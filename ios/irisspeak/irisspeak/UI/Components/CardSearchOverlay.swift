import SwiftUI

struct CboardCard: Decodable, Identifiable {
    var word: String; var image_url: String?; var emoji: String?; var category: String
    var id: String { word }
}
struct FolderCard: Decodable { var folder: String; var word: String; var image_url: String?; var emoji: String? }

/// The full Cboard vocabulary: flat list for search, folder rows for browsing.
enum CboardData {
    static let cards: [CboardCard] = load("cboard_cards")
    static let folders: [FolderCard] = load("cboard_folders")
    static let categoryByWord: [String: String] = { var m: [String: String] = [:]; for c in cards { m[c.word] = c.category }; return m }()
    private static func load<T: Decodable>(_ name: String) -> [T] {
        guard let u = Bundle.main.url(forResource: name, withExtension: "json"), let d = try? Data(contentsOf: u) else { return [] }
        return (try? JSONDecoder().decode([T].self, from: d)) ?? []
    }
    // Real Cboard category icons for top-level folders; deeper folders use their first word's image.
    static let folderIcons: [String: String] = [
        "actions": "/symbols/openmoji/actions.svg", "activities": "/symbols/openmoji/activities.svg", "animals": "/symbols/openmoji/animals.svg",
        "body": "/symbols/mulberry/body_outline.svg", "clothing": "/symbols/mulberry/generic_clothes.svg", "describe": "/symbols/mulberry/shapesorter.svg",
        "drinks": "/symbols/mulberry/drinks.svg", "emotions": "/symbols/openmoji/emotions.svg", "food": "/symbols/mulberry/food.svg",
        "furniture": "/symbols/mulberry/furniture.svg", "hygiene": "/symbols/openmoji/hygiene.svg", "kitchen": "/symbols/openmoji/kitchen.svg",
        "numbers": "/symbols/mulberry/count_,_to.svg", "people": "/symbols/openmoji/people.svg", "places": "/symbols/mulberry/globe.svg",
        "plants": "/symbols/mulberry/plant.svg", "position": "/symbols/mulberry/where.svg", "questions": "/symbols/mulberry/ask_,_to.svg",
        "quick chat": "/symbols/openmoji/speech_bubble.svg", "school": "/symbols/mulberry/school.svg", "snacks": "/symbols/mulberry/jelly_beans.svg",
        "sports": "/symbols/mulberry/football.svg", "technology": "/symbols/mulberry/technology.svg", "time": "/symbols/mulberry/clock.svg",
        "toys": "/symbols/mulberry/toys.svg", "transport": "/symbols/mulberry/travel.svg", "weather": "/symbols/openmoji/weather.svg",
    ]
}

/// "View all words": search the whole vocabulary or browse it by Cboard folder.
struct CardSearchOverlay: View {
    var initialPath: [String]?
    /// Extra folder rows from the session (the "More ideas" page of next suggestions).
    var extraRows: [FolderCard] = []
    var onSelect: (String, CardCategory, String?) -> Void
    var onClose: () -> Void
    @State private var query = ""
    @State private var path: [String] = []
    @FocusState private var focused: Bool

    private func categoryFor(_ s: String) -> CardCategory { CardCategory(rawValue: s) ?? .topic }

    /// Custom words from the shared account (irisspeak.com's vocabulary screen) as cards.
    private var customCards: [CboardCard] { Store.getCustomWords().map { CboardCard(word: $0.word, image_url: $0.imageUrl, emoji: $0.emoji ?? "⭐", category: $0.category.rawValue) } }
    private var customRows: [FolderCard] { customCards.map { FolderCard(folder: "My words", word: $0.word, image_url: $0.image_url, emoji: $0.emoji) } }

    private var searchResults: [CboardCard] {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        if q.isEmpty { return [] }
        let own = customCards.filter { $0.word.lowercased().contains(q) }
        return own + CboardData.cards.filter { c in c.word.lowercased().contains(q) && !own.contains { $0.word.lowercased() == c.word.lowercased() } }
    }

    private var folderView: (subfolders: [(name: String, cover: String)], words: [FolderCard]) {
        var seen = Set<String>(); var order: [String] = []; var covers: [String: String] = [:]; var here: [FolderCard] = []
        for row in extraRows + customRows + CboardData.folders {
            if row.folder == "Root" { continue }
            let segs = row.folder.components(separatedBy: " > ")
            guard segs.count >= path.count, zip(path, segs).allSatisfy({ $0 == $1 }) else { continue }
            if segs.count == path.count { here.append(row) }
            else {
                let next = segs[path.count]
                if !seen.contains(next) { seen.insert(next); order.append(next); covers[next] = CboardData.folderIcons[next] ?? row.image_url ?? "" }
            }
        }
        order.sort()
        return (order.map { ($0, covers[$0]!) }, here)
    }

    var body: some View {
        ModalBackdrop(onClose: onClose) {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    HStack {
                        TextField("Search all cards…", text: $query).font(.od(FS.base)).focused($focused)
                            .autocorrectionDisabled().textInputAutocapitalization(.never)
                        if !query.isEmpty { Button(action: { query = "" }) { Image(systemName: "xmark").foregroundColor(Theme.slate400) } }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.slate50))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate300, lineWidth: 2))
                    Button(action: onClose) { Image(systemName: "xmark").font(.system(size: 20, weight: .bold)).foregroundColor(Theme.slate500) }.padding(4)
                }
                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)
                Divider()
                if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                    let results = searchResults
                    Text("\(results.count) card\(results.count == 1 ? "" : "s") · tap to add").font(.od(FS.xs)).foregroundColor(Theme.slate400)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.vertical, 8)
                    ScrollView {
                        if results.isEmpty {
                            Text("No cards match \"\(query)\"").font(.od(FS.base)).italic().foregroundColor(Theme.slate400).padding(.vertical, 48)
                        } else {
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 6), spacing: 12) {
                                ForEach(results) { c in tile(word: c.word, image: c.image_url, emoji: c.emoji, category: categoryFor(c.category)) { onSelect(c.word, categoryFor(c.category), c.image_url); onClose() } }
                            }
                            .padding(.horizontal, 16).padding(.bottom, 24)
                        }
                    }
                } else {
                    let fv = folderView
                    HStack(spacing: 4) {
                        Button("📁 Folders") { path = [] }.foregroundColor(path.isEmpty ? Theme.slate800 : Theme.slate500)
                        ForEach(Array(path.enumerated()), id: \.offset) { i, seg in
                            Text("/").foregroundColor(Theme.slate300)
                            Button(seg) { path = Array(path.prefix(i + 1)) }.foregroundColor(i == path.count - 1 ? Theme.slate800 : Theme.slate500)
                        }
                        Spacer()
                    }
                    .font(.od(FS.sm, bold: true)).padding(.horizontal, 20).padding(.vertical, 8)
                    ScrollView {
                        VStack(spacing: 16) {
                            if !fv.subfolders.isEmpty {
                                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 5), spacing: 12) {
                                    ForEach(fv.subfolders, id: \.name) { f in
                                        tile(word: f.name.capitalizedFirst, image: f.cover, category: .topic, imageScale: 0.6) { path.append(f.name) }
                                    }
                                }
                            }
                            if !fv.words.isEmpty {
                                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 6), spacing: 12) {
                                    ForEach(fv.words, id: \.word) { w in
                                        let cat = categoryFor(CboardData.categoryByWord[w.word] ?? "topic")
                                        tile(word: w.word, image: w.image_url, emoji: w.emoji, category: cat) { onSelect(w.word, cat, w.image_url); onClose() }
                                    }
                                }
                            }
                            if fv.subfolders.isEmpty && fv.words.isEmpty {
                                Text("This folder is empty.").font(.od(FS.base)).italic().foregroundColor(Theme.slate400).padding(.vertical, 48)
                            }
                        }
                        .padding(.horizontal, 16).padding(.bottom, 24)
                    }
                }
            }
            .frame(maxWidth: 672)
            .frame(maxHeight: .infinity)
            .background(RoundedRectangle(cornerRadius: 24).fill(Color.white))
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .shadow(color: .black.opacity(0.25), radius: 20)
            .padding(.horizontal, 24).padding(.vertical, 40)
        }
        // "View all" lands on the first folder (the first icon of the root grid), not on an empty search; the keyboard
        // never comes up by itself — tap the search box to search.
        .onAppear {
            if let p = initialPath { path = p }
            else { path = []; if let first = folderView.subfolders.first?.name { path = [first] } }
        }
    }

    private func tile(word: String, image: String?, emoji: String? = nil, category: CardCategory, imageScale: CGFloat = 0.5, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            GeometryReader { g in
                VStack(spacing: 4) {
                    Group {
                        if let image = image, !image.isEmpty { SymbolImage(url: image) }
                        else { Text(emoji ?? "💬").font(.system(size: g.size.height * imageScale * 0.6)) }
                    }
                    .frame(width: g.size.width * imageScale, height: g.size.height * imageScale)
                    Text(word).font(.od(labelSize(word, base: .sm), bold: true)).foregroundColor(Theme.slate800).lineLimit(2).multilineTextAlignment(.center).minimumScaleFactor(0.7)
                }
                .padding(8).frame(width: g.size.width, height: g.size.height)
            }
            .aspectRatio(1, contentMode: .fit)
            .background(RoundedRectangle(cornerRadius: 16).fill(Theme.cardColor(category)))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.slate200, lineWidth: 2))
            .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

/// "You said …": play the sentence, then approve (Yes) or go back to the cards (No).
struct SentenceAcceptance: View {
    var sentence: String
    var compact: Bool = false
    var busy: Bool = false
    var onAccept: () -> Void
    var onReject: () -> Void
    var onAnother: () -> Void = {}

    var body: some View {
        ZStack {
            Color.black.opacity(0.4).ignoresSafeArea()
            VStack(spacing: compact ? 16 : 32) {
                Text("You said").font(.od(compact ? FS.xl2 : FS.xl5, bold: true)).foregroundColor(Theme.slate700)
                Text(sentence).font(.od(compact ? FS.xl : FS.xl4, bold: true)).foregroundColor(Theme.slate700).multilineTextAlignment(.center)
                    .lineLimit(4).minimumScaleFactor(0.6)
                    .padding(compact ? 16 : 32)
                    .frame(maxWidth: 576)
                    .background(RoundedRectangle(cornerRadius: 24).fill(Theme.teal.opacity(0.1)))
                    .opacity(busy ? 0.5 : 1)
                // "Another": a different wording from the on-device realiser. "Yes" speaks whichever one is showing.
                Button(action: onAnother) {
                    VStack(spacing: 12) {
                        Image(systemName: "arrow.clockwise").font(.system(size: compact ? 28 : 44, weight: .bold)).foregroundColor(.white)
                            .rotationEffect(.degrees(busy ? 360 : 0))
                            .animation(busy ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: busy)
                            .frame(width: compact ? 64 : 112, height: compact ? 64 : 112)
                            .stickerCircle(busy ? Theme.coralLight : Theme.coral, border: 3, bottom: 7)
                        Text(busy ? "Thinking…" : "Another").font(.od(FS.xl, bold: true)).foregroundColor(Theme.slate500)
                    }
                }
                .buttonStyle(ScaleButtonStyle())
                .disabled(busy).opacity(busy ? 0.6 : 1)
                .gazeTarget("sentence:another") { if !busy { onAnother() } }
                HStack(spacing: 16) {
                    bigButton("No", Theme.coral, action: onReject).gazeTarget("sentence:no", action: onReject)
                    bigButton("Yes", Theme.teal, action: onAccept).disabled(busy).opacity(busy ? 0.6 : 1).gazeTarget("sentence:yes") { if !busy { onAccept() } }
                }
                .frame(maxWidth: 576)
            }
            .padding(.horizontal, compact ? 20 : 32).padding(.vertical, compact ? 24 : 48)
            .frame(maxWidth: 672)
            .sticker(Theme.cream, radius: compact ? 32 : 40, border: 3, bottom: 8)
            .shadow(color: .black.opacity(0.3), radius: 24)
            .padding(24)
        }
        // No TTS stop on disappear: "Yes" starts speaking the sentence and then closes this dialog.
    }

    private func bigButton(_ title: String, _ color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.od(compact ? FS.xl : FS.xl3, bold: true)).foregroundColor(.black)
                .frame(maxWidth: .infinity).padding(.vertical, compact ? 12 : 24)
                .sticker(color, radius: 24, border: 2, bottom: 6)
        }
        .buttonStyle(ScaleButtonStyle())
    }

    struct Bar: View {
        var delay: Double
        var body: some View {
            TimelineView(.animation) { ctx in
                let t = ctx.date.timeIntervalSinceReferenceDate + delay
                let y = -8 * abs(sin(t * .pi))
                RoundedRectangle(cornerRadius: 6).fill(Color.white).frame(width: 12, height: 40).offset(y: y)
            }
        }
    }
}
