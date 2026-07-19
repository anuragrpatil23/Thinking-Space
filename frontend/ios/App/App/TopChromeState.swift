import Foundation
import Combine
import CoreGraphics
import UIKit

struct TopChromeTabItem: Identifiable, Decodable, Equatable {
    let id: String
    let label: String
    let active: Bool
}

final class TopChromeState: ObservableObject {
    @Published var title: String = "Thinking Space"
    @Published var isVisible: Bool = true
    @Published var activeNavItemId: String? = nil
    @Published var isTopBarCollapsed: Bool = false

    /// True when the web reports the content under the status bar is dark
    /// (Home's night backdrop, dark app theme). Flips the status-bar glyphs
    /// to light and renders the top scrim in its dark appearance.
    @Published var isTopBarDark: Bool = false
    @Published var isBottomBarCollapsed: Bool = false
    @Published var showSearch: Bool = true
    @Published var showTools: Bool = true
    @Published var toolsBadgeCount: Int = 0
    @Published var canToggleSidebar: Bool = true
    @Published var sidebarToggleActive: Bool = false
    @Published var sidebarToggleLabel: String = "Show Navigation"
    @Published var canToggleHeader: Bool = false
    @Published var headerToggleLabel: String = "Toggle Header"
    @Published var tabs: [TopChromeTabItem] = []

    /// Live thumbnails for the Safari-style tab grid, keyed by tab id.
    /// Captured from the WKWebView right before the switcher presents, so
    /// each tab accumulates a real snapshot as the user visits it. Purely
    /// in-memory — closed tabs are pruned at capture time.
    @Published var tabSnapshots: [String: UIImage] = [:]
    @Published var isBottomBarHidden: Bool = false
    @Published var canRefresh: Bool = true
    @Published var canSync: Bool = true
    @Published var canRebuild: Bool = true
    @Published var canGitCommit: Bool = false
    @Published var canGitPush: Bool = false
    @Published var drawerProgress: CGFloat = 0

    /// User-configured label for the Webull workspace tab. Sourced from the
    /// React side (see App.tsx webullTabLabel state, persisted in preferences).
    /// Defaults to "Webull"; React pushes the user's actual value on mount.
    @Published var webullTabLabel: String = "Webull"

    /// True when the native push-navigation stack has more than one entry
    /// — i.e., the user has drilled into content and a back action is
    /// meaningful. Drives the morph from hamburger → chevron-back on the
    /// bottom chrome's drawer toggle button.
    @Published var canGoBack: Bool = false

    /// iPad landscape runs the web app in desktop layout, where the React
    /// nav rail is visible — the native drawer (and its hamburger) would be
    /// a redundant second nav, so both hide. Set by RootShellViewController
    /// from view bounds on every layout pass; always false on iPhone.
    @Published var isPadLandscape: Bool = false
}
