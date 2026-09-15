import SwiftUI

struct WelcomeScreen: View {
    @EnvironmentObject var router: Router
    @EnvironmentObject var uiScale: UiScale
    @EnvironmentObject var engineStatus: Engine.Status
    @State private var starting = false
    @State private var startError: String?
    @State private var childName = Store.getAccount()?.childName ?? Store.getProfile().name

    var body: some View {
        GeometryReader { g in
            // Scale spacing and sizes with the available height so the whole screen (start button included)
            // fits without scrolling in landscape as well as portrait.
            let k = min(1, max(0.6, (g.size.height - 60) / 900), max(0.7, g.size.width / 1000))
            let btn = 200 * k
            ScrollView {
                VStack(spacing: 0) {
                    (Text("Welcome, ").foregroundColor(.black) + Text((childName.isEmpty ? "there" : childName).capitalizedFirst + "!").foregroundColor(Theme.coral))
                        .font(.od(FS.xl7 * k * uiScale.f, bold: true))
                        .lineLimit(1).minimumScaleFactor(0.5)
                        .multilineTextAlignment(.center)
                        .padding(.bottom, 24 * k)
                    Text("Start a conversation").font(.od(FS.xl3 * k * uiScale.f, bold: true)).foregroundColor(Theme.slate800)
                        .padding(.bottom, 90 * k)
                    ZStack(alignment: .top) {
                        Button(action: start) {
                            ZStack {
                                if starting { ProgressView().progressViewStyle(.circular).tint(.white).scaleEffect(2) }
                                else { Image(systemName: "play.fill").font(.system(size: 72 * k)).foregroundColor(.white).offset(x: 6 * k) }
                            }
                            .frame(width: btn, height: btn)
                            .stickerCircle(Theme.teal, border: 4, bottom: 10)
                        }
                        .buttonStyle(ScaleButtonStyle())
                        .disabled(starting).opacity(starting ? 0.6 : 1)
                        ArrowDoodle().stroke(Color.black, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                            .frame(width: 68 * k, height: 86 * k).offset(y: -94 * k)
                    }
                    if !engineStatus.ready {
                        Text(engineStatus.message).font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate500).padding(.top, 16)
                    }
                    if let e = startError ?? engineStatus.error {
                        Text(e).font(.od(FS.base, bold: true)).foregroundColor(Theme.coral).padding(.top, 16)
                    }
                }
                .padding(.horizontal, 32)
                .padding(.top, max(g.size.height * 0.08, 56))
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, minHeight: g.size.height)
            }
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .onAppear { childName = Store.getAccount()?.childName ?? Store.getProfile().name; starting = false }
    }

    private func start() {
        guard !starting else { return }
        starting = true; startError = nil
        Task {
            let sid = await LocalApi.shared.newSession(timezone: TimeZone.current.identifier)
            router.go(.session(sid))
        }
    }
}

/// Playful pointer above the start button: arrow bends left and down into it.
struct ArrowDoodle: Shape {
    func path(in r: CGRect) -> Path {
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: r.minX + x / 78 * r.width, y: r.minY + y / 90 * r.height) }
        var path = Path()
        path.move(to: p(55, 8)); path.addCurve(to: p(18, 76), control1: p(70, 25), control2: p(55, 55))
        path.move(to: p(18, 76)); path.addLine(to: p(34, 73))
        path.move(to: p(18, 76)); path.addLine(to: p(28, 64))
        return path
    }
}
