import SwiftUI

enum IconKind {
    case svg(String)   // real brand mark path data
    case symbol(String) // SF Symbol name
}

/// A single ring bubble — either a provider (top level) or one of a
/// provider's own metrics (after drilling in). Same shape either way so the
/// ring/wedge code doesn't need to know which kind it's drawing.
struct Bubble: Identifiable {
    var id: String
    var label: String
    var color: Color
    var icon: IconKind
    var pct: Int?     // drives the border progress arc; nil = no arc
    var big: String   // headline value shown in the hub when selected
    var sub: String?  // reset time / spend / hint, shown in the hub

    static func providers(claude: ClaudeUsage, providerStatus: [String: ProviderStatus]) -> [Bubble] {
        Provider.all.map { p in
            let installed = p.id == "claude" ? true : (providerStatus[p.id]?.installed ?? false)
            let hint = p.id == "claude" ? nil : (installed ? "Detected — not wired up yet." : "Not installed. \(p.hint)")
            return Bubble(id: p.id, label: p.name, color: p.color, icon: .svg(p.icon),
                          pct: p.id == "claude" ? claude.session : nil,
                          big: p.id == "claude" ? (claude.session != nil ? "\(claude.session!)%" : "—") : "",
                          sub: hint)
        }
    }

    static let claudeOrange = Color(hex: "CC785C")

    /// All of Claude's stat wedges, fanned at once — Session, Weekly,
    /// Credits, Skills, All-time, whichever have real clean data. No paging:
    /// the fan just grows/shrinks with however many are available. All share
    /// Claude's own brand color — the color identifies the *provider* these
    /// stats belong to, not the individual stat.
    static func claudeMetrics(_ c: ClaudeUsage) -> [Bubble] {
        var list: [Bubble] = []
        list.append(Bubble(id: "session", label: "Session", color: claudeOrange, icon: .symbol("bolt.fill"),
                            pct: c.session, big: c.session != nil ? "\(c.session!)%" : "—",
                            sub: c.sessionReset.map { "Resets \(Format.reset($0) ?? "")" }))
        list.append(Bubble(id: "weekly", label: "Weekly", color: claudeOrange, icon: .symbol("calendar"),
                            pct: c.weekly, big: c.weekly != nil ? "\(c.weekly!)%" : "—",
                            sub: c.weeklyReset.map { "Resets \(Format.reset($0) ?? "")" }))
        if let credits = c.credits, let pct = credits.pct {
            let sub = (credits.spent != nil && credits.total != nil)
                ? String(format: "$%.2f / $%.2f", credits.spent!, credits.total!) : nil
            list.append(Bubble(id: "credits", label: "Credits", color: claudeOrange, icon: .symbol("cylinder.fill"),
                                pct: pct, big: "\(pct)%", sub: sub))
        }
        if let skills = c.skills, !skills.isEmpty {
            let top = skills.max(by: { $0.pct < $1.pct })
            list.append(Bubble(id: "skills", label: "Skills", color: claudeOrange, icon: .symbol("pencil"),
                                pct: top?.pct, big: "\(skills.count)", sub: top.map { "Top: \($0.name) \($0.pct)%" }))
        }
        if let s = c.stats, (s.favoriteModel != nil || s.sessions != nil) {
            list.append(Bubble(id: "stats", label: "All-time", color: claudeOrange, icon: .symbol("clock.fill"),
                                pct: nil, big: s.sessions != nil ? "\(s.sessions!)" : "—",
                                sub: s.favoriteModel.map { "Favorite: \($0)" }))
        }
        return list
    }
}
