import Foundation

/// BERT WordPiece tokenizer for all-MiniLM-L6-v2 (uncased): BertNormalizer(lowercase, strip accents,
/// clean text, CJK spacing) → BertPreTokenizer (whitespace + punctuation) → greedy longest-match WordPiece,
/// wrapped as [CLS] … [SEP].
final class WordPieceTokenizer {
    private let vocab: [String: Int]
    private let unkId: Int
    let clsId: Int
    let sepId: Int
    private let maxInputCharsPerWord = 100

    init(jsonURL: URL) throws {
        let data = try Data(contentsOf: jsonURL)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let model = root["model"] as? [String: Any],
              let vocabAny = model["vocab"] as? [String: Any] else { throw EngineError("minilm tokenizer.json: unexpected structure") }
        var v: [String: Int] = [:]; v.reserveCapacity(vocabAny.count)
        for (k, x) in vocabAny { if let n = (x as? NSNumber)?.intValue { v[k] = n } }
        vocab = v
        unkId = v["[UNK]"] ?? 100
        clsId = v["[CLS]"] ?? 101
        sepId = v["[SEP]"] ?? 102
    }

    func encode(_ text: String) -> [Int] {
        var ids = [clsId]
        for word in basicTokenize(text) { ids.append(contentsOf: wordPiece(word)) }
        ids.append(sepId)
        return ids
    }

    // MARK: - normalizer + pre-tokenizer

    private func basicTokenize(_ text: String) -> [String] {
        // clean_text: drop control chars, map whitespace to space. lowercase + strip accents (NFD, remove Mn).
        var cleaned = ""
        for s in text.unicodeScalars {
            if s.value == 0 || s.value == 0xFFFD || (isControl(s) && !isWhitespace(s)) { continue }
            cleaned.unicodeScalars.append(isWhitespace(s) ? " " : s)
        }
        let lowered = cleaned.lowercased().decomposedStringWithCanonicalMapping
        var stripped = ""
        for s in lowered.unicodeScalars {
            if s.properties.generalCategory == .nonspacingMark { continue }
            stripped.unicodeScalars.append(s)
        }
        // split on whitespace, punctuation is its own token, CJK chars are their own tokens
        var tokens: [String] = []; var cur = ""
        for s in stripped.unicodeScalars {
            if isWhitespace(s) { if !cur.isEmpty { tokens.append(cur); cur = "" }; continue }
            if isPunctuation(s) || isCJK(s) { if !cur.isEmpty { tokens.append(cur); cur = "" }; tokens.append(String(s)); continue }
            cur.unicodeScalars.append(s)
        }
        if !cur.isEmpty { tokens.append(cur) }
        return tokens
    }

    private func wordPiece(_ word: String) -> [Int] {
        let chars = Array(word)
        if chars.count > maxInputCharsPerWord { return [unkId] }
        var out: [Int] = []; var start = 0
        while start < chars.count {
            var end = chars.count; var found: Int? = nil
            while start < end {
                var sub = String(chars[start..<end]); if start > 0 { sub = "##" + sub }
                if let id = vocab[sub] { found = id; break }
                end -= 1
            }
            guard let id = found else { return [unkId] }
            out.append(id); start = end
        }
        return out
    }

    private func isWhitespace(_ s: Unicode.Scalar) -> Bool {
        s == " " || s == "\t" || s == "\n" || s == "\r" || s.properties.generalCategory == .spaceSeparator
    }
    private func isControl(_ s: Unicode.Scalar) -> Bool {
        switch s.properties.generalCategory { case .control, .format, .surrogate, .privateUse, .unassigned: return true; default: return false }
    }
    private func isPunctuation(_ s: Unicode.Scalar) -> Bool {
        let v = s.value
        if (v >= 33 && v <= 47) || (v >= 58 && v <= 64) || (v >= 91 && v <= 96) || (v >= 123 && v <= 126) { return true }
        switch s.properties.generalCategory {
        case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation, .initialPunctuation, .finalPunctuation, .otherPunctuation: return true
        default: return false
        }
    }
    private func isCJK(_ s: Unicode.Scalar) -> Bool {
        let v = s.value
        return (v >= 0x4E00 && v <= 0x9FFF) || (v >= 0x3400 && v <= 0x4DBF) || (v >= 0x20000 && v <= 0x2A6DF) || (v >= 0x2A700 && v <= 0x2B73F)
            || (v >= 0x2B740 && v <= 0x2B81F) || (v >= 0x2B820 && v <= 0x2CEAF) || (v >= 0xF900 && v <= 0xFAFF) || (v >= 0x2F800 && v <= 0x2FA1F)
    }
}
