import UIKit
import Social
import UniformTypeIdentifiers

/// Share Sheet extension for Lexera Capture.
///
/// Receives shared items (text, URLs, images) from any app,
/// serializes them as JSON, and appends to a pending queue file
/// in the App Group container. The main app processes these on foreground.
///
/// No Rust code runs in the extension — it only writes JSON.
class ShareViewController: SLComposeServiceViewController {

    private let appGroupID = "group.com.lexera.capture"

    override func isContentValid() -> Bool {
        return true
    }

    override func didSelectPost() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            complete()
            return
        }

        let group = DispatchGroup()
        var pendingItems: [[String: Any]] = []

        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments {
                group.enter()

                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
                        defer { group.leave() }
                        guard let url = data as? URL else { return }
                        let entry: [String: Any] = [
                            "type": "url",
                            "url": url.absoluteString,
                            "title": self.contentText ?? url.host ?? "",
                            "timestamp": Date().timeIntervalSince1970
                        ]
                        pendingItems.append(entry)
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
                        defer { group.leave() }
                        guard let text = data as? String else { return }
                        let entry: [String: Any] = [
                            "type": "text",
                            "text": text,
                            "timestamp": Date().timeIntervalSince1970
                        ]
                        pendingItems.append(entry)
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { data, _ in
                        defer { group.leave() }
                        var imageData: Data?
                        if let url = data as? URL {
                            imageData = try? Data(contentsOf: url)
                        } else if let image = data as? UIImage {
                            imageData = image.jpegData(compressionQuality: 0.8)
                        }
                        guard let imgData = imageData else { return }
                        let base64 = imgData.base64EncodedString()
                        let filename = "share_\(Int(Date().timeIntervalSince1970)).jpg"
                        let entry: [String: Any] = [
                            "type": "image",
                            "data": base64,
                            "filename": filename,
                            "timestamp": Date().timeIntervalSince1970
                        ]
                        pendingItems.append(entry)
                    }
                } else {
                    group.leave()
                }
            }
        }

        group.notify(queue: .main) {
            if !pendingItems.isEmpty {
                self.appendToPendingQueue(pendingItems)
            }
            self.complete()
        }
    }

    override func configurationItems() -> [Any]! {
        return []
    }

    // MARK: - Private

    private func appendToPendingQueue(_ newItems: [[String: Any]]) {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        ) else {
            NSLog("[ShareExtension] Cannot access App Group container")
            return
        }

        let dir = containerURL.appendingPathComponent("ShareExtension")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let pendingURL = dir.appendingPathComponent("pending.json")

        // Read existing items
        var existing: [[String: Any]] = []
        if let data = try? Data(contentsOf: pendingURL),
           let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            existing = json
        }

        existing.append(contentsOf: newItems)

        // Write back
        if let data = try? JSONSerialization.data(withJSONObject: existing, options: [.prettyPrinted]) {
            try? data.write(to: pendingURL, options: .atomic)
            NSLog("[ShareExtension] Appended \(newItems.count) items, total \(existing.count)")
        }
    }

    private func complete() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
