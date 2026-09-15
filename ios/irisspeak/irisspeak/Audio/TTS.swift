import AVFoundation

/// Speaks card labels, sentences and example utterances with the system voice.
final class TTS: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    static let shared = TTS()
    private let synth = AVSpeechSynthesizer()
    private var onFinish: (() -> Void)?

    override init() {
        super.init()
        synth.delegate = self
    }

    /// Which voice is in use: the Settings choice, else the child's gender on the account, else girl.
    /// "personal" = an iOS Personal Voice (Settings > Accessibility > Personal Voice), when one exists and is allowed.
    static var effective: String { let c = Store.voice; if c == "personal" && personalVoice == nil { return Store.getProfile().gender == "boy" ? "boy" : "girl" }; if c != "auto" { return c }; return Store.getProfile().gender == "boy" ? "boy" : "girl" }

    /// The first Personal Voice this app is allowed to use, if any (iOS 17+).
    static var personalVoice: AVSpeechSynthesisVoice? {
        if #available(iOS 17, *) { return AVSpeechSynthesisVoice.speechVoices().first { $0.voiceTraits.contains(.isPersonalVoice) } }
        return nil
    }
    /// Ask once for Personal Voice access; `done(true)` when at least one voice can be used.
    static func requestPersonalVoice(_ done: @escaping (Bool) -> Void) {
        if #available(iOS 17, *) {
            AVSpeechSynthesizer.requestPersonalVoiceAuthorization { status in DispatchQueue.main.async { done(status == .authorized && personalVoice != nil) } }
        } else { done(false) }
    }

    private static let maleNames = ["aaron", "alex", "daniel", "fred", "evan", "nathan", "tom", "oliver", "arthur", "james", "rishi", "reed", "rocko", "eddy", "gordon"]
    private static var cache: [String: AVSpeechSynthesisVoice] = [:]
    /// Best on-device English voice of the wanted gender: premium > enhanced > default quality, en-US first.
    static func voice(for want: String) -> AVSpeechSynthesisVoice? {
        if let v = cache[want] { return v }
        let all = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") }
        func isMale(_ v: AVSpeechSynthesisVoice) -> Bool { v.gender == .male || (v.gender == .unspecified && maleNames.contains { v.name.lowercased().hasPrefix($0) }) }
        func isFemale(_ v: AVSpeechSynthesisVoice) -> Bool { v.gender == .female || (v.gender == .unspecified && !isMale(v)) }
        // Boy: Apple's "Junior" is an actual young-boy voice (shipped with iOS, gender unspecified), so it comes first;
        // otherwise the best male voice, which speak() pitches up.
        let junior = want == "boy" ? all.first { $0.name.lowercased() == "junior" } : nil
        let pool = all.filter { want == "boy" ? ($0.gender == .male || isMale($0)) : isFemale($0) }
        let ranked = pool.sorted { a, b in
            if (a.gender == .male) != (b.gender == .male) { return a.gender == .male }   // a real male voice before a name guess
            let qa = a.quality.rawValue, qb = b.quality.rawValue
            if qa != qb { return qa > qb }
            return (a.language == "en-US" ? 0 : 1) < (b.language == "en-US" ? 0 : 1)
        }
        let v = junior ?? ranked.first ?? all.first ?? AVSpeechSynthesisVoice(language: "en-US")
        if let v = v { cache[want] = v }
        log("tts: \(want) -> \(v?.name ?? "?") [\(v?.language ?? "")] gender \(v?.gender.rawValue ?? -1) quality \(v?.quality.rawValue ?? -1); installed en voices: " + all.map { "\($0.name)/\($0.gender.rawValue)/\($0.quality.rawValue)" }.joined(separator: ", "))
        return v
    }

    func speak(_ text: String, rate: Float = 0.95, onFinish: (() -> Void)? = nil) {
        if Store.muted { onFinish?(); return }
        AudioSession.activate()
        synth.stopSpeaking(at: .immediate)
        self.onFinish = onFinish
        let u = AVSpeechUtterance(string: text)
        let want = TTS.effective
        if want == "personal", let pv = TTS.personalVoice {
            u.voice = pv; u.pitchMultiplier = 1.0
        } else if want == "boy" {
            // No child voices ship with iOS: a male voice pitched up is the closest, and clearly different from the girl voice.
            let v = TTS.voice(for: "boy"); u.voice = v
            u.pitchMultiplier = v?.name.lowercased() == "junior" ? 1.0 : 1.3   // Junior already sounds young; a male voice needs the lift
        } else {
            u.voice = TTS.voice(for: "girl"); u.pitchMultiplier = 1.05
        }
        u.rate = AVSpeechUtteranceDefaultSpeechRate * rate
        synth.speak(u)
    }

    func speakCard(_ card: CardInfo) { speak(card.corpusName ?? card.label) }

    func stop() { synth.stopSpeaking(at: .immediate); onFinish = nil }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { let cb = onFinish; onFinish = nil; cb?() }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { let cb = onFinish; onFinish = nil; cb?() }
}

/// One shared audio session so speech output and the microphone can coexist.
enum AudioSession {
    nonisolated(unsafe) private static var configured = false
    static func activate() {
        if configured { return }
        do {
            let s = AVAudioSession.sharedInstance()
            try s.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .duckOthers])
            try s.setActive(true)
            configured = true
        } catch { log("audio session: \(error)") }
    }
}
