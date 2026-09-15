import SwiftUI

enum Route: Hashable {
    case session(String)
    case sessionEnd(String)
    case stars
    case profile
    case vocabulary
    case signup
    case credits
}

@MainActor
final class Router: ObservableObject {
    static let shared = Router()
    @Published var path: [Route] = []
    func go(_ r: Route) { path.append(r) }
    func replace(_ r: Route) { if path.isEmpty { path = [r] } else { path[path.count - 1] = r } }
    func back() { if !path.isEmpty { path.removeLast() } }
    func home() { path = [] }
    var inSession: Bool { if case .session = path.last { return true }; return false }
}

@main
struct IrisSpeakApp: App {
    @StateObject private var router = Router.shared
    @StateObject private var uiScale = UiScale.shared
    @StateObject private var mute = MuteState.shared
    @StateObject private var engineStatus = Engine.shared.status
    @StateObject private var auth = AuthState.shared

    init() {
        // Start loading the on-device model right away so the first session starts quickly.
        Task { try? await Engine.shared.load() }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(router)
                .environmentObject(uiScale)
                .environmentObject(mute)
                .environmentObject(engineStatus)
                .environmentObject(auth)
                .preferredColorScheme(.light)
        }
    }
}

/// Same flow as irisspeak.org: sign in first (shared irisspeak.com account), then the welcome page; the account,
/// profile, custom words and conversations are shared with irisspeak.com. Cards are chosen on the device.
struct RootView: View {
    @EnvironmentObject var router: Router
    @EnvironmentObject var auth: AuthState
    @State private var showSettingsMenu = false

    var body: some View {
        NavigationStack(path: $router.path) {
            Group {
                if !auth.signedIn { SignInScreen() }
                else if auth.needsSetup { SetupScreen(onDone: { auth.refresh() }) }   // first run: boy/girl, age, notes
                else { WelcomeScreen() }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .session(let id): SessionScreen(sessionId: id)
                case .sessionEnd(let id): SessionEndScreen(sessionId: id)
                case .stars: StarsScreen()
                case .profile: ProfileScreen()
                case .vocabulary: VocabularyScreen()
                case .signup: SignupScreen()
                case .credits: CreditsScreen()
                }
            }
            .navigationBarHidden(true)
        }
        // One "Settings" button top-right on every signed-in screen except during a session (the ☰ menu replaces it).
        .overlay(alignment: .topTrailing) {
            if auth.signedIn && !auth.needsSetup && !router.inSession { SettingsButton(showMenu: $showSettingsMenu).padding(20) }
        }
        .onChange(of: auth.signedIn) { _, on in showSettingsMenu = false; if !on { router.home() } }
        .onChange(of: router.path) { _, _ in showSettingsMenu = false }
        .onAppear { if auth.signedIn { Task { _ = try? await RemoteApi.pullProfile(); _ = try? await RemoteApi.pullHistory(); _ = try? await RemoteApi.syncCustomWords() } } }
        .background(Theme.cream.ignoresSafeArea())
        .task { SelfTest.runIfRequested() }
    }
}
