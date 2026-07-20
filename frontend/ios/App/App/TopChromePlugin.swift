import Foundation
import Capacitor

@objc(TopChromePlugin)
public class TopChromePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TopChromePlugin"
    public let jsName = "TopChrome"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushNavigation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "popNavigation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "didCommitNavigation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNavigationStack", returnType: CAPPluginReturnPromise),
    ]

    var chromeState: TopChromeState?

    // MARK: - Native push navigation bridge

    /// Forwarded to RootShellViewController to drive PushNavigationCoordinator.
    var onPushRequest: ((String) -> Void)?
    var onPopRequest: (() -> Void)?
    var onSetNavigationStack: (([String]) -> Void)?

    /// Pending completion stored between `requestRender` (Swift→React event)
    /// and `didCommitNavigation` (React→Swift call). Cleared on commit.
    /// Tuple: (expected path, completion to fire).
    private var pendingNavCommit: (path: String, completion: () -> Void)?

    @objc func setState(_ call: CAPPluginCall) {
        let title = call.getString("title")
        let isVisible = call.getBool("visible")
        let activeNavItemId = call.getString("activeNavItemId")
        let topBarCollapsed = call.getBool("topBarCollapsed")
        let topBarDark = call.getBool("topBarDark")
        let bottomBarCollapsed = call.getBool("bottomBarCollapsed")
        let showSearch = call.getBool("showSearch")
        let showTools = call.getBool("showTools")
        let toolsBadgeCount = call.getInt("toolsBadgeCount")
        let canToggleSidebar = call.getBool("canToggleSidebar")
        let sidebarToggleActive = call.getBool("sidebarToggleActive")
        let sidebarToggleLabel = call.getString("sidebarToggleLabel")
        let canToggleHeader = call.getBool("canToggleHeader")
        let headerToggleLabel = call.getString("headerToggleLabel")
        let tabsPayload = call.getString("tabsPayload")
        let bottomBarHidden = call.getBool("bottomBarHidden")
        let canRefresh = call.getBool("canRefresh")
        let syncActive = call.getBool("syncActive")
        let syncCompleted = call.getInt("syncCompleted")
        let syncTotal = call.getInt("syncTotal")
        let canSync = call.getBool("canSync")
        let canRebuild = call.getBool("canRebuild")
        let canGitCommit = call.getBool("canGitCommit")
        let canGitPush = call.getBool("canGitPush")
        let webullTabLabel = call.getString("webullTabLabel")
        let webullTabIconText = call.getString("webullTabIconText")

        DispatchQueue.main.async {
            guard let state = self.chromeState else {
                call.resolve()
                return
            }

            if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                state.title = title
            }
            if let isVisible {
                state.isVisible = isVisible
            }
            if call.options.keys.contains("activeNavItemId") {
                state.activeNavItemId = activeNavItemId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                    ? activeNavItemId
                    : nil
            }
            if let topBarCollapsed {
                state.isTopBarCollapsed = topBarCollapsed
            }
            if let topBarDark {
                state.isTopBarDark = topBarDark
            }
            if let bottomBarCollapsed {
                state.isBottomBarCollapsed = bottomBarCollapsed
            }
            if let showSearch {
                state.showSearch = showSearch
            }
            if let showTools {
                state.showTools = showTools
            }
            if let toolsBadgeCount {
                state.toolsBadgeCount = max(0, toolsBadgeCount)
            }
            if let canToggleSidebar {
                state.canToggleSidebar = canToggleSidebar
            }
            if let sidebarToggleActive {
                state.sidebarToggleActive = sidebarToggleActive
            }
            if let sidebarToggleLabel, !sidebarToggleLabel.isEmpty {
                state.sidebarToggleLabel = sidebarToggleLabel
            }
            if let canToggleHeader {
                state.canToggleHeader = canToggleHeader
            }
            if let headerToggleLabel, !headerToggleLabel.isEmpty {
                state.headerToggleLabel = headerToggleLabel
            }
            if let tabsPayload {
                state.tabs = self.decodeTabs(from: tabsPayload)
            }
            if let bottomBarHidden {
                state.isBottomBarHidden = bottomBarHidden
            }
            if let canRefresh {
                state.canRefresh = canRefresh
            }
            if let syncActive {
                state.syncActive = syncActive
            }
            if let syncCompleted {
                state.syncCompleted = max(0, syncCompleted)
            }
            if let syncTotal {
                state.syncTotal = max(0, syncTotal)
            }
            if let canSync {
                state.canSync = canSync
            }
            if let canRebuild {
                state.canRebuild = canRebuild
            }
            if let canGitCommit {
                state.canGitCommit = canGitCommit
            }
            if let canGitPush {
                state.canGitPush = canGitPush
            }
            if let webullTabLabel,
               !webullTabLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                state.webullTabLabel = webullTabLabel
            }
            // Unlike the label, empty is meaningful here: it clears the text
            // glyph so the icon falls back to the Webull-horns mark.
            if let webullTabIconText {
                state.webullTabIconText = webullTabIconText
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }

            call.resolve()
        }
    }

    @objc func show(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.chromeState?.isVisible = true
            call.resolve()
        }
    }

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.chromeState?.isVisible = false
            call.resolve()
        }
    }

    func emitMenuTap() {
        notifyListeners("topChromeMenuTap", data: [:])
    }

    func emitSearchTap() {
        notifyListeners("topChromeSearchTap", data: [:])
    }

    func emitOpenDebugTap() {
        notifyListeners("topChromeOpenDebugTap", data: [:])
    }

    func emitRefreshTap() {
        notifyListeners("topChromeRefreshTap", data: [:])
    }

    func emitSyncTap() {
        notifyListeners("topChromeSyncTap", data: [:])
    }

    func emitRebuildTap() {
        notifyListeners("topChromeRebuildTap", data: [:])
    }

    func emitGitCommitTap() {
        notifyListeners("topChromeGitCommitTap", data: [:])
    }

    func emitGitPushTap() {
        notifyListeners("topChromeGitPushTap", data: [:])
    }

    func emitHeaderToggleTap() {
        notifyListeners("topChromeHeaderToggleTap", data: [:])
    }

    func emitSidebarToggleTap() {
        notifyListeners("topChromeSidebarToggleTap", data: [:])
    }

    func emitCreateTap() {
        notifyListeners("topChromeCreateTap", data: [:])
    }

    func emitExpandBottomTap() {
        notifyListeners("topChromeExpandBottomTap", data: [:])
    }

    func emitSelectTab(tabId: String) {
        notifyListeners("topChromeSelectTab", data: ["tabId": tabId])
    }

    func emitCloseTab(tabId: String) {
        notifyListeners("topChromeCloseTab", data: ["tabId": tabId])
    }

    func emitNavItemTap(navItemId: String) {
        notifyListeners("topChromeNavItemTap", data: ["navItemId": navItemId])
    }

    // MARK: - Navigation: Swift → React events (emitted by bridge conformance)

    private func emitNavRequestRender(path: String, direction: String) {
        notifyListeners("topChromeNavRequestRender", data: ["path": path, "direction": direction])
    }

    private func emitNavDidFinish(path: String) {
        notifyListeners("topChromeNavDidFinish", data: ["path": path])
    }

    // MARK: - Navigation: React → Swift entry points

    @objc func pushNavigation(_ call: CAPPluginCall) {
        guard let path = call.getString("path"),
              !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("path is required")
            return
        }
        DispatchQueue.main.async {
            self.onPushRequest?(path)
            call.resolve()
        }
    }

    @objc func popNavigation(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.onPopRequest?()
            call.resolve()
        }
    }

    @objc func didCommitNavigation(_ call: CAPPluginCall) {
        let path = call.getString("path")
        DispatchQueue.main.async {
            guard let pending = self.pendingNavCommit else {
                NSLog("[TopChromePlugin] didCommitNavigation but no pending commit (path=%@)", path ?? "<nil>")
                call.resolve()
                return
            }
            if let path, path != pending.path {
                NSLog("[TopChromePlugin] didCommitNavigation path mismatch: got %@, expected %@", path, pending.path)
                // Fire anyway — the coordinator's isAnimating flag prevents
                // races, so mismatch here means a stale event we should drop.
                call.resolve()
                return
            }
            self.pendingNavCommit = nil
            pending.completion()
            call.resolve()
        }
    }

    @objc func setNavigationStack(_ call: CAPPluginCall) {
        guard let stack = call.getArray("stack") as? [String] else {
            call.reject("stack is required (array of paths)")
            return
        }
        DispatchQueue.main.async {
            self.onSetNavigationStack?(stack)
            call.resolve()
        }
    }

    // Note: `decodeTabs` follows. The PushNavigationBridge conformance lives
    // in an extension at the bottom of this file so the class body stays
    // focused on Capacitor surface area.

    private func decodeTabs(from payload: String) -> [TopChromeTabItem] {
        guard let data = payload.data(using: .utf8) else {
            return []
        }

        do {
            return try JSONDecoder().decode([TopChromeTabItem].self, from: data)
        } catch {
            NSLog("[TopChromePlugin] Failed to decode tabs payload: %@", error.localizedDescription)
            return []
        }
    }
}

// MARK: - PushNavigationBridge conformance

extension TopChromePlugin: PushNavigationBridge {
    func requestRender(path: String, direction: PushNavigationDirection, completion: @escaping () -> Void) {
        DispatchQueue.main.async {
            if self.pendingNavCommit != nil {
                NSLog("[TopChromePlugin] requestRender %@ while another commit pending — replacing", path)
            }
            self.pendingNavCommit = (path: path, completion: completion)
            self.emitNavRequestRender(path: path, direction: direction.rawValue)
        }
    }

    func notifyDidFinish(path: String) {
        DispatchQueue.main.async {
            self.emitNavDidFinish(path: path)
        }
    }
}
