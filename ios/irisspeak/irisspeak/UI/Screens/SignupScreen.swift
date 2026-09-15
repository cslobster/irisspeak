import SwiftUI

/// Same sign-up as irisspeak.com: submissions wait for an admin's approval; the password chosen here works once approved.
struct SignupScreen: View {
    @EnvironmentObject var router: Router
    @State private var childName = ""
    @State private var age = ""
    @State private var gender = "girl"
    @State private var loginCode = ""
    @State private var parentEmail = ""
    @State private var notes = ""
    @State private var submitting = false
    @State private var alias: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if let alias = alias {
                    VStack(spacing: 16) {
                        Text("Thanks!").font(.od(FS.xl2, bold: true)).foregroundColor(Theme.slate800)
                        Text("Your signup is waiting for approval. Once it's approved, sign in with:").font(.od(FS.sm)).foregroundColor(Theme.slate600).multilineTextAlignment(.center)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("USERNAME").font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate400).kerning(1.5)
                            Text(alias).font(.system(.body, design: .monospaced).bold()).foregroundColor(Theme.slate800)
                            Text("PASSWORD").font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate400).kerning(1.5).padding(.top, 6)
                            Text(loginCode).font(.system(.body, design: .monospaced).bold()).foregroundColor(Theme.slate800)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.slate50)).overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
                        PillButton(title: "Back to sign in", color: Theme.teal, fontSize: FS.base) { router.back() }
                    }
                    .padding(32).frame(maxWidth: 384).sticker(Color.white, radius: 24, border: 3, bottom: 8)
                } else {
                    Text("Sign up").font(.od(FS.xl3, bold: true)).foregroundColor(Theme.teal).padding(.bottom, 4)
                    Text("Tell us about your child — accounts need approval before they're active.").font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate600).multilineTextAlignment(.center).padding(.bottom, 24)
                    VStack(spacing: 16) {
                        if let e = error { Text(e).font(.od(FS.sm, bold: true)).foregroundColor(Theme.coral).padding(.horizontal, 12).padding(.vertical, 8).background(RoundedRectangle(cornerRadius: 12).fill(Theme.coral.opacity(0.1))) }
                        field("CHILD'S NAME") { TextField("", text: $childName).autocorrectionDisabled() }
                        HStack(alignment: .top, spacing: 12) {
                            field("AGE") { TextField("", text: $age).keyboardType(.numberPad) }
                            VStack(alignment: .leading, spacing: 6) {
                                label("GENDER")
                                Picker("Gender", selection: $gender) { Text("Girl").tag("girl"); Text("Boy").tag("boy") }.pickerStyle(.segmented).frame(height: 44)
                            }
                        }
                        field("YOUR EMAIL") { TextField("", text: $parentEmail).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled() }
                        field("PASSWORD") { SecureField("Choose a password", text: $loginCode).textInputAutocapitalization(.never).autocorrectionDisabled() }
                        VStack(alignment: .leading, spacing: 6) {
                            label("MAKE THE APP MORE ADAPTIVE FOR YOUR NEEDS")
                            ZStack(alignment: .topLeading) {
                                if notes.isEmpty { Text("Interests (dinosaurs, Bluey, Legos), friends, pets, routine, what helps them stay calm…").font(.od(FS.base)).foregroundColor(Theme.slate300).padding(.horizontal, 20).padding(.vertical, 20) }
                                TextEditor(text: $notes).font(.od(FS.base)).foregroundColor(Theme.slate800).scrollContentBackground(.hidden).padding(.horizontal, 16).padding(.vertical, 12)
                            }
                            .frame(height: 120).background(RoundedRectangle(cornerRadius: 12).fill(Theme.slate50)).overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
                        }
                        PillButton(title: submitting ? "Submitting…" : "Submit for approval →", color: Theme.teal, fontSize: FS.base, fullWidth: true, enabled: !childName.trimmingCharacters(in: .whitespaces).isEmpty && !loginCode.trimmingCharacters(in: .whitespaces).isEmpty && !submitting) { submit() }
                    }
                    .padding(28).frame(maxWidth: 512).sticker(Color.white, radius: 24, border: 3, bottom: 8)
                    Button(action: { router.back() }) { Text("Already have an account? Sign in").font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate500) }.padding(.top, 20)
                }
            }
            .padding(.horizontal, 24).padding(.vertical, 40).frame(maxWidth: .infinity)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
    }

    private func submit() {
        submitting = true; error = nil
        Task {
            do {
                alias = try await RemoteApi.signUp(childName: childName.trimmingCharacters(in: .whitespaces), childGender: gender, loginCode: loginCode.trimmingCharacters(in: .whitespaces),
                                                   age: Int(age), notes: notes.isEmpty ? nil : notes, parentEmail: parentEmail.isEmpty ? nil : parentEmail,
                                                   // the single box is the profile notes; its short comma-separated fragments also become custom word cards
                                                   interests: Array(notes.split(whereSeparator: { $0 == "," || $0 == "\n" }).map { $0.trimmingCharacters(in: .whitespaces) }
                                                       .filter { !$0.isEmpty && $0.split(separator: " ").count <= 3 && $0.count <= 24 }.prefix(12)))
            } catch { self.error = "Something went wrong submitting your signup. Please try again." }
            submitting = false
        }
    }
    private func label(_ t: String) -> some View { Text(t).font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate400).kerning(1.5) }
    private func field<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            label(title)
            content().font(.od(FS.base)).foregroundColor(Theme.slate800).padding(.horizontal, 16).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.slate50)).overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
        }
    }
}
