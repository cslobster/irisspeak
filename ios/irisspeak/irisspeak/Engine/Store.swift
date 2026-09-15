import Foundation

/// Everything the app remembers (profile, sessions, card history, settings, the account token) lives in UserDefaults
/// as JSON, mirroring the web app's localStorage keys. The shared irisspeak.com account is in RemoteApi.swift.
enum Store {
    private static let prefix = "irisspeak_app_"
    private static let defaults = UserDefaults.standard
    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()

    static func get<T: Decodable>(_ key: String, _ fallback: T) -> T {
        guard let data = defaults.data(forKey: prefix + key), let v = try? decoder.decode(T.self, from: data) else { return fallback }
        return v
    }
    static func set<T: Encodable>(_ key: String, _ value: T) {
        if let data = try? encoder.encode(value) { defaults.set(data, forKey: prefix + key) }
    }

    // MARK: profile
    static func getProfile() -> ChildProfile { get("profile", ChildProfile()) }
    static func setProfile(_ p: ChildProfile) { set("profile", p) }

    // MARK: card-use history shared across sessions (feeds the reranker's personal bonus and the model prompt)
    static func getHistory() -> [HistoryTurn] { get("history", []) }
    static func pushHistory(_ t: HistoryTurn) { var h = getHistory(); h.append(t); set("history", Array(h.suffix(50))) }
    static func clearHistory() { set("history", [HistoryTurn]()) }

    // MARK: sessions
    static func loadSessions() -> [String: SessionRecord] { get("sessions", [:]) }
    static func saveSession(_ s: SessionRecord) { var all = loadSessions(); all[s.info.id] = s; set("sessions", all) }

    // MARK: shared account (irisspeak.com backend) — same keys as the web app's localStorage
    static func getToken() -> String? { get("jwt", String?.none) }
    static func setToken(_ t: String?) { set("jwt", t) }
    static func getAccount() -> Account? { get("account", Account?.none) }
    static func setAccount(_ a: Account?) { set("account", a) }
    static func getCustomWords() -> [CustomWordLocal] { get("custom_words", []) }
    static func setCustomWords(_ w: [CustomWordLocal]) { set("custom_words", w) }
    static func setHistory(_ h: [HistoryTurn]) { set("history", Array(h.suffix(50))) }

    // MARK: settings
    static var muted: Bool {
        get { defaults.bool(forKey: prefix + "muted") }
        set { defaults.set(newValue, forKey: prefix + "muted") }
    }
    static var setupDone: Bool {
        get { defaults.bool(forKey: prefix + "setup_done") }
        set { defaults.set(newValue, forKey: prefix + "setup_done") }
    }
    /// "auto" (follow the child's gender on the account), "girl" or "boy".
    static var voice: String {
        get { defaults.string(forKey: prefix + "voice") ?? "auto" }
        set { defaults.set(newValue, forKey: prefix + "voice") }
    }
    static var uiScale: UiScaleLevel {
        get { UiScaleLevel(rawValue: defaults.string(forKey: prefix + "uiScale") ?? "") ?? .normal }
        set { defaults.set(newValue.rawValue, forKey: prefix + "uiScale") }
    }
}

/// Accessibility text/card-size setting: a small number of pre-tested steps that still fit the screen.
enum UiScaleLevel: String, CaseIterable, Identifiable {
    case normal, large, xl
    var id: String { rawValue }
    var label: String { switch self { case .normal: return "Normal"; case .large: return "Large"; case .xl: return "Extra Large" } }
    var factor: CGFloat { switch self { case .normal: return 1; case .large: return 1.12; case .xl: return 1.22 } }
}
