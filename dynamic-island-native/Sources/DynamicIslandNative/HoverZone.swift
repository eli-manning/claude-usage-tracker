import AppKit
import SwiftUI

/// A precise, native circular hover zone — bypasses SwiftUI's `.onHover`
/// entirely, which turned out to be unreliable here: a `Button` (or any
/// view with its own gesture recognizer) sitting on top of a plain
/// `.onHover`-only view can "steal" hover for its own bounds instead of
/// letting it reach whatever's just tracking mouse position underneath,
/// and that inconsistency was the source of every hover glitch we hit —
/// hovering the logo not counting, hovering wedges not counting, the hub's
/// own resize-on-hover creating a feedback loop with its own hit region.
///
/// This uses one real `NSTrackingArea` over the zone's bounding box, then
/// does exact point-in-circle math on every `mouseMoved` — so "am I
/// hovering" is answered by pure geometry against a *fixed* radius, once,
/// in one place, with nothing else in the view hierarchy able to interfere
/// with it.
struct HoverCircle: NSViewRepresentable {
    /// Center of the circle, in this view's own local coordinate space
    /// (i.e. relative to its own frame, not the window).
    var center: CGPoint
    var radius: CGFloat
    var onChange: (Bool) -> Void

    func makeNSView(context: Context) -> HoverCircleView {
        let view = HoverCircleView()
        view.center = center
        view.radius = radius
        view.onChange = onChange
        return view
    }

    func updateNSView(_ nsView: HoverCircleView, context: Context) {
        nsView.center = center
        nsView.radius = radius
        nsView.onChange = onChange
    }

    final class HoverCircleView: NSView {
        var center: CGPoint = .zero
        var radius: CGFloat = 0
        var onChange: ((Bool) -> Void)?
        private var isInside = false
        private var trackingArea: NSTrackingArea?

        override var isFlipped: Bool { true } // match SwiftUI's y-down space

        // Purely a hover sensor, not a click target — without this, sitting
        // on top of the hub button and wedge tap gestures (which it has to,
        // to reliably sense hover over all of them) would swallow every
        // click meant for them. `NSTrackingArea` still fires
        // mouseEntered/Exited/Moved independent of this; only the click
        // hit-test chain is affected.
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func updateTrackingAreas() {
            super.updateTrackingAreas()
            if let trackingArea { removeTrackingArea(trackingArea) }
            // `.activeAlways`, not `.activeInKeyWindow` — our panel
            // (`NotchPanel`) is a deliberately non-activating panel that
            // never becomes key (see `PanelController`'s own comment on
            // why), so `.activeInKeyWindow` meant this tracking area was
            // never actually active at all, ever.
            let area = NSTrackingArea(
                rect: bounds,
                options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                owner: self, userInfo: nil
            )
            addTrackingArea(area)
            trackingArea = area
        }

        private func setInside(_ inside: Bool) {
            guard inside != isInside else { return }
            isInside = inside
            onChange?(inside)
        }

        override func mouseMoved(with event: NSEvent) {
            let p = convert(event.locationInWindow, from: nil)
            let dx = p.x - center.x, dy = p.y - center.y
            setInside(sqrt(dx * dx + dy * dy) <= radius)
        }

        override func mouseExited(with event: NSEvent) {
            setInside(false)
        }
    }
}
