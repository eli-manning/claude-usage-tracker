import SwiftUI

/// One persistent view for both rest and expanded states — no more
/// discrete view-switching between a floating pill and a separate ring.
/// `canvasSize` (the actual window/frame footprint) and `isExpanded` (which
/// drives every internal animation) are deliberately separate pieces of
/// state:
///
/// - Expanding: `canvasSize` jumps to the expanded footprint *instantly*
///   (reported to `PanelController` with no animation) so there's room for
///   the bump/fan to grow into, then `isExpanded` flips inside
///   `withAnimation` so the bump, badge/percentage merge, and wedge fan all
///   animate within that already-large canvas.
/// - Collapsing: `isExpanded` flips back inside `withAnimation` first; only
///   once that animation has finished do we shrink `canvasSize` back down
///   (a delayed `Task`, mirroring Atoll's `expandingViewTask`/`sneakPeekTask`
///   pattern), so the window's dead-zone footprint is only ever as big as
///   the *current* visual, not lingering at the expanded size after the
///   content has already collapsed.
struct IslandShellView: View {
    @ObservedObject var usage: UsageService
    let onResize: (CGSize) -> Void

    @State private var canvasSize: CGSize = NotchGeometry.compactSize()
    @State private var isExpanded = false
    @State private var currentProviderIdx = 0
    @State private var hoverSuppressedUntil: Date = .distantPast
    @State private var collapseTask: Task<Void, Never>?

    private var barHeight: CGFloat { NotchGeometry.info().reservedTopHeight }

    var body: some View {
        ZStack(alignment: .top) {
            MenuBarChromeView(claude: usage.claude, antigravity: usage.antigravity, providerStatus: usage.providers,
                              currentProviderIdx: currentProviderIdx, panelSize: canvasSize, isExpanded: isExpanded)

            // No separate bump shape — that was a second black rectangle
            // that only existed while expanded, which is exactly what read
            // as "a weird extra black bar that only appears on hover." The
            // hub itself (drawn by RingView, starting immediately below the
            // bar) is now the only thing that appears, with its own top
            // half overlapping up into the bar for the fused look.
            if isExpanded {
                RingView(usage: usage, currentProviderIdx: $currentProviderIdx, onSync: sync)
                    .position(x: canvasSize.width / 2, y: barHeight + RingGeometry.height / 2)
                    .transition(.opacity.combined(with: .scale(scale: 0.55, anchor: .top)))
            }
        }
        .frame(width: canvasSize.width, height: canvasSize.height, alignment: .top)
        .contentShape(Rectangle())
        .animation(.island(open: isExpanded), value: isExpanded)
        .onHover { handleHover($0) }
        .onAppear {
            onResize(canvasSize)
            if ProcessInfo.processInfo.environment["ISLAND_DEBUG_EXPAND"] != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { expand() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .panelShouldCollapse)) { _ in
            collapse()
        }
    }

    private func handleHover(_ hovering: Bool) {
        if hovering {
            guard Date() >= hoverSuppressedUntil else { return }
            expand()
        } else {
            collapse()
        }
    }

    private func expand() {
        guard !isExpanded else { return }
        collapseTask?.cancel()
        let expandedSize = NotchGeometry.expandedSize()
        canvasSize = expandedSize
        onResize(expandedSize)
        withAnimation(.island(open: true)) {
            isExpanded = true
        }
    }

    private func collapse() {
        guard isExpanded else { return }
        withAnimation(.island(open: false)) {
            isExpanded = false
        }
        hoverSuppressedUntil = Date().addingTimeInterval(0.35)
        collapseTask?.cancel()
        collapseTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.46))
            guard !Task.isCancelled else { return }
            let compactSize = NotchGeometry.compactSize()
            canvasSize = compactSize
            onResize(compactSize)
        }
    }

    private func sync() {
        Task { await usage.refresh() }
    }
}
