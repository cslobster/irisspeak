import Foundation

// Mirrors aac_next/src/api/types.ts (the subset the app uses).

enum CardCategory: String, Codable, CaseIterable {
    case topic, action, emotion, core
}

enum DialogueRole: String, Codable {
    case parent, child
}

struct CardInfo: Codable, Identifiable, Equatable {
    var id: String
    var recommendationId: String
    var label: String
    var labelLocalized: String
    var category: CardCategory
    var corpusName: String?
    var corpusImageUrl: String?
    var emoji: String?
    var isFolder: Bool?
    var folderPath: String?

    enum CodingKeys: String, CodingKey {
        case id
        case recommendationId = "recommendation_id"
        case label
        case labelLocalized = "label_localized"
        case category
        case corpusName = "corpus_name"
        case corpusImageUrl = "corpus_image_url"
        case emoji
        case isFolder = "is_folder"
        case folderPath = "folder_path"
    }

    /// The word shown on the tile and spoken aloud: the corpus word when there is one.
    var displayName: String { corpusName ?? label }
}

struct ChildCardRecommendationResult: Codable, Equatable {
    var id: String
    var timestamp: Double
    var cards: [CardInfo]
}

/// One transcript entry: parent text or the child's tapped cards (with the spoken sentence).
struct DialogueMessage: Codable, Equatable {
    var role: DialogueRole
    var text: String?
    var cards: [CardInfo]?
    var contentLocalized: String?

    var isCards: Bool { cards != nil }
}

enum SessionStatus: String, Codable {
    case initial, started, conversation, terminated
}

struct SessionInfo: Codable, Identifiable, Equatable {
    var id: String
    var status: SessionStatus
    var localTimezone: String
    var startedTimestamp: Double
    var endedTimestamp: Double?
    var numTurns: Int
    var rating: Int?
    var title: String?
}

struct SessionRecord: Codable {
    var info: SessionInfo
    var dialogue: [DialogueMessage]
}

struct CardSelectionResult {
    var interimCards: [CardInfo]
    var newRecommendation: ChildCardRecommendationResult
}

enum SentenceSource: String { case cloud, device }

struct ChildProfile: Codable, Equatable {
    var name: String = ""
    var gender: String? = nil          // "boy" / "girl" from the shared account; picks the default voice
    var setting: String = "home"
    var age: Int? = nil
    var communicationStyle: String? = ""
    var notes: String? = ChildProfile.defaultNotes
    /// A/B only: the reranker is off since the distilled model. Optional so profiles saved before this key decode.
    var rerankerAB: Bool? = nil

    static let defaultNotes = "likes football, dinosaurs and drawing; friends Sam and Mia; goes to school by bus"
}

struct HistoryTurn: Codable, Equatable {
    var partner: String
    var answer: String
    var cards: [String]
    var t: Double
    var labels: [String]? = nil   // words, for turns made on irisspeak.com whose card ids are not ours
}

/// A parent-added word from the shared account (irisspeak.com's dyad_custom_word): a searchable card and a reranker favourite.
struct CustomWordLocal: Codable, Equatable {
    var word: String
    var category: CardCategory
    var imageUrl: String?
    var emoji: String?
    var favourite: Bool
}

// MARK: shared-account DTOs (mirror aac_next/src/api/remote.ts)

struct Account: Codable, Equatable { var alias: String; var childName: String }

struct RemoteProfile: Codable {
    var age: Int?
    var notes: String?
    var communicationStyle: String?
    var setting: String?
    var childName: String?
    var childGender: String?
    var alias: String?
    enum CodingKeys: String, CodingKey { case age, notes, setting, alias; case communicationStyle = "communication_style"; case childName = "child_name"; case childGender = "child_gender" }
}

struct CustomWord: Codable, Identifiable {
    var id: String
    var word: String
    var category: String
    var isPreferencePointer: Bool?
    var imageData: String?
    var emoji: String?
    var source: String?
    enum CodingKeys: String, CodingKey { case id, word, category, emoji, source; case isPreferencePointer = "is_preference_pointer"; case imageData = "image_data" }
}

struct SettingOption: Identifiable, Equatable {
    var value: String
    var label: String
    var short: String
    var icon: String
    var id: String { value }

    static let all: [SettingOption] = [
        .init(value: "home", label: "Home", short: "Home", icon: "🏠"),
        .init(value: "school", label: "School", short: "School", icon: "🏫"),
        .init(value: "restaurant", label: "Restaurant / shop", short: "Restaurant", icon: "🍽️"),
        .init(value: "doctor", label: "Doctor / clinic", short: "Doctor", icon: "🩺"),
        .init(value: "play", label: "Play / outdoors", short: "Play", icon: "🪁"),
        .init(value: "transport", label: "Transport", short: "Transport", icon: "🚌"),
        .init(value: "selfcare", label: "Bedtime / self-care", short: "Bedtime", icon: "🛏️"),
        .init(value: "unknown", label: "Somewhere else", short: "Other", icon: "📍"),
    ]
}

struct EngineError: LocalizedError {
    var message: String
    init(_ m: String) { message = m }
    var errorDescription: String? { message }
}
