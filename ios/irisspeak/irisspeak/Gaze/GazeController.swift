import SwiftUI
import Combine
import simd

/// Affine map from the tracker's raw camera-plane point (metres) to screen points, fitted by least squares
/// from calibration samples. Stored per orientation because the camera sits on one edge of the iPad.
struct GazeCalibration: Codable, Equatable {
    var ax: [Double] = [0, 0, 0]   // x = ax·[rx, ry, 1]
    var ay: [Double] = [0, 0, 0]
    var fitted = false

    func map(_ raw: CGPoint) -> CGPoint {
        let v = [Double(raw.x), Double(raw.y), 1.0]
        return CGPoint(x: ax[0] * v[0] + ax[1] * v[1] + ax[2], y: ay[0] * v[0] + ay[1] * v[1] + ay[2])
    }

    /// Fit from (raw, screen) pairs; needs at least 3 non-collinear points.
    static func fit(_ pairs: [(raw: CGPoint, screen: CGPoint)]) -> GazeCalibration? {
        guard pairs.count >= 3 else { return nil }
        var ata = simd_double3x3(0); var atx = simd_double3(0); var aty = simd_double3(0)
        for p in pairs {
            let v = simd_double3(Double(p.raw.x), Double(p.raw.y), 1)
            ata += simd_double3x3(rows: [v * v.x, v * v.y, v * v.z])
            atx += v * Double(p.screen.x); aty += v * Double(p.screen.y)
        }
        guard abs(ata.determinant) > 1e-12 else { return nil }
        let inv = ata.inverse
        let sx = inv * atx, sy = inv * aty
        return GazeCalibration(ax: [sx.x, sx.y, sx.z], ay: [sy.x, sy.y, sy.z], fitted: true)
    }
}

struct GazeSettings: Codable, Equatable {
    var enabled = false
    var dwellSeconds: Double = 2.0
    var showCursor = false
    var calibrations: [String: GazeCalibration] = [:]   // keyed by "landscape" / "portrait"
}

extension Store {
    static func getGaze() -> GazeSettings { get("gaze", GazeSettings()) }
    static func setGaze(_ g: GazeSettings) { set("gaze", g) }
}

/// Screen frames of everything the gaze can select, collected through a SwiftUI preference.
struct GazeTargetsKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) { value.merge(nextValue()) { $1 } }
}

/// Actions for the targets (closures can't travel through preferences).
@MainActor enum GazeRegistry {
    static var actions: [String: () -> Void] = [:]
}

struct GazeTargetModifier: ViewModifier {
    var id: String
    var action: () -> Void
    func body(content: Content) -> some View {
        content
            .background(GeometryReader { g in Color.clear.preference(key: GazeTargetsKey.self, value: [id: g.frame(in: .global)]) })
            .onAppear { GazeRegistry.actions[id] = action }
            .onDisappear { GazeRegistry.actions[id] = nil }
    }
}

extension View {
    /// Marks a control as selectable by eye gaze (dwell); `id` must be unique on screen.
    func gazeTarget(_ id: String, action: @escaping () -> Void) -> some View { modifier(GazeTargetModifier(id: id, action: action)) }
}

/// Turns tracker samples into a smoothed on-screen cursor, hover highlight and dwell selection.
@MainActor
final class GazeController: ObservableObject {
    static let shared = GazeController()

    @Published var enabled = false
    @Published var tracking = false
    @Published var calibrated = false
    @Published var point: CGPoint? = nil
    @Published var hoverId: String? = nil
    @Published var dwellProgress: Double = 0
    @Published var calibrating = false
    var targets: [String: CGRect] = [:]
    var settings = Store.getGaze()
    /// Set by the session screen: no selection while a modal is open; only "sentence:*" targets while the
    /// sentence overlay is up.
    var suspended = false
    var idFilter: ((String) -> Bool)? = nil
    private var cooldownUntil: TimeInterval = 0
    var calibrationSampler: ((GazeTracker.Sample) -> Void)? = nil

    private var smoothed: CGPoint? = nil
    private var hoverStart: TimeInterval = 0
    private var firedId: String? = nil
    private var lastSampleTime: TimeInterval = 0
    private var lastSeen = Date.distantPast
    private var orientationKey: String { UIScreen.main.bounds.width > UIScreen.main.bounds.height ? "landscape" : "portrait" }

    private init() {
        settings = Store.getGaze()
        // Longer default dwell (2 s) so a glance across the board never picks a card by accident.
        if !UserDefaults.standard.bool(forKey: "irisspeak_app_gaze_dwell_v2") {
            settings.dwellSeconds = 2.0; Store.setGaze(settings); UserDefaults.standard.set(true, forKey: "irisspeak_app_gaze_dwell_v2")
        }
        GazeTracker.shared.onSample = { [weak self] s in self?.handle(s) }
        GazeTracker.shared.onTrackingChanged = { [weak self] t in self?.tracking = t; if !t { self?.point = nil; self?.hoverId = nil; self?.dwellProgress = 0 } }
    }

    var currentCalibration: GazeCalibration? { settings.calibrations[orientationKey].flatMap { $0.fitted ? $0 : nil } }

    func setEnabled(_ on: Bool) {
        settings.enabled = on; Store.setGaze(settings); enabled = on
        calibrated = currentCalibration != nil
        if on {
            GazeTracker.shared.start()
            // First use: go straight into calibration, otherwise nothing can be selected.
            if !calibrated { DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { NotificationCenter.default.post(name: .gazeCalibrate, object: nil) } }
        } else { GazeTracker.shared.stop(); point = nil; hoverId = nil; dwellProgress = 0 }
    }

    /// Rough metres→points map used only to show a moving cursor before calibration (camera on the top edge).
    private func defaultMap(_ raw: CGPoint) -> CGPoint {
        let b = UIScreen.main.bounds
        let ppm: CGFloat = 3000
        return CGPoint(x: b.width / 2 + raw.x * ppm, y: b.height * 0.1 - raw.y * ppm)
    }

    /// Call when a session screen appears / disappears. The app always starts in tap mode: eye gaze is switched on
    /// from the session menu for the current run only (the calibration is remembered, the on/off state is not).
    func activate() { if enabled { calibrated = currentCalibration != nil; GazeTracker.shared.start() } }
    func deactivate() { GazeTracker.shared.stop(); point = nil; hoverId = nil }

    func saveCalibration(_ c: GazeCalibration) {
        settings.calibrations[orientationKey] = c; Store.setGaze(settings); calibrated = true
        log("gaze: calibration saved for \(orientationKey): ax=\(c.ax) ay=\(c.ay)")
    }

    func setDwell(_ s: Double) { settings.dwellSeconds = s; Store.setGaze(settings) }

    private func handle(_ s: GazeTracker.Sample) {
        if let sampler = calibrationSampler { sampler(s); return }
        guard enabled else { return }
        let mapped = currentCalibration?.map(s.raw) ?? defaultMap(s.raw)
        // Exponential smoothing; a blink freezes the cursor (eyes closed give garbage).
        let blinking = s.blinkLeft > 0.6 && s.blinkRight > 0.6
        if !blinking {
            let a: CGFloat = 0.25
            smoothed = smoothed.map { CGPoint(x: $0.x + a * (mapped.x - $0.x), y: $0.y + a * (mapped.y - $0.y)) } ?? mapped
        }
        guard let p = smoothed else { return }
        let b = UIScreen.main.bounds
        point = CGPoint(x: min(max(p.x, 0), b.width), y: min(max(p.y, 0), b.height))
        if calibrated { updateDwell(at: point!, time: s.time) } else { hoverId = nil; dwellProgress = 0 }
    }

    private func updateDwell(at p: CGPoint, time: TimeInterval) {
        // Snap to the closest target: distance from the gaze point to the target's rectangle (0 when inside),
        // so the nearest card is always highlighted and no precise pointing is needed.
        if suspended || time < cooldownUntil { hoverId = nil; dwellProgress = 0; return }
        var best: (String, CGFloat)? = nil
        for (id, f) in targets where GazeRegistry.actions[id] != nil && (idFilter?(id) ?? true) {
            let dx = max(f.minX - p.x, 0, p.x - f.maxX), dy = max(f.minY - p.y, 0, p.y - f.maxY)
            let d = hypot(dx, dy)
            if best == nil || d < best!.1 { best = (id, d) }
        }
        // Ignore gazes far away from everything (e.g. off the board).
        let id = (best != nil && best!.1 <= 160) ? best!.0 : nil
        if id != hoverId {
            hoverId = id; hoverStart = time; dwellProgress = 0
            if id == nil || id != firedId { firedId = nil }
            return
        }
        guard let h = id, h != firedId else { dwellProgress = 0; return }
        let dwell = max(0.3, settings.dwellSeconds)
        dwellProgress = min(1, (time - hoverStart) / dwell)
        if dwellProgress >= 1 {
            firedId = h; dwellProgress = 0
            cooldownUntil = time + 0.9   // the grid changes after a pick; don't let the new card under the eye fire at once
            log("gaze: select \(h)")
            GazeRegistry.actions[h]?()
        }
    }
}
