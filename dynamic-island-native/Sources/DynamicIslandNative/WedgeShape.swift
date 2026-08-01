import SwiftUI

/// Same polar wedge geometry as the Electron prototype's `wedgePath()` — a
/// ring segment between two radii and two angles (degrees, 0=east, clockwise
/// since SwiftUI's Path space is y-down here too).
struct WedgeShape: Shape {
    var cx: CGFloat
    var cy: CGFloat
    var rInner: CGFloat
    var rOuter: CGFloat
    var startDeg: Double
    var endDeg: Double

    /// `cx`/`cy`/`rInner` are fixed per ring layer; `startDeg`/`endDeg`
    /// (which wedge occupies which angle) and `rOuter` (selected vs. not)
    /// are what actually change between renders — e.g. when the stat wheel
    /// rotates a new wedge to center. Without this, the pie-slice geometry
    /// would just snap between frames instead of sweeping smoothly, even
    /// though the `.position()`-based content around it animates fine.
    var animatableData: AnimatablePair<AnimatablePair<Double, Double>, CGFloat> {
        get { AnimatablePair(AnimatablePair(startDeg, endDeg), rOuter) }
        set {
            startDeg = newValue.first.first
            endDeg = newValue.first.second
            rOuter = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        func pt(_ r: CGFloat, _ deg: Double) -> CGPoint {
            let rad = deg * .pi / 180
            return CGPoint(x: cx + r * cos(rad), y: cy + r * sin(rad))
        }
        var path = Path()
        path.move(to: pt(rInner, startDeg))
        path.addLine(to: pt(rOuter, startDeg))
        path.addArc(center: CGPoint(x: cx, y: cy), radius: rOuter,
                    startAngle: .degrees(startDeg), endAngle: .degrees(endDeg), clockwise: false)
        path.addLine(to: pt(rInner, endDeg))
        path.addArc(center: CGPoint(x: cx, y: cy), radius: rInner,
                    startAngle: .degrees(endDeg), endAngle: .degrees(startDeg), clockwise: true)
        path.closeSubpath()
        return path
    }
}

/// A simple stroked arc — used to trace the percentage line along a
/// bubble's outer border.
struct ArcShape: Shape {
    var cx: CGFloat
    var cy: CGFloat
    var r: CGFloat
    var startDeg: Double
    var endDeg: Double

    var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(startDeg, endDeg) }
        set { (startDeg, endDeg) = (newValue.first, newValue.second) }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.addArc(center: CGPoint(x: cx, y: cy), radius: r,
                    startAngle: .degrees(startDeg), endAngle: .degrees(endDeg), clockwise: false)
        return path
    }
}

/// Neon glow for a shape's stroke — a sharp core stroke plus a wider,
/// blurred copy of the same stroke underneath. Adapted from Atoll's
/// `glow()` helper (animations/HelloAnimation.swift).
extension Shape {
    func glow(color: Color, lineWidth: Double, blurRadius: Double = 8) -> some View {
        self
            .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            .overlay(
                self
                    .stroke(color, style: StrokeStyle(lineWidth: lineWidth * 2.2, lineCap: .round))
                    .blur(radius: blurRadius)
            )
    }
}

/// Soft radial aura behind an icon/badge — adapted from Atoll's
/// PrivacyIndicatorIcon glow.
struct IconAura: View {
    var color: Color
    var size: CGFloat

    var body: some View {
        Circle()
            .fill(RadialGradient(colors: [color.opacity(0.4), color.opacity(0.14), .clear],
                                  center: .center, startRadius: 0, endRadius: size / 2))
            .frame(width: size, height: size)
            .blendMode(.plusLighter)
    }
}

extension CGPoint {
    static func onArc(cx: CGFloat, cy: CGFloat, r: CGFloat, deg: Double) -> CGPoint {
        let rad = deg * .pi / 180
        return CGPoint(x: cx + r * cos(rad), y: cy + r * sin(rad))
    }
}
