import AppKit
import SwiftUI

/// Borderless, transparent, always-on-top panel — the window bounds track
/// the two fixed states (compact bar-sliver / expanded bump+fan) rather
/// than the visible content continuously, so there are no invisible dead
/// zones blocking clicks to whatever's on the desktop behind it while at
/// rest. Deliberately does NOT become key (default NSPanel behavior) — an
/// earlier attempt at overriding canBecomeKey made the panel steal focus and
/// then immediately resign it, auto-collapsing itself a moment after every
/// expand. "Click outside collapses" is instead handled by a global
/// mouse-down monitor below, which works regardless of key-window status.
///
/// `level` matters a lot here: `.floating` sits *below* the system menu
/// bar's own window level, so anything drawn there renders underneath the
/// real menu bar instead of flush with/around the notch — exactly the "it's
/// still beneath the notch" bug. Atoll's own notch window
/// (`components/Notch/DynamicIslandWindow.swift`) uses `.mainMenu + 3`;
/// matching that is what actually gets us drawing at the same layer as the
/// real menu bar/notch.
final class NotchPanel: NSPanel {}

@MainActor
final class PanelController: NSObject {
    private var panel: NotchPanel!
    private let usage = UsageService()
    private var globalClickMonitor: Any?

    func show() {
        let initialSize = NotchGeometry.compactSize()
        panel = NotchPanel(
            contentRect: NSRect(origin: .zero, size: initialSize),
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .mainMenu + 3
        // `HoverZone`'s precise circular hover-catch (`NSTrackingArea`'s
        // `.mouseMoved` option) only actually delivers `mouseMoved` calls if
        // the window opts into them — without this, the tracking area
        // still exists but never fires, which is exactly "detecting none of
        // my hovers": nothing was geometrically wrong, the window just
        // wasn't forwarding the events needed to evaluate it.
        panel.acceptsMouseMovedEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.isMovable = false

        let root = IslandShellView(usage: usage) { [weak self] size in
            self?.resize(to: size)
        }
        let hosting = NSHostingView(rootView: root)
        panel.contentView = hosting

        reposition(size: initialSize)
        panel.orderFrontRegardless()

        globalClickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            self?.handleOutsideClick(event)
        }
    }

    private func handleOutsideClick(_ event: NSEvent) {
        guard let panel else { return }
        // Global-monitor events report the click in screen coordinates
        // relative to the event's own originating screen, not our panel's —
        // convert via the mouse location, which is always in the same
        // global space as NSWindow.frame.
        let clickLocation = NSEvent.mouseLocation
        if !panel.frame.contains(clickLocation) {
            NotificationCenter.default.post(name: .panelShouldCollapse, object: nil)
        }
    }

    /// Instant, non-animated frame change — the panel canvas only ever
    /// snaps between the two fixed sizes; all perceived smoothness comes
    /// from the SwiftUI content animating within that canvas (bump growth,
    /// wedge fan-in, badge/percentage merge), not from animating the window
    /// frame itself.
    private func resize(to size: CGSize) {
        guard let panel else { return }
        let origin = NotchGeometry.topCenterOrigin(for: size)
        panel.setFrame(NSRect(origin: origin, size: size), display: true)
    }

    private func reposition(size: CGSize) {
        guard let panel else { return }
        let origin = NotchGeometry.topCenterOrigin(for: size)
        panel.setFrame(NSRect(origin: origin, size: size), display: true)
    }
}

extension Notification.Name {
    static let panelShouldCollapse = Notification.Name("panelShouldCollapse")
}
