import Foundation
import os

/// On-device engine: IrisSpeak-135M card model (ONNX fp16) + trained reranker (3-layer MLP) + MiniLM question
/// similarity. A port of aac_next/src/engine/model.ts. All model files ship inside the app bundle.
struct VocabCard: Decodable {
    var id: String; var speak: String; var category: String; var intent: String
    var core: Int?; var safety: Int?; var composable: Int?; var multiword: Int?
    var is_folder: Int?; var folder: String?; var members: [String]?     // v3 folder rows (folder = browse path)
    var index: Int = 0
    var isFolder: Bool { (is_folder ?? 0) != 0 }
    enum CodingKeys: String, CodingKey { case id, speak, category, intent, core, safety, composable, multiword, is_folder, folder, members }
}

struct ImageEntry: Decodable { var img: String?; var emoji: String? }

private struct CardsJson: Decodable { var cards: [VocabCard]; var start_index: Int; var n_outputs: Int; var V: Int?; var dead: [Int]? }
private struct RerankerJson: Decodable {
    struct Layer: Decodable { var W: [[Float]]; var b: [Float] }
    var K: Int; var dim: Int; var mu: [Float]; var sd: [Float]; var cats: [String]; var ints: [String]; var layers: [Layer]
}
/// Time-of-day prior (reranker bonus per vocabulary category): meal times raise food and drink, after-school
/// hours raise play, evenings raise home and body words. Same table as the web app.
func timePrior(hour: Int, weekday: Bool) -> [String: Float] {
    var b: [String: Float] = [:]
    func add(_ cats: [String], _ v: Float) { for c in cats { b[c] = max(b[c] ?? 0, v) } }
    if hour >= 6 && hour < 9 { add(["food", "drink", "clothes"], 0.4) }
    if hour >= 11 && hour < 14 { add(["food", "drink"], 0.4) }
    if hour >= 17 && hour < 20 { add(["food", "drink", "home"], 0.4) }
    if hour >= 15 && hour < 18 { add(["play", "activities", "things"], 0.3) }
    if hour >= 19 || hour < 6 { add(["home", "body", "feelings"], 0.3) }
    if weekday && hour >= 8 && hour < 15 { add(["school"], 0.3) }
    return b
}
private struct FreqJson: Decodable { var uni: [Double]; var bi: [String: [[Double]]]; var smoothing: Double; var lambda_bi: Double }

/// Locates bundled resources; a directory override lets the macOS parity harness run the same code.
enum Resources {
    nonisolated(unsafe) static var overrideDirectory: URL? = nil
    static func url(_ name: String, _ ext: String) throws -> URL {
        if let dir = overrideDirectory {
            let u = dir.appendingPathComponent("\(name).\(ext)")
            if FileManager.default.fileExists(atPath: u.path) { return u }
        }
        guard let u = Bundle.main.url(forResource: name, withExtension: ext) else { throw EngineError("missing resource \(name).\(ext)") }
        return u
    }
}

struct Prediction {
    var ranked: [Int]
    var p: [Float]
    var endP: Float
}

final class Engine: @unchecked Sendable {
    static let shared = Engine()
    /// Quick-fire row: fixed answers that are always in the same cells (same list as the web app).
    static let coreLabels = ["yes", "no", "i don't know", "help", "more", "stop", "please"]

    @MainActor final class Status: ObservableObject {
        @Published var message = "Loading…"
        @Published var fraction: Double = 0
        @Published var ready = false
        @Published var error: String? = nil
        nonisolated init() {}
    }
    let status = Status()

    private(set) var cards: [VocabCard] = []
    private(set) var byId: [String: VocabCard] = [:]
    private(set) var byLabel: [String: VocabCard] = [:]
    private(set) var images: [String: ImageEntry] = [:]
    /// v3: rows masked out of the softmax at training time (reachable through search and folders only).
    private var dead: [Int] = []
    /// v3: the <folder:*> output rows.
    private(set) var folderRows: [VocabCard] = []
    private var tok: BPETokenizer?
    private var session: OnnxModel?
    private var startIdx = 0, nOut = 0, V = 49152
    private var runsLogged = 0
    private var coreml: CoreMLCardModel?
    /// The sentence realiser (Engine/Realiser.swift), loaded in the background after the card model.
    private(set) var realiser: Realiser?

    /// Physical footprint (what Jetsam counts) and what iOS says is still available to this process.
    static func footprintMB() -> Int {
        var info = task_vm_info_data_t(); var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) { $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) } }
        return kr == KERN_SUCCESS ? Int(info.phys_footprint / 1_048_576) : -1
    }
    static func availableMB() -> Int { Int(os_proc_available_memory() / 1_048_576) }
    private var rr: RerankerJson?
    private var freq: FreqJson?
    private var cardVecs: [Float]?
    private var embed: OnnxModel?
    private var minilmTok: WordPieceTokenizer?
    private var partnerVec: [Float]?
    private var partnerVecFor = ""
    private let queue = DispatchQueue(label: "irisspeak.engine", qos: .userInitiated)
    private var loadTask: Task<Void, Error>?
    private let lock = NSLock()
    private(set) var ready = false
    private(set) var rerankerReady = false
    /// Milliseconds of the last model run (for the debug self-test and logs).
    private(set) var lastRunMs: Double = 0

    private func setLoad(_ msg: String, _ frac: Double? = nil) {
        Task { @MainActor in self.status.message = msg; if let f = frac { self.status.fraction = f } }
    }

    private func ensureLoadTask() -> Task<Void, Error> {
        lock.lock(); defer { lock.unlock() }
        if loadTask == nil { loadTask = Task.detached(priority: .userInitiated) { [self] in try self.loadSync() } }
        return loadTask!
    }
    private func resetLoadTask() { lock.lock(); loadTask = nil; lock.unlock() }

    func load() async throws {
        let task = ensureLoadTask()
        do { try await task.value } catch {
            resetLoadTask()
            Task { @MainActor in self.status.error = error.localizedDescription }
            throw error
        }
    }

    private func loadSync() throws {
        let t0 = Date()
        setLoad("Loading vocabulary…", 0.02)
        let meta = try JSONDecoder().decode(CardsJson.self, from: Data(contentsOf: Resources.url("cards", "json")))
        var cs = meta.cards
        for i in cs.indices { cs[i].index = i }
        cards = cs; startIdx = meta.start_index; nOut = meta.n_outputs; if let v = meta.V { V = v }
        dead = meta.dead ?? []; folderRows = cs.filter { $0.isFolder }
        var bi: [String: VocabCard] = [:]; var bl: [String: VocabCard] = [:]
        for c in cs { bi[c.id] = c; if !c.isFolder { bl[c.speak.lowercased()] = c } }
        byId = bi; byLabel = bl
        images = try JSONDecoder().decode([String: ImageEntry].self, from: Data(contentsOf: Resources.url("card_images", "json")))
        setLoad("Loading tokenizer…", 0.05)
        // tokenizer.json of the backbone the card model was trained on (Qwen3-0.6B on iPad; SmolLM2 was the browser model)
        tok = try BPETokenizer(jsonURL: (try? Resources.url("tokenizer", "json")) ?? Resources.url("smollm2_tokenizer", "json"))
        setLoad("Starting the model…", 0.3)
        // Core ML (native, Neural Engine) when the compiled package is in the bundle; ONNX Runtime otherwise.
        if let u = try? Resources.url("IrisSpeakCard", "mlmodelc") {
            coreml = try CoreMLCardModel(url: u); log("engine: Core ML card model, window \(coreml!.seq)")
        } else {
            session = try OnnxModel(path: try Resources.url("card_model_fp16", "onnx").path, threads: max(2, min(4, ProcessInfo.processInfo.activeProcessorCount)), disablePrepacking: true)
        }
        setLoad("Ready", 1)
        ready = true
        Task { @MainActor in self.status.ready = true }
        log("engine: model ready in \(Int(Date().timeIntervalSince(t0) * 1000)) ms, footprint \(Engine.footprintMB()) MB, available \(Engine.availableMB()) MB")
        loadReranker() // in the background; the model works without it
        queue.async { [self] in
            do {
                if let u = try? Resources.url("IrisSpeakRealiser", "mlmodelc") {
                    realiser = try Realiser(coremlURL: u, tokenizerURL: try Resources.url("realiser_tokenizer", "json"))
                } else {
                    realiser = try Realiser(modelURL: try Resources.url("realiser_fp16", "onnx"), tokenizerURL: try Resources.url("realiser_tokenizer", "json"))
                }
                log("engine: realiser ready on \(realiser!.backendName)")
            } catch { log("engine: realiser unavailable: \(error.localizedDescription)") }
        }
    }

    private func loadReranker() {
        queue.async { [self] in
            do {
                let r = try JSONDecoder().decode(RerankerJson.self, from: Data(contentsOf: Resources.url("reranker", "json")))
                let f = try JSONDecoder().decode(FreqJson.self, from: Data(contentsOf: Resources.url("freq", "json")))
                let cv = try Data(contentsOf: Resources.url("card_vecs", "bin"))
                var vecs = [Float](repeating: 0, count: cv.count / 2)
                cv.withUnsafeBytes { raw in
                    let h = raw.bindMemory(to: UInt16.self)
                    for i in 0..<vecs.count { vecs[i] = f16(h[i]) }
                }
                minilmTok = try WordPieceTokenizer(jsonURL: Resources.url("minilm_tokenizer", "json"))
                embed = try OnnxModel(path: try Resources.url("minilm_l6_v2", "onnx").path, threads: 2)
                rr = r; freq = f; cardVecs = vecs
                rerankerReady = true
                log("engine: reranker ready")
            } catch {
                log("engine: reranker unavailable: \(error)")
                rr = nil
            }
        }
    }

    // MARK: - personal layer

    /// Words in the profile notes that are also cards get a bonus.
    func profileCards() -> Set<String> {
        var out = Set<String>()
        let text = ((Store.getProfile().notes ?? "") + " " + Store.getCustomWords().map { $0.word }.joined(separator: " ")).lowercased()
        let cleaned = String(text.map { ch -> Character in
            if ch.isLetter && ch.isASCII || ch.isNumber && ch.isASCII || ch == "'" || ch == " " { return ch }
            return " "
        })
        let words = cleaned.split(separator: " ").map(String.init).filter { !$0.isEmpty }
        let stop: Set<String> = ["an", "a", "the", "who", "and", "his", "her", "he", "she", "to", "by", "of", "is", "old", "year", "likes", "like", "goes", "friends", "friend", "with", "in", "on", "at"]
        for i in 0..<words.count {
            for cand in [words[i] + " " + (i + 1 < words.count ? words[i + 1] : ""), words[i]] {
                let w = cand.trimmingCharacters(in: .whitespaces)
                if w.isEmpty || stop.contains(w) { continue }
                let singular = w.hasSuffix("s") ? String(w.dropLast()) : w
                if let c = byLabel[w] ?? byLabel[singular], (c.core ?? 0) == 0 { out.insert(c.id) }
            }
        }
        return out
    }

    /// Card ids of a history turn: ours as they are, irisspeak.com's mapped through their labels.
    private func historyIds(_ t: HistoryTurn) -> [String] {
        t.cards.enumerated().compactMap { i, id in
            if byId[id] != nil { return id }
            if let l = t.labels, i < l.count, let c = byLabel[l[i].lowercased()] { return c.id }
            return nil
        }
    }
    private func personalCounts() -> [String: Int] {
        var c: [String: Int] = [:]
        for t in Store.getHistory() { for id in historyIds(t) { c[id, default: 0] += 1 } }
        return c
    }
    /// The child's own card sequences: how often card `id` followed `prev` ("<start>" for the first card).
    private func personalBigrams(_ prev: String) -> [String: Int] {
        var c: [String: Int] = [:]
        for t in Store.getHistory() {
            let seq = ["<start>"] + historyIds(t)
            if seq.count < 2 { continue }
            for i in 1..<seq.count where seq[i - 1] == prev { c[seq[i], default: 0] += 1 }
        }
        return c
    }

    func promptText(_ question: String) -> String {
        let hist = Store.getHistory().map { ($0.partner.isEmpty ? "" : $0.partner + " | ") + $0.answer }
        var total = 0; var kept: [String] = []
        for h0 in hist.reversed() {
            let h = String(h0.prefix(120))
            if kept.count >= 2 || total + h.count > 240 { break }   // two turns, not six: a long "Earlier:" block let past answers outweigh the question being asked
            kept.insert(h, at: 0); total += h.count
        }
        let setting = Store.getProfile().setting.isEmpty ? "home" : Store.getProfile().setting
        var s = "Setting: \(setting).\n"
        if !kept.isEmpty { s += "Earlier: \(kept.joined(separator: " | "))\n" }
        s += question.isEmpty ? "Partner: (nobody has spoken)" : "Partner: \(question.prefix(200))"
        s += "\nReply cards:"
        return s
    }

    private func freqLogp(_ prefixIdx: [Int]) -> (Int) -> Double {
        let f = freq!
        let uniSum = f.uni.reduce(0, +)
        let last = prefixIdx.last ?? -1
        let bi = f.bi[String(last)] ?? []
        var biMap: [Int: Double] = [:]
        for pair in bi where pair.count == 2 { biMap[Int(pair[0])] = pair[1] }
        let biSum = bi.reduce(0.0) { $0 + ($1.count == 2 ? $1[1] : 0) } + f.smoothing * Double(f.uni.count)
        return { j in log(f.lambda_bi * ((biMap[j] ?? f.smoothing) / biSum) + (1 - f.lambda_bi) * (f.uni[j] / uniSum)) }
    }

    /// MiniLM sentence embedding (mean pooled, L2-normalised) for the reranker's similarity feature.
    func embedText(_ text: String) throws -> [Float] {
        guard let embed = embed, let mt = minilmTok else { throw EngineError("embedder not loaded") }
        let ids = mt.encode(text).map { Int64($0) }
        let L = ids.count
        let feed = [
            "input_ids": try OnnxModel.int64Tensor(ids, shape: [1, L]),
            "attention_mask": try OnnxModel.int64Tensor([Int64](repeating: 1, count: L), shape: [1, L]),
            "token_type_ids": try OnnxModel.int64Tensor([Int64](repeating: 0, count: L), shape: [1, L]),
        ]
        let out = try embed.runFloat(inputs: feed, output: "last_hidden_state")
        let dim = out.shape[2]
        var v = [Float](repeating: 0, count: dim)
        for t in 0..<L { for k in 0..<dim { v[k] += out.values[t * dim + k] } }
        var norm: Float = 0
        for k in 0..<dim { v[k] /= Float(L); norm += v[k] * v[k] }
        norm = sqrt(norm)
        if norm > 0 { for k in 0..<dim { v[k] /= norm } }
        return v
    }

    private func rerank(order: [Int], p: [Float], question: String, prefix: [String]) throws -> [Int]? {
        guard let rr = rr, embed != nil, Store.getProfile().useReranker else { return nil }
        var sim: (Int) -> Float = { _ in 0 }
        if !question.isEmpty {
            if partnerVecFor != question { partnerVec = try embedText(question); partnerVecFor = question }
            let pv = partnerVec!, cv = cardVecs!
            sim = { j in var d: Float = 0; for k in 0..<384 { d += cv[j * 384 + k] * pv[k] }; return d }
        }
        let fl = freqLogp(prefix.compactMap { byId[$0]?.index })
        let counts = personalCounts(); let profile = profileCards()
        let bigr = personalBigrams(prefix.last ?? "<start>")
        let now = Date(); let cal = Calendar.current
        let wd = cal.component(.weekday, from: now); let tp = timePrior(hour: cal.component(.hour, from: now), weekday: wd >= 2 && wd <= 6)
        let top = Array(order.prefix(rr.K))
        var scores: [(Int, Float)] = []; scores.reserveCapacity(top.count)
        for (r, j) in top.enumerated() {
            let c = cards[j]
            var x = [Float](repeating: 0, count: rr.dim); var o = 0
            let raw: [Float] = [log(p[j] + 1e-12), log(Float(r + 1)), Float(fl(j)), sim(j)]
            for k in 0..<4 { x[o] = (raw[k] - rr.mu[k]) / rr.sd[k]; o += 1 }
            for cat in rr.cats { x[o] = c.category == cat ? 1 : 0; o += 1 }
            for it in rr.ints { x[o] = c.intent == it ? 1 : 0; o += 1 }
            x[o] = Float(c.core ?? 0); o += 1; x[o] = Float(c.safety ?? 0); o += 1
            x[o] = Float(c.composable ?? 0); o += 1; x[o] = Float(c.multiword ?? 0); o += 1
            x[o] = c.id == "<aac_end>" ? 1 : 0; o += 1; x[o] = c.id == "<name>" ? 1 : 0; o += 1
            x[o] = Float(min(prefix.count, 6)) / 6; o += 1; x[o] = question.isEmpty ? 0 : 1; o += 1
            if o < rr.dim { x[o] = c.isFolder ? 1 : 0; o += 1 }      // v3 reranker (54 dims)
            var h = x
            for (li, L) in rr.layers.enumerated() {
                var y = [Float](repeating: 0, count: L.b.count)
                for i in 0..<L.b.count {
                    var acc = L.b[i]; let W = L.W[i]
                    for k in 0..<min(W.count, h.count) { acc += W[k] * h[k] }
                    y[i] = li < rr.layers.count - 1 ? max(0, acc) : acc
                }
                h = y
            }
            let pc = counts[c.id] ?? 0, pb = bigr[c.id] ?? 0
            // The personal layer reorders cards the model already finds plausible; it must not resurrect ones it
            // doesn't. A child who said "water" a few times was getting Water on the board for "What did you
            // learn?". So the bonus fades with the model's own ranking and never applies to function words.
            let pw = max(0, 1 - Float(r) / 60)
            let personal = (c.core ?? 0) != 0 ? 0 : pw * (0.3 * log(1 + Float(pc)) + 0.25 * log(1 + Float(pb)))
            scores.append((j, h[0] + personal + (profile.contains(c.id) ? 0.8 : 0) + (tp[c.category] ?? 0)))
        }
        scores.sort { $0.1 > $1.1 }
        return scores.map { $0.0 } + Array(order.dropFirst(rr.K))   // reranked top K, then the model's order
    }

    /// Ranked card indices (best first) and the model's probability vector for the current state.
    func predict(question: String, prefix: [String]) async throws -> Prediction {
        try await load()
        return try await withCheckedThrowingContinuation { cont in
            queue.async {
                do { cont.resume(returning: try self.predictSync(question: question, prefix: prefix)) }
                catch { cont.resume(throwing: error) }
            }
        }
    }

    /// Synchronous prediction on the engine queue (also used by the parity harness).
    func predictSync(question: String, prefix: [String], promptOverride: String? = nil, rerankEnabled: Bool = true) throws -> Prediction {
        guard let tok = tok, coreml != nil || session != nil else { throw EngineError("model not loaded") }
        let textIds = tok.encode(promptOverride ?? promptText(question))
        var ids = textIds.map { Int64($0) }
        ids.append(Int64(V + startIdx))
        ids.append(contentsOf: prefix.compactMap { byId[$0] }.map { Int64(V + $0.index) }.suffix(10))
        let L = ids.count
        let t0 = Date()
        var logits: [Float]
        if let cm = coreml {
            logits = try cm.cardLogits(ids: ids.map { Int32($0) })
            if logits.count > nOut { logits = Array(logits[0..<nOut]) }
        } else {
            let session = session!
            var feed = [
                "input_ids": try OnnxModel.int64Tensor(ids, shape: [1, L]),
                "attention_mask": try OnnxModel.int64Tensor([Int64](repeating: 1, count: L), shape: [1, L]),
            ]
            if session.inputNames.contains("position_ids") {
                feed["position_ids"] = try OnnxModel.int64Tensor((0..<L).map { Int64($0) }, shape: [1, L])
            }
            let out = try session.runFloat(inputs: feed, output: "logits")
            let vocabExt = out.shape[2]
            let base = (out.shape[1] - 1) * vocabExt + V          // the iOS export returns only the last position ([1, 1, V+nOut])
            logits = Array(out.values[base..<(base + nOut)])
        }
        lastRunMs = Date().timeIntervalSince(t0) * 1000
        if runsLogged < 3 { runsLogged += 1; log("engine: run \(Int(lastRunMs)) ms, L=\(L), footprint \(Engine.footprintMB()) MB, available \(Engine.availableMB()) MB") }
        for i in dead where i < nOut { logits[i] = -1e4 }          // same mask the model was trained with
        var m = -Float.infinity
        for i in 0..<nOut { m = max(m, logits[i]) }
        var p = [Float](repeating: 0, count: nOut); var z: Float = 0
        for i in 0..<nOut { p[i] = exp(logits[i] - m); z += p[i] }
        for i in 0..<nOut { p[i] /= z }
        let order = (0..<nOut).sorted { p[$0] > p[$1] }
        let ranked = rerankEnabled ? (try rerank(order: order, p: p, question: question, prefix: prefix) ?? order) : order
        let endIdx = byId["<aac_end>"]?.index ?? 0
        return Prediction(ranked: ranked, p: p, endP: p[endIdx])
    }

    // MARK: - sentence realiser

    private static let proper = try! NSRegularExpression(pattern: #"^(I|I'.*|I .*|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Christmas|Easter|Halloween|Thanksgiving|Mum|Mom|Dad|Grandma|Grandpa|Nan|Nana|Pop|God|Jesus|YouTube|Minecraft|Roblox|Lego|iPad|TV|McDonald's|Disney|America|England|Australia|Canada|USA|UK|New .*|North .*|South .*|London|Paris|Europe|Africa|Asia|Arctic)$"#)

    /// Turn tapped card ids (or labels) into a spoken sentence with a fixed rule (no language model involved).
    func realise(_ ids: [String]) -> String {
        let words = ids.map { id -> String in
            let w = byId[id]?.speak ?? id
            let isProper = Engine.proper.firstMatch(in: w, range: NSRange(location: 0, length: (w as NSString).length)) != nil
            return isProper ? w : w.lowercased()
        }
        var s = words.joined(separator: " ")
        s = s.replacingOccurrences(of: #"\s+([,.!?])"#, with: "$1", options: .regularExpression)
        if let first = words.first, ["yes", "no", "maybe", "ok", "sure"].contains(first.lowercased()), words.count > 1 {
            s = first + ", " + words.dropFirst().joined(separator: " ")
        }
        if let f = s.first { s = String(f).uppercased() + s.dropFirst() }
        if !(s.hasSuffix(".") || s.hasSuffix("!") || s.hasSuffix("?")) { s += "." }
        return s
    }
}

private func f16(_ h: UInt16) -> Float {
    let s: Float = (h & 0x8000) != 0 ? -1 : 1
    let e = Int((h >> 10) & 0x1f)
    let m = Float(h & 0x3ff)
    if e == 0 { return s * m * powf(2, -24) }
    if e == 31 { return m != 0 ? .nan : s * .infinity }
    return s * (1 + m / 1024) * powf(2, Float(e - 15))
}

func log(_ message: String) {
    let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)"
    print(line)
    DebugLog.append(line)
}
