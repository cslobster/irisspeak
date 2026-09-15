import SwiftUI

/// The conversation screen: an adaptive full-screen board on iPads (nothing scrolls), a compact grid on phones.
struct SessionScreen: View {
    let sessionId: String
    @StateObject private var vm: SessionViewModel
    @EnvironmentObject var uiScale: UiScale
    @ObservedObject private var gaze = GazeController.shared
    @State private var showCalibration = false

    static let designW: CGFloat = 1024, designH: CGFloat = 880

    init(sessionId: String) {
        self.sessionId = sessionId
        _vm = StateObject(wrappedValue: SessionViewModel(sessionId: sessionId))
    }

    var body: some View {
        GeometryReader { g in
            let vw = g.size.width, vh = g.size.height
            let compact = vw < 900 || vh < 600
            if compact {
                CompactSession(vm: vm, landscape: vw > vh, safeTop: g.safeAreaInsets.top, safeBottom: g.safeAreaInsets.bottom)
                    .ignoresSafeArea()
            } else {
                // The board adapts to the viewport (panels stretch to the available height), so no scaling.
                board(width: vw, height: vh).frame(width: vw, height: vh)
            }
        }
        .overlay { GazeOverlay() }
        .overlay { if showCalibration { GazeCalibrationView { showCalibration = false } } }
        .onPreferenceChange(GazeTargetsKey.self) { gaze.targets = $0 }
        .onChange(of: gazeModeKey, initial: true) { _, k in
            gaze.suspended = k.hasPrefix("blocked")
            gaze.idFilter = k == "sentence" ? { $0.hasPrefix("sentence:") } : nil
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .task { await vm.start() }
        .onAppear { gaze.activate() }
        .onReceive(NotificationCenter.default.publisher(for: .gazeCalibrate)) { _ in vm.showMenu = false; showCalibration = true }
        .onDisappear { SessionViewModel.current = nil; gaze.deactivate() }
    }

    /// Which gaze targets are live: nothing while a modal is open, only the sentence buttons while approving.
    private var gazeModeKey: String {
        if vm.showSearch || vm.showDialogue || vm.showMenu || showCalibration || vm.phase != .idle { return "blocked" }
        if vm.inferredSentence != nil { return "sentence" }
        return "board"
    }

    // MARK: - iPad board

    private func board(width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            VStack(spacing: 8) {
                if vm.role == .child {
                    // Kept clear of the corner buttons (place picker left, ☰ right); long text wraps to two lines.
                    TurnBanner(role: vm.role, parentText: vm.lastParentMessage, childText: vm.bankedChildSentences)
                        .padding(.top, 8).padding(.horizontal, 190)
                }
                VStack(spacing: 0) {
                    switch vm.phase {
                    case .initial, .thinking, .closing:
                        Spacer(); Loader(label: vm.phaseLabel); Spacer()
                    case .idle:
                        if vm.role == .parent && vm.started {
                            // The parent's panel fills the screen without scrolling; no dialogue history here
                            // (user: "just do not show dialog history") — the Transcript lives in the ☰ menu.
                            ParentTurn(vm: vm).padding(.top, 44)   // clear of the ☰ button
                        } else if vm.role == .child, let rec = vm.childRec {
                            ChildTurn(vm: vm, rec: rec)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 16)
            .frame(width: width, height: height)

            // Same corners as irisspeak.org: the place picker top-left on the child's turn, the ☰ menu top-right always.
            VStack {
                HStack(alignment: .top) {
                    if vm.role == .child && vm.phase == .idle {
                        SettingPicker(value: vm.setting, large: false) { v in Task { await vm.changeSetting(v) } }
                    }
                    Spacer()
                    MenuIconButton { vm.showMenu = true }.gazeTarget("menu") { vm.showMenu = true }
                }
                .padding(.horizontal, 16).padding(.top, 12)
                Spacer()
            }

            overlays
        }
    }

    @ViewBuilder private var overlays: some View {
        if let s = vm.inferredSentence {
            SentenceAcceptance(sentence: s, busy: vm.anotherBusy, onAccept: { Task { await vm.onAcceptSentence() } }, onReject: { vm.onRejectSentence() }, onAnother: { Task { await vm.onAnotherSentence() } })
        }
        if vm.showDialogue {
            TranscriptModal(dialogue: vm.dialogue, onClose: { vm.showDialogue = false })
        }
        if vm.showMenu {
            SessionMenu(onClose: { vm.showMenu = false }, onTranscript: { vm.showDialogue = true }, setting: vm.setting,
                        onSettingChange: { v in Task { await vm.changeSetting(v) } }, onEnd: { Task { await vm.endSession() } },
                        onCalibrate: { showCalibration = true })
        }
        if vm.showSearch {
            CardSearchOverlay(initialPath: vm.scopedFolderPath, extraRows: vm.moreRows, onSelect: { w, c, u in Task { await vm.onSearchSelect(word: w, category: c, imageUrl: u) } },
                              onClose: { vm.showSearch = false; vm.scopedFolderPath = nil })
        }
        if let e = vm.errorMsg {
            VStack { ErrorToast(message: e) { vm.errorMsg = nil }.padding(.top, 64); Spacer() }
        }
    }
}

struct MenuIconButton: View {
    var action: () -> Void
    var body: some View {
        IconButton(action: action) { Image(systemName: "line.3.horizontal").font(.system(size: 26, weight: .semibold)).foregroundColor(Color(hex: 0x575757)) }
    }
}

struct Loader: View {
    var label: String
    var body: some View {
        VStack(spacing: 16) {
            Spinner(size: 112)
            Text(label).font(.od(FS.base, bold: true)).foregroundColor(Theme.slate600).multilineTextAlignment(.center)
        }
        .padding(.vertical, 40)
    }
}

struct TranscriptModal: View {
    var dialogue: [DialogueMessage]
    var onClose: () -> Void
    var body: some View {
        ModalBackdrop(onClose: onClose) {
            VStack(spacing: 0) {
                HStack {
                    Text("Transcript").font(.od(FS.xl, bold: true)).foregroundColor(Theme.slate800)
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(Theme.slate500)
                            .frame(width: 36, height: 36).background(Circle().fill(Theme.slate100))
                    }
                }
                .padding(.horizontal, 24).padding(.vertical, 16)
                Divider()
                ScrollView {
                    if dialogue.isEmpty {
                        Text("Nothing said yet.").font(.od(FS.base)).italic().foregroundColor(Theme.slate400).padding(.vertical, 32)
                    } else {
                        TranscriptView(dialogue: dialogue, scaled: true).padding(20)
                    }
                }
            }
            .frame(maxWidth: 512, maxHeight: 560)
            .background(RoundedRectangle(cornerRadius: 24).fill(Color.white))
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .shadow(color: .black.opacity(0.25), radius: 20)
            .padding(24)
        }
    }
}

/// "Where are you talking?" picker (emoji + menu), small in the corner or large on the parent turn.
struct SettingPicker: View {
    var value: String
    var large: Bool
    var onChange: (String) -> Void
    var body: some View {
        let cur = SettingOption.all.first { $0.value == value } ?? SettingOption.all[0]
        Menu {
            ForEach(SettingOption.all) { s in Button("\(s.icon) \(s.label)") { onChange(s.value) } }
        } label: {
            HStack(spacing: 12) {
                Text(cur.icon).font(.system(size: large ? 32 : 19))
                Text(large ? cur.label : String(cur.label.split(separator: " ")[0])).font(.od(large ? FS.xl2 : FS.sm, bold: true)).foregroundColor(Theme.slate700)
                if large { Spacer() }
                Image(systemName: "chevron.down").font(.system(size: large ? 16 : 12, weight: .bold)).foregroundColor(Theme.slate500)
            }
            .padding(.leading, large ? 20 : 12).padding(.trailing, large ? 16 : 12)
            .frame(maxWidth: large ? .infinity : nil)
            .frame(height: large ? 64 : 48)
            .sticker(Color.white.opacity(0.9), radius: 16, border: 2, bottom: large ? 5 : 4)
        }
    }
}

// MARK: - Parent turn (port of aac_next/src/components/AskPanel.tsx)

/// The top questions for each place, ranked by how often they were asked in the AAC training material (questions.json).
enum QuestionBank {
    struct Item: Decodable { var q: String; var n: Int }
    private struct File: Decodable { var settings: [String: [Item]] }
    static let bySetting: [String: [Item]] = {
        guard let u = Bundle.main.url(forResource: "questions", withExtension: "json"), let d = try? Data(contentsOf: u),
              let f = try? JSONDecoder().decode(File.self, from: d) else { return [:] }
        return f.settings
    }()
}

/// The parent's turn, one screen: 1 · pick a place, 2 · tap one of its top questions, or speak, or type.
struct ParentTurn: View {
    @ObservedObject var vm: SessionViewModel
    var compact: Bool = false
    @EnvironmentObject var uiScale: UiScale
    @FocusState private var focused: Bool

    var body: some View {
        let isRecording = vm.recState == .recording
        let canSend = !vm.parentMessage.trimmingCharacters(in: .whitespaces).isEmpty || (isRecording && !vm.partialTranscript.trimmingCharacters(in: .whitespaces).isEmpty)
        let c = compact
        let mic: CGFloat = c ? 84 : 136
        let questions = Array((QuestionBank.bySetting[vm.setting] ?? []).prefix(6))
        GeometryReader { g in
        // iPad: everything scales with the height so the Send button is always on screen (no scrolling).
        let k: CGFloat = c ? 1 : min(1, max(0.55, g.size.height / 720))
        let mic = mic * k
        let body = VStack(spacing: (c ? 8 : 12) * k) {
                // Step 1: the place
                VStack(alignment: .leading, spacing: 6) {
                    Text("1 · WHERE ARE YOU?").font(.od(c ? 10 : FS.xs, bold: true)).foregroundColor(Theme.slate400).kerning(1.5)
                    let cols = Array(repeating: GridItem(.flexible(), spacing: c ? 8 : 12), count: c ? 4 : 8)
                    LazyVGrid(columns: cols, spacing: c ? 8 : 12) {
                        ForEach(SettingOption.all) { s in
                            let on = s.value == vm.setting
                            Button(action: { Task { await vm.changeSetting(s.value) } }) {
                                VStack(spacing: c ? 2 : 4) {
                                    Text(s.icon).font(.system(size: (c ? 30 : 36) * k))
                                    Text(s.short).font(.od(c ? 9 : 12, bold: true)).foregroundColor(on ? .white : Theme.slate500).lineLimit(1).minimumScaleFactor(0.6)
                                }
                                .frame(maxWidth: .infinity).frame(height: (c ? 64 : 88) * k)
                                .sticker(on ? Theme.teal : Color.white, radius: 12, border: 2, bottom: on ? 2 : 4)
                                .offset(y: on ? 2 : 0)
                            }
                            .buttonStyle(ScaleButtonStyle())
                        }
                    }
                }
                // Step 2: the question, one block
                VStack(alignment: .leading, spacing: c ? 6 : 12) {
                    Text("2 · ASK A QUESTION: PICK ONE, OR TAP TO SPEAK, OR TYPE").font(.od(c ? 10 : FS.sm, bold: true)).foregroundColor(Theme.slate400).kerning(1.2).lineLimit(2).minimumScaleFactor(0.7)
                    if questions.isEmpty {
                        Text("No questions yet for this place. Speak or type below.").font(.od(FS.xs)).italic().foregroundColor(Theme.slate400)
                    } else {
                        let qcols = Array(repeating: GridItem(.flexible(), spacing: c ? 6 : 12), count: c ? 1 : 3)
                        LazyVGrid(columns: qcols, spacing: c ? 6 : 12) {
                            ForEach(questions, id: \.q) { item in
                                Button(action: { vm.parentMessage = item.q; focused = false; Task { await vm.submitParent() } }) {
                                    Text(item.q).font(.od((c ? FS.sm : FS.lg) * uiScale.f, bold: true)).foregroundColor(Theme.slate700).multilineTextAlignment(.leading)
                                        .frame(maxWidth: .infinity, minHeight: (c ? 36 : 64) * k, alignment: .leading)
                                        .padding(.horizontal, c ? 12 : 16).padding(.vertical, (c ? 8 : 10) * k)
                                        .sticker(Color.white, radius: 12, border: 2, bottom: 3)
                                }
                                .buttonStyle(ScaleButtonStyle())
                            }
                        }
                    }
                    HStack(spacing: 12) {
                        DashedLine(); Text("or").font(.od(c ? 11 : FS.sm, bold: true)).foregroundColor(Theme.slate400); DashedLine()
                    }
                    .padding(.vertical, (c ? 6 : 16) * k)
                    VStack(spacing: 4) {
                        ZStack {
                            if isRecording { MicRipple() }
                            Button(action: { Task { await vm.handleMicTap() } }) {
                                ZStack {
                                    if isRecording { RoundedRectangle(cornerRadius: 8).fill(Color.white).frame(width: c ? 28 : 40, height: c ? 28 : 40) }
                                    else { MicGlyph(size: mic * 0.5) }
                                }
                                .frame(width: mic, height: mic)
                                .stickerCircle(isRecording ? Theme.coral : Theme.teal, border: 3, bottom: 7)
                            }
                            .buttonStyle(ScaleButtonStyle())
                        }
                        .frame(width: mic + 16, height: mic + 16)
                        Text(isRecording ? "Listening… tap to stop" : "Tap to speak, or type").font(.od((c ? FS.xs : FS.base) * uiScale.f, bold: true)).foregroundColor(Theme.slate500)
                            .padding(.bottom, (c ? 4 : 8) * k)
                        HStack(spacing: 12) {
                            ZStack(alignment: .topLeading) {
                                if vm.parentMessage.isEmpty && !isRecording {
                                    Text("Type your question…").font(.od((c ? FS.base : FS.xl) * uiScale.f)).foregroundColor(Theme.slate300).padding(.horizontal, c ? 16 : 20).padding(.vertical, c ? 12 : 20)
                                }
                                if isRecording {
                                    Text(vm.partialTranscript.isEmpty ? "Listening… tap the mic to stop" : vm.partialTranscript).font(.od((c ? FS.base : FS.xl) * uiScale.f)).foregroundColor(vm.partialTranscript.isEmpty ? Theme.slate300 : Theme.slate700).padding(.horizontal, c ? 16 : 20).padding(.vertical, c ? 12 : 20)
                                } else {
                                    TextEditor(text: $vm.parentMessage).font(.od((c ? FS.base : FS.xl) * uiScale.f)).foregroundColor(Theme.slate700)
                                        .scrollContentBackground(.hidden).padding(.horizontal, c ? 12 : 16).padding(.vertical, c ? 4 : 12).focused($focused)
                                }
                            }
                            .frame(height: (c ? 48 : 72) * k)
                            .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 16).stroke(focused ? Theme.coral : Theme.slate200, lineWidth: 2))
                            PillButton(title: "Send", color: canSend ? Theme.teal : Theme.slate300, fontSize: (c ? FS.sm : FS.xl) * k, hPad: c ? 12 : 32, minHeight: (c ? 48 : 72) * k, enabled: canSend) {
                                focused = false; Task { await vm.submitParent() }
                            }
                        }
                    }
                }
                .padding((c ? 8 : 20) * k)
                .sticker(Color.white.opacity(0.6), radius: 16, border: 2, bottom: 4)
            }
            .padding(.horizontal, c ? 8 : 16).padding(.vertical, c ? 4 : 8)   // full board width, like the child's card page
            .frame(maxWidth: .infinity)
        if c { ScrollView { body }.scrollDismissesKeyboard(.interactively) }
        else { body.frame(width: g.size.width, height: g.size.height, alignment: .top) }
        }
    }
}

/// The conversation so far, small, beside the parent's panel (newest at the bottom).
struct DialogueSide: View {
    var dialogue: [DialogueMessage]
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("SO FAR").font(.od(10, bold: true)).foregroundColor(Theme.slate400).kerning(1.5)
            if dialogue.isEmpty {
                Text("Nothing said yet.").font(.od(FS.xs)).italic().foregroundColor(Theme.slate400)
            } else {
                ScrollViewReader { proxy in
                    ScrollView(showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(dialogue.enumerated()), id: \.offset) { i, m in
                                let parent = m.role == .parent
                                Text(m.text ?? m.contentLocalized ?? (m.cards ?? []).map { $0.displayName }.joined(separator: " "))
                                    .font(.od(FS.xs, bold: parent)).foregroundColor(Theme.slate700).multilineTextAlignment(.leading)
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .frame(maxWidth: .infinity, alignment: parent ? .leading : .trailing)
                                    .background(RoundedRectangle(cornerRadius: 10).fill(parent ? Theme.teal.opacity(0.18) : Theme.coral.opacity(0.18)))
                                    .id(i)
                            }
                        }
                    }
                    .onAppear { proxy.scrollTo(dialogue.count - 1, anchor: .bottom) }
                    .onChange(of: dialogue.count) { _, n in proxy.scrollTo(n - 1, anchor: .bottom) }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .sticker(Color.white.opacity(0.6), radius: 16, border: 2, bottom: 4)
    }
}

struct DashedLine: View {
    var body: some View {
        Rectangle().fill(Color.clear).frame(height: 2)
            .overlay(GeometryReader { g in Path { p in p.move(to: CGPoint(x: 0, y: 1)); p.addLine(to: CGPoint(x: g.size.width, y: 1)) }.stroke(Theme.slate300, style: StrokeStyle(lineWidth: 2, dash: [6, 6])) })
    }
}

/// Outward ripple rings while the mic is listening.
struct MicRipple: View {
    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            ZStack {
                ForEach(0..<2, id: \.self) { i in
                    let u = ((t + Double(i) * 1.3).truncatingRemainder(dividingBy: 2.6)) / 2.6
                    let e = 0.5 - 0.5 * cos(u * .pi)
                    Circle().stroke(Theme.coral, lineWidth: 3).scaleEffect(1 + 0.65 * e).opacity(0.45 * (1 - e))
                }
            }
        }
    }
}

/// The child's selected cards as removable text pills (fixed height, horizontal scroll).
struct SelectionDeck: View {
    var interim: [CardInfo]
    var onRemove: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text("YOUR SELECTION").font(.od(10, bold: true)).kerning(1)
                if !interim.isEmpty { Text("(tap to remove)").font(.od(10)) }
            }
            .foregroundColor(Theme.amber700)
            if interim.isEmpty {
                Text("Tap cards below to build your sentence…").font(.od(FS.xs)).italic().foregroundColor(Theme.slate400)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(interim.enumerated()), id: \.offset) { _, c in
                            Button(action: { onRemove(c.id) }) {
                                HStack(spacing: 6) {
                                    Text(c.category == .emotion ? c.label : c.displayName).font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate700)
                                    Text("✕").font(.od(11, bold: true)).foregroundColor(Theme.coral)
                                }
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .stickerCapsule(Color.white, border: 2, bottom: 4)
                            }
                            .buttonStyle(ScaleButtonStyle())
                            .gazeTarget("remove:\(c.id)") { onRemove(c.id) }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 84)
        .sticker(Theme.amber50.opacity(0.8), radius: 16)
        .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
    }
}
