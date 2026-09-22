import Foundation
import OnnxRuntimeBindings
import CoreML

/// The on-device sentence realiser (port of aac_next/src/engine/realiser.ts): a small causal LM turns the tapped
/// cards plus the partner's question into one sentence, decoded with a KV cache under a hard vocabulary
/// constraint — only the card words (and their inflections), function words and punctuation may appear.
final class Realiser {
    /// Words the model may add freely. Negations and question words are not here: they change the meaning, so the
    /// negation family is unlocked only when a tapped card is one ("not", "no", "don't"…).
    static let functionWords = ("i me my mine you your yours we us our he him his she her hers it its they them their this that these those there here " +
        "a an the some any to of in on at for with from by about up down out off over into and or but so because if yes " +
        "do does did can could will would should may might must is am are was were be been being have has had having " +
        "want wants wanted need needs needed like likes liked get got go going went let let's please thank thanks very really too also more again now today tomorrow yesterday " +
        "okay ok all just still only than then one it's i'm i've i'll i'd you're we're they're he's she's that's there's").split(separator: " ").map(String.init)
    static let negations = "not no n't don't doesn't didn't can't couldn't won't wouldn't shouldn't isn't aren't wasn't weren't haven't hasn't never".split(separator: " ").map(String.init)
    static let punct = [".", ",", "!", "?", "'", "'s", "'m", "'re", "'ll", "'ve", "'d", " .", " ,", " !", " ?", ". ", "! ", "? "]

    /// Core ML (native, a fixed window re-run per token) or ONNX Runtime (KV cache) — same decoder on top.
    private enum Backend { case coreml(MLModel, window: Int); case ort(OnnxModel) }
    private let backend: Backend
    private let tok: BPETokenizer
    private let layers: Int, kvHeads: Int, headDim: Int
    private var eos: Set<Int> = []
    private var punctIds: Set<Int> = []
    private var idCache: [String: [Int]] = [:]
    var backendName: String { if case .coreml(_, let w) = backend { return "Core ML (window \(w))" }; return "ONNX Runtime (KV cache)" }

    /// ONNX Runtime backend (export/export_realiser.py: realiser_fp16.onnx with past key/values).
    init(modelURL: URL, tokenizerURL: URL, layers: Int = 30, kvHeads: Int = 3, headDim: Int = 64) throws {
        backend = .ort(try OnnxModel(path: modelURL.path, threads: 2, disablePrepacking: true))
        tok = try BPETokenizer(jsonURL: tokenizerURL)
        self.layers = layers; self.kvHeads = kvHeads; self.headDim = headDim
        eos = Set(ids("\n") + [tok.specialId("<|endoftext|>") ?? 0, tok.specialId("<|im_end|>") ?? 2])
        for p in Realiser.punct { for id in ids(p) { punctIds.insert(id) } }
    }
    /// Core ML backend (export/export_coreml_realiser.py: IrisSpeakRealiser.mlpackage, right-padded window).
    init(coremlURL: URL, tokenizerURL: URL) throws {
        let cfg = MLModelConfiguration(); cfg.computeUnits = .all
        let m = try MLModel(contentsOf: coremlURL, configuration: cfg)
        let shape = m.modelDescription.inputDescriptionsByName["input_ids"]?.multiArrayConstraint?.shape.map { $0.intValue } ?? [1, 64]
        backend = .coreml(m, window: shape.count == 2 ? shape[1] : 64)
        tok = try BPETokenizer(jsonURL: tokenizerURL)
        layers = 0; kvHeads = 0; headDim = 0
        eos = Set(ids("\n") + [tok.specialId("<|endoftext|>") ?? 0, tok.specialId("<|im_end|>") ?? 2])
        for p in Realiser.punct { for id in ids(p) { punctIds.insert(id) } }
    }

    /// Logits of the last position for `seq` (Core ML: one windowed pass, no cache).
    private func coremlLastLogits(_ m: MLModel, window: Int, seq: [Int]) throws -> [Float] {
        let L = min(seq.count, window)
        let inIds = try MLMultiArray(shape: [1, NSNumber(value: window)], dataType: .int32), inMask = try MLMultiArray(shape: [1, NSNumber(value: window)], dataType: .int32)
        let pi = inIds.dataPointer.assumingMemoryBound(to: Int32.self), pm = inMask.dataPointer.assumingMemoryBound(to: Int32.self)
        for i in 0..<window { pi[i] = i < L ? Int32(seq[seq.count - L + i]) : 0; pm[i] = i < L ? 1 : 0 }
        let out = try m.prediction(from: try MLDictionaryFeatureProvider(dictionary: ["input_ids": inIds, "attention_mask": inMask]))
        guard let arr = out.featureValue(for: "logits")?.multiArrayValue else { throw EngineError("missing logits") }
        let V = arr.shape.last!.intValue, rowStride = arr.strides[1].intValue, colStride = arr.strides[2].intValue, base = (L - 1) * rowStride
        var lg = [Float](repeating: 0, count: V)
        if arr.dataType == .float16 { let p = arr.dataPointer.assumingMemoryBound(to: Float16.self); for j in 0..<V { lg[j] = Float(p[base + j * colStride]) } }
        else { let p = arr.dataPointer.assumingMemoryBound(to: Float.self); for j in 0..<V { lg[j] = p[base + j * colStride] } }
        return lg
    }

    /// Which inflections each card word may be said in; empty if realiser_forms.json is missing, which can
    /// only ever under-generate.
    var forms: [String: [String]] = [:]
    private var funcTrie = Trie(); private var negTrie = Trie(); private var triesBuilt = false

    private func buildStaticTries() {
        guard !triesBuilt else { return }
        funcTrie = Trie(); for f in Realiser.functionWords { addWord(f, into: &funcTrie, withForms: false) }
        negTrie = Trie(); for f in Realiser.negations { addWord(f, into: &negTrie, withForms: false) }
        triesBuilt = true
    }

    private func ids(_ text: String) -> [Int] {
        if let v = idCache[text] { return v }
        let v = tok.encode(text); idCache[text] = v; return v
    }
    /// A trie over the token spellings of the words that may be said. `start` holds the space-initial first
    /// tokens, the only ones allowed to begin a new word.
    struct Trie { var ch: [String: Set<Int>] = [:]; var term: Set<String> = []; var start: Set<Int> = [] }

    /// Insert every spelling of `word`, so only whole words can be said. A flat set of token ids let any BPE
    /// *prefix* of an allowed word out on its own: "busy" is ["bus","y"], so the board said "bus" for a card
    /// nobody tapped (docs/PLAN-REALISER.md 12). Inflections come from `forms` (built by
    /// data/build_realiser_forms.py), not from applying the spelling rules blindly, which produced "busies".
    private func addWord(_ word: String, into t: inout Trie, withForms: Bool) {
        let w = word.trimmingCharacters(in: .whitespaces); guard !w.isEmpty else { return }
        var spellings: Set<String> = [w, w.lowercased(), w.prefix(1).uppercased() + w.dropFirst().lowercased()]
        if withForms { for x in forms[w.lowercased()] ?? [] { spellings.insert(x); spellings.insert(x.prefix(1).uppercased() + x.dropFirst()) } }
        for f in spellings {
            for v in [f, " " + f] {
                let seq = ids(v); guard !seq.isEmpty else { continue }
                for i in 0..<seq.count {
                    let k = seq[0..<i].map(String.init).joined(separator: ",")
                    t.ch[k, default: []].insert(seq[i])
                }
                t.term.insert(seq.map(String.init).joined(separator: ","))
                if v.hasPrefix(" ") { t.start.insert(seq[0]) }
            }
        }
    }

    /// The sentence for the tapped cards, or nil when decoding produced nothing usable. With `sample`, tokens are drawn
    /// from the top of the allowed distribution (temperature 0.9, top 8) so "Another" gives a different wording; up to
    /// four draws are tried to find one not in `avoid`.
    func realise(cards: [String], partner: String, maxNew: Int = 20, sample: Bool = false, avoid: [String] = [], setting: String? = nil) throws -> String? {
        let seen = Set(avoid.map { $0.lowercased() })
        for _ in 0..<(sample ? 4 : 1) {
            if let s = try decode(cards: cards, partner: partner, setting: setting, maxNew: maxNew, sample: sample), !seen.contains(s.lowercased()) { return s }
        }
        return nil
    }

    private func decode(cards: [String], partner: String, setting: String?, maxNew: Int, sample: Bool) throws -> String? {
        guard !cards.isEmpty else { return nil }
        buildStaticTries()
        var cardTrie = Trie()
        for c in cards {
            for w in c.split(whereSeparator: { !$0.isLetter && $0 != "'" }) { addWord(String(w), into: &cardTrie, withForms: true) }
        }
        let negOk = cards.contains(where: { Realiser.negations.contains($0.lowercased().trimmingCharacters(in: .whitespaces)) || $0.lowercased().hasSuffix("n't") })
        let tries: [Trie] = negOk ? [funcTrie, negTrie, cardTrie] : [funcTrie, cardTrie]
        let stop = punctIds.union(eos)
        func childrenOf(_ k: String) -> Set<Int> { var out = Set<Int>(); for t in tries { if let c = t.ch[k] { out.formUnion(c) } }; return out }
        func isTerm(_ k: String) -> Bool { tries.contains { $0.term.contains(k) } }
        func canStart(_ id: Int) -> Bool { tries.contains { $0.start.contains(id) } }
        // legal() runs once per generated token and the word-start set is large, so memoise it per word-state
        var legalMemo: [String: [Int]] = [:]
        func legal(_ k: String) -> [Int] {
            if let v = legalMemo[k] { return v }
            var set = childrenOf(k)
            if k.isEmpty || isTerm(k) { for t in tries { set.formUnion(t.start) }; set.formUnion(stop) }
            let v = Array(set); legalMemo[k] = v; return v
        }
        var path: [Int] = []
        let p = partner.trimmingCharacters(in: .whitespaces)
        // Same prompt train/train_realiser.py builds; the Setting line was missing here too (docs/PLAN-REALISER.md §2).
        let place = (setting ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let prompt = "Setting: \(place.isEmpty ? "unknown" : place).\nPartner: \(p.isEmpty ? "(nobody has spoken)" : p)\nCards: \(cards.joined(separator: " | "))\nSentence:"
        var promptIds = ids(prompt)
        if case .coreml(_, let w) = backend, promptIds.count > w - maxNew { promptIds = Array(promptIds.suffix(w - maxNew)) }   // keep the end of a long prompt
        let L0 = promptIds.count
        var past: [String: ORTValue] = [:]; var feeds: [String: ORTValue] = [:]
        if case .ort = backend { past = try emptyPast(); feeds = try feed(promptIds, pos0: 0, total: L0, past: past) }
        var out: [Int] = []; var lastTok = -1; var reps = 0
        let outputs = ["logits"] + (0..<layers).flatMap { ["present.\($0).key", "present.\($0).value"] }
        for _ in 0..<maxNew {
            var logits: [Float] = []; var V = 0; var row = 0; var res: [String: ORTValue] = [:]
            switch backend {
            case .coreml(let m, let w):
                if L0 + out.count < w { logits = try coremlLastLogits(m, window: w, seq: promptIds + out); V = logits.count }
            case .ort(let model):
                res = try model.run(inputs: feeds, outputs: outputs)
                if let lv = res["logits"] { let (lg, shape) = try OnnxModel.floats(lv); logits = lg; V = shape[2]; row = (shape[1] - 1) * V }
            }
            if logits.isEmpty { break }
            let pathKey = path.map(String.init).joined(separator: ",")
            let cand = legal(pathKey)
            if cand.isEmpty { break }
            var best = -1; var bestV = -Float.infinity
            if sample {
                // top-8 of the legal tokens at temperature 0.9
                var top: [(Int, Float)] = []
                for id in cand where id < V { let v = logits[row + id]; if top.count < 8 { top.append((id, v)); top.sort { $0.1 > $1.1 } } else if v > top[7].1 { top[7] = (id, v); top.sort { $0.1 > $1.1 } } }
                if top.isEmpty { break }
                let m = top[0].1; let w = top.map { exp(($0.1 - m) / 0.9) }; var r = Float.random(in: 0..<w.reduce(0, +)); best = top[top.count - 1].0
                for (i, wi) in w.enumerated() { r -= wi; if r <= 0 { best = top[i].0; break } }
            } else {
                for id in cand where id < V { let v = logits[row + id]; if v > bestV { bestV = v; best = id } }
            }
            if best < 0 || eos.contains(best) { break }
            // advance the trie: continue this word, else begin a new one, else fall back to a word boundary
            if childrenOf(pathKey).contains(best) { path.append(best) }
            else if canStart(best) && (pathKey.isEmpty || isTerm(pathKey)) { path = [best] }
            else { path = [] }
            reps = best == lastTok ? reps + 1 : 0; lastTok = best; if reps >= 2 { break }
            out.append(best)
            if case .ort = backend {
                past = [:]; for (k, v) in res where k.hasPrefix("present.") { past["past_key_values." + k.dropFirst(8)] = v }
                feeds = try feed([best], pos0: L0 + out.count - 1, total: L0 + out.count, past: past)
            }
        }
        guard !out.isEmpty else { return nil }
        var s = tok.decode(out).components(separatedBy: "\n")[0].trimmingCharacters(in: .whitespaces)
        s = s.trimmingCharacters(in: CharacterSet(charactersIn: "\"“”'")).trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty else { return nil }
        s = s.replacingOccurrences(of: #"\s+([,.!?])"#, with: "$1", options: .regularExpression)
        s = s.prefix(1).uppercased() + s.dropFirst()
        if !(s.hasSuffix(".") || s.hasSuffix("!") || s.hasSuffix("?")) { s += "." }
        return s
    }

    private func feed(_ tokens: [Int], pos0: Int, total: Int, past: [String: ORTValue]) throws -> [String: ORTValue] {
        var f = past
        f["input_ids"] = try OnnxModel.int64Tensor(tokens.map { Int64($0) }, shape: [1, tokens.count])
        f["attention_mask"] = try OnnxModel.int64Tensor([Int64](repeating: 1, count: total), shape: [1, total])
        f["position_ids"] = try OnnxModel.int64Tensor((0..<tokens.count).map { Int64(pos0 + $0) }, shape: [1, tokens.count])
        return f
    }
    private func emptyPast() throws -> [String: ORTValue] {
        var p: [String: ORTValue] = [:]
        for l in 0..<layers { for kv in ["key", "value"] { p["past_key_values.\(l).\(kv)"] = try OnnxModel.floatTensor([], shape: [1, kvHeads, 0, headDim]) } }
        return p
    }
}

/// Word forms (port of aac_next/src/engine/grammar.ts): plural, past, -ing, third person, possessive.
enum Inflect {
    enum Form: CaseIterable { case plural, past, ing, third, possessive }
    static let irregularPast: [String: String] = ["go": "went", "eat": "ate", "drink": "drank", "see": "saw", "come": "came", "run": "ran", "sit": "sat", "sleep": "slept", "get": "got", "give": "gave", "have": "had", "make": "made", "take": "took", "read": "read", "write": "wrote", "draw": "drew", "swim": "swam", "sing": "sang", "ride": "rode", "fall": "fell", "feel": "felt", "find": "found", "hurt": "hurt", "buy": "bought", "bring": "brought", "think": "thought", "say": "said", "tell": "told", "do": "did", "put": "put", "cut": "cut", "hit": "hit", "win": "won", "lose": "lost", "build": "built", "break": "broke", "wear": "wore", "throw": "threw", "catch": "caught", "hold": "held", "hear": "heard", "know": "knew", "leave": "left", "meet": "met", "forget": "forgot", "begin": "began", "fly": "flew", "grow": "grew", "hide": "hid", "keep": "kept", "let": "let", "lie": "lay", "pay": "paid", "send": "sent", "shake": "shook", "speak": "spoke", "stand": "stood", "teach": "taught", "wake": "woke", "is": "was", "are": "were", "am": "was", "can": "could", "will": "would", "want": "wanted", "like": "liked"]
    static let irregularPlural: [String: String] = ["child": "children", "foot": "feet", "tooth": "teeth", "mouse": "mice", "man": "men", "woman": "women", "person": "people", "fish": "fish", "sheep": "sheep", "deer": "deer", "goose": "geese", "leaf": "leaves", "knife": "knives", "life": "lives", "wolf": "wolves", "potato": "potatoes", "tomato": "tomatoes", "hero": "heroes", "mum": "mums", "mom": "moms"]
    static let irregularThird: [String: String] = ["have": "has", "do": "does", "go": "goes", "be": "is", "am": "is", "are": "is", "can": "can", "will": "will", "say": "says"]
    static let irregularIng: [String: String] = ["lie": "lying", "die": "dying", "tie": "tying", "be": "being", "see": "seeing", "is": "being", "are": "being", "am": "being"]
    static let noDouble: Set<String> = ["open", "listen", "visit", "happen", "enter", "offer", "order", "answer", "water", "color", "colour", "wonder", "remember", "travel", "cancel"]
    static let vowels = Set("aeiou")

    static func cvc(_ w: String) -> Bool {
        let c = Array(w); guard c.count >= 3, c.count <= 5, !noDouble.contains(w) else { return false }
        let a = c[c.count - 3], b = c[c.count - 2], z = c[c.count - 1]
        return !vowels.contains(a) && vowels.contains(b) && !vowels.contains(z) && !"wxy".contains(z)
    }
    static func inflect(_ word: String, _ form: Form) -> String? {
        let w = word.trimmingCharacters(in: .whitespaces)
        guard !w.isEmpty, w.rangeOfCharacter(from: .decimalDigits) == nil, !w.contains("'") else { return nil }
        let parts = w.split(separator: " ").map(String.init); guard parts.count <= 2 else { return nil }
        let head = parts.count == 2 ? parts[1] : parts[0]; let prefix = parts.count == 2 ? parts[0] + " " : ""
        let lw = head.lowercased(); var out: String? = nil
        func endsAny(_ s: String, _ suf: [String]) -> Bool { suf.contains { s.hasSuffix($0) } }
        func consY(_ s: String) -> Bool { s.hasSuffix("y") && s.count > 1 && !vowels.contains(s[s.index(s.endIndex, offsetBy: -2)]) }
        switch form {
        case .plural:
            if let x = irregularPlural[lw] { out = x } else if endsAny(lw, ["s", "x", "z", "ch", "sh"]) { out = lw + "es" } else if consY(lw) { out = String(lw.dropLast()) + "ies" } else { out = lw + "s" }
        case .past:
            if let x = irregularPast[lw] { out = x } else if lw.hasSuffix("e") { out = lw + "d" } else if consY(lw) { out = String(lw.dropLast()) + "ied" } else if cvc(lw) { out = lw + String(lw.last!) + "ed" } else { out = lw + "ed" }
        case .ing:
            if let x = irregularIng[lw] { out = x } else if lw.hasSuffix("ie") { out = String(lw.dropLast(2)) + "ying" } else if lw.hasSuffix("e") && !lw.hasSuffix("ee") && lw != "be" { out = String(lw.dropLast()) + "ing" } else if cvc(lw) { out = lw + String(lw.last!) + "ing" } else { out = lw + "ing" }
        case .third:
            if let x = irregularThird[lw] { out = x } else if endsAny(lw, ["s", "x", "z", "ch", "sh", "o"]) { out = lw + "es" } else if consY(lw) { out = String(lw.dropLast()) + "ies" } else { out = lw + "s" }
        case .possessive:
            out = lw.hasSuffix("s") ? lw + "'" : lw + "'s"
        }
        guard let o = out, o != lw else { return nil }
        let cap = head.first!.isUppercase ? o.prefix(1).uppercased() + o.dropFirst() : o
        return prefix + cap
    }
}
