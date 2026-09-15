import SwiftUI

/// Phone layout for the session screen (viewport narrower than 900 pt or shorter than 600 pt). Everything
/// fits without scrolling: portrait shows the cards as a 3 x 8 grid, landscape as 9 x 3 with the action
/// buttons drawn as tiles; Transcript / Sound / place / text size / End collapse into one ☰ menu.
struct CompactSession: View {
    @ObservedObject var vm: SessionViewModel
    var landscape: Bool
    var safeTop: CGFloat
    var safeBottom: CGFloat

    var body: some View {
        let childTurn = vm.phase == .idle && vm.role == .child && vm.childRec != nil
        let said = vm.role == .child ? vm.bankedChildSentences.last : nil
        let banner: String = vm.role == .child ? (said.map { "“\($0)”" } ?? vm.lastParentMessage.map { "“\($0)”" } ?? "") : vm.bankedChildSentences.map { "“\($0)”" }.joined(separator: "  ")
        ZStack {
            Theme.cream
            VStack(spacing: 6) {
                if !banner.isEmpty || (landscape && childTurn) {
                    HStack(spacing: 6) {
                        if landscape && childTurn {
                            Button(action: { vm.showMenu = true }) { Image(systemName: "line.3.horizontal").font(.system(size: 18, weight: .semibold)).foregroundColor(Color(hex: 0x575757)).frame(width: 40, height: 32).sticker(Color.white.opacity(0.9), radius: 12) }
                        }
                        if !banner.isEmpty {
                            HStack(spacing: 6) {
                                Text(banner).font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate700).lineLimit(1).frame(maxWidth: .infinity)
                                if let said = said {
                                    Button(action: { TTS.shared.speak(said) }) { Image(systemName: "speaker.wave.2.fill").font(.system(size: 14)).foregroundColor(Theme.slate600).frame(width: 30, height: 26).sticker(Color.white, radius: 8, border: 2, bottom: 3) }
                                }
                            }
                            .padding(.horizontal, 12).padding(.vertical, 4).frame(maxWidth: .infinity)
                            .sticker(said != nil ? Theme.teal.opacity(0.15) : (vm.role == .child ? Theme.purple100 : Theme.teal.opacity(0.15)), radius: 12, border: 2, bottom: 3)
                        }
                    }
                    .padding(.horizontal, 8).padding(.top, 6)
                }
                Group {
                    switch vm.phase {
                    case .initial, .thinking, .closing:
                        VStack(spacing: 12) { Spinner(size: 64); Text(vm.phaseLabel).font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate600).multilineTextAlignment(.center) }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    case .idle:
                        if vm.role == .parent && vm.started { ParentCompact(vm: vm, landscape: landscape) }
                        else if vm.role == .child, let rec = vm.childRec { ChildCompact(vm: vm, rec: rec, landscape: landscape) }
                    }
                }
                .padding(.horizontal, 8).padding(.vertical, 6)
            }
            .padding(.top, safeTop).padding(.bottom, safeBottom)

            if !(vm.phase == .idle && vm.role == .child && vm.childRec != nil) {
                VStack { Spacer(); HStack { IconButton(action: { vm.showMenu = true }) { Image(systemName: "line.3.horizontal").font(.system(size: 22, weight: .semibold)).foregroundColor(Color(hex: 0x575757)) }; Spacer() } }
                    .padding(12).padding(.bottom, safeBottom)
            }

            if let s = vm.inferredSentence {
                SentenceAcceptance(sentence: s, compact: true, busy: vm.anotherBusy, onAccept: { Task { await vm.onAcceptSentence() } }, onReject: { vm.onRejectSentence() }, onAnother: { Task { await vm.onAnotherSentence() } })
            }
            if vm.showDialogue { TranscriptModal(dialogue: vm.dialogue, onClose: { vm.showDialogue = false }) }
            if vm.showMenu {
                SessionMenu(onClose: { vm.showMenu = false }, onTranscript: { vm.showDialogue = true }, setting: vm.setting,
                            onSettingChange: { v in Task { await vm.changeSetting(v) } }, onEnd: { Task { await vm.endSession() } },
                            onCalibrate: { NotificationCenter.default.post(name: .gazeCalibrate, object: nil) })
            }
            if vm.showSearch {
                CardSearchOverlay(initialPath: vm.scopedFolderPath, extraRows: vm.moreRows, onSelect: { w, c, u in Task { await vm.onSearchSelect(word: w, category: c, imageUrl: u) } },
                                  onClose: { vm.showSearch = false; vm.scopedFolderPath = nil })
            }
            if let e = vm.errorMsg { VStack { ErrorToast(message: e) { vm.errorMsg = nil }.padding(.top, safeTop + 16); Spacer() } }
        }
        .overlay { GazeOverlay() }
    }
}

struct ParentCompact: View {
    @ObservedObject var vm: SessionViewModel
    var landscape: Bool
    var body: some View { ParentTurn(vm: vm, compact: true) }
}

struct ChildCompact: View {
    @ObservedObject var vm: SessionViewModel
    var rec: ChildCardRecommendationResult
    var landscape: Bool

    enum Cell: Identifiable { case card(CardInfo), search, more, refresh, clear, confirm, done, empty(Int)
        var id: String { switch self { case .card(let c): return c.id; case .search: return "search"; case .more: return "more"; case .refresh: return "refresh"; case .clear: return "clear"; case .confirm: return "confirm"; case .done: return "done"; case .empty(let i): return "empty\(i)" } }
    }

    private func pad(_ xs: [CardInfo], _ n: Int, tag: Int) -> [Cell] {
        var out = xs.prefix(n).map { Cell.card($0) }
        var i = 0
        while out.count < n { out.append(.empty(tag * 100 + i)); i += 1 }
        return out
    }

    var body: some View {
        let by = Dictionary(grouping: rec.cards, by: { $0.category })
        // portrait 3 x 9: topic 9, action 6, feeling 3, quick row 7, More ideas, View all; landscape 9 x 4 adds the action tiles
        var cells: [Cell] = pad(by[.topic] ?? [], 9, tag: 1) + pad(by[.action] ?? [], 6, tag: 2) + pad(by[.emotion] ?? [], 3, tag: 3) + pad(by[.core] ?? [], 7, tag: 4) + [.more, .search]
        if landscape { cells += [.refresh, .clear, .confirm, .done] }
        let cols = landscape ? 9 : 3
        var padIdx = 900
        while cells.count % cols != 0 { cells.append(.empty(padIdx)); padIdx += 1 }
        return VStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    if vm.interimCards.isEmpty { Text("Tap cards to build your sentence…").font(.od(FS.xs)).italic().foregroundColor(Theme.slate400) }
                    ForEach(Array(vm.interimCards.enumerated()), id: \.offset) { _, c in
                        Button(action: { vm.onRemoveCard(c.id) }) {
                            HStack(spacing: 4) { Text(c.displayName).font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate700); Text("✕").font(.od(10, bold: true)).foregroundColor(Theme.coral) }
                                .padding(.horizontal, 8).padding(.vertical, 2).stickerCapsule(Color.white, border: 2, bottom: 3)
                        }
                    }
                }
                .padding(.horizontal, 8)
            }
            .frame(height: 40)
            .sticker(Theme.amber50.opacity(0.8), radius: 12, border: 2, bottom: 3)

            GeometryReader { g in
                let gap: CGFloat = 6
                let rows = cells.count / cols
                let cw = (g.size.width - CGFloat(cols - 1) * gap) / CGFloat(cols)
                let ch = (g.size.height - CGFloat(rows - 1) * gap) / CGFloat(rows)
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(cw), spacing: gap), count: cols), spacing: gap) {
                    ForEach(cells) { cell in
                        Group {
                            switch cell {
                            case .card(let c): CardChip(card: c, size: .fill, enabled: !vm.refreshingCards) { Task { await vm.onCardClick(c) } }
                            case .search:
                                Button(action: { vm.openSearch() }) {
                                    VStack(spacing: 2) { Text("🔍").font(.system(size: 24)); Text("View all").font(.od(11, bold: true)).foregroundColor(Theme.slate500) }
                                        .frame(maxWidth: .infinity, maxHeight: .infinity).sticker(Color.white, radius: 12, border: 2, bottom: 3)
                                }.buttonStyle(ScaleButtonStyle()).gazeTarget("search") { vm.openSearch() }
                            case .more:
                                Button(action: { vm.openMoreIdeas() }) {
                                    VStack(spacing: 2) { Text("💡").font(.system(size: 24)); Text("More ideas").font(.od(11, bold: true)).foregroundColor(Theme.slate500) }
                                        .frame(maxWidth: .infinity, maxHeight: .infinity).sticker(Color.white, radius: 12, border: 2, bottom: 3)
                                }.buttonStyle(ScaleButtonStyle()).gazeTarget("more") { vm.openMoreIdeas() }
                            case .refresh: actionTile("Refresh", "↻", Color(hex: 0x64748b), enabled: !vm.refreshingCards) { vm.onRefreshCards() }
                            case .clear: actionTile("Clear", "✕", Color.white, fg: Theme.slate600, enabled: !vm.refreshingCards && !vm.interimCards.isEmpty) { Task { await vm.onClearCards() } }
                            case .confirm: actionTile("Generate sentence", "💬", Theme.teal, enabled: !vm.interimCards.isEmpty && !vm.refreshingCards) { Task { await vm.onConfirm() } }
                            case .done: actionTile("Done", "✓", Theme.coral, enabled: !vm.refreshingCards) { vm.onFinishTurn() }
                            case .empty: Color.clear
                            }
                        }
                        .frame(width: cw, height: ch)
                    }
                }
                .overlay {
                    if vm.refreshingCards {
                        ZStack { RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.6))
                            HStack(spacing: 8) { Spinner(size: 18, strokeWidth: 6); Text("Thinking…").font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate600) }
                                .padding(.horizontal, 12).padding(.vertical, 6).background(Capsule().fill(Color.white)).overlay(Capsule().stroke(Theme.slate200)) }
                        .allowsHitTesting(false)
                    }
                }
            }

            if !landscape {
                HStack(spacing: 8) {
                    Button(action: { vm.showMenu = true }) { Image(systemName: "line.3.horizontal").font(.system(size: 20, weight: .semibold)).foregroundColor(Color(hex: 0x575757)).frame(width: 44, height: 44).sticker(Color.white.opacity(0.9), radius: 12) }
                    PillButton(title: "↻ Refresh", color: Theme.slate500, fontSize: FS.xs, hPad: 12, vPad: 6, minHeight: 40, enabled: !vm.refreshingCards) { vm.onRefreshCards() }
                        .gazeTarget("refresh") { if !vm.refreshingCards { vm.onRefreshCards() } }
                    PillButton(title: "✕ Clear", color: Theme.slate400, fontSize: FS.xs, hPad: 10, vPad: 6, minHeight: 40, enabled: !vm.refreshingCards && !vm.interimCards.isEmpty) { Task { await vm.onClearCards() } }
                        .gazeTarget("clear") { if !vm.refreshingCards && !vm.interimCards.isEmpty { Task { await vm.onClearCards() } } }
                    PillButton(title: "Generate", color: Theme.teal, fontSize: FS.xs, hPad: 16, vPad: 6, minHeight: 40, fullWidth: true, enabled: !vm.interimCards.isEmpty && !vm.refreshingCards) { Task { await vm.onConfirm() } }
                        .gazeTarget("generate") { if !vm.interimCards.isEmpty && !vm.refreshingCards { Task { await vm.onConfirm() } } }
                    PillButton(title: "Done", color: Theme.coral, fontSize: FS.xs, hPad: 16, vPad: 6, minHeight: 40, enabled: !vm.refreshingCards) { vm.onFinishTurn() }
                        .gazeTarget("done") { if !vm.refreshingCards { vm.onFinishTurn() } }
                }
            }
        }
    }

    private func actionTile(_ label: String, _ icon: String, _ bg: Color, fg: Color = .white, enabled: Bool, action: @escaping () -> Void) -> some View {
        actionTileBody(label, icon, bg, fg: fg, enabled: enabled, action: action).gazeTarget("tile:" + label) { if enabled { action() } }
    }
    private func actionTileBody(_ label: String, _ icon: String, _ bg: Color, fg: Color = .white, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) { Text(icon).font(.system(size: 20)).foregroundColor(fg); Text(label).font(.od(10, bold: true)).foregroundColor(fg).multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.8) }
                .frame(maxWidth: .infinity, maxHeight: .infinity).sticker(bg, radius: 12, border: 2, bottom: 3)
        }
        .buttonStyle(ScaleButtonStyle()).disabled(!enabled).opacity(enabled ? 1 : 0.4)
    }
}
