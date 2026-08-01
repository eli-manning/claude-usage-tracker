import SwiftUI

struct Provider: Identifiable {
    var id: String
    var name: String
    var color: Color
    var icon: String
    var hint: String = ""
    /// What "not installed" runs in a real Terminal window, for CLIs
    /// installable with a single package-manager command — preferred over
    /// `installURL` when both are set, since it actually installs the thing
    /// instead of just handing the user a docs page to read and act on
    /// themselves.
    var installCommand: String? = nil
    /// Where "not installed" sends the user when there's no one-line
    /// `installCommand` — the CLI's own install page.
    var installURL: String? = nil
    /// What "installed, not signed in" runs in a real Terminal window —
    /// these CLIs' auth flows are interactive, so a background `Process`
    /// can't drive them; the tap has to hand off to an actual terminal.
    var loginCommand: String? = nil

    static let all: [Provider] = [
        Provider(id: "claude", name: "Claude", color: Color(hex: "D97757"), icon: BrandIcon.claude),
        Provider(id: "antigravity", name: "Antigravity", color: Color(hex: "4E8CFF"), icon: BrandIcon.gemini,
                 hint: "Run `agy`, then sign in with Google.",
                 installCommand: "brew install --cask antigravity-cli", loginCommand: "agy"),
        Provider(id: "codex", name: "Codex", color: Color(hex: "3ECF8E"), icon: BrandIcon.codex,
                 hint: "Run `codex`, then `/status` for usage.",
                 installCommand: "npm i -g @openai/codex", loginCommand: "codex"),
        Provider(id: "cursor", name: "Cursor", color: Color(hex: "8B7CF6"), icon: BrandIcon.cursor,
                 hint: "Run `cursor-agent`, then `/usage` for usage.",
                 installCommand: "curl -fsSL https://cursor.com/install | bash", loginCommand: "cursor-agent"),
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
