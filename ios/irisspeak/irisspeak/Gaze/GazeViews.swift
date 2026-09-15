import SwiftUI

/// Gaze cursor, hover highlight and dwell ring, drawn over the session screen (never intercepts touches).
struct GazeOverlay: View {
    @ObservedObject var gaze = GazeController.shared

    var body: some View {
        GeometryReader { g in
            let origin = g.frame(in: .global).origin
            ZStack(alignment: .topLeading) {
                if gaze.enabled, let id = gaze.hoverId, let f = gaze.targets[id] {
                    // Highlight the snapped target; the ring in its corner fills with the dwell time.
                    RoundedRectangle(cornerRadius: 18).stroke(Theme.coral, lineWidth: 5)
                        .frame(width: f.width + 10, height: f.height + 10)
                        .offset(x: f.minX - 5 - origin.x, y: f.minY - 5 - origin.y)
                    ZStack {
                        Circle().fill(Color.white).frame(width: 30, height: 30)
                        Circle().stroke(Theme.slate200, lineWidth: 5).frame(width: 24, height: 24)
                        Circle().trim(from: 0, to: gaze.dwellProgress).stroke(Theme.coral, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                            .rotationEffect(.degrees(-90)).frame(width: 24, height: 24)
                    }
                    .offset(x: f.maxX - 20 - origin.x, y: f.minY - 10 - origin.y)
                }
                if gaze.enabled, gaze.settings.showCursor, let p = gaze.point {
                    ZStack {
                        Circle().fill(Theme.teal.opacity(0.35)).frame(width: 34, height: 34)
                        Circle().stroke(Color.white, lineWidth: 2).frame(width: 34, height: 34)
                        Circle().trim(from: 0, to: gaze.dwellProgress).stroke(Theme.coral, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                            .rotationEffect(.degrees(-90)).frame(width: 44, height: 44)
                        Circle().fill(Theme.teal).frame(width: 8, height: 8)
                    }
                    .frame(width: 48, height: 48)
                    .offset(x: p.x - 24 - origin.x, y: p.y - 24 - origin.y)
                }
                if gaze.enabled && (!gaze.tracking || !gaze.calibrated) && !gaze.calibrating {
                    Text(!GazeTracker.isSupported ? "Eye tracking is not supported on this device" : !gaze.tracking ? "👀 Looking for your face…" : "👀 Open ☰ and tap Calibrate to choose cards by looking")
                        .font(.od(FS.sm, bold: true)).foregroundColor(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8).background(Capsule().fill(Color.black.opacity(0.6)))
                        .offset(x: g.size.width / 2 - 120, y: 12)
                }
            }
        }
        .allowsHitTesting(false)
    }
}

/// Five-point calibration: look at each dot while it fills; the affine map is fitted from the averages.
struct GazeCalibrationView: View {
    var onDone: () -> Void
    @ObservedObject var gaze = GazeController.shared
    @State private var step = -1                // -1 intro, 0..<targets.count dots, targets.count = done
    @State private var progress: Double = 0
    @State private var collected: [(raw: CGPoint, screen: CGPoint)] = []
    @State private var samples: [CGPoint] = []
    @State private var stepStart = Date()
    @State private var failed = false

    private let positions: [CGPoint] = [(0.5, 0.5), (0.12, 0.12), (0.88, 0.12), (0.88, 0.88), (0.12, 0.88), (0.5, 0.12), (0.5, 0.88)]
        .map { CGPoint(x: $0.0, y: $0.1) }
    private let settle = 0.8, collect = 1.4

    var body: some View {
        GeometryReader { g in
            ZStack {
                Theme.cream.ignoresSafeArea()
                if step < 0 {
                    VStack(spacing: 20) {
                        Text("👀").font(.system(size: 72))
                        Text("Eye gaze calibration").font(.od(FS.xl3, bold: true)).foregroundColor(Theme.slate800)
                        Text("Hold the iPad still, about an arm's length away.\nLook at each dot until it fills up. It takes about 20 seconds.")
                            .font(.od(FS.lg, bold: true)).foregroundColor(Theme.slate600).multilineTextAlignment(.center).frame(maxWidth: 600)
                        if !gaze.tracking {
                            Text(GazeTracker.isSupported ? "Looking for your face…" : "Eye tracking is not supported on this device")
                                .font(.od(FS.base, bold: true)).foregroundColor(Theme.coral)
                        }
                        HStack(spacing: 16) {
                            PillButton(title: "Cancel", color: Theme.slate500) { finish() }
                            PillButton(title: "Start", color: Theme.teal, enabled: gaze.tracking) { begin() }
                        }
                    }
                    .padding(40)
                } else if step < positions.count {
                    let pos = positions[step]
                    let c = CGPoint(x: pos.x * g.size.width, y: pos.y * g.size.height)
                    ZStack {
                        Circle().stroke(Theme.slate300, lineWidth: 6).frame(width: 64, height: 64)
                        Circle().trim(from: 0, to: progress).stroke(Theme.coral, style: StrokeStyle(lineWidth: 6, lineCap: .round)).rotationEffect(.degrees(-90)).frame(width: 64, height: 64)
                        Circle().fill(Theme.teal).frame(width: 22, height: 22)
                    }
                    .position(c)
                    Text("\(step + 1) / \(positions.count)").font(.od(FS.base, bold: true)).foregroundColor(Theme.slate500).position(x: g.size.width / 2, y: g.size.height - 40)
                } else {
                    VStack(spacing: 20) {
                        Text(failed ? "😕" : "✅").font(.system(size: 72))
                        Text(failed ? "Calibration didn't work" : "Calibration saved").font(.od(FS.xl3, bold: true)).foregroundColor(Theme.slate800)
                        Text(failed ? "Your face wasn't tracked for long enough. Make sure the front camera can see your eyes and try again." : "Look at a card and hold your gaze to choose it. You can change the dwell time in the menu.")
                            .font(.od(FS.lg, bold: true)).foregroundColor(Theme.slate600).multilineTextAlignment(.center).frame(maxWidth: 600)
                        HStack(spacing: 16) {
                            if failed { PillButton(title: "Try again", color: Theme.teal) { step = -1 } }
                            PillButton(title: "Done", color: failed ? Theme.slate500 : Theme.teal) { finish() }
                        }
                    }
                    .padding(40)
                }
            }
            .onAppear { gaze.calibrating = true; GazeTracker.shared.start() }
            .onDisappear { gaze.calibrating = false; gaze.calibrationSampler = nil }
            .onChange(of: step) { _, s in
                if s >= 0 && s < positions.count {
                    let o = g.frame(in: .global).origin
                    startDot(global: CGPoint(x: positions[s].x * g.size.width + o.x, y: positions[s].y * g.size.height + o.y))
                }
            }
        }
    }

    private func begin() { collected = []; failed = false; step = 0 }

    private func startDot(global: CGPoint) {
        samples = []; progress = 0; stepStart = Date()
        gaze.calibrationSampler = { s in
            let t = Date().timeIntervalSince(stepStart)
            progress = min(1, t / (settle + collect))
            if t > settle, !(s.blinkLeft > 0.6 && s.blinkRight > 0.6) { samples.append(s.raw) }
            if t >= settle + collect {
                gaze.calibrationSampler = nil
                if samples.count >= 10 {
                    let m = CGPoint(x: samples.map { $0.x }.reduce(0, +) / CGFloat(samples.count), y: samples.map { $0.y }.reduce(0, +) / CGFloat(samples.count))
                    collected.append((m, global))
                }
                if step + 1 < positions.count { step += 1 } else { fitAndFinish() }
            }
        }
    }

    private func fitAndFinish() {
        if collected.count >= 5, let cal = GazeCalibration.fit(collected) { gaze.saveCalibration(cal); failed = false }
        else { failed = true; log("gaze: calibration failed (\(collected.count) points)") }
        step = positions.count
    }

    private func finish() {
        gaze.calibrationSampler = nil
        if !gaze.settings.enabled { GazeTracker.shared.stop() }
        onDone()
    }
}

/// Gaze section for the session menu: on/off, calibrate, dwell time.
struct GazeMenuSection: View {
    @ObservedObject var gaze = GazeController.shared
    var onCalibrate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("EYE GAZE").font(.od(11, bold: true)).foregroundColor(Theme.slate400).kerning(1)
            HStack(spacing: 8) {
                Toggle(isOn: Binding(get: { gaze.enabled }, set: { gaze.setEnabled($0) })) {
                    Text(GazeTracker.isSupported ? "Choose cards by looking" : "Not supported on this device").font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate600)
                }
                .tint(Theme.teal).disabled(!GazeTracker.isSupported)
            }
            HStack(spacing: 8) {
                Button(action: onCalibrate) {
                    Text(gaze.calibrated ? "Recalibrate" : "Calibrate").font(.od(FS.xs, bold: true)).foregroundColor(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8).background(Capsule().fill(Theme.teal))
                }
                .disabled(!GazeTracker.isSupported)
                Spacer()
                Text("Dwell").font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate500)
                ForEach([1.0, 1.5, 2.0, 3.0], id: \.self) { d in
                    Button(action: { gaze.setDwell(d); gaze.objectWillChange.send() }) {
                        Text(String(format: "%.1fs", d)).font(.od(FS.xs, bold: true))
                            .foregroundColor(gaze.settings.dwellSeconds == d ? .white : Theme.slate600)
                            .padding(.horizontal, 8).padding(.vertical, 6)
                            .background(RoundedRectangle(cornerRadius: 8).fill(gaze.settings.dwellSeconds == d ? Theme.teal : Theme.slate100))
                    }
                }
            }
            if gaze.enabled && !gaze.calibrated {
                Text("Calibrate once before using gaze selection.").font(.od(FS.xs)).foregroundColor(Theme.coral)
            }
        }
    }
}

extension Notification.Name { static let gazeCalibrate = Notification.Name("gazeCalibrate") }
