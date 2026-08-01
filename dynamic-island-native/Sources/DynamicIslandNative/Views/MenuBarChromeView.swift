import SwiftUI

/// The rest-state menu-bar chrome — one continuous solid black, rounded
/// bar (Atoll's closed-notch look: a single fused shape, not separate
/// floating chips) that reaches all the way from the badge to the
/// percentage, with the real hardware notch sitting inside it undisturbed
/// (drawing black there is harmless — the physical camera housing is
/// already black). On non-notched external displays this same bar is what
/// stands in for the notch, since it never shrinks narrower than the
/// notch's own width.
///
/// The bar's *position* never changes — it's always centered on the notch.
/// Expanding only shrinks its width symmetrically from both sides down to
/// just the notch's own width (as the badge/percentage merge into it and
/// disappear); it never slides or jumps.
struct MenuBarChromeView: View {
    let claude: ClaudeUsage
    let antigravity: GeminiUsage?
    let providerStatus: [String: ProviderStatus]
    let currentProviderIdx: Int
    let panelSize: CGSize
    let isExpanded: Bool

    /// The pill always reflects whichever provider is currently selected in
    /// the ring (hover-picked), not always Claude — so switching providers
    /// while expanded is still reflected once it collapses back down.
    private var activeProvider: Provider { Provider.all[currentProviderIdx] }
    private var isClaudeActive: Bool { activeProvider.id == "claude" }
    private var activeStatus: ProviderStatus {
        providerStatus[activeProvider.id] ?? ProviderStatus(state: .notInstalled)
    }

    private var barHeight: CGFloat { NotchGeometry.info().reservedTopHeight }
    private var hasNotch: Bool { NotchGeometry.info().hasNotch }
    private var notchRect: CGRect { NotchGeometry.notchLocalRect(panelSize: panelSize) }
    private var restBarWidth: CGFloat { NotchGeometry.compactSize().width }

    private var barCenterX: CGFloat { panelSize.width / 2 }
    private var barWidth: CGFloat { isExpanded ? notchRect.width : restBarWidth }

    /// Centers of the left/right flank slots at rest — a *fixed* offset
    /// from the bar's own center (constants only, no `panelSize`), not
    /// re-derived from the live panel width. `panelSize` lags `isExpanded`
    /// by ~0.46s on collapse (the window's hit-test footprint intentionally
    /// stays large until the collapse animation finishes), so a
    /// panelSize-relative formula would place these at the wide expanded
    /// window's edges for that whole window, then jump inward once
    /// `canvasSize` finally shrinks — the "shoots out to the sides" glitch.
    /// A fixed offset from center is correct the instant `isExpanded` flips,
    /// independent of how large the window still is underneath it.
    private var flankOffset: CGFloat { NotchGeometry.info().notchWidth / 2 + NotchGeometry.Layout.flankWidth / 2 }
    private var leftCenterX: CGFloat { barCenterX - flankOffset }
    private var rightCenterX: CGFloat { barCenterX + flankOffset }

    var body: some View {
        ZStack {
            // Once fully merged into a *real* notch, this shape has nothing
            // left to contribute — the physical camera housing already
            // renders that exact region black. Left visible, its own
            // rounded top corners would show up as a separate curved seam
            // sitting just below the real notch (the "extra black spacer"
            // artifact). On non-notched displays it stays visible, since
            // it's the only thing standing in for the notch there.
            BumpShape(topCornerRadius: 6, bottomCornerRadius: barHeight / 2)
                .fill(Color.black)
                .frame(width: barWidth, height: barHeight)
                .position(x: barCenterX, y: barHeight / 2)
                .opacity(isExpanded && hasNotch ? 0 : 1)

            badge
                .position(x: isExpanded ? notchRect.midX : leftCenterX, y: barHeight / 2)
                .scaleEffect(isExpanded ? 0.3 : 1)
                .opacity(isExpanded ? 0 : 1)

            percentageLabel
                .position(x: isExpanded ? notchRect.midX : rightCenterX, y: barHeight / 2)
                .scaleEffect(isExpanded ? 0.3 : 1)
                .opacity(isExpanded ? 0 : 1)
        }
        .frame(width: panelSize.width, height: barHeight, alignment: .top)
        .animation(.island(open: isExpanded), value: isExpanded)
    }

    private var badge: some View {
        ZStack {
            Circle().fill(activeProvider.color.opacity(0.3))
            BrandIconView(d: activeProvider.icon, size: 12)
        }
        .frame(width: 19, height: 19)
        .overlay(
            Circle()
                .fill(dotColor)
                .frame(width: 6, height: 6)
                .offset(x: 7, y: 7)
        )
    }

    /// Antigravity's "right now" figure for the pill, same role Claude's
    /// `session` plays there — the 5-hour window is Antigravity's rolling
    /// short-term quota, same as Claude's session is its rolling short-term
    /// quota (as opposed to the weekly figure, which is the longer-window
    /// one for both).
    private var antigravityPillPct: Int? {
        guard activeProvider.id == "antigravity", activeStatus.state == .loggedIn else { return nil }
        return antigravity?.fiveHourPct ?? antigravity?.weeklyPct
    }

    private var dotColor: Color {
        if isClaudeActive {
            if claude.session == nil && claude.weekly == nil { return Color(hex: "555555") }
            return Format.statusHex(max(claude.session ?? 0, claude.weekly ?? 0))
        }
        if let pct = antigravityPillPct {
            return Format.statusHex(pct)
        }
        if case .error = activeStatus.state { return Color(hex: "d1685f") }
        return Color(hex: "555555")
    }

    @ViewBuilder private var percentageLabel: some View {
        if isClaudeActive, let session = claude.session {
            Text("\(session)%")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(Format.statusColor(session))
                .fixedSize()
        } else if let pct = antigravityPillPct {
            Text("\(pct)%")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(Format.statusColor(pct))
                .fixedSize()
        } else {
            Text(compactLabel)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundColor(.white.opacity(0.45))
                .fixedSize()
        }
    }

    private var compactLabel: String {
        guard isClaudeActive else { return activeStatus.shortLabel }
        switch claude.errorType {
        case "offline": return "offline"
        case "auth": return "sign in"
        default: return "…"
        }
    }
}
