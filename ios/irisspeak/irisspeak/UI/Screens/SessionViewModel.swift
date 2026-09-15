import SwiftUI
import Combine

/// All the state and actions of the conversation screen (port of SessionScreen.tsx's hooks), shared by the
/// iPad board layout, the compact phone layout and the debug self-test.
@MainActor
final class SessionViewModel: ObservableObject {
    enum Phase { case initial, idle, thinking, closing }
    enum RecState { case idle, recording, paused }

    static weak var current: SessionViewModel?

    let sessionId: String
    private let api = LocalApi.shared
    private let engine = Engine.shared
    private let router = Router.shared

    @Published var phase: Phase = .initial
    @Published var phaseLabel = "Starting your session…"
    @Published var role: DialogueRole = .parent
    @Published var started = false
    @Published var childRec: ChildCardRecommendationResult?
    @Published var interimCards: [CardInfo] = []
    @Published var dialogue: [DialogueMessage] = []
    @Published var parentMessage = ""
    @Published var errorMsg: String?
    @Published var showMenu = false
    @Published var showDialogue = false
    @Published var showSearch = false
    @Published var scopedFolderPath: [String]?
    @Published var moreRows: [FolderCard] = []
    @Published var lastParentMessage: String?
    @Published var bankedChildSentences: [String] = []
    @Published var inferredSentence: String?
    @Published var hasBankedSentence = false
    @Published var setting: String = Store.getProfile().setting.isEmpty ? "home" : Store.getProfile().setting
    @Published var refreshingCards = false
    @Published var recState: RecState = .idle
    @Published var partialTranscript = ""

    private let recognizer = SpeechRecognizer()
    private var removeQueue: Task<Void, Never>?
    private var statusCancellable: Any?

    init(sessionId: String) {
        self.sessionId = sessionId
        SessionViewModel.current = self
    }

    // MARK: lifecycle

    func start() async {
        guard !started, phase == .initial else { return }
        let status = engine.status
        phaseLabel = engine.ready ? "Starting your session…" : status.message
        let sub = status.$message.sink { [weak self] m in guard let self = self else { return }; if !self.engine.ready { self.phaseLabel = m } }
        statusCancellable = sub
        do {
            try await api.startSession(sessionId)
            role = .parent; started = true; phase = .idle
            refreshDialogue()
        } catch {
            errorMsg = error.localizedDescription
        }
    }

    func refreshDialogue() { dialogue = api.getDialogue(sessionId) }

    // MARK: parent turn

    func submitParent() async {
        let text = partialTranscript.trimmingCharacters(in: .whitespaces).isEmpty ? parentMessage.trimmingCharacters(in: .whitespaces) : partialTranscript.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        if recognizer.state != .idle { recognizer.abort() }
        partialTranscript = ""; recState = .idle
        phase = .thinking; phaseLabel = "Generating cards for the child…"
        do {
            let t0 = Date()
            let rec = try await api.sendParentText(sessionId, message: text)
            log("session: parent text → \(rec.cards.count) cards in \(Int(Date().timeIntervalSince(t0) * 1000)) ms (model \(Int(engine.lastRunMs)) ms)")
            role = .child; childRec = rec; interimCards = []; hasBankedSentence = false; bankedChildSentences = []
            lastParentMessage = text; parentMessage = ""; phase = .idle
            refreshDialogue()
        } catch {
            errorMsg = error.localizedDescription; phase = .idle
        }
    }

    /// First tap starts listening, second tap stops (text stays in the box), third tap restarts.
    func handleMicTap() async {
        if recState == .recording {
            let text = await recognizer.stop()
            partialTranscript = ""; parentMessage = text; recState = .idle
        } else {
            parentMessage = ""; partialTranscript = ""
            recognizer.onState = { [weak self] s in self?.recState = s == .listening ? .recording : s == .stopping ? .paused : .idle }
            recognizer.onPartial = { [weak self] t in self?.partialTranscript = t }
            do { try await recognizer.start() } catch { errorMsg = "Voice not available: \(error.localizedDescription)" }
        }
    }

    // MARK: child turn

    func onCardClick(_ card: CardInfo) async {
        guard role == .child else { return }
        if card.isFolder == true, let fp = card.folderPath { scopedFolderPath = fp.components(separatedBy: " > "); showSearch = true; return }
        TTS.shared.speakCard(card)
        interimCards.append(card) // optimistic
        refreshingCards = true
        do {
            let r = try await api.addChildCard(card)
            interimCards = r.interimCards; childRec = r.newRecommendation
        } catch {
            errorMsg = error.localizedDescription
            interimCards.removeAll { $0.id == card.id }
        }
        refreshingCards = false
    }

    func onSearchSelect(word: String, category: CardCategory, imageUrl: String?) async {
        guard role == .child else { return }
        let optimistic = CardInfo(id: "free-\(Int(Date().timeIntervalSince1970 * 1000))", recommendationId: "free", label: word, labelLocalized: word, category: category, corpusName: word, corpusImageUrl: imageUrl)
        TTS.shared.speakCard(optimistic)
        interimCards.append(optimistic)
        refreshingCards = true
        do {
            let r = try await api.addFreeCard(label: word, category: category, imageUrl: imageUrl)
            interimCards = r.interimCards; childRec = r.newRecommendation
        } catch {
            errorMsg = error.localizedDescription
            interimCards.removeAll { $0.id == optimistic.id }
        }
        refreshingCards = false
    }

    /// Removals are serialised and resolve the card's index at execution time, not tap time.
    func onRemoveCard(_ cardId: String) {
        let previous = removeQueue
        removeQueue = Task { [weak self] in
            await previous?.value
            guard let self = self, let index = self.interimCards.firstIndex(where: { $0.id == cardId }) else { return }
            self.interimCards.remove(at: index)
            self.refreshingCards = true
            do {
                let r = try await self.api.removeCard(index: index)
                self.interimCards = r.interimCards; self.childRec = r.newRecommendation
            } catch { self.errorMsg = error.localizedDescription }
            self.refreshingCards = false
        }
    }

    func onConfirm() async {
        guard !interimCards.isEmpty else { return }
        phase = .thinking; phaseLabel = "Figuring out what you want to say…"
        let r = await api.inferSentence()
        log("session: sentence (\(r.source.rawValue)): \(r.sentence)")
        inferredSentence = r.sentence
        phase = .idle
    }

    func onAcceptSentence() async {
        if let s = inferredSentence { bankedChildSentences.append(s); TTS.shared.speak(s) }
        inferredSentence = nil
        phase = .thinking; phaseLabel = "Getting your next cards…"
        do {
            childRec = try await api.confirmCards(sessionId)
            interimCards = []; hasBankedSentence = true; phase = .idle
            refreshDialogue()
        } catch { errorMsg = error.localizedDescription; phase = .idle }
    }

    func onRejectSentence() { inferredSentence = nil }

    /// "Another": a different wording for the same cards from the on-device realiser.
    @Published var anotherBusy = false
    func onAnotherSentence() async {
        guard !anotherBusy else { return }
        anotherBusy = true
        let r = await api.inferSentence(again: true)
        inferredSentence = r.sentence; anotherBusy = false
    }

    /// Done: hand the turn to the parent (always allowed, even with nothing banked).
    func onFinishTurn() {
        api.finishChildTurn(sessionId)
        role = .parent; interimCards = []; childRec = nil
        refreshDialogue()
    }

    func onRefreshCards() {
        guard !refreshingCards else { return }
        childRec = api.refreshCards()
    }

    /// Clear the selection and re-predict from the question alone.
    func onClearCards() async {
        guard !refreshingCards, !interimCards.isEmpty else { return }
        refreshingCards = true; interimCards = []
        do { let r = try await api.clearCards(); interimCards = r.interimCards; childRec = r.newRecommendation }
        catch { errorMsg = error.localizedDescription }
        refreshingCards = false
    }

    /// "More ideas": the next 60 suggested cards as a page in the card browser.
    func openMoreIdeas() {
        moreRows = api.moreSuggestions()
        scopedFolderPath = ["More ideas"]; showSearch = true
    }

    /// Where the conversation happens: saved to the profile, fed to the model prompt, cards re-predicted.
    func changeSetting(_ v: String) async {
        setting = v
        var p = Store.getProfile(); p.setting = v; Store.setProfile(p)
        if role == .child, childRec != nil {
            refreshingCards = true
            if let r = try? await api.repredict() { childRec = r }
            refreshingCards = false
        }
    }

    func endSession() async {
        TTS.shared.stop()
        if recognizer.state != .idle { recognizer.abort() }
        showMenu = false; phase = .closing
        api.endSession(sessionId)
        router.replace(.sessionEnd(sessionId))
    }

    func openSearch() { scopedFolderPath = nil; showSearch = true }
}
