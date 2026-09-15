import SwiftUI

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255, opacity: alpha)
    }
}

/// Colors and type scale from the web client's tailwind.config.js / styles.css.
enum Theme {
    static let cream = Color(hex: 0xf0ebe1)
    static let teal = Color(hex: 0x94c1c2)
    static let coral = Color(hex: 0xf09281)
    static let coralLight = Color(hex: 0xf4a998)
    static let ink = Color(hex: 0x2b2d31)
    // Fitzgerald Key: nouns/things=orange, verbs=green, descriptors=blue, function/core words=pink
    static let cardTopic = Color(hex: 0xFFE3C2)
    static let cardAction = Color(hex: 0xD9F2D0)
    static let cardEmotion = Color(hex: 0xD6E8FB)
    static let cardCore = Color(hex: 0xFCD9E5)
    static let folderAccent = Color(hex: 0x6D5BD0)
    static let slate50 = Color(hex: 0xf8fafc)
    static let slate100 = Color(hex: 0xf1f5f9)
    static let slate200 = Color(hex: 0xe2e8f0)
    static let slate300 = Color(hex: 0xcbd5e1)
    static let slate400 = Color(hex: 0x94a3b8)
    static let slate500 = Color(hex: 0x64748b)
    static let slate600 = Color(hex: 0x475569)
    static let slate700 = Color(hex: 0x334155)
    static let slate800 = Color(hex: 0x1e293b)
    static let amber50 = Color(hex: 0xfffbeb)
    static let amber700 = Color(hex: 0xb45309)
    static let purple100 = Color(hex: 0xf3e8ff)

    static func cardColor(_ c: CardCategory) -> Color {
        switch c { case .topic: return cardTopic; case .action: return cardAction; case .emotion: return cardEmotion; case .core: return cardCore }
    }
}

/// Tailwind font sizes (bumped ~10% in the web app's config), in points.
enum FS {
    static let xs: CGFloat = 13, sm: CGFloat = 15, base: CGFloat = 17, lg: CGFloat = 19, xl: CGFloat = 22
    static let xl2: CGFloat = 26, xl3: CGFloat = 32, xl4: CGFloat = 40, xl5: CGFloat = 52, xl6: CGFloat = 64, xl7: CGFloat = 76
}

extension Font {
    /// OpenDyslexic (bundled). The face only ships Regular and Bold, so every "semibold/extrabold" is Bold.
    static func od(_ size: CGFloat, bold: Bool = false) -> Font {
        .custom(bold ? "OpenDyslexic-Bold" : "OpenDyslexic-Regular", size: size)
    }
}

// MARK: - "Sticker" look: solid black outline plus a thicker black bottom edge standing in for a drop shadow.

struct StickerStyle: ViewModifier {
    var fill: Color
    var shape: AnyShape
    var border: CGFloat = 2
    var bottom: CGFloat = 4
    var borderColor: Color = .black

    func body(content: Content) -> some View {
        let extra = max(0, bottom - border)
        content
            .offset(y: -extra / 2)
            .background(
                ZStack(alignment: .top) {
                    shape.fill(borderColor)
                    GeometryReader { g in
                        shape.fill(Theme.cream)
                            .overlay(shape.fill(fill))
                            .overlay(shape.stroke(borderColor, lineWidth: border * 2).clipShape(shape))
                            .frame(width: g.size.width, height: max(0, g.size.height - extra))
                    }
                }
            )
    }
}

extension View {
    func sticker(_ fill: Color, radius: CGFloat = 16, border: CGFloat = 2, bottom: CGFloat = 4, borderColor: Color = .black) -> some View {
        modifier(StickerStyle(fill: fill, shape: AnyShape(RoundedRectangle(cornerRadius: radius, style: .circular)), border: border, bottom: bottom, borderColor: borderColor))
    }
    func stickerCircle(_ fill: Color, border: CGFloat = 3, bottom: CGFloat = 8, borderColor: Color = .black) -> some View {
        modifier(StickerStyle(fill: fill, shape: AnyShape(Circle()), border: border, bottom: bottom, borderColor: borderColor))
    }
    func stickerCapsule(_ fill: Color, border: CGFloat = 2, bottom: CGFloat = 5, borderColor: Color = .black) -> some View {
        modifier(StickerStyle(fill: fill, shape: AnyShape(Capsule()), border: border, bottom: bottom, borderColor: borderColor))
    }
}

/// Press feedback: scale down slightly while the finger is on the button (Tailwind `active:scale-95`).
struct ScaleButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.95
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// The shared `.pill-btn` button: white bold text on a colored capsule with the sticker outline.
struct PillButton: View {
    var title: String
    var color: Color
    var textColor: Color = .white
    var fontSize: CGFloat = FS.base
    var hPad: CGFloat = 32
    var vPad: CGFloat = 12
    var minHeight: CGFloat = 48
    var fullWidth: Bool = false
    var enabled: Bool = true
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.od(fontSize, bold: true))
                .foregroundColor(textColor)
                .padding(.horizontal, hPad)
                .padding(.vertical, vPad)
                .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: minHeight)
                .stickerCapsule(color)
        }
        .buttonStyle(ScaleButtonStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
    }
}

/// The `.icon-btn` square: white, rounded-2xl, sticker outline, min 48pt.
struct IconButton<Label: View>: View {
    var action: () -> Void
    @ViewBuilder var label: () -> Label
    var body: some View {
        Button(action: action) {
            label()
                .frame(minWidth: 48, minHeight: 48)
                .sticker(Color.white.opacity(0.9), radius: 16)
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

/// Accessibility text/card-size setting, published app-wide.
@MainActor final class UiScale: ObservableObject {
    static let shared = UiScale()
    @Published var level: UiScaleLevel = Store.uiScale { didSet { Store.uiScale = level } }
    var f: CGFloat { level.factor }
}

/// Global mute toggle, published app-wide.
@MainActor final class MuteState: ObservableObject {
    static let shared = MuteState()
    @Published var muted: Bool = Store.muted {
        didSet { Store.muted = muted; if muted { TTS.shared.stop() } }
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// Font size tiers for a card label: longer words shrink to fit instead of wrapping past 2 lines.
func labelSize(_ text: String, base: CardChipSize) -> CGFloat {
    let long = text.count > 8, longer = text.count > 14
    switch base {
    case .sm: return longer ? 9 : long ? 10 : FS.xs
    case .md: return longer ? 10 : long ? FS.xs : FS.sm
    case .lg: return longer ? FS.xs : long ? FS.sm : FS.base
    case .fill: return text.count > 12 ? 9 : text.count > 8 ? 11 : FS.xs
    }
}
