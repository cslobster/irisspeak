import SwiftUI

/// Indeterminate progress ring: the ring spins at a constant rate while the visible arc grows and shrinks.
struct Spinner: View {
    var size: CGFloat = 112
    var color: Color = Theme.teal
    var track: Color = Theme.slate200
    var strokeWidth: CGFloat = 5

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            let rot = (t.truncatingRemainder(dividingBy: 2)) / 2 * 360
            let u = (t.truncatingRemainder(dividingBy: 1.5)) / 1.5
            let eased = 0.5 - 0.5 * cos(u * .pi)
            let len = 0.01 + 0.7 * (u < 0.5 ? (0.5 - 0.5 * cos(u / 0.5 * .pi)) : 1)
            let start = u < 0.5 ? 0 : (eased - 0.5) * 1.4
            ZStack {
                Circle().stroke(track, lineWidth: strokeWidth * size / 50)
                Circle().trim(from: start, to: min(1, start + len))
                    .stroke(color, style: StrokeStyle(lineWidth: strokeWidth * size / 50, lineCap: .round))
            }
            .rotationEffect(.degrees(rot - 90))
        }
        .frame(width: size * 0.8, height: size * 0.8)
        .frame(width: size, height: size)
    }
}

/// Shows what the *other* person just said: on the child's turn, the parent's last message; on the
/// parent's turn, every sentence the child banked this turn.
struct TurnBanner: View {
    var role: DialogueRole
    var parentText: String?
    var childText: [String]
    @EnvironmentObject var uiScale: UiScale

    var body: some View {
        if role == .child, let said = childText.last {
            // Once the child has said something this turn, the banner shows that sentence (with a speaker to hear it
            // again) instead of the question.
            HStack(spacing: 12) {
                Text("“\(said)”").font(.od(FS.lg * uiScale.f, bold: true)).foregroundColor(Theme.slate700).multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.7)
                Button(action: { TTS.shared.speak(said) }) {
                    Image(systemName: "speaker.wave.2.fill").font(.system(size: 18)).foregroundColor(Theme.slate600)
                        .frame(width: 40, height: 40).sticker(Color.white, radius: 12)
                }
                .buttonStyle(ScaleButtonStyle())
                .gazeTarget("banner:speak") { TTS.shared.speak(said) }
            }
            .padding(.leading, 20).padding(.trailing, 8).padding(.vertical, 6)
            .frame(maxWidth: 672)
            .sticker(Theme.teal.opacity(0.15), radius: 16)
        } else if role == .child, let p = parentText {
            Text("“\(p)”")
                .font(.od(FS.lg * uiScale.f, bold: true)).foregroundColor(Theme.slate700).multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.7)
                .padding(.horizontal, 20).padding(.vertical, 10)
                .frame(maxWidth: 672)
                .sticker(Theme.purple100, radius: 16)
        } else if role == .parent, !childText.isEmpty {
            VStack(spacing: 6) {
                ForEach(Array(childText.enumerated()), id: \.offset) { _, s in Text("“\(s)”") }
            }
            .font(.od(FS.lg * uiScale.f, bold: true)).foregroundColor(Theme.slate700).multilineTextAlignment(.center)
            .padding(.horizontal, 20).padding(.vertical, 10)
            .frame(maxWidth: 672)
            .sticker(Theme.teal.opacity(0.15), radius: 16)
        }
    }
}

/// Transcript bubbles: consecutive same-role messages are grouped into one bubble.
struct TranscriptView: View {
    var dialogue: [DialogueMessage]
    var scaled: Bool = false
    @State private var expanded: Set<Int> = []
    @EnvironmentObject var uiScale: UiScale

    private var groups: [[DialogueMessage]] {
        var out: [[DialogueMessage]] = []
        for m in dialogue {
            if let last = out.last, last[0].role == m.role { out[out.count - 1].append(m) } else { out.append([m]) }
        }
        return out
    }

    var body: some View {
        let f = scaled ? uiScale.f : 1
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(groups.enumerated()), id: \.offset) { i, group in
                let role = group[0].role
                let accent = role == .parent ? Theme.teal : Theme.coral
                let isCards = group.allSatisfy { $0.isCards }
                VStack(alignment: .leading, spacing: 4) {
                    Text(role.rawValue.uppercased()).font(.od(10 * f, bold: true)).foregroundColor(accent).kerning(1)
                    if isCards {
                        let cards = group.flatMap { $0.cards ?? [] }
                        let sentence = group.map { $0.contentLocalized ?? ($0.cards ?? []).map { $0.displayName }.joined(separator: " ") }.joined(separator: " ")
                        Text(sentence).font(.od(FS.sm * f)).foregroundColor(Theme.slate800)
                        Button(expanded.contains(i) ? "Hide cards" : "View cards") {
                            if expanded.contains(i) { expanded.remove(i) } else { expanded.insert(i) }
                        }
                        .font(.od(FS.xs * f, bold: true)).foregroundColor(Theme.slate400).padding(.top, 2)
                        if expanded.contains(i) {
                            FlowLayout(spacing: 6) {
                                ForEach(Array(cards.enumerated()), id: \.offset) { _, c in
                                    Text(c.displayName).font(.od(FS.xs * f, bold: true)).foregroundColor(Theme.slate700)
                                        .padding(.horizontal, 8).padding(.vertical, 4)
                                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.slate200))
                                }
                            }.padding(.top, 4)
                        }
                    } else {
                        Text(group.map { $0.text ?? "" }.joined(separator: " ")).font(.od(FS.sm * f)).foregroundColor(Theme.slate800)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12).fill(accent.opacity(0.1)))
                .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(accent).frame(width: 4).padding(.vertical, 0) }
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }
}

/// Simple wrapping horizontal layout (Tailwind `flex-wrap`).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > w, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
        return CGSize(width: w == .infinity ? x : w, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > bounds.width, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}

/// Five-point star with a black outline and a hard black drop shadow (SessionEnd / Stars ratings).
struct StarShape: Shape {
    func path(in rect: CGRect) -> Path {
        let pts: [CGPoint] = [(100, 14), (124, 78), (192, 86), (142, 132), (156, 198), (100, 164), (44, 198), (58, 132), (8, 86), (76, 78)]
            .map { CGPoint(x: rect.minX + $0.0 / 200 * rect.width, y: rect.minY + $0.1 / 200 * rect.height) }
        var p = Path(); p.move(to: pts[0]); for q in pts.dropFirst() { p.addLine(to: q) }; p.closeSubpath(); return p
    }
}

struct StarIcon: View {
    var size: CGFloat
    var fill: Color
    var shadow: Bool = true
    var body: some View {
        ZStack {
            if shadow { StarShape().fill(Color.black).offset(x: size * 0.125, y: size * 0.1875) }
            StarShape().fill(fill).overlay(StarShape().stroke(Color.black, style: StrokeStyle(lineWidth: size * 0.08, lineJoin: .round)))
        }
        .frame(width: size, height: size)
    }
}

struct MicGlyph: View {
    var size: CGFloat
    var color: Color = .white
    var body: some View {
        Image(systemName: "mic.fill").font(.system(size: size * 0.7, weight: .bold)).foregroundColor(color)
            .frame(width: size, height: size)
    }
}

/// Coral error toast pinned near the top.
struct ErrorToast: View {
    var message: String
    var dismiss: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Text(message).font(.od(FS.sm, bold: true)).foregroundColor(.white)
            Button(action: dismiss) { Image(systemName: "xmark").foregroundColor(.white).font(.system(size: 16, weight: .bold)) }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.coral))
        .shadow(radius: 8)
        .frame(maxWidth: 448)
    }
}

/// Dimmed modal backdrop with a tap-to-close area.
struct ModalBackdrop<Content: View>: View {
    var onClose: () -> Void
    var alignment: Alignment = .center
    @ViewBuilder var content: () -> Content
    var body: some View {
        ZStack(alignment: alignment) {
            Color.black.opacity(0.4).ignoresSafeArea().onTapGesture(perform: onClose)
            content()
        }
    }
}
