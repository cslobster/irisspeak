import SwiftUI

/// First run after signing in: who is the child? Boy / girl (picks the voice), age, and an optional description that
/// feeds the personal cards. Saved to the shared account; shown once (or until the account has an age).
struct SetupScreen: View {
    @EnvironmentObject var auth: AuthState
    @State private var name = Store.getProfile().name
    @State private var gender = Store.getProfile().gender == "boy" ? "boy" : "girl"
    @State private var age = Store.getProfile().age.map(String.init) ?? ""
    @State private var notes = Store.getProfile().notes ?? ""
    @State private var saving = false
    var onDone: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Text("Tell us about your child").font(.od(FS.xl3, bold: true)).foregroundColor(Theme.teal).padding(.bottom, 4)
                Text("This picks the voice and helps the cards fit. You can change it later under Settings → Profile.").font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate600).multilineTextAlignment(.center).padding(.bottom, 24)
                VStack(alignment: .leading, spacing: 20) {
                    field("CHILD'S NAME") { TextField("", text: $name).autocorrectionDisabled() }
                    VStack(alignment: .leading, spacing: 6) {
                        label("BOY OR GIRL?")
                        HStack(spacing: 12) {
                            ForEach([("girl", "👧", "Girl"), ("boy", "👦", "Boy")], id: \.0) { g, icon, title in
                                Button(action: { gender = g }) {
                                    VStack(spacing: 4) { Text(icon).font(.system(size: 34)); Text(title).font(.od(FS.sm, bold: true)).foregroundColor(gender == g ? .white : Theme.slate600) }
                                        .frame(maxWidth: .infinity).frame(height: 80)
                                        .sticker(gender == g ? Theme.teal : Color.white, radius: 12, border: 2, bottom: gender == g ? 2 : 4)
                                }
                                .buttonStyle(ScaleButtonStyle())
                            }
                        }
                    }
                    field("AGE") { TextField("e.g. 6", text: $age).keyboardType(.numberPad) }
                    VStack(alignment: .leading, spacing: 6) {
                        label("ANYTHING ELSE WE SHOULD KNOW? (OPTIONAL)")
                        ZStack(alignment: .topLeading) {
                            if notes.isEmpty { Text("Interests, friends, pets, what helps them stay calm…").font(.od(FS.base)).foregroundColor(Theme.slate300).padding(.horizontal, 20).padding(.vertical, 20) }
                            TextEditor(text: $notes).font(.od(FS.base)).foregroundColor(Theme.slate800).scrollContentBackground(.hidden).padding(.horizontal, 16).padding(.vertical, 12)
                        }
                        .frame(height: 120).background(RoundedRectangle(cornerRadius: 12).fill(Theme.slate50)).overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
                    }
                    PillButton(title: saving ? "Saving…" : "Done →", color: Theme.teal, fontSize: FS.base, fullWidth: true, enabled: !saving) { save() }
                }
                .padding(28).frame(maxWidth: 512).sticker(Color.white, radius: 24, border: 3, bottom: 8)
            }
            .padding(.horizontal, 24).padding(.vertical, 40).frame(maxWidth: .infinity)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
    }

    private func save() {
        saving = true
        var p = Store.getProfile()
        if !name.trimmingCharacters(in: .whitespaces).isEmpty { p.name = name.trimmingCharacters(in: .whitespaces) }
        p.gender = gender; p.age = Int(age); p.notes = notes.trimmingCharacters(in: .whitespaces).isEmpty ? nil : notes
        Store.setProfile(p); Store.setupDone = true
        if var acc = Store.getAccount() { acc.childName = p.name; Store.setAccount(acc) }
        Task { _ = try? await RemoteApi.pushProfile(p); await MainActor.run { auth.refresh(); saving = false; onDone() } }
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
