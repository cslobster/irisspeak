import SwiftUI
import AuthenticationServices

/// Same sign-in as irisspeak.org / irisspeak.com: username + login code against the shared backend, a sign-up
/// link, and "Continue with Google" (the API runs the OAuth flow; see RemoteApi.googleSignIn).
struct SignInScreen: View {
    @EnvironmentObject var auth: AuthState
    @EnvironmentObject var router: Router
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?
    enum Field { case user, pass }

    var body: some View {
        GeometryReader { g in
            ScrollView {
                VStack(spacing: 0) {
                    Text("Iris Speak").font(.od(min(FS.xl7, g.size.width / 8), bold: true)).foregroundColor(Theme.teal).padding(.bottom, 4)
                    Text("Welcome! Sign in to continue.").font(.od(FS.base, bold: true)).foregroundColor(Theme.slate600).padding(.bottom, 28)
                    VStack(spacing: 16) {
                        if auth.expired { notice("Session expired — please sign in again.") }
                        if let e = error { notice(e) }
                        if busy {
                            HStack(spacing: 12) { ProgressView(); Text("Signing in…").font(.od(FS.base, bold: true)).foregroundColor(Theme.slate500) }.padding(.vertical, 24)
                        } else {
                            field("USERNAME") {
                                TextField("Enter username", text: $username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                                    .focused($focus, equals: .user).submitLabel(.next).onSubmit { focus = .pass }
                            }
                            field("PASSWORD") {
                                SecureField("Enter password", text: $password).textContentType(.password)
                                    .focused($focus, equals: .pass).submitLabel(.go).onSubmit { submit() }
                            }
                            PillButton(title: "Sign in →", color: Theme.teal, fontSize: FS.base, fullWidth: true, enabled: canSubmit) { submit() }
                            HStack(spacing: 12) { Rectangle().fill(Theme.slate100).frame(height: 2); Text("OR").font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate300).kerning(1.5); Rectangle().fill(Theme.slate100).frame(height: 2) }
                            GoogleButton { google() }
                        }
                    }
                    .padding(28)
                    .frame(maxWidth: 384)
                    .sticker(Color.white, radius: 24, border: 3, bottom: 8)
                    Button(action: { router.go(.signup) }) { Text("New here? Sign up →").font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate500) }
                        .padding(.top, 20)
                }
                .padding(.horizontal, 24).padding(.vertical, 40)
                .frame(maxWidth: .infinity, minHeight: g.size.height)
            }
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
    }

    private var canSubmit: Bool { !username.trimmingCharacters(in: .whitespaces).isEmpty && !password.trimmingCharacters(in: .whitespaces).isEmpty }

    private func submit() {
        guard canSubmit, !busy else { return }
        busy = true; error = nil
        Task {
            do { _ = try await RemoteApi.signIn(username: username, code: password) }
            catch let e as RemoteApi.ApiError { self.error = e.detail == "NoSuchUser" ? "Incorrect username or password." : e.detail == "AccountPendingApproval" ? "This account is waiting for approval." : "Network error — check your connection." }
            catch { self.error = "Network error — check your connection." }
            busy = false
        }
    }
    private func google() {
        guard !busy else { return }
        busy = true; error = nil
        Task {
            do { _ = try await RemoteApi.googleSignIn() }
            catch let e as RemoteApi.ApiError { self.error = e.detail }
            catch let e as ASWebAuthenticationSessionError { if e.code != .canceledLogin { self.error = "Google sign-in failed — please try again." } }
            catch { self.error = "Google sign-in failed — please try again." }
            busy = false
        }
    }

    private func notice(_ t: String) -> some View {
        Text(t).font(.od(FS.sm, bold: true)).foregroundColor(Theme.coral).frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 8).background(RoundedRectangle(cornerRadius: 12).fill(Theme.coral.opacity(0.1)))
    }
    private func field<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate400).kerning(1.5)
            content().font(.od(FS.base)).foregroundColor(Theme.slate800)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.slate50))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
        }
    }
}

/// "Sign in with Google" — same look as the web apps' GoogleButton.
struct GoogleButton: View {
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                GoogleG(size: 20)
                Text("Sign in with Google").font(.od(FS.base, bold: true)).foregroundColor(Theme.slate700).lineLimit(1).minimumScaleFactor(0.8).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

/// The four-colour G, drawn as four arcs (same geometry as the SVG in the web button).
struct GoogleG: View {
    var size: CGFloat
    var body: some View {
        ZStack {
            arc(from: 150, to: 210, color: Color(hex: 0xEA4335))   // red (top-left)
            arc(from: 210, to: 300, color: Color(hex: 0xFBBC05))   // yellow (left)
            arc(from: 300, to: 400, color: Color(hex: 0x34A853))   // green (bottom)
            arc(from: 40, to: 90, color: Color(hex: 0x4285F4))     // blue (right)
            Rectangle().fill(Color(hex: 0x4285F4)).frame(width: size * 0.5, height: size * 0.2).offset(x: size * 0.25)
        }
        .frame(width: size, height: size)
    }
    private func arc(from a: Double, to b: Double, color: Color) -> some View {
        Circle().trim(from: a / 360, to: b / 360).stroke(color, style: StrokeStyle(lineWidth: size * 0.2, lineCap: .butt)).rotationEffect(.degrees(-90 + 90)).padding(size * 0.1)
    }
}
