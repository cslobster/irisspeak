import SwiftUI
import UIKit

/// Scripted end-to-end run for unattended testing on a device or simulator. Enabled by launching with the
/// environment variable IRIS_SELFTEST=1: walks through a whole conversation with the real UI and view model,
/// logs timings to Documents/irisspeak.log and saves screenshots to Documents/shots/.
enum SelfTest {
    static var enabled: Bool { ProcessInfo.processInfo.environment["IRIS_SELFTEST"] == "1" }
    static var shotsDir: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("shots") }
    nonisolated(unsafe) private static var started = false

    @MainActor static func runIfRequested() {
        guard enabled, !started else { return }
        started = true
        Task { await run() }
    }

    @MainActor static func run() async {
        log("selftest: start")
        try? FileManager.default.removeItem(at: shotsDir)
        try? FileManager.default.createDirectory(at: shotsDir, withIntermediateDirectories: true)
        let router = Router.shared
        let engine = Engine.shared
        let savedProfile = Store.getProfile()
        var p = savedProfile; if p.name.isEmpty { p.name = "Sammy" }; Store.setProfile(p)
        defer { Store.setProfile(savedProfile) }
        await pause(1.0); await shot("01_welcome_loading")
        do { try await engine.load() } catch { log("selftest: FAIL engine load: \(error)"); return }
        await pause(0.5); await shot("02_welcome_ready")

        let sid = await LocalApi.shared.newSession(timezone: TimeZone.current.identifier)
        router.go(.session(sid))
        guard let vm = await waitFor({ SessionViewModel.current }) else { log("selftest: FAIL no session vm"); return }
        _ = await waitFor({ vm.phase == .idle && vm.started ? true : nil })
        await pause(0.5); await shot("03_parent_turn")

        vm.parentMessage = "What do you want for lunch?"
        await pause(0.3); await shot("04_parent_typed")
        var t0 = Date()
        await vm.submitParent()
        log("selftest: parent → cards \(Int(Date().timeIntervalSince(t0) * 1000)) ms; model \(Int(engine.lastRunMs)) ms; reranker=\(engine.rerankerReady)")
        guard let rec = vm.childRec else { log("selftest: FAIL no cards"); return }
        log("selftest: cards = \(rec.cards.map { "\($0.category.rawValue):\($0.displayName)" }.joined(separator: ", "))")
        await pause(0.5); await shot("05_child_cards")

        if let first = rec.cards.first(where: { $0.category == .topic }) {
            t0 = Date(); await vm.onCardClick(first)
            log("selftest: tap '\(first.displayName)' → re-predict \(Int(Date().timeIntervalSince(t0) * 1000)) ms; model \(Int(engine.lastRunMs)) ms")
            log("selftest: next cards = \(vm.childRec?.cards.prefix(9).map { $0.displayName }.joined(separator: ", ") ?? "")")
            await pause(0.4); await shot("06_after_tap")
        }
        if let want = vm.childRec?.cards.first(where: { $0.displayName.lowercased() == "i want" }) {
            await vm.onCardClick(want); await pause(0.3)
        }
        vm.onRefreshCards(); await pause(0.4); await shot("07_refreshed")
        vm.openSearch(); await pause(0.6); await shot("08_search_folders")
        vm.showSearch = false; await pause(0.2)

        t0 = Date(); await vm.onConfirm()
        log("selftest: sentence in \(Int(Date().timeIntervalSince(t0) * 1000)) ms: \(vm.inferredSentence ?? "nil")")
        await pause(0.5); await shot("09_sentence")
        await vm.onAcceptSentence(); await pause(0.5); await shot("10_after_accept")
        vm.showDialogue = true; await pause(0.4); await shot("11_transcript"); vm.showDialogue = false
        vm.showMenu = true; await pause(0.4); await shot("12_menu"); vm.showMenu = false
        vm.onFinishTurn(); await pause(0.4); await shot("13_parent_again")
        await vm.endSession(); await pause(0.8); await shot("14_session_end")
        router.go(.stars); await pause(0.8); await shot("15_stars")
        router.back(); await pause(0.3); router.go(.profile); await pause(0.8); await shot("16_profile")
        router.home(); await pause(0.5); await shot("17_home")
        log("selftest: DONE")
    }

    @MainActor private static func waitFor<T>(_ f: @escaping () -> T?, timeout: Double = 120) async -> T? {
        let start = Date()
        while Date().timeIntervalSince(start) < timeout {
            if let v = f() { return v }
            await pause(0.1)
        }
        return nil
    }

    private static func pause(_ s: Double) async { try? await Task.sleep(nanoseconds: UInt64(s * 1_000_000_000)) }

    @MainActor static func shot(_ name: String) async {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first else { return }
        let r = UIGraphicsImageRenderer(bounds: window.bounds)
        let img = r.image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        if let d = img.pngData() { try? d.write(to: shotsDir.appendingPathComponent(name + ".png")) }
        log("selftest: shot \(name) \(Int(window.bounds.width))x\(Int(window.bounds.height))")
    }
}
