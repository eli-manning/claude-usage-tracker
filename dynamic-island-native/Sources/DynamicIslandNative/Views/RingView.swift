import SwiftUI
import AppKit

/// Small-scale fan geometry — anchored so `cy` sits just under the bump's
/// bottom edge (passed in by the caller), not a fixed frame origin. Kept
/// deliberately modest: a nub with a fan under it, not a dome.
///
/// Layers stack outward from the hub as a chain, not as independently
/// guessed radii — each layer's inner radius is the previous layer's outer
/// radius plus a fixed margin. That's what "modular" means here: bump
/// `hubRadius` (or insert a new layer between two existing ones) and
/// everything further out re-flows automatically instead of silently
/// starting to overlap, which is exactly what happened when the hub grew
/// and the provider ring didn't move with it.
struct RingGeometry {
    static let height: CGFloat = NotchGeometry.Layout.fanHeight

    /// Gap left between consecutive layers (and between the hub and the
    /// first layer) so adjacent rings never touch/overlap.
    static let layerMargin: CGFloat = 8

    // Use the full 180° (nearly edge to edge) so every layer gets as much
    // angular room per item as possible — important now that layers can
    // hold 3-5 evenly-divided items and need room for label text.
    static let arcStart: Double = 3
    static let arcEnd: Double = 177
    static let gapDeg: Double = 4
    static let selectedWidthDeg: Double = 48
    // Ceiling on how wide a single unselected wedge can get. Claude's fan
    // (3-5 items) never hits this — dividing the leftover arc among 2-4
    // unselected items naturally lands well under it, so that fan's layout
    // is untouched. It only kicks in for small fans like Antigravity's 2
    // stats, where dividing leftover space among just 1 unselected item let
    // it balloon to ~120° next to a 48° selected wedge.
    static let maxUnselectedWidthDeg: Double = 55

    // MARK: Hub
    static let hubRadius: CGFloat = 35

    // MARK: Layer 1 — provider picker (hover-revealed), evenly divided,
    // no enlarged/"selected" member. Every ring that just needs to divide
    // N items evenly around the hub (with no highlighted one) should look
    // like this: a thickness, chained off the previous layer's outer edge.
    static let providerLayerThickness: CGFloat = 46
    static var providerRInner: CGFloat { hubRadius + layerMargin }
    static var providerROuter: CGFloat { providerRInner + providerLayerThickness }

    // MARK: Layer 2 — stats (Session/Weekly/etc.), one member enlarged to
    // show its value. Chained off layer 1's outer edge so it can never
    // creep inward and overlap the provider ring, regardless of how big
    // either layer's thickness is tuned to be.
    static let statsLayerThickness: CGFloat = 50
    static let statsSelectedExtra: CGFloat = 16
    static var rInner: CGFloat { providerROuter + layerMargin }
    static var rOuter: CGFloat { rInner + statsLayerThickness }
    static var rOuterSelected: CGFloat { rOuter + statsSelectedExtra }

    /// Derived from the outermost layer, not a guessed constant — so the
    /// frame (and the panel, via `NotchGeometry.expandedSize`) always has
    /// room for whatever the layer chain currently adds up to.
    static var width: CGFloat { (rOuterSelected + 20) * 2 }
}

struct WedgeLayout: Identifiable {
    let bubble: Bubble
    let index: Int
    let isSelected: Bool
    let startDeg: Double
    let endDeg: Double
    let rInner: CGFloat
    let rOuter: CGFloat
    var id: String { bubble.id }

    /// `radiusFraction` picks where between `rInner` (0) and `rOuter` (1)
    /// the content sits. Defaults to the middle, but selected stat wedges
    /// pull this in toward the inner edge — their curved label lives out
    /// near `rOuter`, so the icon+value block needs to stay well clear of
    /// it instead of both fighting over the same middle ground.
    func contentPos(cx: CGFloat, cy: CGFloat, radiusFraction: CGFloat = 0.5) -> CGPoint {
        let r = rInner + (rOuter - rInner) * radiusFraction
        return .onArc(cx: cx, cy: cy, r: r, deg: (startDeg + endDeg) / 2)
    }

    /// The widest a label can be before it would start overlapping a
    /// neighboring wedge — the chord length at the *outer* radius (the
    /// widest point of the slice), so text sizes to its own wedge
    /// regardless of how many items are sharing the arc or how tight the
    /// spacing gets.
    var labelMaxWidth: CGFloat {
        let halfAngleRad = (endDeg - startDeg) / 2 * .pi / 180
        return 2 * rOuter * sin(halfAngleRad)
    }
}

func buildWedges(bubbles: [Bubble], selectedIdx: Int, rInner: CGFloat, rOuterBase: CGFloat, rOuterSelected: CGFloat) -> [WedgeLayout] {
    let g = RingGeometry.self
    let n = Double(bubbles.count)
    guard n > 0 else { return [] }
    let span = g.arcEnd - g.arcStart
    let hasSelection = rOuterSelected > rOuterBase

    guard hasSelection else {
        // No highlighted member (the provider ring) — every item just
        // divides the entire span evenly. Always exactly 3 items in
        // practice, so this always fills the arc.
        let evenWidth = (span - g.gapDeg * (n - 1)) / n
        var cursor = g.arcStart
        return bubbles.enumerated().map { i, b in
            let start = cursor
            let end = start + evenWidth
            cursor = end + g.gapDeg
            return WedgeLayout(bubble: b, index: i, isSelected: false, startDeg: start, endDeg: end,
                                rInner: rInner, rOuter: rOuterBase)
        }
    }

    // With a highlighted member, the selected wedge is anchored to the
    // arc's exact center angle — not "whichever array index happens to be
    // in the middle" — so it stays visually centered whether the fan has
    // an even or odd item count. An odd count with the selected item at
    // the true middle index (Claude's 5-stat fan) makes those two things
    // coincide, which is why that layout is unchanged from before; an even
    // count (Antigravity's 2 stats) has no middle index at all, so
    // centering "the whole block" like before left the selection off to
    // one side instead of centered.
    let selWidth = g.selectedWidthDeg
    // Capped so a small fan's leftover space can't balloon a single
    // unselected wedge (Claude's fan never hits this cap). A hair under
    // the true max (half the arc, minus half the selected wedge and one
    // gap) so a lone neighbor can't overshoot the arc's edge.
    let naturalEvenWidth = n > 1 ? (span - selWidth - g.gapDeg * (n - 1)) / (n - 1) : span
    let evenWidth = min(naturalEvenWidth, g.maxUnselectedWidthDeg)

    let centerDeg = (g.arcStart + g.arcEnd) / 2
    var spans = [Int: (Double, Double)]()
    spans[selectedIdx] = (centerDeg - selWidth / 2, centerDeg + selWidth / 2)

    var leftCursor = centerDeg - selWidth / 2 - g.gapDeg
    if selectedIdx > 0 {
        for i in stride(from: selectedIdx - 1, through: 0, by: -1) {
            let end = leftCursor
            let start = end - evenWidth
            spans[i] = (start, end)
            leftCursor = start - g.gapDeg
        }
    }

    var rightCursor = centerDeg + selWidth / 2 + g.gapDeg
    let lastIdx = Int(n) - 1
    if selectedIdx < lastIdx {
        for i in (selectedIdx + 1)...lastIdx {
            let start = rightCursor
            let end = start + evenWidth
            spans[i] = (start, end)
            rightCursor = end + g.gapDeg
        }
    }

    return bubbles.enumerated().map { i, b in
        let isSelected = i == selectedIdx
        let (start, end) = spans[i]!
        return WedgeLayout(bubble: b, index: i, isSelected: isSelected, startDeg: start, endDeg: end,
                            rInner: rInner, rOuter: isSelected ? rOuterSelected : rOuterBase)
    }
}

/// The wedge fan + hub, hanging just under the fused bump. `cy` is the
/// bump's bottom edge in the parent's local coordinate space — everything
/// here is drawn relative to that, so it always reads as growing out of the
/// bump rather than floating independently.
struct RingView: View {
    let usage: UsageService
    @Binding var currentProviderIdx: Int
    let onSync: () -> Void

    // Tracked by id, not array index — the outer list gets reordered
    // (Session centered rather than first) and its length changes with
    // which metrics have real data, so a plain index would silently point
    // at the wrong bubble.
    @State private var selectedStatID: String = "session"
    @State private var isHoveringHub = false
    // Only meaningful for an even-sized fan (odd fans have one unambiguous
    // middle index — see `centeredOrder`). With exactly 2 items there's no
    // way to tell "rotate forward" from "rotate backward" from the fixed
    // order alone, so without this every swap would snap the outgoing item
    // back to the same fixed side instead of swinging like a pendulum.
    // Toggled once per genuine selection change in `selectOuter`.
    @State private var centerSlotParity = false

    private var isClaudeActive: Bool { currentProviderIdx == 0 }
    private var activeProvider: Provider { Provider.all[currentProviderIdx] }
    private let cx: CGFloat = RingGeometry.width / 2
    // Zero, deliberately — this frame's own top edge (y=0) *is* the bump's
    // bottom edge (set by the parent), so the hub's center sits exactly on
    // that seam and its top half overlaps into the bump. That's what
    // guarantees zero visible gap between the bump and the hub regardless
    // of bump height, rather than relying on two independently-tuned
    // constants to happen to line up.
    private let cy: CGFloat = 0

    /// The outer ring's content — the active provider's own stats, if it
    /// has any wired up yet. Providers without real data don't get a lone
    /// giant "selected" wedge just because they're the only bubble in the
    /// ring (that's what made switching to Cursor/Codex look so lopsided —
    /// three tiny provider icons next to one blown-up wedge); the hub
    /// itself already shows which provider is active via its color and
    /// logo, so there's nothing else to render out here until a provider
    /// has real stats.
    private var outerBubbles: [Bubble] {
        let metrics: [Bubble]
        if isClaudeActive {
            metrics = Bubble.claudeMetrics(usage.claude)
        } else if activeProvider.id == "antigravity", let g = usage.antigravity, activeStatus.state == .loggedIn {
            metrics = Bubble.antigravityMetrics(g, color: activeProvider.color)
        } else {
            metrics = []
        }
        guard !metrics.isEmpty else { return [] }
        return centeredOrder(metrics)
    }

    /// Fixed circular neighbor order per provider — session's neighbors are
    /// always weekly and credits, credits' neighbors are always session and
    /// skills, etc. — independent of which one is currently centered.
    /// [farRight, ..., farLeft] to match `buildWedges`' expected input
    /// order (it lays out starting from `arcStart`, the *right* edge of
    /// the fan, and works leftward).
    private static let claudeStatOrder = ["stats", "credits", "session", "weekly", "skills"]
    private static let antigravityStatOrder = ["fiveHour", "weekly"]

    private var activeStatOrder: [String] {
        isClaudeActive ? Self.claudeStatOrder : Self.antigravityStatOrder
    }

    /// Rotates the fixed circular order so the selected stat lands in the
    /// center slot — a wheel, not a reshuffle: every item keeps the same
    /// neighbors it always had, just which one faces front changes. With
    /// `session` selected (Claude's default) this reduces to the original
    /// fixed [stats, credits, session, weekly, skills] layout exactly.
    ///
    /// An odd-sized fan has one unambiguous middle index, so it always
    /// rotates the same way. An even-sized fan (Antigravity's 2 stats) has
    /// two equally-valid "center" candidates — `(n-1)/2` and `n/2` — and
    /// picking the same one every time makes every swap snap the outgoing
    /// item back to the same fixed side instead of swinging like a
    /// pendulum. `centerSlotParity` alternates between the two candidates
    /// once per genuine selection change (see `selectOuter`), which is
    /// exactly what makes the outgoing item swing to the opposite side each
    /// time. For an odd n both candidates are equal, so this is a no-op —
    /// Claude's fan is unaffected either way.
    private func centeredOrder(_ bubbles: [Bubble]) -> [Bubble] {
        let byID = Dictionary(uniqueKeysWithValues: bubbles.map { ($0.id, $0) })
        let available = activeStatOrder.filter { byID[$0] != nil }
        guard !available.isEmpty else { return [] }
        let n = available.count
        let centerSlot = centerSlotParity ? n / 2 : (n - 1) / 2
        let selIdx = available.firstIndex(of: selectedStatID) ?? centerSlot
        return (0..<n).map { offset in
            let idx = ((selIdx - centerSlot + offset) % n + n) % n
            return byID[available[idx]]!
        }
    }

    var body: some View {
        let g = RingGeometry.self
        let allProviderBubbles = Bubble.providers(claude: usage.claude, providerStatus: usage.providers, antigravity: usage.antigravity)

        // A provider with real data (Claude, or Antigravity once signed in)
        // gets the full multi-wedge stat fan; everyone else gets one
        // centered wedge carrying its status message (not installed / not
        // signed in) instead of a lone giant "selected" wedge sized for
        // data it doesn't have.
        let outer = outerBubbles
        let hasStats = !outer.isEmpty
        let outerSelectedIdx = outer.firstIndex(where: { $0.id == selectedStatID }) ?? 0
        let outerWedges: [WedgeLayout] = hasStats
            ? buildWedges(bubbles: outer, selectedIdx: outerSelectedIdx,
                           rInner: g.rInner, rOuterBase: g.rOuter, rOuterSelected: g.rOuterSelected)
            : [centeredWedge(allProviderBubbles[currentProviderIdx], rInner: g.rInner, rOuter: g.rOuterSelected)]

        let providerBubbles = allProviderBubbles.enumerated().filter { $0.offset != currentProviderIdx }.map(\.element)
        let innerWedges = isHoveringHub
            ? buildWedges(bubbles: providerBubbles, selectedIdx: -1,
                          rInner: g.providerRInner, rOuterBase: g.providerROuter, rOuterSelected: g.providerROuter)
            : []

        ZStack {
            ForEach(outerWedges) { w in
                wedgeShape(w)
                    .onTapGesture { if hasStats { selectOuter(w) } else { handleStatusTap() } }
                    .help(hasStats ? "" : activeStatus.message(installHint: activeProvider.hint))
                    .transition(.scale(scale: 0.6, anchor: .top).combined(with: .opacity))
            }
            .compositingGroup()

            if hasStats {
                // Icon sits in its own inner band, well clear of the two
                // curved-text bands further out — value in the middle,
                // label right against the percent arc — so nothing has to
                // fight for the same radius regardless of selection state.
                ForEach(outerWedges) { w in
                    wedgeContent(w)
                        .position(w.contentPos(cx: cx, cy: cy, radiusFraction: 0.24))
                        .onTapGesture { selectOuter(w) }
                }

                // Value readout, curved — same band for every wedge (as a
                // fraction of that wedge's own rInner...rOuter), just bigger
                // and brighter when selected.
                ForEach(outerWedges) { w in
                    CurvedText(
                        text: w.bubble.big,
                        radius: w.rInner + (w.rOuter - w.rInner) * 0.6,
                        centerDeg: (w.startDeg + w.endDeg) / 2,
                        fontSize: w.isSelected ? 15 : 10,
                        weight: .bold,
                        color: .white
                    )
                    .position(x: cx, y: cy)
                    .allowsHitTesting(false)
                }

                // Name, curved along the wedge's outer edge, just inside its
                // percent-progress arc — selected or not; it should never
                // snap back to flat text just because a wedge became
                // selected.
                ForEach(outerWedges) { w in
                    CurvedText(
                        text: w.bubble.label.uppercased(),
                        radius: w.rOuter - 6,
                        centerDeg: (w.startDeg + w.endDeg) / 2,
                        fontSize: w.isSelected ? 9.5 : 8,
                        color: w.isSelected ? .white.opacity(0.85) : .white.opacity(0.65)
                    )
                    .position(x: cx, y: cy)
                    .allowsHitTesting(false)
                }
            } else {
                // No real stats to lay out along an arc yet — an icon +
                // one-word action ("Install" / "Sign In") instead of a
                // paragraph. The full sentence lives in the `.help()`
                // tooltip on the wedge itself; tapping either runs the
                // action directly (`handleStatusTap`).
                ForEach(outerWedges) { w in
                    statusAction(w)
                }
            }

            providerCluster(innerWedges: innerWedges)

            // A native, precise hover zone — a fixed circle of radius
            // `providerROuter`, full stop. Anywhere inside it (whether
            // that's directly over the hub, over a revealed provider
            // wedge, or just empty space between them) keeps the ring
            // retracted; leaving that circle entirely is what expands it
            // back. See `HoverCircle`'s own doc comment for why this had to
            // be native AppKit tracking rather than SwiftUI `.onHover` —
            // every SwiftUI attempt at this (hover on the cluster, hover on
            // a separate overlay, hover on the button itself) ran into a
            // different flavor of the same problem: some other view with
            // its own gesture recognizer sitting in the same area could
            // "steal" the hover instead of it reflecting pure geometry.
            HoverCircle(center: CGPoint(x: cx, y: cy), radius: g.providerROuter) { hovering in
                isHoveringHub = hovering
            }
            .frame(width: g.width, height: g.height)
            .allowsHitTesting(true)
        }
        .frame(width: g.width, height: g.height)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: outer.count)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: isHoveringHub)
        // The wheel rotation itself — every wedge's angle shifts at once
        // when the selected stat changes, so it needs its own trigger
        // rather than relying on `outer.count`/`isHoveringHub` (neither of
        // which changes when you just pick a different stat).
        .animation(.spring(response: 0.4, dampingFraction: 0.82), value: selectedStatID)
    }

    /// When the provider ring isn't showing, there's nothing occupying the
    /// space between the hub and where those wedges normally start/end —
    /// which read as an empty hole. So instead of staying a fixed size, the
    /// hub itself grows to fill exactly that space (out to
    /// `providerROuter`) whenever the ring is collapsed, and shrinks back
    /// down to make room the moment you hover it.
    private var effectiveHubRadius: CGFloat {
        isHoveringHub ? RingGeometry.hubRadius : RingGeometry.providerROuter
    }


    @ViewBuilder
    private func providerCluster(innerWedges: [WedgeLayout]) -> some View {
        let hubR = effectiveHubRadius
        ZStack {
            ForEach(innerWedges) { w in
                wedgeShape(w)
                    .onTapGesture { pickProvider(w.index) }
                    .transition(.scale(scale: 0.6, anchor: .top).combined(with: .opacity))
            }
            .compositingGroup()

            IconAura(color: activeProvider.color, size: hubR * 2.6)
                .position(x: cx, y: cy)

            Circle()
                .fill(Color.black.opacity(0.85))
                .overlay(Circle().stroke(Color.white.opacity(0.12), lineWidth: 1))
                .frame(width: hubR * 2, height: hubR * 2)
                .shadow(color: .black.opacity(0.6), radius: 6, y: 2)
                .position(x: cx, y: cy)

            // Icon only — no flat label here, the logo is recognizable
            // enough on its own for provider switching.
            ForEach(innerWedges) { w in
                iconOnlyWedgeContent(w)
                    .position(w.contentPos(cx: cx, cy: cy))
                    .onTapGesture { pickProvider(w.index) }
            }

            // Real quota, when a provider has any cached — curved along the
            // wedge's own outer edge, just inset from it, same treatment
            // (and same radius convention, `rOuter - 6`) as the outer stat
            // wedges' curved *label* text, just smaller to fit this ring's
            // thinner band. Lets you see every provider's usage at a glance
            // in the picker itself, without switching to each one.
            ForEach(innerWedges) { w in
                if let pct = w.bubble.pct {
                    CurvedText(
                        text: "\(pct)%",
                        radius: w.rOuter - 6,
                        centerDeg: (w.startDeg + w.endDeg) / 2,
                        fontSize: 6,
                        weight: .bold,
                        color: Format.statusColor(pct)
                    )
                    .position(x: cx, y: cy)
                    .allowsHitTesting(false)
                }
            }

            hub.position(x: cx, y: cy)
        }
        .frame(width: RingGeometry.width, height: RingGeometry.height)
        // Hover detection lives on `providerHoverDetector` above, not here —
        // this view's own content (the `innerWedges` ForEach) changes based
        // on `isHoveringHub`, so it can't safely carry the hover tracking
        // itself.
    }

    private func selectOuter(_ w: WedgeLayout) {
        guard w.bubble.id != selectedStatID else { return }
        centerSlotParity.toggle()
        selectedStatID = w.bubble.id
    }

    private func pickProvider(_ providerAllIndex: Int) {
        // innerWedges filters out the current provider, so its `index` is
        // the index *within that filtered list* — map back to Provider.all.
        let filtered = Provider.all.enumerated().filter { $0.offset != currentProviderIdx }
        guard providerAllIndex < filtered.count else { return }
        currentProviderIdx = filtered[providerAllIndex].offset
        selectedStatID = "session"
        centerSlotParity = false
    }

    private func wedgeShape(_ w: WedgeLayout) -> some View {
        WedgeShape(cx: cx, cy: cy, rInner: w.rInner, rOuter: w.rOuter,
                   startDeg: w.startDeg, endDeg: w.endDeg)
            // A solid dark base first — the glassmorphic color wash on top
            // reads as basically transparent without something opaque-ish
            // underneath it, which is what let wedges blend into whatever's
            // behind the panel (wallpaper, other windows, etc).
            .fill(Color.black.opacity(0.4))
            .overlay(
                WedgeShape(cx: cx, cy: cy, rInner: w.rInner, rOuter: w.rOuter,
                           startDeg: w.startDeg, endDeg: w.endDeg)
                    .fill(
                        LinearGradient(
                            // Unselected wedges now get a wash of their own
                            // brand color too, not plain white — more
                            // contrast against the background, and an extra
                            // cue for telling wedges apart at a glance.
                            colors: w.isSelected
                                ? [w.bubble.color.opacity(0.42), w.bubble.color.opacity(0.18)]
                                : [w.bubble.color.opacity(0.22), w.bubble.color.opacity(0.08)],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
            )
            .shadow(color: .black.opacity(0.55), radius: 6, x: 0, y: 3)
            .overlay(
                WedgeShape(cx: cx, cy: cy, rInner: w.rInner, rOuter: w.rOuter,
                           startDeg: w.startDeg, endDeg: w.endDeg)
                    .glow(color: w.bubble.color, lineWidth: w.isSelected ? 2 : 1.3, blurRadius: w.isSelected ? 6 : 3)
                    .opacity(w.isSelected ? 1 : 0.8)
            )
            .overlay(
                Group {
                    if let pct = w.bubble.pct {
                        let frac = CGFloat(max(0, min(100, pct))) / 100
                        ArcShape(cx: cx, cy: cy, r: w.rOuter + 5,
                                 startDeg: w.startDeg, endDeg: w.startDeg + (w.endDeg - w.startDeg) * frac)
                            .glow(color: w.bubble.color, lineWidth: 2, blurRadius: 6)
                    }
                }
            )
            .contentShape(WedgeShape(cx: cx, cy: cy, rInner: w.rInner, rOuter: w.rOuter,
                                      startDeg: w.startDeg, endDeg: w.endDeg))
    }

    /// Icon-only wedge content — no label at all. The logo itself is more
    /// recognizable than a tiny caption, so the provider ring just shows a
    /// badge sized to fill as much of its own wedge as it can (bounded by
    /// both the wedge's angular width and its radial thickness, so it never
    /// pokes past either edge). The glow behind it identifies the brand
    /// color, so the icon itself stays plain white — tinting it the *same*
    /// color as the glow behind it (with an additive blend, no less) was
    /// what made it wash out to an illegible blob.
    private func iconOnlyWedgeContent(_ w: WedgeLayout) -> some View {
        let diameter = max(min(w.labelMaxWidth, w.rOuter - w.rInner) * 0.94, 1)
        return ZStack {
            IconAura(color: w.bubble.color, size: diameter * 1.25)
            iconView(w.bubble.icon, size: diameter * 0.6, tint: .white)
        }
        .frame(width: diameter, height: diameter)
    }

    /// One wedge, centered on the fan's own midpoint rather than positioned
    /// by `buildWedges`'s "reserve a selected slot among N items" math —
    /// that math is for dividing several items around the arc, not for
    /// placing a single standalone wedge, which it would otherwise shove
    /// off to one side (starting at `arcStart`).
    private func centeredWedge(_ bubble: Bubble, rInner: CGFloat, rOuter: CGFloat, widthDeg: Double = 72) -> WedgeLayout {
        let g = RingGeometry.self
        let centerDeg = (g.arcStart + g.arcEnd) / 2
        return WedgeLayout(bubble: bubble, index: 0, isSelected: true,
                            startDeg: centerDeg - widthDeg / 2, endDeg: centerDeg + widthDeg / 2,
                            rInner: rInner, rOuter: rOuter)
    }

    private var activeStatus: ProviderStatus {
        usage.providers[activeProvider.id] ?? ProviderStatus(state: .notInstalled)
    }

    /// Icon + one-word action for the "provider isn't wired up yet" wedge.
    /// The full sentence lives in the `.help()` tooltip on the wedge shape
    /// itself (see `body`) — curved per-character text only works for
    /// short single values like "82%", not full sentences.
    private func statusAction(_ w: WedgeLayout) -> some View {
        VStack(spacing: 6) {
            Image(systemName: activeStatus.actionIcon)
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(.white)
            Text(activeStatus.actionLabel.uppercased())
                .font(.system(size: 10.5, weight: .bold))
                .foregroundColor(.white.opacity(0.9))
        }
        .position(w.contentPos(cx: cx, cy: cy, radiusFraction: 0.58))
        .allowsHitTesting(false)
    }

    /// Not installed → a real Terminal window running its one-line install
    /// command if it has one (e.g. `npm i -g @openai/codex`), otherwise the
    /// CLI's own install page in the browser. Installed but not signed in
    /// (or last fetch errored) → a real Terminal window running its login
    /// command, since these are interactive OAuth flows a background
    /// `Process` can't drive.
    private func handleStatusTap() {
        switch activeStatus.state {
        case .notInstalled:
            if let command = activeProvider.installCommand {
                runInTerminal(command)
            } else if let urlString = activeProvider.installURL, let url = URL(string: urlString) {
                NSWorkspace.shared.open(url)
            }
        case .installed, .error:
            if let command = activeProvider.loginCommand {
                runInTerminal(command)
            }
        case .loggedIn:
            break
        }
    }

    private func runInTerminal(_ command: String) {
        let escaped = command.replacingOccurrences(of: "\"", with: "\\\"")
        let script = "tell application \"Terminal\"\nactivate\ndo script \"\(escaped)\"\nend tell"
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        task.arguments = ["-e", script]
        try? task.run()
    }

    private func wedgeContent(_ w: WedgeLayout) -> some View {
        VStack(spacing: w.isSelected ? 5 : 4) {
            ZStack {
                if w.isSelected {
                    IconAura(color: w.bubble.color, size: 46)
                }
                // Same reasoning as the provider badges above: once there's
                // a same-color glow behind it (selected only), the icon
                // needs to switch to white or it disappears into its own
                // halo. Unselected icons have no glow, so the brand tint
                // still reads fine against the plain wedge fill.
                iconView(w.bubble.icon, size: w.isSelected ? 18 : 14, tint: w.isSelected ? .white : w.bubble.color)
            }
            .frame(width: w.isSelected ? 32 : 24, height: w.isSelected ? 32 : 24)
            // Value and label are both drawn separately as `CurvedText`,
            // further out — this is just the icon, in its own inner band.
        }
        // Clamps the icon to this wedge's own width at its widest point so
        // it stays centered on the wedge rather than drifting to one side.
        .frame(width: max(w.labelMaxWidth, 1))
    }

    @ViewBuilder private func iconView(_ icon: IconKind, size: CGFloat, tint: Color) -> some View {
        switch icon {
        case .svg(let d):
            BrandIconView(d: d, size: size, color: tint)
        case .symbol(let name):
            Image(systemName: name).font(.system(size: size * 0.66, weight: .semibold)).foregroundColor(tint)
        }
    }

    // The active provider's logo — hover reveals the provider-picker ring,
    // click refreshes. No separate close/back buttons anywhere; hovering
    // away from the whole panel is what collapses it (handled by the
    // parent).
    @ViewBuilder private var hub: some View {
        // Icon size and its down-offset both scale with the hub's own
        // radius — otherwise growing the hub to close the "hole" (see
        // `effectiveHubRadius`) leaves a tiny logo floating in a big empty
        // disc instead of actually filling it.
        let hubScale = effectiveHubRadius / RingGeometry.hubRadius
        Button(action: onSync) {
            ZStack {
                Circle().fill(activeProvider.color)
                    .shadow(color: activeProvider.color.opacity(0.8), radius: 7)
                // Nudged down from true-center — the circle itself is cut
                // in half by the bar above, so centering the logo on the
                // circle's midpoint would put its top half up under the
                // bar; shifting it toward the visible (bottom) half keeps
                // it fully readable. Rotation has to come *before* the
                // offset here: rotationEffect spins a view around its own
                // center as it's currently laid out, so rotating first (at
                // the icon's natural position) then shifting the whole
                // already-spinning result down is what keeps it spinning in
                // place. Doing it the other way (offset then rotate) rotates
                // around the shifted view's bounding box in a way that reads
                // as an orbit instead of an in-place spin.
                BrandIconView(d: activeProvider.icon, size: 19 * hubScale)
                    .rotationEffect(.degrees(usage.isRefreshing ? 360 : 0))
                    .animation(usage.isRefreshing ? .linear(duration: 0.9).repeatForever(autoreverses: false) : .default, value: usage.isRefreshing)
                    .offset(y: 11 * hubScale)
            }
            .frame(width: effectiveHubRadius * 2, height: effectiveHubRadius * 2)
            .animation(.spring(response: 0.32, dampingFraction: 0.8), value: currentProviderIdx)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help("Click to refresh · hover to switch provider")
        // Hover no longer lives here at all — see `HoverCircle` in
        // `body`, a native fixed-geometry hover sensor that isn't affected
        // by this button's own resizing, or by anything else in the tree.
    }
}
