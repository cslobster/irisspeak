import SwiftUI

enum CardChipSize { case sm, md, lg, fill }

/// Maps a web symbol URL (e.g. "/symbols/mulberry/food.svg") to the bundled asset-catalog image.
enum SymbolAssets {
    static let map: [String: String] = {
        guard let u = Bundle.main.url(forResource: "symbol_assets", withExtension: "json"),
              let d = try? Data(contentsOf: u), let m = try? JSONDecoder().decode([String: String].self, from: d) else { return [:] }
        return m
    }()
    static func name(for url: String?) -> String? { url.flatMap { map[$0] } }
}

struct SymbolImage: View {
    var url: String?
    var body: some View {
        if let name = SymbolAssets.name(for: url) {
            Image(name).resizable().interpolation(.high).scaledToFit()
        } else {
            Color.clear
        }
    }
}

/// A card tile: colored by category (Fitzgerald Key), symbol or emoji on top, the word below.
struct CardChip: View {
    var card: CardInfo
    var size: CardChipSize = .lg
    var enabled: Bool = true
    var action: (() -> Void)? = nil
    @EnvironmentObject var uiScale: UiScale

    private var dims: CGSize? {
        switch size {
        case .sm: return CGSize(width: 80, height: 96)
        case .md: return CGSize(width: 96, height: 112)
        case .lg: return CGSize(width: 128, height: 144)
        case .fill: return nil
        }
    }

    var body: some View {
        let displayLabel = card.category == .emotion ? card.label : card.displayName
        let isFolder = card.isFolder ?? false
        let radius: CGFloat = size == .fill ? 12 : 16
        let border: Color = isFolder ? Theme.folderAccent : .black
        ZStack {
            if isFolder {
                RoundedRectangle(cornerRadius: radius).fill(Color.white).overlay(RoundedRectangle(cornerRadius: radius).stroke(Theme.folderAccent, lineWidth: 2)).offset(x: 8, y: 8)
                RoundedRectangle(cornerRadius: radius).fill(Color.white).overlay(RoundedRectangle(cornerRadius: radius).stroke(Theme.folderAccent, lineWidth: 2)).offset(x: 4, y: 4)
            }
            Button(action: { action?() }) {
                GeometryReader { g in
                    VStack(spacing: size == .fill ? 2 : 4) {
                        if card.corpusImageUrl != nil {
                            SymbolImage(url: card.corpusImageUrl)
                                .frame(width: size == .fill ? g.size.width * 0.8 : g.size.width * 0.75, height: size == .fill ? g.size.height * 0.52 : g.size.height * 0.62)
                        } else if let e = card.emoji, !e.isEmpty {
                            Text(e).font(.system(size: size == .fill ? 26 : 40))
                                .frame(height: size == .fill ? g.size.height * 0.52 : g.size.height * 0.5)
                        }
                        Text(displayLabel)
                            .font(.od(labelSize(displayLabel, base: size) * uiScale.f, bold: true))
                            .foregroundColor(Theme.slate800)
                            .multilineTextAlignment(.center)
                            .lineLimit(size == .fill ? 1 : 2)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity)
                    }
                    .padding(size == .fill ? 2 : 8)
                    .frame(width: g.size.width, height: g.size.height)
                }
                .sticker(Theme.cardColor(card.category), radius: radius, border: 2, bottom: size == .fill ? 3 : 4, borderColor: border)
                .shadow(color: .black.opacity(0.12), radius: 4, x: 0, y: 3)
                .overlay(alignment: .topTrailing) {
                    if isFolder {
                        Text("📂").font(.system(size: 16))
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(Theme.folderAccent))
                            .overlay(Circle().stroke(Color.black, lineWidth: 2))
                            .offset(x: 10, y: -10)
                    }
                }
            }
            .buttonStyle(ScaleButtonStyle())
            .disabled(action == nil || !enabled)
            .opacity(action == nil || !enabled ? 0.5 : 1)
            .gazeTarget("card:\(card.id)") { if enabled { action?() } }
        }
        .frame(width: dims?.width, height: dims?.height)
        .frame(maxWidth: size == .fill ? .infinity : nil, maxHeight: size == .fill ? .infinity : nil)
    }
}
