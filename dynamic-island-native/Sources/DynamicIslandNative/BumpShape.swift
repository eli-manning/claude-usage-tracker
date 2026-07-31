import SwiftUI

/// The fused notch+bump outline — same quad-curve corner technique as
/// Atoll's `components/Notch/NotchShape.swift`, so the corners themselves
/// can animate smoothly (via `animatableData`) independent of the frame
/// size SwiftUI hands to `path(in:)`. The frame's *height* growing from the
/// notch's own height up to notch+bump is driven externally by a normal
/// `.frame(height:)` animation — SwiftUI already interpolates that smoothly
/// and re-invokes `path(in:)` each frame, so the bump reads as growing
/// straight out of the notch's bottom edge with zero seam.
struct BumpShape: Shape {
    private var topCornerRadius: CGFloat
    private var bottomCornerRadius: CGFloat

    init(topCornerRadius: CGFloat, bottomCornerRadius: CGFloat) {
        self.topCornerRadius = topCornerRadius
        self.bottomCornerRadius = bottomCornerRadius
    }

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { .init(topCornerRadius, bottomCornerRadius) }
        set {
            topCornerRadius = newValue.first
            bottomCornerRadius = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()

        path.move(to: CGPoint(x: rect.minX, y: rect.minY))

        path.addQuadCurve(
            to: CGPoint(x: rect.minX + topCornerRadius, y: rect.minY + topCornerRadius),
            control: CGPoint(x: rect.minX + topCornerRadius, y: rect.minY)
        )

        path.addLine(to: CGPoint(x: rect.minX + topCornerRadius, y: rect.maxY - bottomCornerRadius))

        path.addQuadCurve(
            to: CGPoint(x: rect.minX + topCornerRadius + bottomCornerRadius, y: rect.maxY),
            control: CGPoint(x: rect.minX + topCornerRadius, y: rect.maxY)
        )

        path.addLine(to: CGPoint(x: rect.maxX - topCornerRadius - bottomCornerRadius, y: rect.maxY))

        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - topCornerRadius, y: rect.maxY - bottomCornerRadius),
            control: CGPoint(x: rect.maxX - topCornerRadius, y: rect.maxY)
        )

        path.addLine(to: CGPoint(x: rect.maxX - topCornerRadius, y: rect.minY + topCornerRadius))

        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control: CGPoint(x: rect.maxX - topCornerRadius, y: rect.minY)
        )

        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))

        return path
    }
}

/// Shared spring constants. Deliberately quick — this should read as an
/// immediate "pop" (like the real Dynamic Island snapping open), not a slow
/// downward slide.
extension Animation {
    static let islandOpen = Animation.spring(response: 0.3, dampingFraction: 0.72, blendDuration: 0)
    static let islandClose = Animation.spring(response: 0.32, dampingFraction: 0.86, blendDuration: 0)
    static func island(open: Bool) -> Animation { open ? islandOpen : islandClose }
}
