import SwiftUI
import PhotosUI

/// Same as irisspeak.com's Vocabulary screen: parent-added custom words with an emoji or a photo, stored on the
/// shared account. Here they also become searchable cards and reranker favourites on this device.
struct VocabularyScreen: View {
    @EnvironmentObject var router: Router
    @State private var words: [CustomWord] = []
    @State private var loading = true
    @State private var word = ""
    @State private var category = "topic"
    @State private var emoji = ""
    @State private var photo: PhotosPickerItem?
    @State private var imageData: String?
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                HStack { Text("Vocabulary").font(.od(FS.xl2, bold: true)).foregroundColor(.black); Spacer(); CloseButton { router.back() } }.padding(.bottom, 8)
                Text("Add words that aren't in the app yet — like a friend's name, pet, or school — so your child can use them.").font(.od(FS.sm)).foregroundColor(Theme.slate500).frame(maxWidth: .infinity, alignment: .leading)
                VStack(spacing: 12) {
                    TextField("Word (e.g. a friend's name)", text: $word).font(.od(FS.sm)).padding(.horizontal, 12).padding(.vertical, 10).background(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
                    HStack(spacing: 8) {
                        Picker("Category", selection: $category) { Text("Thing (topic)").tag("topic"); Text("Doing (action)").tag("action") }.pickerStyle(.menu).tint(Theme.slate800)
                            .padding(.horizontal, 8).background(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
                        TextField("Emoji (optional)", text: $emoji).font(.od(FS.sm)).frame(width: 150).padding(.horizontal, 12).padding(.vertical, 10)
                            .background(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2)).disabled(imageData != nil).opacity(imageData != nil ? 0.5 : 1)
                            .onChange(of: emoji) { _, v in if v.count > 4 { emoji = String(v.prefix(4)) } }
                    }
                    HStack(spacing: 12) {
                        PhotosPicker(selection: $photo, matching: .images) {
                            Text(imageData == nil ? "Choose photo" : "Change photo").font(.od(FS.xs, bold: true)).foregroundColor(Theme.slate600).padding(.horizontal, 12).padding(.vertical, 8).background(RoundedRectangle(cornerRadius: 10).fill(Theme.slate100))
                        }
                        if let d = imageData, let ui = UIImage(data: Data(base64Encoded: d) ?? Data()) {
                            Image(uiImage: ui).resizable().scaledToFill().frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.slate200))
                            Button("Remove") { imageData = nil; photo = nil }.font(.od(FS.xs, bold: true)).foregroundColor(Theme.coral)
                        }
                        Spacer()
                    }
                    Button(action: add) {
                        Text(saving ? "Adding…" : "Add word").font(.od(FS.sm, bold: true)).foregroundColor(.white).frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.teal))
                    }
                    .buttonStyle(ScaleButtonStyle()).disabled(saving || word.trimmingCharacters(in: .whitespaces).isEmpty).opacity(saving || word.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)
                    if let e = error { Text(e).font(.od(FS.xs, bold: true)).foregroundColor(Theme.coral) }
                }
                .padding(16).sticker(Color.white, radius: 16)
                if loading { Text("Loading…").font(.od(FS.base)).foregroundColor(Theme.slate400).padding(.vertical, 32) }
                else if words.isEmpty { Text("No custom words yet.").font(.od(FS.base)).foregroundColor(Theme.slate500).padding(.vertical, 32) }
                else {
                    VStack(spacing: 8) {
                        ForEach(words) { w in
                            HStack(spacing: 12) {
                                if let d = w.imageData, let ui = UIImage(data: Data(base64Encoded: d.replacingOccurrences(of: "data:image/png;base64,", with: "")) ?? Data()) {
                                    Image(uiImage: ui).resizable().scaledToFill().frame(width: 32, height: 32).clipShape(RoundedRectangle(cornerRadius: 8))
                                } else { Text(w.emoji ?? "❓").font(.system(size: 22)) }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(w.word).font(.od(FS.sm, bold: true)).foregroundColor(Theme.slate800)
                                    Text(w.category).font(.od(FS.xs)).foregroundColor(Theme.slate400)
                                }
                                Spacer()
                                Button("Remove") { remove(w) }.font(.od(FS.xs, bold: true)).foregroundColor(Theme.coral)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 12).background(RoundedRectangle(cornerRadius: 12).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.slate200, lineWidth: 2))
                        }
                    }
                }
            }
            .frame(maxWidth: 672).padding(.horizontal, 32).padding(.top, 88).padding(.bottom, 40).frame(maxWidth: .infinity)
        }
        .background(Theme.cream.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .onAppear(perform: load)
        .onChange(of: photo) { _, item in
            guard let item = item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let ui = UIImage(data: data) {
                    let side: CGFloat = 256; let scale = min(1, side / max(ui.size.width, ui.size.height))
                    let sz = CGSize(width: ui.size.width * scale, height: ui.size.height * scale)
                    let small = UIGraphicsImageRenderer(size: sz).image { _ in ui.draw(in: CGRect(origin: .zero, size: sz)) }
                    imageData = small.pngData()?.base64EncodedString(); emoji = ""
                }
            }
        }
    }

    private func load() {
        loading = true
        Task {
            do { words = try await RemoteApi.listCustomWords() } catch { self.error = "Could not load vocabulary." }
            loading = false
            _ = try? await RemoteApi.syncCustomWords()
        }
    }
    private func add() {
        let w = word.trimmingCharacters(in: .whitespaces); guard !w.isEmpty else { return }
        saving = true; error = nil
        Task {
            do {
                _ = try await RemoteApi.addVocabularyWord(word: w, category: category, imageData: imageData, emoji: imageData != nil ? nil : (emoji.isEmpty ? nil : emoji))
                word = ""; emoji = ""; imageData = nil; photo = nil; load()
            } catch { self.error = "Could not add word." }
            saving = false
        }
    }
    private func remove(_ w: CustomWord) {
        words.removeAll { $0.id == w.id }
        Task { do { try await RemoteApi.deleteVocabularyWord(id: w.id); _ = try? await RemoteApi.syncCustomWords() } catch { load() } }
    }
}
