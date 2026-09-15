import Foundation
import AuthenticationServices
import UIKit

/// The shared irisspeak.com backend (Neon Postgres behind the Next.js API on Vercel) — a port of
/// aac_next/src/api/remote.ts. Signing in gives the same account, profile, custom words, sessions and transcripts
/// as irisspeak.org, irisspeak.com and the admin site. Card prediction stays on the device; the server only
/// stores what happened (device/turn). Every mirror call is fire-and-forget and never blocks the child.
@MainActor
final class AuthState: ObservableObject {
    static let shared = AuthState()
    @Published var signedIn: Bool = Store.getToken() != nil
    @Published var account: Account? = Store.getAccount()
    @Published var expired = false
    @Published var needsSetup: Bool = RemoteApi.needsSetup
    func refresh() { signedIn = Store.getToken() != nil; account = Store.getAccount(); needsSetup = RemoteApi.needsSetup }
}

enum RemoteApi {
    static let apiBase = "https://aac-roan.vercel.app/api/v1"
    static let clientId = "irisspeak.app"
    /// Custom URL scheme registered in Info.plist; the API's Google callback redirects here (see src/lib/google.ts).
    static let googleRedirect = "irisspeak://google"

    struct ApiError: LocalizedError { var detail: String; var status: Int; var errorDescription: String? { detail } }

    static var isSignedIn: Bool { Store.getToken() != nil }
    /// First-run setup (boy/girl, age, notes) is asked until the account has an age, or it was done on this device.
    static var needsSetup: Bool { isSignedIn && Store.getProfile().age == nil && !Store.setupDone }

    private struct Empty: Decodable {}

    @discardableResult
    static func call<T: Decodable>(_ method: String, _ path: String, body: [String: Any?]? = nil, auth: Bool = true, as type: T.Type = T.self) async throws -> T {
        var req = URLRequest(url: URL(string: apiBase + path)!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        if auth {
            guard let t = Store.getToken() else { throw ApiError(detail: "not signed in", status: 401) }
            req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
        }
        if let body = body {
            let clean = body.mapValues { $0 ?? NSNull() }
            req.httpBody = try JSONSerialization.data(withJSONObject: clean)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 && auth {
            await MainActor.run { signOut(); AuthState.shared.expired = true }
            throw ApiError(detail: "Session expired, please sign in again", status: 401)
        }
        if status == 204 || data.isEmpty { if let e = Empty() as? T { return e }; throw ApiError(detail: "empty response", status: status) }
        if !(200..<300).contains(status) {
            let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["detail"] as? String
            throw ApiError(detail: detail ?? "HTTP \(status)", status: status)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: sign in / out / up

    private struct LoginResponse: Decodable { var jwt: String; var child_name: String?; var alias: String? }

    /// Sign in with the irisspeak.com username and login code; pulls the profile, history and custom words down.
    static func signIn(username: String, code: String) async throws -> Account {
        let r: LoginResponse = try await call("POST", "/dyad/account/login", body: ["username": username.trimmingCharacters(in: .whitespaces), "password": code.trimmingCharacters(in: .whitespaces)], auth: false)
        return await finishSignIn(jwt: r.jwt, alias: r.alias ?? username, childName: r.child_name ?? "")
    }

    /// Finish any sign-in (password or Google): store the token, then pull the account data down.
    static func finishSignIn(jwt: String, alias: String, childName: String) async -> Account {
        Store.setToken(jwt)
        var acc = Account(alias: alias, childName: childName)
        Store.setAccount(acc)
        if let p = try? await pullProfile() { acc = Account(alias: p.alias ?? acc.alias, childName: p.childName ?? acc.childName); Store.setAccount(acc) }
        _ = try? await pullHistory()
        _ = try? await syncCustomWords()
        await MainActor.run { AuthState.shared.expired = false; AuthState.shared.refresh() }
        return acc
    }

    @MainActor static func signOut() {
        Store.setToken(nil); Store.setAccount(nil)
        AuthState.shared.refresh()
    }

    private struct SignupResponse: Decodable { var id: String; var alias: String; var status: String }
    static func signUp(childName: String, childGender: String, loginCode: String, age: Int?, notes: String?, parentEmail: String?, interests: [String]) async throws -> String {
        let r: SignupResponse = try await call("POST", "/dyad/account/signup", body: [
            "child_name": childName, "child_gender": childGender, "login_code": loginCode, "age": age, "notes": notes,
            "parent_email": parentEmail, "interests": interests, "locale": "en",
        ], auth: false)
        return r.alias
    }

    // MARK: Google sign-in (ASWebAuthenticationSession → the API's server-side OAuth flow → irisspeak://google#jwt=…)

    static func googleSignIn() async throws -> Account {
        let start = URL(string: "\(apiBase)/dyad/account/google/start?redirect=\(googleRedirect.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!)")!
        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: start, callbackURLScheme: "irisspeak") { url, error in
                if let url = url { cont.resume(returning: url) } else { cont.resume(throwing: error ?? ApiError(detail: "Google sign-in was cancelled.", status: 0)) }
            }
            session.presentationContextProvider = WebAuthPresenter.shared
            session.prefersEphemeralWebBrowserSession = false
            WebAuthPresenter.shared.session = session
            if !session.start() { cont.resume(throwing: ApiError(detail: "Could not open the sign-in window.", status: 0)) }
        }
        // The API puts the result in the fragment (or the query for hash-routed web clients); accept both.
        let params = URLComponents(string: "x://x?" + (callback.fragment ?? "") + "&" + (URLComponents(url: callback, resolvingAgainstBaseURL: false)?.percentEncodedQuery ?? ""))?.queryItems ?? []
        func q(_ k: String) -> String? { params.first { $0.name == k }?.value }
        if let e = q("error") {
            throw ApiError(detail: e == "AccountPendingApproval" ? "This account is waiting for approval." : e == "access_denied" ? "Google sign-in was cancelled." : "Google sign-in failed — please try again.", status: 0)
        }
        guard let jwt = q("jwt") else { throw ApiError(detail: "Google sign-in failed — please try again.", status: 0) }
        return await finishSignIn(jwt: jwt, alias: q("alias") ?? "", childName: q("child_name") ?? "")
    }

    // MARK: profile

    /// Server profile -> local profile (name, setting, age, notes, style).
    static func pullProfile() async throws -> RemoteProfile {
        let p: RemoteProfile = try await call("GET", "/dyad/profile")
        var local = Store.getProfile()
        if let n = p.childName, !n.isEmpty { local.name = n }
        if let g = p.childGender, !g.isEmpty { local.gender = g }
        if let s = p.setting, !s.isEmpty { local.setting = s }
        if let a = p.age { local.age = a }
        if let n = p.notes { local.notes = n }
        if let c = p.communicationStyle { local.communicationStyle = c }
        Store.setProfile(local)
        if var acc = Store.getAccount() { acc.childName = p.childName ?? acc.childName; acc.alias = p.alias ?? acc.alias; Store.setAccount(acc) }
        await MainActor.run { AuthState.shared.refresh() }
        return p
    }
    /// Local profile -> server (called after the profile screen saves).
    static func pushProfile(_ p: ChildProfile) async throws {
        guard isSignedIn else { return }
        let _: RemoteProfile = try await call("PATCH", "/dyad/profile", body: ["age": p.age, "notes": p.notes, "communication_style": p.communicationStyle, "setting": p.setting, "child_name": p.name.isEmpty ? nil : p.name, "child_gender": p.gender])
    }

    // MARK: history (the child's last confirmed turns from every device, into the local history the reranker reads)

    private struct HistoryResponse: Decodable { var turns: [HistoryTurnDTO] }
    private struct HistoryTurnDTO: Decodable { var partner: String?; var answer: String?; var cards: [String]?; var labels: [String]?; var t: Double? }
    static func pullHistory() async throws -> Int {
        let r: HistoryResponse = try await call("GET", "/dyad/history?limit=50")
        let turns = r.turns.reversed().map { HistoryTurn(partner: $0.partner ?? "", answer: $0.answer ?? "", cards: $0.cards ?? [], t: $0.t ?? 0, labels: $0.labels) }
        Store.setHistory(turns)
        return turns.count
    }

    // MARK: custom words

    static func listCustomWords() async throws -> [CustomWord] { isSignedIn ? try await call("GET", "/dyad/vocabulary") : [] }
    static func addVocabularyWord(word: String, category: String, imageData: String?, emoji: String?) async throws -> CustomWord {
        try await call("POST", "/dyad/vocabulary", body: ["word": word, "category": category, "image_data": imageData, "emoji": emoji])
    }
    static func deleteVocabularyWord(id: String) async throws {
        let _: Empty = try await call("DELETE", "/dyad/vocabulary/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")
    }
    /// Server custom words -> local searchable cards (a base64 image becomes a data URL).
    static func syncCustomWords() async throws -> Int {
        let words = try await listCustomWords()
        Store.setCustomWords(words.map { w in
            CustomWordLocal(word: w.word, category: w.category == "action" ? .action : .topic,
                            imageUrl: w.imageData.map { $0.hasPrefix("data:") ? $0 : "data:image/png;base64,\($0)" },
                            emoji: w.emoji, favourite: w.isPreferencePointer ?? false)
        })
        return words.count
    }

    // MARK: previous conversations from every device (irisspeak.com, other iPads)

    private struct SessionRow: Decodable {
        var id: String; var status: String?; var local_timezone: String?; var started_timestamp: Double?; var ended_timestamp: Double?; var num_turns: Int?; var rating: Int?; var title: String?
    }
    private struct SessionList: Decodable { var sessions: [SessionRow] }
    static func listSessions() async -> [SessionInfo]? {
        guard isSignedIn, let r: SessionList = try? await call("GET", "/dyad/session/list") else { return nil }
        return r.sessions.map { SessionInfo(id: $0.id, status: SessionStatus(rawValue: $0.status ?? "") ?? .terminated, localTimezone: $0.local_timezone ?? "", startedTimestamp: $0.started_timestamp ?? 0, endedTimestamp: $0.ended_timestamp, numTurns: $0.num_turns ?? 0, rating: $0.rating, title: $0.title) }
    }
    /// The account's transcript of a session: text messages and card turns (with the sentence the child approved).
    static func dialogue(_ sessionId: String) async -> [DialogueMessage]? {
        guard isSignedIn, let t = Store.getToken(), let url = URL(string: "\(apiBase)/dyad/session/\(sessionId)/message/all") else { return nil }
        var req = URLRequest(url: url); req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
        guard let (data, resp) = try? await URLSession.shared.data(for: req), (resp as? HTTPURLResponse)?.statusCode == 200,
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let rows = root["dialogue"] as? [[String: Any]] else { return nil }
        let dec = JSONDecoder()
        return rows.compactMap { r in
            guard let role = DialogueRole(rawValue: r["role"] as? String ?? "") else { return nil }
            if let text = r["content"] as? String { return DialogueMessage(role: role, text: text, cards: nil, contentLocalized: nil) }
            if let arr = r["content"] as? [[String: Any]], let d = try? JSONSerialization.data(withJSONObject: arr), let cards = try? dec.decode([CardInfo].self, from: d) {
                return DialogueMessage(role: role, text: nil, cards: cards, contentLocalized: r["content_localized"] as? String)
            }
            return nil
        }
    }

    // MARK: sessions and turns: mirrors of what the device did

    private struct AnyJSON: Decodable {}
    static func remoteNewSession(timezone: String) async -> String? {
        guard isSignedIn else { return nil }
        return try? await call("POST", "/dyad/session/new", body: ["topic": ["category": "free"], "timezone": timezone, "client": clientId], as: String.self)
    }
    static func remoteStart(_ id: String) { fire("POST", "/dyad/session/\(id)/start") }
    static func remoteParentTurn(_ id: String, text: String) { fire("POST", "/dyad/session/\(id)/device/turn", ["role": "parent", "text": text, "timestamp": now]) }
    static func remoteChildTurn(_ id: String, cards: [CardInfo], sentence: String, shown: [CardInfo]) {
        fire("POST", "/dyad/session/\(id)/device/turn", ["role": "child", "cards": cards.map(cardJSON), "sentence": sentence, "shown": shown.map(cardJSON), "timestamp": now])
    }
    static func remoteEnd(_ id: String) { fire("PUT", "/dyad/session/\(id)/end") }
    static func remoteRate(_ id: String, rating: Int) { fire("PUT", "/dyad/session/\(id)/rating", ["rating": rating]) }

    private static var now: Double { Date().timeIntervalSince1970 * 1000 }
    private static func cardJSON(_ c: CardInfo) -> [String: Any] {
        var d: [String: Any] = ["id": c.id, "recommendation_id": c.recommendationId, "label": c.label, "label_localized": c.labelLocalized, "category": c.category.rawValue]
        if let n = c.corpusName { d["corpus_name"] = n }
        if let u = c.corpusImageUrl { d["corpus_image_url"] = u }
        if let e = c.emoji { d["emoji"] = e }
        if let f = c.isFolder { d["is_folder"] = f }
        if let p = c.folderPath { d["folder_path"] = p }
        return d
    }
    private static func fire(_ method: String, _ path: String, _ body: [String: Any?]? = nil) {
        guard isSignedIn else { return }
        Task.detached { _ = try? await call(method, path, body: body, as: AnyJSON.self) }
    }
}

/// Presents the Google sign-in sheet over the key window.
final class WebAuthPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = WebAuthPresenter()
    var session: ASWebAuthenticationSession?
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first ?? ASPresentationAnchor()
    }
}
