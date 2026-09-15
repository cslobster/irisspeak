import SwiftUI

struct StarsScreen: View {
    @EnvironmentObject var router: Router
    @State private var sessions: [SessionInfo] = []
    @State private var selected: SessionInfo?
    @State private var dialogue: [DialogueMessage] = []

    private func fmt(_ ms: Double) -> String {
        let d = Date(timeIntervalSince1970: ms / 1000)
        let f = DateFormatter(); f.dateFormat = "MMM d, h:mm a"; return f.string(from: d)
    }

    var body: some View {
        ZStack {
            ScrollView {
                VStack(spacing: 12) {
                    HStack {
                        Text("Your conversations").font(.od(FS.xl2, bold: true)).foregroundColor(.black)
                        Spacer()
                        CloseButton { router.back() }
                    }
                    .padding(.bottom, 12)
                    if sessions.isEmpty {
                        Text("No conversations yet. Start one from the home screen!").font(.od(FS.base)).foregroundColor(Theme.slate500).padding(.vertical, 48)
                    }
                    ForEach(sessions) { s in
                        Button(action: { open(s) }) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(s.title ?? "Conversation").font(.od(FS.base, bold: true)).foregroundColor(Theme.slate800).lineLimit(1)
                                    Text("\(fmt(s.startedTimestamp)) · \(s.numTurns) turn\(s.numTurns == 1 ? "" : "s") · \(s.status.rawValue)").font(.od(FS.xs)).foregroundColor(Theme.slate500)
                                }
                                Spacer()
                                if let r = s.rating {
                                    HStack(spacing: 2) { ForEach(1...5, id: \.self) { i in StarIcon(size: 16, fill: r >= i ? Theme.coral : Theme.slate200) } }
                                } else {
                                    Text("Not rated").font(.od(FS.xs)).foregroundColor(Theme.slate400)
                                }
                            }
                            .padding(16)
                            .frame(maxWidth: .infinity)
                            .sticker(Color.white, radius: 16)
                        }
                        .buttonStyle(ScaleButtonStyle(scale: 0.99))
                    }
                }
                .frame(maxWidth: 768)
                .padding(.horizontal, 32).padding(.top, 88).padding(.bottom, 40)
                .frame(maxWidth: .infinity)
            }
            if let s = selected {
                ModalBackdrop(onClose: { selected = nil }) {
                    VStack(spacing: 0) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.title ?? "Conversation").font(.od(FS.xl, bold: true)).foregroundColor(Theme.slate800).lineLimit(1)
                                Text(fmt(s.startedTimestamp)).font(.od(FS.xs)).foregroundColor(Theme.slate500)
                            }
                            Spacer()
                            Button(action: { selected = nil }) {
                                Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(Theme.slate500)
                                    .frame(width: 36, height: 36).stickerCircle(Color.white, border: 2, bottom: 4)
                            }
                        }
                        .padding(.horizontal, 24).padding(.vertical, 16)
                        Divider()
                        HStack(spacing: 8) {
                            Text("Rating:").font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate500)
                            if let r = s.rating { HStack(spacing: 2) { ForEach(1...5, id: \.self) { i in StarIcon(size: 20, fill: r >= i ? Theme.coral : Theme.slate200) } } }
                            else { Text("Not rated").font(.od(FS.sm)).italic().foregroundColor(Theme.slate400) }
                            Spacer()
                        }
                        .padding(.horizontal, 24).padding(.vertical, 12)
                        Divider()
                        ScrollView {
                            if dialogue.isEmpty { Text("Nothing was said this session.").font(.od(FS.base)).italic().foregroundColor(Theme.slate400).padding(.vertical, 32) }
                            else { TranscriptView(dialogue: dialogue).padding(20) }
                        }
                    }
                    .frame(maxWidth: 512, maxHeight: 640)
                    .sticker(Color.white, radius: 24, border: 3, bottom: 8)
                    .padding(24)
                }
            }
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .onAppear {
            sessions = LocalApi.shared.listSessions().sorted { $0.startedTimestamp > $1.startedTimestamp }
            Task { let all = await LocalApi.shared.listSessionsMerged(); await MainActor.run { sessions = all.sorted { $0.startedTimestamp > $1.startedTimestamp } } }
        }
    }

    private func open(_ s: SessionInfo) {
        selected = s; dialogue = LocalApi.shared.getDialogue(s.id)
        Task { let d = await LocalApi.shared.getDialogueMerged(s.id); await MainActor.run { if selected?.id == s.id { dialogue = d } } }
    }
}

struct CloseButton: View {
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark").font(.system(size: 20, weight: .bold)).foregroundColor(Color(hex: 0x575757))
                .frame(width: 44, height: 44).sticker(Color.white, radius: 12)
        }
        .buttonStyle(ScaleButtonStyle())
    }
}
