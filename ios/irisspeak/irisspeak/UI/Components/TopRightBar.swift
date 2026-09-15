import SwiftUI

/// The one corner button, same as irisspeak.org / irisspeak.com: "Settings" (gear) top-right on every signed-in
/// screen except during a session (the ☰ menu replaces it). Menu: Sound on/off, text size, Previous conversations,
/// Vocabulary, Profile, Sign out.
struct SettingsButton: View {
    @Binding var showMenu: Bool
    @EnvironmentObject var uiScale: UiScale
    @EnvironmentObject var mute: MuteState
    @EnvironmentObject var router: Router

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            Button(action: { showMenu.toggle() }) {
                HStack(spacing: 8) {
                    Image(systemName: "gearshape.fill").font(.system(size: 18)).foregroundColor(Theme.slate500)
                    Text("Settings").font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate600)
                }
                .padding(.leading, 12).padding(.trailing, 16).frame(height: 48)
                .sticker(Color.white.opacity(0.85), radius: 16)
            }
            .buttonStyle(ScaleButtonStyle())
            if showMenu {
                VStack(alignment: .leading, spacing: 0) {
                    Button(action: { mute.muted.toggle() }) {
                        HStack(spacing: 12) {
                            Image(systemName: mute.muted ? "speaker.slash.fill" : "speaker.wave.2.fill").font(.system(size: 18)).foregroundColor(mute.muted ? Theme.coral : Theme.slate500)
                            Text(mute.muted ? "Sound off" : "Sound on").font(.od(FS.sm, bold: true)).foregroundColor(mute.muted ? Theme.coral : Theme.slate600)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.vertical, 16)
                    }
                    Divider()
                    VStack(alignment: .leading, spacing: 8) {
                        Text("VOICE").font(.od(11, bold: true)).foregroundColor(Theme.slate400).kerning(1)
                        VoicePicker()
                    }
                    .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 12)
                    Divider()
                    VStack(alignment: .leading, spacing: 8) {
                        Text("TEXT & CARD SIZE").font(.od(11, bold: true)).foregroundColor(Theme.slate400).kerning(1)
                        UiScalePicker()
                    }
                    .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 12)
                    Divider()
                    menuRow("Previous conversations") { showMenu = false; router.go(.stars) }
                    Divider()
                    menuRow("Vocabulary") { showMenu = false; router.go(.vocabulary) }
                    Divider()
                    menuRow("Profile") { showMenu = false; router.go(.profile) }
                    Divider()
                    menuRow("Credits & privacy") { showMenu = false; router.go(.credits) }
                    Divider()
                    menuRow("Sign out", color: Theme.coral) { showMenu = false; router.home(); RemoteApi.signOut() }
                }
                .frame(width: 256)
                .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.slate100))
                .shadow(color: .black.opacity(0.15), radius: 12, y: 6)
            }
        }
    }

    private func menuRow(_ title: String, color: Color = Theme.slate600, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.od(FS.sm, bold: true)).foregroundColor(color)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.vertical, 16)
        }
    }
}

/// Girl / Boy voice, defaulting to the child's gender on the account ("Auto"). Tapping a choice says a short sample.
struct VoicePicker: View {
    @State private var choice = Store.voice
    @State private var hasPersonal = TTS.personalVoice != nil
    var body: some View {
        let auto = Store.getProfile().gender == "boy" ? "boy" : "girl"
        var options = [("auto", "Auto (\(auto))"), ("girl", "Girl"), ("boy", "Boy")]
        if hasPersonal { options.append(("personal", "Mine")) }
        return HStack(spacing: 6) {
            ForEach(options, id: \.0) { v, label in
                Button(action: { Store.voice = v; choice = v; TTS.shared.speak("Hello, I am ready.") }) {
                    Text(label).font(.od(FS.xs, bold: true))
                        .foregroundColor(choice == v ? .white : Theme.slate600)
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 12).fill(choice == v ? Theme.teal : Theme.slate100))
                }
                .buttonStyle(ScaleButtonStyle())
            }
        }
        .onAppear { if !hasPersonal { TTS.requestPersonalVoice { ok in hasPersonal = ok } } }   // "Mine" appears once a Personal Voice is set up and allowed
    }
}

struct UiScalePicker: View {
    @EnvironmentObject var uiScale: UiScale
    var body: some View {
        HStack(spacing: 6) {
            ForEach(UiScaleLevel.allCases) { level in
                Button(action: { uiScale.level = level }) {
                    Text(level.label).font(.od(FS.xs, bold: true))
                        .foregroundColor(uiScale.level == level ? .white : Theme.slate600)
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 12).fill(uiScale.level == level ? Theme.teal : Theme.slate100))
                }
                .buttonStyle(ScaleButtonStyle())
            }
        }
    }
}

/// The one session menu (opened from the ☰ button): Transcript, Sound, place, text size,
/// previous conversations, vocabulary, profile and End conversation.
struct SessionMenu: View {
    var onClose: () -> Void
    var onTranscript: () -> Void
    var setting: String
    var onSettingChange: (String) -> Void
    var onEnd: () -> Void
    var onCalibrate: () -> Void = {}
    @EnvironmentObject var mute: MuteState
    @EnvironmentObject var router: Router

    var body: some View {
        ModalBackdrop(onClose: onClose) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Menu").font(.od(FS.lg, bold: true))
                    Spacer()
                    Button(action: onClose) { Image(systemName: "xmark").font(.system(size: 18, weight: .bold)).foregroundColor(Theme.slate500) }
                }
                HStack(spacing: 8) {
                    sheetButton("Transcript", accent: false) { Text("📜").font(.system(size: 26)) } action: { onClose(); onTranscript() }
                    sheetButton(mute.muted ? "Muted" : "Sound on", accent: mute.muted) {
                        Image(systemName: mute.muted ? "speaker.slash.fill" : "speaker.wave.2.fill").font(.system(size: 22)).foregroundColor(mute.muted ? Theme.coral : Theme.slate500)
                    } action: { mute.muted.toggle() }
                    let cur = SettingOption.all.first { $0.value == setting } ?? SettingOption.all[0]
                    Menu {
                        ForEach(SettingOption.all) { s in Button(s.label) { onSettingChange(s.value) } }
                    } label: {
                        VStack(spacing: 4) {
                            Text(cur.icon).font(.system(size: 26))
                            Text(cur.label.components(separatedBy: " /")[0]).font(.od(11, bold: true)).foregroundColor(Theme.slate600)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.slate100))
                    }
                }
                Text("VOICE").font(.od(11, bold: true)).foregroundColor(Theme.slate400).kerning(1)
                VoicePicker()
                Text("TEXT & CARD SIZE").font(.od(11, bold: true)).foregroundColor(Theme.slate400).kerning(1)
                UiScalePicker()
                Divider()
                GazeMenuSection(onCalibrate: { onClose(); onCalibrate() })
                Divider()
                Button("Previous conversations") { onClose(); router.go(.stars) }.font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate600).padding(.vertical, 6)
                Divider()
                Button("Vocabulary") { onClose(); router.go(.vocabulary) }.font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate600).padding(.vertical, 6)
                Divider()
                Button("Profile") { onClose(); router.go(.profile) }.font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate600).padding(.vertical, 6)
                PillButton(title: "End conversation", color: Theme.teal, fontSize: FS.sm, vPad: 8, fullWidth: true) { onClose(); onEnd() }
            }
            .padding(20)
            .frame(maxWidth: 448)
            .sticker(Color.white, radius: 24, border: 2, bottom: 5)
            .padding(24)
        }
    }

    private func sheetButton<L: View>(_ label: String, accent: Bool, @ViewBuilder icon: () -> L, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                icon()
                Text(label).font(.od(11, bold: true)).foregroundColor(accent ? Theme.coral : Theme.slate600)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.slate100))
        }
        .buttonStyle(ScaleButtonStyle())
    }
}
