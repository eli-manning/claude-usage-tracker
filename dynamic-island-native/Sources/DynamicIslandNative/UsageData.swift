import Foundation

struct Credits: Codable {
    var pct: Int?
    var spent: Double?
    var total: Double?
    var reset: String?
}

struct NamedPct: Codable, Identifiable {
    var name: String
    var pct: Int
    var id: String { name }
}

struct Stats: Codable {
    var favoriteModel: String?
    var totalTokens: String?
    var sessions: Int?
    var longestSession: String?
    var activeDays: Int?
    var totalDays: Int?
    var longestStreak: String?
    var mostActiveDay: String?
    var currentStreak: String?
    var funFact: String?
}

struct ClaudeUsage: Codable {
    var session: Int?
    var weekly: Int?
    var sessionReset: String?
    var weeklyReset: String?
    var weeklyPromo: String?
    var credits: Credits?
    var skills: [NamedPct]?
    var mcpServers: [NamedPct]?
    var stats: Stats?
    var error: String?
    var errorType: String?
    var lastUpdated: Date?

    static let empty = ClaudeUsage()
}

struct ProviderStatus: Codable {
    var installed: Bool
}
