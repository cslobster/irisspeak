import Foundation

/// Appends log lines to Documents/irisspeak.log so they can be pulled off a device without a debugger.
enum DebugLog {
    nonisolated(unsafe) private static var handle: FileHandle? = nil
    private static let lock = NSLock()

    static var url: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return dir.appendingPathComponent("irisspeak.log")
    }

    static func append(_ line: String) {
        lock.lock(); defer { lock.unlock() }
        if handle == nil {
            if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
            handle = try? FileHandle(forWritingTo: url)
            handle?.seekToEndOfFile()
        }
        handle?.write((line + "\n").data(using: .utf8)!)
    }
}
