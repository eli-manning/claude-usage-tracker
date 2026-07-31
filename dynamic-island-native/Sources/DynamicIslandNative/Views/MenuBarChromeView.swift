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
    let panelSize: CGSize
    let isExpanded: Bool

    private var barHeight: CGFloat { NotchGeometry.info().reservedTopHeight }
    private var hasNotch: Bool { NotchGeometry.info().hasNotch }
    private var notchRect: CGRect { NotchGeometry.notchLocalRect(panelSize: panelSize) }
    private var restBarWidth: CGFloat { NotchGeometry.compactSize().width }

    private var barCenterX: CGFloat { panelSize.width / 2 }
    private var barWidth: CGFloat { isExpanded ? notchRect.width : restBarWidth }

    /// Centers of the left/right flank slots at rest — derived from the
    /// notch rect so the badge/percentage always sit centered in whatever
    /// room is actually available on each side.
    private var leftCenterX: CGFloat { notchRect.minX / 2 }
    private var rightCenterX: CGFloat { (notchRect.maxX + panelSize.width) / 2 }

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
            Circle().fill(Color(hex: "D97757").opacity(0.3))
            BrandIconView(d: BrandIcon.claude, size: 12)
        }
        .frame(width: 19, height: 19)
        .overlay(
            Circle()
                .fill(dotColor)
                .frame(width: 6, height: 6)
                .offset(x: 7, y: 7)
        )
    }

    private var dotColor: Color {
        if claude.session == nil && claude.weekly == nil { return Color(hex: "555555") }
        return Format.statusHex(max(claude.session ?? 0, claude.weekly ?? 0))
    }

    @ViewBuilder private var percentageLabel: some View {
        if let session = claude.session {
            Text("\(session)%")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(Format.statusColor(session))
                .fixedSize()
        } else {
            Text(loadingLabel)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundColor(.white.opacity(0.45))
                .fixedSize()
        }
    }

    private var loadingLabel: String {
        switch claude.errorType {
        case "offline": return "offline"
        case "auth": return "sign in"
        default: return "…"
        }
    }
}
