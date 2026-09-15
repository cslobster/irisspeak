import SwiftUI

/// Same fields as irisspeak.com's Profile screen: age, preferred way to communicate, and free notes. Loaded
/// from and saved to the shared account; the local copy feeds the on-device model and reranker.
struct ProfileScreen: View {
    @EnvironmentObject var router: Router
    @State private var gender = "girl"
    @State private var age = ""
    @State private var communicationStyle = ""
    @State private var notes = ""
    @State private var loading = true
    @State private var saving = false
    @State private var saved = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                HStack { Text("Profile").font(.od(FS.xl2, bold: true)).foregroundColor(.black); Spacer(); CloseButton { router.back() } }
                if loading { Text("Loading…").font(.od(FS.base)).foregroundColor(Theme.slate400).padding(.vertical, 32) } else {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 4) {
                            label("BOY OR GIRL")
                            HStack(spacing: 8) {
                                ForEach([("girl", "👧 Girl"), ("boy", "👦 Boy")], id: \.0) { g, title in
                                    Button(action: { gender = g; saved = false }) {
                                        Text(title).font(.od(FS.sm, bold: true)).foregroundColor(gender == g ? .white : Theme.slate600).frame(maxWidth: .infinity).padding(.vertical, 8)
                                            .background(RoundedRectangle(cornerRadius: 12).fill(gender == g ? Theme.teal : Theme.slate100))
                                    }
                                    .buttonStyle(ScaleButtonStyle())
                                }
                            }
                        }
                        field("AGE") { TextField("", text: $age).keyboardType(.numberPad).onChange(of: age) { _, _ in saved = false } }
                        field("PREFERRED WAY TO COMMUNICATE") { TextField("e.g. mostly AAC, some verbal words", text: $communicationStyle).onChange(of: communicationStyle) { _, _ in saved = false } }
                        VStack(alignment: .leading, spacing: 4) {
                            label("ANYTHING ELSE WE SHOULD KNOW?")
                            ZStack(alignment: .topLeading) {
                                if notes.isEmpty { Text("Interests, what helps them stay calm, sensory preferences…").font(.od(FS.sm)).foregroundColor(Theme.slate300).padding(.horizontal, 16).padding(.vertical, 18) }
                                TextEditor(text: $notes).font(.od(FS.sm)).foregroundColor(Theme.slate800).scrollContentBackground(.hidden).padding(.horizontal, 12).padding(.vertical, 10)
                                    .onChange(of: notes) { _, _ in saved = false }
                            }
                            .frame(height: 130).background(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
                        }
                        Button(action: save) {
                            Text(saving ? "Saving…" : saved ? "Saved!" : "Save").font(.od(FS.sm, bold: true)).foregroundColor(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 10).background(RoundedRectangle(cornerRadius: 12).fill(Theme.teal))
                        }
                        .buttonStyle(ScaleButtonStyle()).disabled(saving).opacity(saving ? 0.5 : 1)
                    }
                    .padding(20).sticker(Color.white, radius: 16)
                }
            }
            .frame(maxWidth: 672).padding(.horizontal, 32).padding(.top, 88).padding(.bottom, 40).frame(maxWidth: .infinity)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .onAppear {
            Task {
                _ = try? await RemoteApi.pullProfile()
                let p = Store.getProfile()
                gender = p.gender == "boy" ? "boy" : "girl"; age = p.age.map(String.init) ?? ""; communicationStyle = p.communicationStyle ?? ""; notes = p.notes ?? ""
                loading = false
            }
        }
    }

    private func label(_ t: String) -> some View { Text(t).font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate400).kerning(1) }
    private func field<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            label(title)
            content().font(.od(FS.sm)).foregroundColor(Theme.slate800).autocorrectionDisabled().padding(.horizontal, 12).padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
        }
    }
    private func save() {
        saving = true; saved = false
        var p = Store.getProfile()
        p.gender = gender; p.age = Int(age); p.communicationStyle = communicationStyle.isEmpty ? nil : communicationStyle; p.notes = notes.isEmpty ? nil : notes
        Store.setProfile(p)
        Task { if (try? await RemoteApi.pushProfile(p)) != nil { saved = true }; saving = false }
    }
}
