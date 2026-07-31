import SwiftUI
import AppKit

/// Text that follows a circular arc, letter by letter, instead of sitting
/// flat — used for the stat wedge labels (Weekly, Credits, etc.), hugging
/// the wedge's *outer* curve just inside its percent-progress arc.
///
/// Each character is measured individually (via `NSFont`, so the spacing is
/// based on real glyph widths, not a guess) and placed at the angle whose
/// arc length from the string's center matches that character's position in
/// the string, then rotated to stay tangent to the circle.
///
/// Orientation: our wedges only ever occupy the *bottom* half of the circle
/// (the fan hangs below the hub), so "up" for each letter is pointed
/// *inward*, toward the hub — that's what keeps the text reading roughly
/// right-side-up instead of drooping upside-down away from the circle the
/// way outward-facing rim text would at the bottom of an arc.
struct CurvedText: View {
    let text: String
    let radius: CGFloat
    let centerDeg: Double
    let fontSize: CGFloat
    let weight: NSFont.Weight
    let color: Color

    init(text: String, radius: CGFloat, centerDeg: Double, fontSize: CGFloat, weight: NSFont.Weight = .semibold, color: Color) {
        self.text = text
        self.radius = radius
        self.centerDeg = centerDeg
        self.fontSize = fontSize
        self.weight = weight
        self.color = color
    }

    private var nsFont: NSFont { .systemFont(ofSize: fontSize, weight: weight) }

    var body: some View {
        let chars = Array(text).map(String.init)
        let widths = chars.map(charWidth)
        let totalWidth = widths.reduce(0, +)

        ZStack {
            ForEach(Array(chars.enumerated()), id: \.offset) { i, ch in
                let precedingWidth = widths[..<i].reduce(0, +)
                // Arc length = radius * angle(radians), so this character's
                // offset from the string's own center converts to an angle
                // by dividing its arc-length position by the radius.
                let centerOffset = precedingWidth + widths[i] / 2 - totalWidth / 2
                // Our arc's angle *decreases* left-to-right (arcStart is
                // near due-east/right, arcEnd near due-west/left), so
                // reading order (first character = leftmost = larger angle)
                // means later characters need a *smaller* angle — hence the
                // minus sign here. Without it, the string comes out
                // mirrored/reversed.
                let angleRad = (centerDeg * .pi / 180) - centerOffset / radius
                let angleDeg = angleRad * 180 / .pi

                Text(ch)
                    .font(Font(nsFont))
                    .foregroundColor(color)
                    .fixedSize()
                    .rotationEffect(.degrees(angleDeg - 90))
                    .offset(x: radius * CGFloat(cos(angleRad)), y: radius * CGFloat(sin(angleRad)))
            }
        }
    }

    private func charWidth(_ s: String) -> CGFloat {
        (s as NSString).size(withAttributes: [.font: nsFont]).width
    }
}
