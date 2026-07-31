import SwiftUI

struct Provider: Identifiable {
    var id: String
    var name: String
    var color: Color
    var icon: String
    var hint: String = ""

    static let all: [Provider] = [
        Provider(id: "claude", name: "Claude", color: Color(hex: "D97757"), icon: BrandIcon.claude),
        Provider(id: "gemini", name: "Gemini", color: Color(hex: "4E8CFF"), icon: BrandIcon.gemini,
                 hint: "Run `gemini`, then `/stats model` for usage."),
        Provider(id: "codex", name: "Codex", color: Color(hex: "3ECF8E"), icon: BrandIcon.codex,
                 hint: "Run `codex`, then `/status` for usage."),
        Provider(id: "cursor", name: "Cursor", color: Color(hex: "8B7CF6"), icon: BrandIcon.cursor,
                 hint: "Run `cursor-agent`, then `/usage` for usage."),
    ]
}

extension Color {
    init(hex: String) {
        var h = hex
        if h.hasPrefix("#") { h.removeFirst() }
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

enum Format {
    static func statusColor(_ pct: Int?) -> Color {
        guard let pct else { return .white.opacity(0.5) }
        if pct >= 90 { return Color(hex: "e0857c") }
        if pct >= 70 { return Color(hex: "e6bd6b") }
        return .white
    }
    static func statusHex(_ pct: Int?) -> Color {
        guard let pct else { return .white.opacity(0.3) }
        if pct >= 90 { return Color(hex: "d1685f") }
        if pct >= 70 { return Color(hex: "d4a843") }
        return Color(hex: "CC785C")
    }
    static func ago(_ date: Date?) -> String {
        guard let date else { return "never" }
        let m = Int(-date.timeIntervalSinceNow / 60)
        if m < 1 { return "just now" }
        if m < 60 { return "\(m)m ago" }
        return "\(m / 60)h ago"
    }
    static func reset(_ s: String?) -> String? {
        guard let s else { return nil }
        var out = s
        out = out.replacingOccurrences(of: #"\s*\([^)]*\)"#, with: "", options: .regularExpression)
        return out.trimmingCharacters(in: .whitespaces)
    }
}
