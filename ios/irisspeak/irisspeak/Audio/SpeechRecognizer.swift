import Foundation
import Speech
import AVFoundation

/// Speech-to-text for the parent's turn (replaces the web client's Web Speech API wrapper).
/// start() streams partial results; stop() resolves with the final transcript; abort() discards.
@MainActor
final class SpeechRecognizer {
    enum State { case idle, listening, stopping }
    private(set) var state: State = .idle
    var onState: (State) -> Void = { _ in }
    var onPartial: (String) -> Void = { _ in }

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var finalText = ""
    private var stopContinuation: CheckedContinuation<String, Never>?

    static var isSupported: Bool { SFSpeechRecognizer(locale: Locale(identifier: "en-US"))?.isAvailable ?? false }

    private func requestPermissions() async -> Bool {
        let speech = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        guard speech == .authorized else { return false }
        return await withCheckedContinuation { c in AVAudioSession.sharedInstance().requestRecordPermission { c.resume(returning: $0) } }
    }

    func start() async throws {
        guard state == .idle else { return }
        guard let recognizer = recognizer, recognizer.isAvailable else { throw EngineError("speech recognition not available") }
        guard await requestPermissions() else { throw EngineError("permission denied") }
        AudioSession.activate()
        finalText = ""
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = false }
        request = req
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
        engine.prepare()
        try engine.start()
        state = .listening; onState(state)
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                guard let self = self else { return }
                if let r = result {
                    self.finalText = r.bestTranscription.formattedString
                    self.onPartial(self.finalText)
                    if r.isFinal { self.finish() }
                }
                if error != nil && self.state != .idle { self.finish() }
            }
        }
    }

    /// Stops listening; resolves with the final transcript.
    func stop() async -> String {
        guard state == .listening else { return finalText }
        state = .stopping; onState(state)
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        request?.endAudio()
        let text = await withCheckedContinuation { (c: CheckedContinuation<String, Never>) in
            stopContinuation = c
            // The recognizer normally finishes within a second; don't hang the UI if it never does.
            Task { try? await Task.sleep(nanoseconds: 1_500_000_000); self.finish() }
        }
        return text
    }

    func abort() {
        stopContinuation = nil
        task?.cancel()
        finish()
    }

    private func finish() {
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        request?.endAudio(); request = nil
        task = nil
        state = .idle; onState(state)
        let c = stopContinuation; stopContinuation = nil
        c?.resume(returning: finalText.trimmingCharacters(in: .whitespaces))
    }
}
