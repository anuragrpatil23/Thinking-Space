import Foundation
import Capacitor

/// Native vault tree walker. The JS-side walk did a recursive readdir plus a
/// per-file Filesystem.stat — every one a WKWebView bridge round trip, so a
/// few thousand vault files meant minutes of serialized bridge traffic on
/// every launch/foreground sync. This plugin enumerates the whole tree in ONE
/// native pass (FileManager.enumerator, ~100–300ms for thousands of files)
/// and returns all entries in a single bridge response — the same shape the
/// Electron main-process walk has always had.
@objc(VaultWalkPlugin)
public class VaultWalkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VaultWalkPlugin"
    public let jsName = "VaultWalk"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "walk", returnType: CAPPluginReturnPromise),
    ]

    @objc func walk(_ call: CAPPluginCall) {
        guard let root = call.getString("root"), !root.isEmpty else {
            call.reject("root is required")
            return
        }
        let extensions = (call.getArray("extensions", String.self) ?? [".md"]).map { $0.lowercased() }
        let excludedDirNames = Set(call.getArray("excludedDirNames", String.self) ?? [])
        let excludedPrefixes = call.getArray("excludedPrefixes", String.self) ?? []

        DispatchQueue.global(qos: .userInitiated).async {
            let fm = FileManager.default
            let rootURL: URL = root.hasPrefix("/")
                ? URL(fileURLWithPath: root, isDirectory: true)
                : fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
                    .appendingPathComponent(root, isDirectory: true)

            let keys: Set<URLResourceKey> = [
                .isDirectoryKey, .fileSizeKey, .contentModificationDateKey, .creationDateKey,
            ]
            // skipsHiddenFiles drops dotfiles/dirs AND iCloud `.….icloud`
            // placeholders — matching the JS walk's `startsWith('.')` skip.
            guard let enumerator = fm.enumerator(
                at: rootURL,
                includingPropertiesForKeys: Array(keys),
                options: [.skipsHiddenFiles]
            ) else {
                call.reject("Cannot enumerate \(root)")
                return
            }

            let rootPath = rootURL.standardizedFileURL.path
            var files: [[String: Any]] = []
            files.reserveCapacity(2048)

            for case let url as URL in enumerator {
                let path = url.standardizedFileURL.path
                guard path.hasPrefix(rootPath + "/") else { continue }
                let rel = String(path.dropFirst(rootPath.count + 1))
                let values = try? url.resourceValues(forKeys: keys)

                if values?.isDirectory == true {
                    let name = url.lastPathComponent
                    if excludedDirNames.contains(name)
                        || excludedPrefixes.contains(where: { rel == $0 || rel.hasPrefix($0 + "/") }) {
                        enumerator.skipDescendants()
                    }
                    continue
                }

                if excludedPrefixes.contains(where: { rel == $0 || rel.hasPrefix($0 + "/") }) { continue }
                let ext = "." + url.pathExtension.lowercased()
                guard extensions.contains(ext) else { continue }

                let mtime = values?.contentModificationDate?.timeIntervalSince1970 ?? 0
                let ctime = values?.creationDate?.timeIntervalSince1970 ?? mtime
                files.append([
                    "path": rel,
                    "size": values?.fileSize ?? 0,
                    "mtime": mtime,
                    "ctime": ctime,
                ])
            }

            call.resolve(["files": files])
        }
    }
}
