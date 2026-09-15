import SwiftUI

struct SessionEndScreen: View {
    let sessionId: String
    @EnvironmentObject var router: Router
    @State private var dialogue: [DialogueMessage] = []
    @State private var rating: Int? = nil
    @State private var submitted = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Text("Great conversation!").font(.od(FS.xl3, bold: true)).foregroundColor(Theme.slate700).padding(.bottom, 8)
                Text("Here's what you talked about today.").font(.od(FS.base)).foregroundColor(Theme.slate500).padding(.bottom, 32)

                VStack(spacing: 12) {
                    if !submitted {
                        Text("How did the conversation go?").font(.od(FS.lg, bold: true)).foregroundColor(Theme.slate700)
                        Text("Tap a star to rate it together").font(.od(FS.sm)).foregroundColor(Theme.slate500)
                        HStack(spacing: 8) {
                            ForEach(1...5, id: \.self) { s in
                                Button(action: { rate(s) }) { StarIcon(size: 52, fill: (rating ?? 0) >= s ? Theme.coral : Theme.slate200) }.buttonStyle(ScaleButtonStyle(scale: 0.9))
                            }
                        }
                    } else {
                        Text("Thanks for rating!").font(.od(FS.lg, bold: true)).foregroundColor(Theme.slate700)
                        HStack(spacing: 8) { ForEach(1...5, id: \.self) { s in StarIcon(size: 44, fill: (rating ?? 0) >= s ? Theme.coral : Theme.slate200) } }
                        Text("\(rating ?? 0) out of 5 stars").font(.od(FS.sm)).foregroundColor(Theme.slate500)
                    }
                }
                .padding(.horizontal, 32).padding(.vertical, 24)
                .frame(maxWidth: 448)
                .background(RoundedRectangle(cornerRadius: 24).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 24).stroke(Theme.teal, lineWidth: 2))
                .shadow(color: .black.opacity(0.08), radius: 4, y: 2)
                .padding(.bottom, 32)

                VStack(alignment: .leading, spacing: 12) {
                    Text("Conversation transcript").font(.od(FS.base, bold: true)).foregroundColor(Theme.slate700)
                    if dialogue.isEmpty {
                        Text("Nothing was said this session.").font(.od(FS.base)).italic().foregroundColor(Theme.slate400)
                    } else {
                        ScrollView { TranscriptView(dialogue: dialogue) }.frame(maxHeight: 384)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 24).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 24).stroke(Theme.slate200.opacity(0.6)))
                .shadow(color: .black.opacity(0.08), radius: 4, y: 2)
                .padding(.bottom, 32)

                HStack(spacing: 12) {
                    PillButton(title: "Back to home", color: Theme.teal) { router.home() }
                    PillButton(title: "See all stars", color: Theme.coral) { router.go(.stars) }
                }
            }
            .frame(maxWidth: 768)
            .padding(.horizontal, 32).padding(.top, 88).padding(.bottom, 40)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .onAppear {
            dialogue = LocalApi.shared.getDialogue(sessionId)
            if let r = LocalApi.shared.listSessions().first(where: { $0.id == sessionId })?.rating { rating = r; submitted = true }
            Task { let d = await LocalApi.shared.getDialogueMerged(sessionId); await MainActor.run { if !d.isEmpty { dialogue = d } } }
        }
    }

    private func rate(_ r: Int) {
        guard !submitted else { return }
        rating = r; submitted = true
        LocalApi.shared.rateSession(sessionId, rating: r)
    }
}
