import SwiftUI

/// Third-party work the app is built on, with the licence terms each one asks for, plus the privacy policy link
/// (App Store guideline 5.1.1: the policy must be reachable inside the app).
struct CreditsScreen: View {
    @EnvironmentObject var router: Router
    private let credits: [(name: String, what: String, by: String, licence: String, url: String)] = [
        ("Mulberry Symbols", "Most of the card pictures and folder covers", "Paxtoncrafts Charitable Trust (Steve Lee)", "CC BY-SA 2.0 UK", "https://mulberrysymbols.org"),
        ("OpenMoji", "Phrase cards and category icons", "HfG Schwäbisch Gmünd and contributors", "CC BY-SA 4.0", "https://openmoji.org"),
        ("OpenDyslexic", "The typeface", "Abbie Gonzalez", "SIL Open Font License 1.1", "https://opendyslexic.org"),
        ("Cboard", "The starting vocabulary lists and folders", "Cboard, an open-source AAC project", "GPL-3.0 (data used with attribution)", "https://www.cboard.io"),
    ]
    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                HStack { Text("Credits").font(.od(FS.xl2, bold: true)).foregroundColor(.black); Spacer(); CloseButton { router.back() } }.padding(.bottom, 8)
                Text("IrisSpeak is built on these open resources. Symbol pictures keep their original licences; the card model and sentence model run on your device.").font(.od(FS.sm)).foregroundColor(Theme.slate500).frame(maxWidth: .infinity, alignment: .leading)
                ForEach(credits, id: \.name) { c in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) { Text(c.name).font(.od(FS.base, bold: true)).foregroundColor(Theme.slate800); Spacer(); Text(c.licence).font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate400) }
                        Text("\(c.what). By \(c.by).").font(.od(FS.sm)).foregroundColor(Theme.slate600)
                        Link(c.url, destination: URL(string: c.url)!).font(.od(FS.xs, bold: true)).foregroundColor(Theme.teal)
                    }
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading).sticker(Color.white, radius: 16)
                }
                HStack(spacing: 12) {
                    Link("Privacy policy", destination: URL(string: "https://irisspeak.com/privacy")!)
                    Link("Terms", destination: URL(string: "https://irisspeak.com/terms")!)
                }
                .font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate500).padding(.top, 12)
            }
            .frame(maxWidth: 672).padding(.horizontal, 32).padding(.top, 88).padding(.bottom, 40).frame(maxWidth: .infinity)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
    }
}
