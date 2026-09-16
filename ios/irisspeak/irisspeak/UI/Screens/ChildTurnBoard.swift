import SwiftUI

/// The child's turn on the iPad board: the selection deck, three category panels (Topic 4 columns, Action 1,
/// Feeling 1, widths 4:1:1) that stretch to fill the available space, the core-card row and the action bar.
struct ChildTurn: View {
    @ObservedObject var vm: SessionViewModel
    var rec: ChildCardRecommendationResult

    var body: some View {
        let groups = Dictionary(grouping: rec.cards, by: { $0.category })
        VStack(spacing: 10) {
            SelectionDeck(interim: vm.interimCards, onRemove: { vm.onRemoveCard($0) }, onConfirm: { Task { await vm.onConfirm() } }, busy: vm.refreshingCards)

            GeometryReader { g in
                let gap: CGFloat = 12
                let unit = (g.size.width - 2 * gap) / 6
                HStack(alignment: .top, spacing: gap) {
                    panel("Topic", Theme.cardTopic, groups[.topic] ?? [], cols: 4, width: unit * 4, height: g.size.height)
                    panel("Action", Theme.cardAction, groups[.action] ?? [], cols: 1, width: unit, height: g.size.height)
                    panel("Feeling", Theme.cardEmotion, groups[.emotion] ?? [], cols: 1, width: unit, height: g.size.height)
                }
                .overlay {
                    if vm.refreshingCards {
                        ZStack {
                            RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.7))
                            HStack(spacing: 8) { Spinner(size: 20, strokeWidth: 6); Text("Thinking…").font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate600) }
                                .padding(.horizontal, 16).padding(.vertical, 8)
                                .background(Capsule().fill(Color.white)).overlay(Capsule().stroke(Theme.slate200)).shadow(radius: 3)
                        }
                        .allowsHitTesting(false)
                    }
                }
            }
            .frame(maxHeight: .infinity)

            // Core cards + "View all words": one row that shares the full width.
            GeometryReader { g in
                let core = groups[.core] ?? []
                let n = CGFloat(core.count + 2)
                let gap: CGFloat = 12
                let w = min(120, (g.size.width - (n - 1) * gap) / n)
                let h = g.size.height
                HStack(spacing: gap) {
                    ForEach(core) { c in
                        CardChip(card: c, size: .fill, enabled: !vm.refreshingCards) { Task { await vm.onCardClick(c) } }.frame(width: w, height: h)
                    }
                    Button(action: { vm.openMoreIdeas() }) {
                        VStack(spacing: 6) {
                            Text("💡").font(.system(size: 30)).frame(maxWidth: .infinity, maxHeight: .infinity).background(RoundedRectangle(cornerRadius: 12).fill(Theme.amber50))
                            Text("More\nideas").font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate500).lineLimit(2).multilineTextAlignment(.center).minimumScaleFactor(0.7)
                        }
                        .padding(8).frame(width: w, height: h)
                        .sticker(Color.white, radius: 16)
                    }
                    .buttonStyle(ScaleButtonStyle())
                    .gazeTarget("more") { vm.openMoreIdeas() }
                    Button(action: { vm.openSearch() }) {
                        VStack(spacing: 6) {
                            Text("🔍").font(.system(size: 30)).frame(maxWidth: .infinity, maxHeight: .infinity).background(RoundedRectangle(cornerRadius: 12).fill(Theme.slate100))
                            Text("View all\nwords").font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate500).lineLimit(2).multilineTextAlignment(.center).minimumScaleFactor(0.7).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(8).frame(width: w, height: h)
                        .sticker(Color.white, radius: 16)
                    }
                    .buttonStyle(ScaleButtonStyle())
                    .gazeTarget("search") { vm.openSearch() }
                }
                .frame(maxWidth: .infinity)
            }
            .frame(height: 112)

            // Bottom row: the actions (the ☰ menu and the place picker sit in the screen corners, as on irisspeak.org).
            HStack(spacing: 12) {
                Spacer(minLength: 8)
                PillButton(title: "↻ Refresh", color: Theme.slate500, fontSize: FS.base, hPad: 24, enabled: !vm.refreshingCards) { vm.onRefreshCards() }
                    .gazeTarget("refresh") { if !vm.refreshingCards { vm.onRefreshCards() } }
                PillButton(title: "✕ Clear", color: Theme.slate400, fontSize: FS.base, hPad: 20, enabled: !vm.refreshingCards && !vm.interimCards.isEmpty) { Task { await vm.onClearCards() } }
                    .gazeTarget("clear") { if !vm.refreshingCards && !vm.interimCards.isEmpty { Task { await vm.onClearCards() } } }
                PillButton(title: "Done", color: Theme.coral, fontSize: FS.base, hPad: 32, enabled: !vm.refreshingCards) { vm.onFinishTurn() }
                    .gazeTarget("done") { if !vm.refreshingCards { vm.onFinishTurn() } }
                Spacer(minLength: 8)
            }
            .padding(.bottom, 4)
        }
    }

    private func panel(_ title: String, _ tint: Color, _ cards: [CardInfo], cols: Int, width: CGFloat, height: CGFloat) -> some View {
        let pad: CGFloat = 12, gap: CGFloat = 12, header: CGFloat = 26
        let rows = 3
        let cw = (width - 2 * pad - CGFloat(cols - 1) * gap) / CGFloat(cols)
        let ch = (height - 2 * pad - header - CGFloat(rows - 1) * gap - 4) / CGFloat(rows)
        return VStack(spacing: 8) {
            Text(title).font(.od(FS.base, bold: true)).foregroundColor(Theme.slate700).frame(height: header - 8)
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(cw), spacing: gap), count: cols), spacing: gap) {
                ForEach(cards) { c in
                    CardChip(card: c, size: .fill, enabled: !vm.refreshingCards) { Task { await vm.onCardClick(c) } }.frame(width: cw, height: ch)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(pad)
        .frame(width: width, height: height)
        .sticker(tint.opacity(0.4), radius: 16)
    }
}
