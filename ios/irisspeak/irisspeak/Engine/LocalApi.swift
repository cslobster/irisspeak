import Foundation

/// Local replacement for the web client's HTTP ApiClient: every call is answered on the device by the card model
/// + reranker, and sessions live in UserDefaults. Port of aac_next/src/api/local.ts (10 Sep 2026): question-type
/// routing, choice pinning, one folder card in the last Topic cell (v2 taxonomy, folder chosen by the reranked
/// order), filler cap, "More ideas" page, Clear.
@MainActor
final class LocalApi {
    static let shared = LocalApi()
    static let panel = (topic: 12, action: 3, emotion: 3)   // Topic 4 x 3, Action 1 x 3, Feeling 1 x 3
    static let maxFolderCards = 1
    private static let feelingFallback = ["happy", "sad", "tired", "excited", "angry", "scared", "bored", "hungry", "okay", "good"]

    // MARK: folders (aac_next/public/folders.json)
    struct FolderDef: Decodable { var path: String; var label: String; var icon: String; var words: [String]; var triggers: [String]; var id: String? }
    private struct FolderData: Decodable { var folders: [FolderDef]; var category_to_folder: [String: String]; var card_folder: [String: String]? }
    private static let folderData: FolderData = {
        if let u = Bundle.main.url(forResource: "folders", withExtension: "json"), let d = try? Data(contentsOf: u), let f = try? JSONDecoder().decode(FolderData.self, from: d) { return f }
        return FolderData(folders: [], category_to_folder: [:], card_folder: [:])
    }()
    private func folderPathOf(_ c: VocabCard) -> String? { LocalApi.folderData.card_folder?[c.id] ?? LocalApi.folderData.category_to_folder[c.category] }
    private func folder(at path: String) -> FolderDef? { LocalApi.folderData.folders.first { $0.path == path } }

    // MARK: question-type routing (same table as the web app)
    private struct Route { let rx: NSRegularExpression; let folder: String?; let allow: [String]; let first: [String] }
    private static let routeTable: [(String, String?, [String], [String])] = [
        (#"\b(who|whose|who's|with whom)\b"#, "people", ["me", "you", "mine", "my turn", "your turn", "friend", "mum", "mom", "dad", "teacher", "nobody"], []),
        (#"\b(where)\b"#, "places", ["here", "there", "home", "school", "outside", "inside"], []),
        (#"\b(when|what time|how long|how soon)\b"#, "time", ["now", "later", "soon", "today", "tomorrow", "not yet"], []),
        (#"\b(how many|how much|how old|what number|count)\b"#, "numbers", [], []),
        (#"\b(colou?rs?)\b"#, "describe > colours", [], []),
        (#"\b(eat|food|breakfast|lunch|dinner|snack|hungry|ate)\b"#, "food", [], []),
        (#"\b(drink|thirsty)\b"#, "drinks", [], []),
        (#"\b(play|game|toy|toys)\b"#, "toys", ["ball", "blocks", "lego", "puzzle", "cars", "tag", "outside", "swing", "slide"], []),
        (#"\b(wear|clothes|pyjamas|pajamas|jacket|shoes|dress)\b"#, "clothing", [], []),
        (#"\b(animal|animals|pet)\b"#, "animals", [], []),
        (#"\b(hurt|hurts|pain|sore|ache)\b"#, "body", [], []),
        (#"\b(weather|rain|sunny|snow)\b"#, "weather", [], []),
        (#"\b(feel|feeling|mood|okay|ok)\b"#, nil, ["tired", "sick", "sad", "happy", "scared", "hurt", "fine", "good", "bad"], []),
        (#"\b(how was|how is|how's|how did it go|how did .* go|how are you|how're you)\b"#, "Good & nice", ["good", "bad", "okay", "fine", "great", "fun", "boring", "tired", "busy", "long"], []),
    ]
    private static let routes: [Route] = routeTable.map { (pat: String, folder: String?, allow: [String], first: [String]) -> Route in
        Route(rx: try! NSRegularExpression(pattern: pat, options: [.caseInsensitive]), folder: folder, allow: allow, first: first)
    }
    /// Where the conversation happens changes what a question means: at the doctor's, "How are you feeling?" is about
    /// being sick or in pain, not about mood. These answer words go first, in this order, and their folder leads.
    private static let settingRoutes: [String: [(NSRegularExpression, String?, [String])]] = [
        "doctor": [(try! NSRegularExpression(pattern: #"\b(feel|feeling|mood|okay|ok|how are you|how're you|how's it going|what's wrong|what is wrong|hurt|hurts|pain|sore|sick|better|worse)\b"#, options: [.caseInsensitive]), "Health & sick", [])],   // folder steering only; the pinned answer words came out with the distilled model
    ]
    private func routeQuestion(_ q: String) -> (folders: [String], allow: [String], first: [String]) {
        let s = q.lowercased(); let ns = s as NSString; var folders: [String] = []; var allow: [String] = []; var first: [String] = []
        let setting = Store.getProfile().setting
        for (rx, folder, words) in LocalApi.settingRoutes[setting] ?? [] where rx.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) != nil {
            if let f = folder, !folders.contains(f) { folders.append(f) }
            first.append(contentsOf: words)
        }
        for r in LocalApi.routes where r.rx.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) != nil {
            if let f = r.folder, !folders.contains(f) { folders.append(f) }
            allow.append(contentsOf: r.allow); first.append(contentsOf: r.first)
        }
        return (folders, allow, first)
    }

    /// For evaluation questions ("How was your day?", "How are you feeling?") a card that repeats a word of the question
    /// (day) or names a time of day (morning, today) is never the answer, yet the sequence model and the question-similarity
    /// feature rank them high ("good day", "good morning"). They drop below the model's other picks; routed words are exempt.
    private static let evalQuestion = try! NSRegularExpression(pattern: #"\b(how was|how is|how's|how did|how are you|how're you|how's it going|feel|feeling|mood)\b"#, options: [.caseInsensitive])
    private func demoteEchoes(_ ranked: [Int], question: String) -> [Int] {
        let q = question.lowercased(); let ns = q as NSString
        guard LocalApi.evalQuestion.firstMatch(in: q, range: NSRange(location: 0, length: ns.length)) != nil else { return ranked }
        let qw = Set(q.replacingOccurrences(of: #"[^a-z' ]+"#, with: " ", options: .regularExpression).split(separator: " ").map(String.init))
        func echo(_ j: Int) -> Bool {
            let c = engine.cards[j]; if c.isFolder { return false }
            let ws = c.speak.lowercased().split(separator: " ").map(String.init)
            let greeting: Set<String> = ["morning", "afternoon", "evening", "night", "hello", "hi", "hey"]   // "Morning!" back to "Good morning" is a real reply
            return ws.allSatisfy { qw.contains($0) } && !ws.contains { greeting.contains($0) }
        }
        return ranked.filter { !echo($0) } + ranked.filter(echo)
    }

    private struct Current {
        var id: String; var question: String; var prefix: [CardInfo]; var ranked: [Int]; var p: [Float]; var endP: Float
        var page: Int; var role: DialogueRole; var sentence: String?; var folders: [FolderDef]?; var routed: [String]?; var lastShown: [CardInfo]; var candidates: [String] = []
    }
    private var current: Current?
    private var recCounter = 0
    private let engine = Engine.shared

    static func categoryOf(_ vocabCategory: String) -> CardCategory {
        if vocabCategory == "feelings" { return .emotion }
        if vocabCategory == "actions" || vocabCategory == "activities" || vocabCategory == "play" { return .action }
        return .topic
    }

    func cardFromVocab(_ id: String, recId: String, forceCat: CardCategory? = nil) -> CardInfo {
        let c = engine.byId[id]!
        let im = engine.images[id]
        return CardInfo(id: id, recommendationId: recId, label: c.speak, labelLocalized: c.speak,
                        category: forceCat ?? LocalApi.categoryOf(c.category), corpusName: c.speak,
                        corpusImageUrl: im?.img, emoji: im?.img != nil ? nil : im?.emoji)
    }
    private func folderCard(_ f: FolderDef, recId: String) -> CardInfo {
        CardInfo(id: "folder:" + f.path, recommendationId: recId, label: f.label, labelLocalized: f.label, category: .topic, corpusName: f.label,
                 corpusImageUrl: f.icon, emoji: nil, isFolder: true, folderPath: f.path)
    }

    // MARK: sessions

    func newSession(timezone: String) async -> String {
        // Signed in: the server issues the id so the session shows up on irisspeak.com and the admin site too.
        let id = await RemoteApi.remoteNewSession(timezone: timezone) ?? ("s" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))
        RemoteApi.remoteStart(id)
        let info = SessionInfo(id: id, status: .initial, localTimezone: timezone, startedTimestamp: Date().timeIntervalSince1970 * 1000,
                               endedTimestamp: nil, numTurns: 0, rating: nil, title: nil)
        Store.saveSession(SessionRecord(info: info, dialogue: []))
        return id
    }

    func startSession(_ id: String) async throws {
        try await engine.load()
        if var s = Store.loadSessions()[id] { s.info.status = .started; Store.saveSession(s) }
        current = Current(id: id, question: "", prefix: [], ranked: [], p: [], endP: 0, page: 0, role: .parent, sentence: nil, folders: nil, routed: nil, lastShown: [])
    }

    func endSession(_ id: String) {
        if var s = Store.loadSessions()[id] { s.info.status = .terminated; s.info.endedTimestamp = Date().timeIntervalSince1970 * 1000; Store.saveSession(s) }
        if current?.id == id { current = nil }
        RemoteApi.remoteEnd(id)
    }

    // MARK: cards

    private func recompute() async throws -> ChildCardRecommendationResult {
        guard var cur = current else { throw EngineError("no active session") }
        let vocabPrefix = cur.prefix.map { $0.id }.filter { engine.byId[$0] != nil }
        let pred = try await engine.predict(question: cur.question, prefix: vocabPrefix)
        cur.ranked = demoteEchoes(pred.ranked, question: cur.question); cur.p = pred.p; cur.endP = pred.endP; cur.page = 0
        current = cur
        return recommendation()
    }

    /// Cards named as options in the partner's question ("Read, or draw?", "Do you want juice or milk?").
    private func choiceCards(_ question: String) -> [String] {
        var q = question.lowercased().replacingOccurrences(of: #"[^a-z' ,]+"#, with: " ", options: .regularExpression)
        q = q.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        guard q.range(of: #"\bor\b"#, options: .regularExpression) != nil else { return [] }
        let parts = q.components(separatedBy: " or "); let left = parts[0]; let right = parts.count > 1 ? parts[1...].joined(separator: " or ") : ""
        let core = Set(Engine.coreLabels.map { $0.lowercased() })
        let stop: Set<String> = ["do", "you", "want", "to", "the", "a", "an", "some", "is", "it", "one", "which", "what", "or", "and", "with", "for", "first", "should", "we", "i", "your", "my", "did", "too", "here", "as", "last"]
        func lookup(_ words: [String]) -> String? {
            var n = min(3, words.count)
            while n >= 1 {
                for cand in [words.suffix(n).joined(separator: " "), words.prefix(n).joined(separator: " ")] {
                    let c = engine.byLabel[cand] ?? engine.byLabel[cand.hasSuffix("s") ? String(cand.dropLast()) : cand]
                    if let c = c, !core.contains(c.speak.lowercased()) { return c.id }
                }
                n -= 1
            }
            return nil
        }
        var found: [String] = []
        func add(_ id: String?) { if let id = id, !found.contains(id) { found.append(id) } }
        for item in left.components(separatedBy: ",").map({ $0.trimmingCharacters(in: .whitespaces) }).filter({ !$0.isEmpty }) {
            add(lookup(item.components(separatedBy: " ").filter { !$0.isEmpty && !stop.contains($0) }))
        }
        let rightWords = right.replacingOccurrences(of: #"[,?].*$"#, with: "", options: .regularExpression).components(separatedBy: " ").filter { !$0.isEmpty && !stop.contains($0) }
        var n = min(3, rightWords.count)
        while n >= 1 {
            let cand = rightWords.prefix(n).joined(separator: " ")
            if let c = engine.byLabel[cand] ?? engine.byLabel[cand.hasSuffix("s") ? String(cand.dropLast()) : cand], !core.contains(c.speak.lowercased()) { add(c.id); break }
            n -= 1
        }
        return Array(found.prefix(4))
    }

    /// The folder card for this turn, once (frozen across taps): question routing, then the model's own folder
    /// rows above 8 percent, then keyword triggers, then the folder whose members sit highest in the reranked order.
    private func decideFolders() -> [FolderDef] {
        guard let cur = current else { return [] }
        var chosen: [FolderDef] = []
        func add(_ f: FolderDef?) { if let f = f, chosen.count < LocalApi.maxFolderCards, !chosen.contains(where: { $0.path == f.path }) { chosen.append(f) } }
        for path in routeQuestion(cur.question).folders { add(folder(at: path)) }
        if !engine.folderRows.isEmpty, !cur.p.isEmpty, cur.prefix.count <= 1 {
            for c in engine.folderRows.filter({ cur.p[$0.index] >= 0.08 }).sorted(by: { cur.p[$0.index] > cur.p[$1.index] }) {
                if let path = c.folder { add(folder(at: path)) }
            }
        }
        let q = cur.question.lowercased()
        for f in LocalApi.folderData.folders where f.triggers.contains(where: { t in q.range(of: "\\b" + NSRegularExpression.escapedPattern(for: t) + "\\b", options: .regularExpression) != nil }) { add(f) }
        var mass: [String: Double] = [:]; var tot = 0.0
        for (r, j) in cur.ranked.prefix(60).enumerated() {
            if let path = folderPathOf(engine.cards[j]) { let w = 1.0 / Double(r + 1); mass[path, default: 0] += w; tot += w }
        }
        for (path, m) in mass.sorted(by: { $0.value > $1.value }) where m / max(tot, 1e-9) >= 0.03 { add(folder(at: path)) }
        return chosen
    }

    private func recommendation() -> ChildCardRecommendationResult {
        var cur = current!
        recCounter += 1
        let recId = "r\(recCounter)"
        let coreIds = Set(Engine.coreLabels.compactMap { engine.byLabel[$0]?.id })
        let chosen = Set(cur.prefix.map { $0.id })
        var lists: [CardCategory: [String]] = [.topic: [], .action: [], .emotion: []]
        // options offered in the question come first in their panels
        for id in choiceCards(cur.question) where !chosen.contains(id) && !coreIds.contains(id) {
            let cat = LocalApi.categoryOf(engine.byId[id]!.category); lists[cat, default: []].append(id)
        }
        if cur.folders == nil {
            cur.folders = decideFolders()
            // routed cards: the question type's own answer words first, then the routed folder's best members
            let (rf, allow, first) = routeQuestion(cur.question)
            let firstIds = Array(first.compactMap { engine.byLabel[$0]?.id }.prefix(6))
            let allowIds = firstIds + Array(allow.compactMap { engine.byLabel[$0]?.id }.filter { !firstIds.contains($0) }.sorted { (cur.p.isEmpty ? 0 : cur.p[engine.byId[$0]!.index]) > (cur.p.isEmpty ? 0 : cur.p[engine.byId[$1]!.index]) }.prefix(3))
            var pool: [String: Float] = [:]
            for f in cur.folders! where rf.contains(f.path) { for w in f.words { if let c = engine.byLabel[w.lowercased()] { pool[c.id] = cur.p.isEmpty ? 0 : cur.p[c.index] } } }
            for w in allow { if let c = engine.byLabel[w] { pool[c.id] = cur.p.isEmpty ? 0 : cur.p[c.index] } }
            let rest = pool.sorted { $0.value > $1.value }.map { $0.key }.filter { !allowIds.contains($0) }
            cur.routed = Array((allowIds + rest).prefix(max(4, firstIds.count)))
        }
        for id in cur.routed ?? [] where !chosen.contains(id) && !coreIds.contains(id) {
            let cat = LocalApi.categoryOf(engine.byId[id]!.category)
            if !(lists[cat]!.contains(id)) { lists[cat]!.append(id) }
        }
        let keep = Set((cur.routed ?? []).compactMap { engine.byId[$0]?.speak.lowercased() })
        let folderWords = Set((cur.folders ?? []).flatMap { $0.words.map { $0.lowercased() } }).subtracting(keep)
        let folderCats = Set((cur.folders ?? []).compactMap { f in LocalApi.folderData.category_to_folder.first { $0.value == f.path }?.key })
        var perCat: [String: Int] = [:]; var fillers = 0
        // Near-duplicates ("Sound", "Good", "Sounds good") would take three slots for one idea: a card whose stems are all
        // already on the board is skipped, unless a route or choice pinned it.
        let glue: Set<String> = ["am", "is", "are", "be", "the", "a", "an", "to", "of"]   // never makes a card distinct: "I am" = "I"
        func stem(_ w: String) -> String { var x = w.lowercased().filter { $0.isLetter || $0 == "'" }; if x == "i" { return x }; for suf in ["ies", "ing", "es", "ed", "s"] where x.hasSuffix(suf) && x.count > suf.count + 1 { x = String(x.dropLast(suf.count)); break }; return x }
        func stemsOf(_ speak: String) -> [String] {
            speak.lowercased().replacingOccurrences(of: #"^(i'm|i am|i feel|i want to|i want|i need to|i need|i like to|i like)\s+"#, with: "", options: .regularExpression)   // "I'm tired" = "Tired"
                .replacingOccurrences(of: "'m", with: " am").replacingOccurrences(of: "'s", with: "").replacingOccurrences(of: "n't", with: " not")
                .split(separator: " ").map { stem(String($0)) }.filter { !$0.isEmpty && !glue.contains($0) }
        }
        var onBoard = Set<String>(); let pinned = Set((cur.routed ?? []) + Array(chosen))
        for (_, list) in lists { for id in list { if let c = engine.byId[id] { for st in stemsOf(c.speak) { onBoard.insert(st) } } } }
        for j in cur.ranked {
            let c = engine.cards[j]
            if c.id == "<aac_end>" || c.id == "<name>" || c.isFolder || coreIds.contains(c.id) || chosen.contains(c.id) { continue }
            let cat = LocalApi.categoryOf(c.category)
            let sts = stemsOf(c.speak)
            if !pinned.contains(c.id), !sts.isEmpty, sts.allSatisfy({ onBoard.contains($0) }) { continue }
            // function words are sentence glue, not answers: at most two of them on the first page
            // function words and sentence starters (I am, I feel, I need, I'm) are glue, not answers: at most two on the first page
            if (c.category == "core" || c.category == "phrases" || c.speak.lowercased() == "i'm") && !(lists[cat]!.contains(c.id)) { fillers += 1; if fillers > 2 { continue } }
            if cat == .topic, !(cur.folders ?? []).isEmpty, folderWords.contains(c.speak.lowercased()), !(lists[cat]!.contains(c.id)) { continue } // the Topic folder covers it
            if folderCats.contains(c.category) { perCat[c.category, default: 0] += 1; if perCat[c.category]! > 2 && !(lists[cat]!.contains(c.id)) { continue } }
            if !(lists[cat]!.contains(c.id)) { lists[cat]!.append(c.id); for st in sts { onBoard.insert(st) } }
        }
        for l in LocalApi.feelingFallback {
            if let c = engine.byLabel[l], !(lists[.emotion]!.contains(c.id)), !chosen.contains(c.id) { lists[.emotion]!.append(c.id) }
        }
        var cards: [CardInfo] = []
        for (cat, n) in [(CardCategory.topic, LocalApi.panel.topic), (.action, LocalApi.panel.action), (.emotion, LocalApi.panel.emotion)] {
            let list = lists[cat] ?? []
            var start = cur.page * n; if start >= list.count { start = 0 }
            var page = Array(list[start..<min(start + n, list.count)])
            for id in list { if page.count >= n { break }; if !page.contains(id) { page.append(id) } }
            let slots = cat == .topic ? n - (cur.folders?.count ?? 0) : n
            for id in page.prefix(slots) { cards.append(cardFromVocab(id, recId: recId, forceCat: cat)) }
            if cat == .topic { for f in cur.folders ?? [] { cards.append(folderCard(f, recId: recId)) } }   // last Topic cell
        }
        for l in Engine.coreLabels {
            if let c = engine.byLabel[l] { cards.append(cardFromVocab(c.id, recId: recId, forceCat: .core)) }
            else { cards.append(CardInfo(id: "core:" + l, recommendationId: recId, label: l, labelLocalized: l, category: .core, corpusName: l, corpusImageUrl: nil, emoji: nil)) }
        }
        cur.lastShown = cards
        current = cur
        return ChildCardRecommendationResult(id: recId, timestamp: Date().timeIntervalSince1970 * 1000, cards: cards)
    }

    var endProbability: Float { current?.endP ?? 0 }

    /// "More ideas": the next N ranked cards that are not on the board, as rows for the folder browser.
    func moreSuggestions(_ n: Int = 60) -> [FolderCard] {
        guard let cur = current else { return [] }
        let on = Set(cur.lastShown.map { $0.id } + cur.prefix.map { $0.id })
        var out: [FolderCard] = []
        for j in cur.ranked {
            let c = engine.cards[j]
            if c.isFolder || c.id == "<aac_end>" || c.id == "<name>" || on.contains(c.id) { continue }
            let im = engine.images[c.id]
            out.append(FolderCard(folder: "More ideas", word: c.speak, image_url: im?.img, emoji: im?.img == nil ? (im?.emoji ?? "💬") : nil))
            if out.count >= n { break }
        }
        return out
    }

    func sendParentText(_ id: String, message: String) async throws -> ChildCardRecommendationResult {
        guard current != nil else { throw EngineError("no active session") }
        current!.question = message; current!.prefix = []; current!.role = .child; current!.folders = nil; current!.routed = nil
        if var s = Store.loadSessions()[id] {
            s.dialogue.append(DialogueMessage(role: .parent, text: message, cards: nil, contentLocalized: nil))
            s.info.status = .conversation; s.info.numTurns += 1
            if s.info.title == nil { s.info.title = String(message.prefix(60)) }
            Store.saveSession(s)
        }
        RemoteApi.remoteParentTurn(id, text: message)
        return try await recompute()
    }

    func addChildCard(_ card: CardInfo) async throws -> CardSelectionResult {
        guard current != nil else { throw EngineError("no active session") }
        current!.prefix.append(card)
        return CardSelectionResult(interimCards: current!.prefix, newRecommendation: try await recompute())
    }

    func addFreeCard(label: String, category: CardCategory, imageUrl: String?) async throws -> CardSelectionResult {
        guard current != nil else { throw EngineError("no active session") }
        let card: CardInfo
        if let vocab = engine.byLabel[label.lowercased()] { card = cardFromVocab(vocab.id, recId: "free") }
        else { card = CardInfo(id: "free-\(Int(Date().timeIntervalSince1970 * 1000))", recommendationId: "free", label: label, labelLocalized: label, category: category, corpusName: label, corpusImageUrl: imageUrl, emoji: imageUrl == nil ? "💬" : nil) }
        current!.prefix.append(card)
        return CardSelectionResult(interimCards: current!.prefix, newRecommendation: try await recompute())
    }

    func removeCard(index: Int) async throws -> CardSelectionResult {
        guard current != nil else { throw EngineError("no active session") }
        if index >= 0 && index < current!.prefix.count { current!.prefix.remove(at: index) }
        return CardSelectionResult(interimCards: current!.prefix, newRecommendation: try await recompute())
    }

    /// Clear the whole selection and re-predict from the question alone.
    func clearCards() async throws -> CardSelectionResult {
        guard current != nil else { throw EngineError("no active session") }
        current!.prefix = []; current!.page = 0
        return CardSelectionResult(interimCards: [], newRecommendation: try await recompute())
    }

    /// Re-run the model for the current question + selection (used when the setting changes).
    func repredict() async throws -> ChildCardRecommendationResult? {
        guard let cur = current, cur.role == .child else { return nil }
        return try await recompute()
    }

    func refreshCards() -> ChildCardRecommendationResult {
        current!.page += 1
        return recommendation()
    }

    /// Sentence from the tapped cards: the cloud endpoint when the network is reachable, otherwise the
    /// on-device rule (cards in order). The approved sentence is remembered for confirmCards.
    /// Sentence from the tapped cards, on the device: the realiser model (cards + the partner's question,
    /// constrained to the card words plus function words), or the rule (cards in order) until it has loaded.
    func inferSentence(again: Bool = false) async -> (sentence: String, source: SentenceSource) {
        guard let cur = current else { return ("", .device) }
        let labels = cur.prefix.map { $0.corpusName ?? $0.label }
        let rule = engine.realise(labels)
        if !again { current?.candidates = [] }
        let seen = current?.candidates ?? []
        var sentence: String? = nil
        let setting = Store.getProfile().setting.isEmpty ? "unknown" : Store.getProfile().setting
        if let r = engine.realiser { sentence = try? r.realise(cards: labels, partner: cur.question, sample: again, avoid: seen, setting: setting) }
        // "Another": a fresh wording; when the model has none left, the plain card order, then cycle through earlier ones.
        if sentence == nil {
            if again, !seen.contains(rule) { sentence = rule }
            else if again, !seen.isEmpty { sentence = seen[((seen.firstIndex(of: cur.sentence ?? "") ?? -1) + 1) % seen.count] }
            else { sentence = rule }
        }
        if !(current?.candidates.contains(sentence!) ?? true) { current?.candidates.append(sentence!) }
        current?.sentence = sentence
        return (sentence!, .device)
    }

    func confirmCards(_ id: String) async throws -> ChildCardRecommendationResult {
        guard let cur = current else { throw EngineError("no active session") }
        let sentence = cur.sentence ?? engine.realise(cur.prefix.map { $0.corpusName ?? $0.label })
        current!.sentence = nil
        if var s = Store.loadSessions()[id] {
            s.dialogue.append(DialogueMessage(role: .child, text: nil, cards: cur.prefix, contentLocalized: sentence))
            Store.saveSession(s)
        }
        Store.pushHistory(HistoryTurn(partner: cur.question, answer: sentence, cards: cur.prefix.map { $0.id }.filter { engine.byId[$0] != nil }, t: Date().timeIntervalSince1970 * 1000))
        RemoteApi.remoteChildTurn(id, cards: cur.prefix, sentence: sentence, shown: cur.lastShown)
        current!.prefix = []; current!.folders = nil; current!.routed = nil
        return try await recompute()
    }

    func finishChildTurn(_ id: String) {
        current?.role = .parent; current?.prefix = []
        if var s = Store.loadSessions()[id] { s.info.numTurns += 1; Store.saveSession(s) }
    }

    // MARK: history

    func getDialogue(_ id: String) -> [DialogueMessage] { Store.loadSessions()[id]?.dialogue ?? [] }
    func listSessions() -> [SessionInfo] { Store.loadSessions().values.map { $0.info } }
    /// Transcript: the shared account's copy (it has every device's turns), else this device's.
    func getDialogueMerged(_ id: String) async -> [DialogueMessage] {
        if let d = await RemoteApi.dialogue(id), !d.isEmpty { return d }
        return getDialogue(id)
    }
    /// Previous conversations: the shared account's list (irisspeak.com, other devices) merged with this device's.
    func listSessionsMerged() async -> [SessionInfo] {
        let local = listSessions()
        guard let remote = await RemoteApi.listSessions() else { return local }
        var byId: [String: SessionInfo] = [:]
        for s in remote { byId[s.id] = s }
        for s in local where byId[s.id] == nil { byId[s.id] = s }   // made offline, never reached the server
        return Array(byId.values)
    }
    func rateSession(_ id: String, rating: Int) { if var s = Store.loadSessions()[id] { s.info.rating = rating; Store.saveSession(s) }; RemoteApi.remoteRate(id, rating: rating) }
}
