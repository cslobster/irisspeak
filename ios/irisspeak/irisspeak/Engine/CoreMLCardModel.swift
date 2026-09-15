import Foundation
import CoreML

/// The card model on Apple's native runtime (Core ML: fp16 on the Neural Engine / GPU, weights memory-mapped).
/// Package built by export/export_coreml.py: inputs `input_ids` and `attention_mask` (int32 [1, seq], right-padded),
/// output `card_logits` (fp16 [1, seq, n_cards]); we read the row of the last real token.
final class CoreMLCardModel {
    private let model: MLModel
    let seq: Int
    let nCards: Int

    init(url: URL) throws {
        let cfg = MLModelConfiguration(); cfg.computeUnits = .all
        model = try MLModel(contentsOf: url, configuration: cfg)
        let meta = model.modelDescription.metadata[.creatorDefinedKey] as? [String: String] ?? [:]
        let inShape = model.modelDescription.inputDescriptionsByName["input_ids"]?.multiArrayConstraint?.shape.map { $0.intValue } ?? []
        seq = inShape.count == 2 ? inShape[1] : Int(meta["seq"] ?? "256") ?? 256
        nCards = Int(meta["n_cards"] ?? "0") ?? 0
    }

    /// Card logits for the last token of `ids` (the window keeps the end of a prompt longer than `seq`).
    func cardLogits(ids: [Int32]) throws -> [Float] {
        let ids = Array(ids.suffix(seq)); let L = ids.count
        let inIds = try MLMultiArray(shape: [1, NSNumber(value: seq)], dataType: .int32)
        let inMask = try MLMultiArray(shape: [1, NSNumber(value: seq)], dataType: .int32)
        let pi = inIds.dataPointer.assumingMemoryBound(to: Int32.self), pm = inMask.dataPointer.assumingMemoryBound(to: Int32.self)
        for i in 0..<seq { pi[i] = i < L ? ids[i] : 0; pm[i] = i < L ? 1 : 0 }
        let out = try model.prediction(from: try MLDictionaryFeatureProvider(dictionary: ["input_ids": inIds, "attention_mask": inMask]))
        guard let arr = out.featureValue(for: "card_logits")?.multiArrayValue else { throw EngineError("missing card_logits") }
        let n = arr.shape.last!.intValue
        let rowStride = arr.strides[1].intValue, colStride = arr.strides[2].intValue
        var logits = [Float](repeating: 0, count: n)
        let base = (L - 1) * rowStride
        switch arr.dataType {
        case .float16:
            let p = arr.dataPointer.assumingMemoryBound(to: Float16.self)
            for j in 0..<n { logits[j] = Float(p[base + j * colStride]) }
        case .float32:
            let p = arr.dataPointer.assumingMemoryBound(to: Float.self)
            for j in 0..<n { logits[j] = p[base + j * colStride] }
        default:
            for j in 0..<n { logits[j] = arr[[0, NSNumber(value: L - 1), NSNumber(value: j)]].floatValue }
        }
        return logits
    }
}
