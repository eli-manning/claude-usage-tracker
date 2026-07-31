import SwiftUI

/// Minimal SVG path-data ("d" attribute) parser, just enough to render the
/// real brand marks pulled from Simple Icons (M/L/H/V/C/S/Q/T/A/Z, upper and
/// lower case). Paths are authored in a 24x24 viewBox; `size` scales them.
enum SVGPath {
    static func path(_ d: String, size: CGFloat) -> Path {
        var path = Path()
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?
        let scale = size / 24.0

        let tokens = tokenize(d)
        var i = 0
        var lastCommand: Character = " "

        func pt(_ x: Double, _ y: Double) -> CGPoint {
            CGPoint(x: x * scale, y: y * scale)
        }

        while i < tokens.count {
            let tok = tokens[i]
            var cmd: Character
            if let f = tok.first, f.isLetter {
                cmd = f
                i += 1
            } else {
                // Repeated implicit command (same as last), token is a number
                cmd = lastCommand
            }
            let isRelative = cmd.isLowercase
            let upper = Character(cmd.uppercased())

            func nextDouble() -> Double {
                defer { i += 1 }
                return Double(tokens[i]) ?? 0
            }

            switch upper {
            case "M":
                let x = nextDouble(), y = nextDouble()
                let p = isRelative ? CGPoint(x: current.x + x * scale, y: current.y + y * scale) : pt(x, y)
                path.move(to: p)
                current = p; start = p
                lastCommand = isRelative ? "l" : "L" // subsequent coords are implicit lineto
            case "L":
                let x = nextDouble(), y = nextDouble()
                let p = isRelative ? CGPoint(x: current.x + x * scale, y: current.y + y * scale) : pt(x, y)
                path.addLine(to: p)
                current = p
                lastCommand = cmd
            case "H":
                let x = nextDouble()
                let p = isRelative ? CGPoint(x: current.x + x * scale, y: current.y) : CGPoint(x: x * scale, y: current.y)
                path.addLine(to: p)
                current = p
                lastCommand = cmd
            case "V":
                let y = nextDouble()
                let p = isRelative ? CGPoint(x: current.x, y: current.y + y * scale) : CGPoint(x: current.x, y: y * scale)
                path.addLine(to: p)
                current = p
                lastCommand = cmd
            case "C":
                let x1 = nextDouble(), y1 = nextDouble()
                let x2 = nextDouble(), y2 = nextDouble()
                let x = nextDouble(), y = nextDouble()
                let c1 = isRelative ? CGPoint(x: current.x + x1 * scale, y: current.y + y1 * scale) : pt(x1, y1)
                let c2 = isRelative ? CGPoint(x: current.x + x2 * scale, y: current.y + y2 * scale) : pt(x2, y2)
                let p = isRelative ? CGPoint(x: current.x + x * scale, y: current.y + y * scale) : pt(x, y)
                path.addCurve(to: p, control1: c1, control2: c2)
                current = p; lastControl = c2
                lastCommand = cmd
            case "S":
                let x2 = nextDouble(), y2 = nextDouble()
                let x = nextDouble(), y = nextDouble()
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let c2 = isRelative ? CGPoint(x: current.x + x2 * scale, y: current.y + y2 * scale) : pt(x2, y2)
                let p = isRelative ? CGPoint(x: current.x + x * scale, y: current.y + y * scale) : pt(x, y)
                path.addCurve(to: p, control1: c1, control2: c2)
                current = p; lastControl = c2
                lastCommand = cmd
            case "Q":
                let x1 = nextDouble(), y1 = nextDouble()
                let x = nextDouble(), y = nextDouble()
                let c1 = isRelative ? CGPoint(x: current.x + x1 * scale, y: current.y + y1 * scale) : pt(x1, y1)
                let p = isRelative ? CGPoint(x: current.x + x * scale, y: current.y + y * scale) : pt(x, y)
                path.addQuadCurve(to: p, control: c1)
                current = p; lastControl = c1
                lastCommand = cmd
            case "T":
                let x = nextDouble(), y = nextDouble()
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let p = isRelative ? CGPoint(x: current.x + x * scale, y: current.y + y * scale) : pt(x, y)
                path.addQuadCurve(to: p, control: c1)
                current = p; lastControl = c1
                lastCommand = cmd
            case "A":
                let rx = nextDouble(), ry = nextDouble()
                let rot = nextDouble()
                let large = nextDouble()
                let sweep = nextDouble()
                let x = nextDouble(), y = nextDouble()
                let p = isRelative ? CGPoint(x: current.x + x * scale, y: current.y + y * scale) : pt(x, y)
                addArc(&path, from: current, to: p, rx: rx * scale, ry: ry * scale,
                       rotation: rot, largeArc: large != 0, sweep: sweep != 0)
                current = p
                lastCommand = cmd
            case "Z":
                path.closeSubpath()
                current = start
                lastCommand = cmd
            default:
                i += 1
            }
        }
        return path
    }

    /// Splits an SVG path string into command letters and numeric tokens
    /// (numbers may run together like "1.5.5" meaning "1.5 .5", or use
    /// scientific-notation-free signs like "-1-2" meaning "-1 -2").
    private static func tokenize(_ d: String) -> [String] {
        var tokens: [String] = []
        var num = ""
        func flush() {
            if !num.isEmpty { tokens.append(num); num = "" }
        }
        for ch in d {
            if ch.isLetter {
                flush()
                tokens.append(String(ch))
            } else if ch == "," || ch.isWhitespace {
                flush()
            } else if ch == "-" || ch == "+" {
                // New number starts unless this is an exponent sign
                if num.isEmpty || !(num.hasSuffix("e") || num.hasSuffix("E")) {
                    flush()
                }
                num.append(ch)
            } else if ch == "." {
                if num.contains(".") { flush() }
                num.append(ch)
            } else {
                num.append(ch)
            }
        }
        flush()
        return tokens
    }

    /// Converts an SVG elliptical arc to 1-4 cubic beziers via the standard
    /// endpoint-to-center parameterization (SVG spec Appendix F.6). The
    /// previous version bowed a straight line toward a guessed midpoint,
    /// which was visibly wrong for glyphs like Gemini's sparkle and the
    /// Codex hexaflower, where the arcs define most of the silhouette
    /// between the sharp points — inaccurate curvature there is what made
    /// icons read as the wrong shape (a "flower" instead of a crisp star)
    /// rather than just looking slightly rough.
    private static func addArc(_ path: inout Path, from: CGPoint, to: CGPoint, rx rxIn: CGFloat, ry ryIn: CGFloat,
                                rotation rotationDeg: Double, largeArc: Bool, sweep: Bool) {
        var rx = abs(rxIn), ry = abs(ryIn)
        guard rx > 0.0001, ry > 0.0001, from != to else {
            path.addLine(to: to)
            return
        }

        let phi = rotationDeg * .pi / 180
        let cosPhi = CGFloat(cos(phi)), sinPhi = CGFloat(sin(phi))

        // Endpoint -> center parameterization, in the ellipse's own
        // (unrotated, untranslated) coordinate frame.
        let dx2 = (from.x - to.x) / 2, dy2 = (from.y - to.y) / 2
        let x1p = cosPhi * dx2 + sinPhi * dy2
        let y1p = -sinPhi * dx2 + cosPhi * dy2

        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 {
            let s = sqrt(lambda)
            rx *= s; ry *= s
        }

        let sign: CGFloat = (largeArc != sweep) ? 1 : -1
        let num = max(rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, 0)
        let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        let coef = den > 0 ? sign * sqrt(num / den) : 0
        let cxp = coef * (rx * y1p / ry)
        let cyp = coef * (-ry * x1p / rx)

        let cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2

        func vectorAngle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let dot = ux * vx + uy * vy
            let len = max(sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)), 0.0001)
            var ang = acos(max(-1, min(1, dot / len)))
            if (ux * vy - uy * vx) < 0 { ang = -ang }
            return ang
        }

        let ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry
        let vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry
        let theta1 = vectorAngle(1, 0, ux, uy)
        var deltaTheta = vectorAngle(ux, uy, vx, vy)
        if !sweep, deltaTheta > 0 { deltaTheta -= 2 * .pi }
        if sweep, deltaTheta < 0 { deltaTheta += 2 * .pi }

        // Split into segments of at most 90° — the standard bezier
        // approximation only holds up well over that range.
        let segmentCount = max(Int(ceil(abs(deltaTheta) / (.pi / 2))), 1)
        let delta = deltaTheta / CGFloat(segmentCount)

        func ellipsePoint(_ angle: CGFloat) -> CGPoint {
            let x = rx * cos(angle), y = ry * sin(angle)
            return CGPoint(x: cosPhi * x - sinPhi * y + cx, y: sinPhi * x + cosPhi * y + cy)
        }

        var angleStart = theta1
        for _ in 0..<segmentCount {
            let angleEnd = angleStart + delta
            let alpha = tan(delta / 4) * 4.0 / 3.0

            let (cosA1, sinA1) = (cos(angleStart), sin(angleStart))
            let (cosA2, sinA2) = (cos(angleEnd), sin(angleEnd))

            let c1Local = CGPoint(x: cosA1 - alpha * sinA1, y: sinA1 + alpha * cosA1)
            let c2Local = CGPoint(x: cosA2 + alpha * sinA2, y: sinA2 - alpha * cosA2)

            func toWorld(_ p: CGPoint) -> CGPoint {
                let x = rx * p.x, y = ry * p.y
                return CGPoint(x: cosPhi * x - sinPhi * y + cx, y: sinPhi * x + cosPhi * y + cy)
            }

            path.addCurve(to: ellipsePoint(angleEnd), control1: toWorld(c1Local), control2: toWorld(c2Local))
            angleStart = angleEnd
        }
    }
}
