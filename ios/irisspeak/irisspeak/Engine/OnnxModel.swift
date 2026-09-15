import Foundation
import OnnxRuntimeBindings

/// Thin wrapper over ONNX Runtime for the two models the app runs on device.
final class OnnxModel {
    private static let env: ORTEnv = { try! ORTEnv(loggingLevel: .warning) }()
    private let session: ORTSession
    let inputNames: Set<String>
    let outputNames: [String]

    init(path: String, threads: Int = 4, useCoreML: Bool = false, optimization: ORTGraphOptimizationLevel = .basic, disablePrepacking: Bool = false) throws {
        let opts = try ORTSessionOptions()
        try opts.setIntraOpNumThreads(Int32(threads))
        // The card model ships its fp16 weights in an external data file that ONNX Runtime memory-maps (clean,
        // evictable pages). Pre-packing would copy every MatMul weight into the heap as fp32 (+4.5 GB measured for
        // Qwen3-0.6B) and Jetsam kills the app; without it the run is as fast and the footprint stays under 1 GB.
        if disablePrepacking { try opts.addConfigEntry(withKey: "session.disable_prepacking", value: "1") }
        // `.extended`/`.all` trip a SimplifiedLayerNormFusion bug in ORT 1.24 on this fp16 (keep_io_types) graph.
        try opts.setGraphOptimizationLevel(optimization)
        if useCoreML {
            let cm = ORTCoreMLExecutionProviderOptions()
            cm.createMLProgram = true
            try opts.appendCoreMLExecutionProvider(with: cm)
        }
        session = try ORTSession(env: OnnxModel.env, modelPath: path, sessionOptions: opts)
        inputNames = Set(try session.inputNames())
        outputNames = try session.outputNames()
    }

    static func int64Tensor(_ values: [Int64], shape: [Int]) throws -> ORTValue {
        let data = NSMutableData(bytes: values, length: values.count * MemoryLayout<Int64>.stride)
        return try ORTValue(tensorData: data, elementType: .int64, shape: shape.map { NSNumber(value: $0) })
    }

    static func floatTensor(_ values: [Float], shape: [Int]) throws -> ORTValue {
        let data = NSMutableData(bytes: values, length: values.count * MemoryLayout<Float>.stride)
        return try ORTValue(tensorData: data, elementType: .float, shape: shape.map { NSNumber(value: $0) })
    }
    /// Runs the model and returns every requested output as an ORTValue (KV-cache tensors are fed straight back in).
    func run(inputs: [String: ORTValue], outputs: [String]) throws -> [String: ORTValue] {
        try session.run(withInputs: inputs, outputNames: Set(outputs), runOptions: nil)
    }
    static func floats(_ v: ORTValue) throws -> (values: [Float], shape: [Int]) {
        let info = try v.tensorTypeAndShapeInfo(); let shape = info.shape.map { $0.intValue }
        let data = try v.tensorData() as Data; let count = data.count / MemoryLayout<Float>.stride
        return (data.withUnsafeBytes { Array(UnsafeBufferPointer(start: $0.baseAddress!.assumingMemoryBound(to: Float.self), count: count)) }, shape)
    }

    /// Runs the model and returns the named float output as a flat array plus its shape.
    func runFloat(inputs: [String: ORTValue], output: String) throws -> (values: [Float], shape: [Int]) {
        let outs = try session.run(withInputs: inputs, outputNames: [output], runOptions: nil)
        guard let v = outs[output] else { throw EngineError("missing output \(output)") }
        let info = try v.tensorTypeAndShapeInfo()
        let shape = info.shape.map { $0.intValue }
        let data = try v.tensorData() as Data
        let count = data.count / MemoryLayout<Float>.stride
        let values = data.withUnsafeBytes { Array(UnsafeBufferPointer(start: $0.baseAddress!.assumingMemoryBound(to: Float.self), count: count)) }
        return (values, shape)
    }
}
