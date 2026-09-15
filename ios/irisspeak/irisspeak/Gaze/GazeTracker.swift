import Foundation
import ARKit
import simd

/// Eye-gaze estimation with ARKit face tracking (front camera; any A12+ device, no Face ID needed).
/// For every frame it casts the ray from the eyes through ARKit's `lookAtPoint` and intersects it with the
/// device plane (the camera's own z = 0 plane), giving a raw gaze point in metres in the camera's frame.
/// `GazeCalibration` maps that raw point to screen coordinates.
final class GazeTracker: NSObject, ARSessionDelegate, @unchecked Sendable {
    static let shared = GazeTracker()
    static var isSupported: Bool { ARFaceTrackingConfiguration.isSupported }

    struct Sample { var raw: CGPoint; var blinkLeft: Float; var blinkRight: Float; var time: TimeInterval }

    private let session = ARSession()
    private(set) var running = false
    /// Called on the main thread for every frame with a tracked face.
    var onSample: (Sample) -> Void = { _ in }
    var onTrackingChanged: (Bool) -> Void = { _ in }
    private var tracked = false
    private var lastLog = Date.distantPast

    override private init() { super.init(); session.delegate = self }

    func start() {
        guard !running, GazeTracker.isSupported else { return }
        let config = ARFaceTrackingConfiguration()
        config.isLightEstimationEnabled = false
        config.maximumNumberOfTrackedFaces = 1
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
        running = true
        log("gaze: ARKit face tracking started")
    }

    func stop() {
        guard running else { return }
        session.pause(); running = false
        setTracked(false)
        log("gaze: stopped")
    }

    private func setTracked(_ t: Bool) {
        if t != tracked { tracked = t; DispatchQueue.main.async { self.onTrackingChanged(t) } }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard let face = frame.anchors.compactMap({ $0 as? ARFaceAnchor }).first, face.isTracked else { setTracked(false); return }
        setTracked(true)
        // Eye midpoint and look-at point in face space → world → camera space.
        let eyeMid = (simd_make_float3(face.leftEyeTransform.columns.3) + simd_make_float3(face.rightEyeTransform.columns.3)) / 2
        let eyeW = face.transform * simd_float4(eyeMid, 1)
        let lookW = face.transform * simd_float4(face.lookAtPoint, 1)
        let inv = frame.camera.transform.inverse
        let eyeC = simd_make_float3(inv * eyeW), lookC = simd_make_float3(inv * lookW)
        let dir = lookC - eyeC
        // The face sits in front of the camera (negative z); the device plane is z = 0.
        guard abs(dir.z) > 1e-5 else { return }
        let t = -eyeC.z / dir.z
        guard t > 0 else { return }
        let p = eyeC + t * dir
        let bl = face.blendShapes[.eyeBlinkLeft]?.floatValue ?? 0
        let br = face.blendShapes[.eyeBlinkRight]?.floatValue ?? 0
        let sample = Sample(raw: CGPoint(x: CGFloat(p.x), y: CGFloat(p.y)), blinkLeft: bl, blinkRight: br, time: frame.timestamp)
        if Date().timeIntervalSince(lastLog) > 5 { lastLog = Date(); log(String(format: "gaze: raw=(%.3f, %.3f) m  eye z=%.2f m", p.x, p.y, eyeC.z)) }
        DispatchQueue.main.async { self.onSample(sample) }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        log("gaze: ARKit error \(error.localizedDescription)"); running = false; setTracked(false)
    }
    func sessionWasInterrupted(_ session: ARSession) { setTracked(false) }
}
