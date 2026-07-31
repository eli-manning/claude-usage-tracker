import AppKit

/// Real notch geometry via the same public API Atoll uses
/// (`auxiliaryTopLeftArea`/`auxiliaryTopRightArea`, `safeAreaInsets`) rather
/// than guessing a notch width like the Electron version had to.
enum NotchGeometry {
    struct Info {
        var hasNotch: Bool
        var notchWidth: CGFloat
        var reservedTopHeight: CGFloat // menu bar (+ notch) height to sit flush under
    }

    static func info(for screen: NSScreen = NSScreen.main ?? NSScreen.screens[0]) -> Info {
        let hasNotch = screen.safeAreaInsets.top > 0
        var notchWidth: CGFloat = 200 // reasonable fallback on non-notched Macs
        if let left = screen.auxiliaryTopLeftArea?.width,
           let right = screen.auxiliaryTopRightArea?.width {
            notchWidth = screen.frame.width - left - right
        }
        let reservedTop = hasNotch ? screen.safeAreaInsets.top : NSStatusBar.system.thickness
        return Info(hasNotch: hasNotch, notchWidth: notchWidth, reservedTopHeight: reservedTop)
    }

    /// Top-left origin (AppKit/Cocoa y-up coordinates) to center a window of
    /// `size` horizontally on `screen`, with its *top* edge flush against
    /// the very top of the screen — i.e. occupying the same rows of pixels
    /// as the real menu bar, so our content reads as living in the bar
    /// itself rather than as a pill hanging below it. Growing `size.height`
    /// (compact → expanded) extends the window straight down from that same
    /// fixed top edge.
    static func topCenterOrigin(for size: CGSize, on screen: NSScreen = NSScreen.main ?? NSScreen.screens[0]) -> CGPoint {
        let x = screen.frame.midX - size.width / 2
        let y = screen.frame.maxY - size.height
        return CGPoint(x: x, y: y)
    }

    /// Fixed layout constants shared by the menu-bar chrome and the wedge
    /// fan. Footprint stays tight (a nub, not a dome) but the content
    /// inside it (icons/text/hub) is sized to stay legible.
    enum Layout {
        static let flankWidth: CGFloat = 64        // badge/percentage slot, each side of the notch
        static let fanHeight: CGFloat = 180         // wedge fan + hub area below the bar
        static let fanExtraWidth: CGFloat = 34      // widen beyond notch+flanks so the fan has room to spread
    }

    /// Panel size for the rest (flanking) state — just tall enough for the
    /// menu-bar sliver, wide enough for notch + both flanking slots.
    static func compactSize(for screen: NSScreen = NSScreen.main ?? NSScreen.screens[0]) -> CGSize {
        let i = info(for: screen)
        return CGSize(width: i.notchWidth + Layout.flankWidth * 2, height: i.reservedTopHeight)
    }

    /// Panel size for the expanded state — same horizontal center, grown
    /// downward (and slightly outward if the fan needs more width than the
    /// compact frame already provides) to fit the hub + wedge fan.
    ///
    /// Width is clamped to at least `RingGeometry.width` — the ring's own
    /// layers are chained outward from the hub and can grow (a thicker
    /// layer, a bigger hub, an extra layer), so the panel has to grow with
    /// them or the outermost wedges get hard-clipped at the window edge.
    static func expandedSize(for screen: NSScreen = NSScreen.main ?? NSScreen.screens[0]) -> CGSize {
        let i = info(for: screen)
        let compact = compactSize(for: screen)
        let fanWidth = i.notchWidth + Layout.fanExtraWidth * 2
        let width = max(compact.width, fanWidth, RingGeometry.width)
        let height = i.reservedTopHeight + Layout.fanHeight
        return CGSize(width: width, height: height)
    }

    /// The real hardware notch's rect in the *panel's local* coordinate
    /// space (SwiftUI y-down), for a panel of `panelSize` centered over it.
    static func notchLocalRect(panelSize: CGSize, for screen: NSScreen = NSScreen.main ?? NSScreen.screens[0]) -> CGRect {
        let i = info(for: screen)
        let x = (panelSize.width - i.notchWidth) / 2
        return CGRect(x: x, y: 0, width: i.notchWidth, height: i.reservedTopHeight)
    }
}
