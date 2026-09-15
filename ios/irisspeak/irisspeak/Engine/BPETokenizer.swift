import Foundation

/// Byte-level BPE tokenizer matching Hugging Face `tokenizers`, configured from tokenizer.json itself:
///  * SmolLM2 (GPT-2 style): Digits(individual_digits) → ByteLevel(use_regex, GPT-2 pattern), no normalizer
///  * Qwen3: NFC normalizer → Split(Qwen regex) → ByteLevel(use_regex=false)
/// model = BPE over byte-to-unicode symbols; no post-processor (so `add_special_tokens` adds nothing).
final class BPETokenizer {
    private let vocab: [String: Int]
    private let ranks: [String: Int]          // "a b" → merge rank
    private let addedTokens: [String: Int]
    private let byteEncoder: [UInt8: Character]
    private let regex: NSRegularExpression
    private let splitDigitsFirst: Bool
    private let nfc: Bool
    private var cache: [String: [Int]] = [:]
    private let cacheLock = NSLock()

    init(jsonURL: URL) throws {
        let data = try Data(contentsOf: jsonURL)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let model = root["model"] as? [String: Any],
              let vocabAny = model["vocab"] as? [String: Any],
              let mergesAny = model["merges"] as? [Any] else { throw EngineError("tokenizer.json: unexpected structure") }
        var v: [String: Int] = [:]; v.reserveCapacity(vocabAny.count)
        for (k, x) in vocabAny { if let n = x as? Int { v[k] = n } else if let n = x as? NSNumber { v[k] = n.intValue } }
        vocab = v
        var r: [String: Int] = [:]; r.reserveCapacity(mergesAny.count)
        for (i, m) in mergesAny.enumerated() {
            if let s = m as? String { r[s] = i }                       // "Ġ t"
            else if let pair = m as? [String], pair.count == 2 { r[pair[0] + " " + pair[1]] = i }
        }
        ranks = r
        var added: [String: Int] = [:]
        for a in (root["added_tokens"] as? [[String: Any]]) ?? [] {
            if let c = a["content"] as? String, let id = (a["id"] as? NSNumber)?.intValue { added[c] = id }
        }
        addedTokens = added
        byteEncoder = BPETokenizer.bytesToUnicode()
        // pre-tokenizer: read the pipeline from the file. A Split step carries its own regex (Qwen); a ByteLevel
        // step with use_regex means the GPT-2 pattern (SmolLM2); a Digits step splits digits first.
        var pattern = #"'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+"#
        var digits = false
        var steps: [[String: Any]] = []
        if let pre = root["pre_tokenizer"] as? [String: Any] {
            if let seq = pre["pretokenizers"] as? [[String: Any]] { steps = seq } else { steps = [pre] }
        }
        for st in steps {
            switch st["type"] as? String {
            case "Digits": digits = true
            case "Split": if let pat = st["pattern"] as? [String: Any], let rx = pat["Regex"] as? String { pattern = rx }
            default: break
            }
        }
        splitDigitsFirst = digits
        nfc = ((root["normalizer"] as? [String: Any])?["type"] as? String) == "NFC"
        regex = try NSRegularExpression(pattern: pattern, options: [])
    }

    var vocabSize: Int { vocab.count }
    private lazy var idToToken: [Int: String] = { var m: [Int: String] = [:]; for (k, v) in vocab { m[v] = k }; for (k, v) in addedTokens { m[v] = k }; return m }()
    private lazy var byteDecoder: [Character: UInt8] = { var m: [Character: UInt8] = [:]; for (b, c) in byteEncoder { m[c] = b }; return m }()

    /// Id of an added (special) token such as <|endoftext|> or <|im_end|>, if the tokenizer has it.
    func specialId(_ content: String) -> Int? { addedTokens[content] }
    /// True for added/special tokens (never part of a sentence).
    func isSpecial(_ id: Int) -> Bool { addedTokens.values.contains(id) }

    /// Inverse of encode: byte-level symbols back to UTF-8 text (special tokens are dropped).
    func decode(_ ids: [Int]) -> String {
        var bytes: [UInt8] = []
        for id in ids {
            guard let t = idToToken[id], !isSpecial(id) else { continue }
            for ch in t { if let b = byteDecoder[ch] { bytes.append(b) } }
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    func encode(_ text: String) -> [Int] {
        var out: [Int] = []
        let src = nfc ? text.precomposedStringWithCanonicalMapping : text
        // Split around added (special) tokens first, as `tokenizers` does.
        for (piece, special) in splitAdded(src) {
            if special { out.append(addedTokens[piece]!); continue }
            for digitPiece in (splitDigitsFirst ? splitDigits(piece) : [piece]) {
                for chunk in regexSplit(digitPiece) { out.append(contentsOf: bpe(chunk)) }
            }
        }
        return out
    }

    // MARK: - pieces

    private func splitAdded(_ text: String) -> [(String, Bool)] {
        guard addedTokens.keys.contains(where: { text.contains($0) }) else { return [(text, false)] }
        var result: [(String, Bool)] = []
        var rest = Substring(text)
        while !rest.isEmpty {
            var best: (Range<Substring.Index>, String)? = nil
            for tok in addedTokens.keys {
                if let r = rest.range(of: tok), best == nil || r.lowerBound < best!.0.lowerBound || (r.lowerBound == best!.0.lowerBound && tok.count > best!.1.count) { best = (r, tok) }
            }
            guard let (r, tok) = best else { result.append((String(rest), false)); break }
            if r.lowerBound > rest.startIndex { result.append((String(rest[rest.startIndex..<r.lowerBound]), false)) }
            result.append((tok, true))
            rest = rest[r.upperBound...]
        }
        return result
    }

    /// Digits(individual_digits=true): every digit becomes its own piece; other runs stay together.
    private func splitDigits(_ s: String) -> [String] {
        var out: [String] = []; var cur = ""
        for ch in s.unicodeScalars {
            if CharacterSet.decimalDigits.contains(ch) {
                if !cur.isEmpty { out.append(cur); cur = "" }
                out.append(String(ch))
            } else { cur.unicodeScalars.append(ch) }
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }

    private func regexSplit(_ s: String) -> [String] {
        let ns = s as NSString
        return regex.matches(in: s, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
    }

    // MARK: - BPE

    private func bpe(_ chunk: String) -> [Int] {
        cacheLock.lock(); if let c = cache[chunk] { cacheLock.unlock(); return c }; cacheLock.unlock()
        // bytes → unicode symbols
        var word: [String] = Array(chunk.utf8).map { String(byteEncoder[$0]!) }
        if word.count > 1 {
            while true {
                var bestRank = Int.max; var bestIdx = -1
                for i in 0..<(word.count - 1) {
                    if let r = ranks[word[i] + " " + word[i + 1]], r < bestRank { bestRank = r; bestIdx = i }
                }
                if bestIdx < 0 { break }
                let merged = word[bestIdx] + word[bestIdx + 1]
                var next: [String] = []; next.reserveCapacity(word.count)
                var i = 0
                while i < word.count {
                    if i < word.count - 1 && word[i] == word[bestIdx] && word[i + 1] == word[bestIdx + 1] { next.append(merged); i += 2 }
                    else { next.append(word[i]); i += 1 }
                }
                word = next
                if word.count == 1 { break }
            }
        }
        let ids = word.map { vocab[$0] ?? addedTokens["<|endoftext|>"] ?? 0 }
        cacheLock.lock(); if cache.count < 20000 { cache[chunk] = ids }; cacheLock.unlock()
        return ids
    }

    private static func bytesToUnicode() -> [UInt8: Character] {
        var bs: [Int] = Array(33...126) + Array(161...172) + Array(174...255)
        var cs = bs
        var n = 0
        for b in 0..<256 where !bs.contains(b) { bs.append(b); cs.append(256 + n); n += 1 }
        var map: [UInt8: Character] = [:]
        for (b, c) in zip(bs, cs) { map[UInt8(b)] = Character(UnicodeScalar(c)!) }
        return map
    }
}
