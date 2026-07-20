import UIKit
import SwiftUI
import Combine
import WebKit

final class RootShellViewController: UIViewController {
    private let shellBackgroundColor = UIColor.systemBackground

    /// The app theme is mostly light warm-beige, but some surfaces run a dark
    /// backdrop under the status bar (Home's night time-of-day canvas, dark
    /// app theme). The web reports that via TopChrome.setState(topBarDark) →
    /// chromeState.isTopBarDark, and the glyphs flip to stay legible.
    override var preferredStatusBarStyle: UIStatusBarStyle {
        chromeState.isTopBarDark ? .lightContent : .darkContent
    }

    private let bridgeVC = LTMBridgeViewController()
    let chromeState = TopChromeState()
    private var chromePlugin: TopChromePlugin?
    private var chromeVisibilityCancellable: AnyCancellable?
    private var bottomBarVisibilityCancellable: AnyCancellable?
    private var bottomBarLayoutCancellable: AnyCancellable?
    private var activeNavItemCancellable: AnyCancellable?
    private var webullLabelCancellable: AnyCancellable?
    private var webullIconCancellable: AnyCancellable?
    private var topBarDarkCancellable: AnyCancellable?
    private var bottomChromeHeightConstraint: NSLayoutConstraint?

    // MARK: - Rail / drawer state

    private let railState = RailState()
    private let railHeaderState = DrawerHeaderState(sectionLabel: "Menu", title: "Thinking Space")

    private lazy var railHostingVC = UIHostingController(
        rootView: RailView(
            headerState: railHeaderState,
            railState: railState,
            onSelect: { [weak self] tab in
                self?.handleRailSelect(tab)
            },
            onClose: { [weak self] in
                self?.closeDrawer(animated: true)
            }
        )
    )

    private var isDrawerOpen: Bool = false
    private var leftDrawerWidthConstraint: NSLayoutConstraint?
    /// iPad: the top chrome bar compacts into the visible content area while
    /// the drawer is open (leading inset follows the drawer slide offset) —
    /// otherwise the drawer buries the hamburger and the centered tab pill
    /// drifts off-center relative to the shifted content.
    private var bottomChromeLeadingConstraint: NSLayoutConstraint?

    private var pushCoordinator: PushNavigationCoordinator?
    private lazy var stubNavBridge: StubPushNavigationBridge = StubPushNavigationBridge()

    // Tuned values — see docs/ios-animation-reference/ANIMATION_VALUES.md
    private let drawerOpenThreshold: CGFloat = 72
    private let drawerCloseThreshold: CGFloat = -56
    private let drawerVerticalDriftTolerance: CGFloat = 44

    // MARK: - Containers

    /// Wraps the React phone shell. We apply transforms to this to slide it.
    private let mainShellContainerView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = .clear
        view.layer.shadowColor = UIColor.black.cgColor
        view.layer.shadowOffset = .zero
        view.layer.shadowRadius = 28
        view.layer.shadowOpacity = 0
        return view
    }()

    /// Drawer surface: warm beige (#f5f3ee) in light, neutral near-black in
    /// dark. Dynamic provider — flips automatically with the root trait
    /// override, no manual re-assignment needed.
    private static let drawerBackgroundColor = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 24.0 / 255.0, green: 24.0 / 255.0, blue: 28.0 / 255.0, alpha: 1.0)
            : UIColor(red: 245.0 / 255.0, green: 243.0 / 255.0, blue: 238.0 / 255.0, alpha: 1.0)
    }

    private let leftDrawerContainerView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = drawerBackgroundColor
        view.clipsToBounds = true
        return view
    }()

    private let drawerTapShieldView: UIControl = {
        let view = UIControl(frame: .zero)
        view.backgroundColor = UIColor.black.withAlphaComponent(0.001)
        view.alpha = 0
        view.isHidden = true
        return view
    }()

    private lazy var phoneShellHostingVC = UIHostingController(
        rootView: PhoneShellView(
            chromeState: chromeState,
            bridgeController: bridgeVC
        )
    )

    /// iPad gets the chrome as a persistent TOP bar (Safari-style tab strip);
    /// iPhone keeps the collapsing bottom dock. See BottomChromeView.padLayout.
    private var isPadChrome: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
    }

    private lazy var bottomChromeHostingVC = UIHostingController(
        rootView: BottomChromeView(
            state: chromeState,
            padLayout: isPadChrome,
            onDrawerToggleTap: { [weak self] in self?.toggleDrawer() },
            onSidebarToggleTap: { [weak self] in self?.chromePlugin?.emitSidebarToggleTap() },
            onBackTap: { [weak self] in _ = self?.popNavigation() },
            onSearchTap: { [weak self] in self?.chromePlugin?.emitSearchTap() },
            onCreateTap: { [weak self] in self?.chromePlugin?.emitCreateTap() },
            onExpandTap: { [weak self] in self?.chromePlugin?.emitExpandBottomTap() },
            onTabSwitcherWillPresent: { [weak self] in self?.captureActiveTabSnapshot() },
            onSelectTab: { [weak self] tabId in self?.chromePlugin?.emitSelectTab(tabId: tabId) },
            onCloseTab: { [weak self] tabId in self?.chromePlugin?.emitCloseTab(tabId: tabId) },
            onDebugTap: { [weak self] in self?.chromePlugin?.emitOpenDebugTap() },
            onRefreshTap: { [weak self] in self?.chromePlugin?.emitRefreshTap() },
            onSyncTap: { [weak self] in self?.chromePlugin?.emitSyncTap() },
            onRebuildTap: { [weak self] in self?.chromePlugin?.emitRebuildTap() },
            onGitCommitTap: { [weak self] in self?.chromePlugin?.emitGitCommitTap() },
            onGitPushTap: { [weak self] in self?.chromePlugin?.emitGitPushTap() },
            onHeaderToggleTap: { [weak self] in self?.chromePlugin?.emitHeaderToggleTap() }
        )
    )

    /// Snapshot the WKWebView for the currently active tab, downscaled for
    /// the tab-grid thumbnails. Called right before the tab switcher
    /// presents, so the grid always has a fresh shot of the tab you came
    /// from; other tabs keep the snapshot from their last visit.
    private func captureActiveTabSnapshot() {
        guard let webView = bridgeVC.webView else { return }
        guard let activeId = chromeState.tabs.first(where: { $0.active })?.id else { return }
        let config = WKSnapshotConfiguration()
        config.snapshotWidth = 420
        webView.takeSnapshot(with: config) { [weak self] image, _ in
            guard let self, let image else { return }
            let liveIds = Set(self.chromeState.tabs.map(\.id))
            var next = self.chromeState.tabSnapshots.filter { liveIds.contains($0.key) }
            next[activeId] = image
            self.chromeState.tabSnapshots = next
        }
    }

    private let bottomChromeContainerView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    // MARK: - Gestures

    private lazy var leftEdgeGestureRecognizer: UIScreenEdgePanGestureRecognizer = {
        let r = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleLeftEdgePan(_:)))
        r.edges = .left
        // WKWebView's internal scroll recognizers win the gesture race and
        // the edge pan never fires over web content — simultaneous
        // recognition (via the delegate below) lets it track anyway.
        r.delegate = self
        return r
    }()

    private lazy var drawerClosePanGesture: UIPanGestureRecognizer = {
        UIPanGestureRecognizer(target: self, action: #selector(handleDrawerClosePan(_:)))
    }()

    private var shouldUseNativeTopChrome: Bool {
        // iPhone AND iPad (decided 2026-07-19): the iPad previously rendered
        // the web top bar, which never matched the native Liquid Glass
        // chrome no matter how it was dressed in CSS. One native shell for
        // both idioms; the web side mirrors this via useNativeTopChrome.
        let idiom = UIDevice.current.userInterfaceIdiom
        return idiom == .phone || idiom == .pad
    }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        bridgeVC.chromeState = chromeState
        bridgeVC.onTopChromePluginReady = { [weak self] plugin in
            self?.wireTopChromePlugin(plugin)
        }

        if shouldUseNativeTopChrome {
            configurePhoneShell()
            observeBottomChromeState()
            observeRailSelection()
            observeRailTabOverrides()
        } else {
            embedBridgeFullscreen()
        }

        // Single source of truth for native dark mode: flip the trait on the
        // ROOT view whenever the web reports the surface is dark. Every native
        // subview — drawer rail, bottom chrome capsules, top scrim materials,
        // pull-down menu — adapts through semantic colors/materials, no
        // per-view overrides. Safe to include the WKWebView subtree: the web
        // theme is class-based (tailwind darkMode:["class"]) and nothing in it
        // reads prefers-color-scheme, so the trait flip is invisible to it.
        topBarDarkCancellable = chromeState.$isTopBarDark
            .removeDuplicates()
            .receive(on: RunLoop.main)
            .sink { [weak self] dark in
                guard let self else { return }
                UIView.animate(withDuration: 0.24) {
                    self.view.overrideUserInterfaceStyle = dark ? .dark : .light
                    self.setNeedsStatusBarAppearanceUpdate()
                }
            }
    }

    /// Mirror user-configured tab labels + icons from chromeState into
    /// RailState. Today this only covers the Webull/F9 tab; if more
    /// user-renameable tabs land in the future, extend this subscription.
    private func observeRailTabOverrides() {
        webullLabelCancellable = chromeState.$webullTabLabel
            .receive(on: RunLoop.main)
            .sink { [weak self] label in
                self?.railState.setLabel(forPath: "/webull", label)
            }
        webullIconCancellable = chromeState.$webullTabIconText
            .receive(on: RunLoop.main)
            .sink { [weak self] iconText in
                // Same fallback as Electron's resolvedWebullIcon: text glyph
                // when configured, otherwise the Webull-horns mark.
                self?.railState.setIcon(
                    forPath: "/webull",
                    iconText.isEmpty ? .template("RailWebullIcon") : .text(iconText)
                )
            }
    }

    /// Mirror `chromeState.activeNavItemId` (set by React via TopChrome.setState)
    /// into the rail's selection so the highlight stays in sync as the user
    /// navigates via any means (rail tap, bottom bar, deep link, etc.).
    private func observeRailSelection() {
        activeNavItemCancellable = chromeState.$activeNavItemId
            .receive(on: RunLoop.main)
            .sink { [weak self] activeId in
                guard let self else { return }
                let path = activeId?.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let path, !path.isEmpty else { return }
                self.railState.selectTab(forPath: path)
                if let match = self.railState.tabs.first(where: { $0.id == self.railState.selectedId }) {
                    self.railHeaderState.title = match.title
                }
            }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyBottomBarVisibility(animated: false)
        updateDrawerWidthConstraints()
        layoutDrawerTapShield()
        updatePadOrientationState()
    }

    /// Landscape iPad = web desktop layout with its own nav rail; the native
    /// drawer disables there (hamburger hides via chromeState.isPadLandscape,
    /// edge-swipe is guarded, and an open drawer closes on rotation).
    private func updatePadOrientationState() {
        let landscape = isPadChrome && view.bounds.width > view.bounds.height
        if chromeState.isPadLandscape != landscape {
            chromeState.isPadLandscape = landscape
        }
        if landscape && isDrawerOpen {
            closeDrawer(animated: false)
        }
    }

    private var drawerDisabledForPadLandscape: Bool {
        isPadChrome && view.bounds.width > view.bounds.height
    }

    func wireTopChromePlugin(_ plugin: TopChromePlugin) {
        chromePlugin = plugin
        plugin.chromeState = chromeState

        // Swap the stub nav bridge for the real plugin-backed bridge.
        pushCoordinator?.setBridge(plugin)

        plugin.onPushRequest = { [weak self] path in
            self?.pushCoordinator?.push(toPath: path)
        }
        plugin.onPopRequest = { [weak self] in
            _ = self?.pushCoordinator?.pop()
        }
        plugin.onSetNavigationStack = { [weak self] stack in
            self?.pushCoordinator?.replaceStack(stack)
        }
    }

    func dismissInlineWebView() {
        bridgeVC.dismissInlineWebView()
    }

    func suspendInlineWebView() {
        bridgeVC.suspendInlineWebView()
    }

    func resumeInlineWebView() {
        bridgeVC.resumeInlineWebView()
    }

    // MARK: - Phone shell configuration

    private func configurePhoneShell() {
        phoneShellHostingVC.view.backgroundColor = .clear
        bottomChromeContainerView.backgroundColor = .clear
        bottomChromeHostingVC.view.backgroundColor = .clear

        // Z-order (back to front):
        //   1. leftDrawerContainerView (rail)
        //   2. mainShellContainerView (wraps phoneShellHostingVC)
        //   3. drawerTapShieldView (above main shell only when drawer open)
        //   4. bottomChromeContainerView (always on top)

        // --- Left drawer (rail) ---
        view.addSubview(leftDrawerContainerView)
        addChild(railHostingVC)
        railHostingVC.view.translatesAutoresizingMaskIntoConstraints = false
        railHostingVC.view.backgroundColor = .clear
        leftDrawerContainerView.addSubview(railHostingVC.view)

        let initialWidth = resolvedDrawerWidth()
        let widthConstraint = leftDrawerContainerView.widthAnchor.constraint(equalToConstant: initialWidth)
        leftDrawerWidthConstraint = widthConstraint

        NSLayoutConstraint.activate([
            leftDrawerContainerView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            leftDrawerContainerView.topAnchor.constraint(equalTo: view.topAnchor),
            leftDrawerContainerView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            widthConstraint,

            railHostingVC.view.leadingAnchor.constraint(equalTo: leftDrawerContainerView.leadingAnchor),
            railHostingVC.view.trailingAnchor.constraint(equalTo: leftDrawerContainerView.trailingAnchor),
            railHostingVC.view.topAnchor.constraint(equalTo: leftDrawerContainerView.safeAreaLayoutGuide.topAnchor),
            railHostingVC.view.bottomAnchor.constraint(equalTo: leftDrawerContainerView.bottomAnchor),
        ])

        railHostingVC.didMove(toParent: self)
        leftDrawerContainerView.isUserInteractionEnabled = false  // closed by default

        // --- Main shell container wrapping the React phone shell ---
        view.addSubview(mainShellContainerView)
        addChild(phoneShellHostingVC)
        mainShellContainerView.addSubview(phoneShellHostingVC.view)
        phoneShellHostingVC.view.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            mainShellContainerView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            mainShellContainerView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            mainShellContainerView.topAnchor.constraint(equalTo: view.topAnchor),
            mainShellContainerView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            phoneShellHostingVC.view.leadingAnchor.constraint(equalTo: mainShellContainerView.leadingAnchor),
            phoneShellHostingVC.view.trailingAnchor.constraint(equalTo: mainShellContainerView.trailingAnchor),
            phoneShellHostingVC.view.topAnchor.constraint(equalTo: mainShellContainerView.topAnchor),
            phoneShellHostingVC.view.bottomAnchor.constraint(equalTo: mainShellContainerView.bottomAnchor),
        ])

        phoneShellHostingVC.didMove(toParent: self)

        // --- Tap shield (sits above main shell only when drawer is open) ---
        view.addSubview(drawerTapShieldView)
        drawerTapShieldView.addTarget(self, action: #selector(handleDrawerTapShield), for: .touchUpInside)

        // --- Bottom chrome overlay (always on top) ---
        embedBottomChromeOverlay()
        view.bringSubviewToFront(bottomChromeContainerView)

        // --- Gestures ---
        // Edge-pan on left edge opens drawer. NOTE: in task #7 this will be
        // routed conditionally: if nav stack has >1 page, edge-pan goes to
        // the swipe-back interaction; otherwise it opens the rail.
        view.addGestureRecognizer(leftEdgeGestureRecognizer)
        // Pan inside the main shell closes the drawer when it's open.
        mainShellContainerView.addGestureRecognizer(drawerClosePanGesture)

        // --- Push navigation coordinator ---
        // Uses a stub bridge for now; the real plugin-backed bridge gets
        // swapped in when wireTopChromePlugin runs.
        pushCoordinator = PushNavigationCoordinator(
            mainShellView: mainShellContainerView,
            containerView: view,
            topSiblingView: bottomChromeContainerView,
            bridge: stubNavBridge
        )
        // Mirror canPop into chromeState so the BottomChromeView's
        // drawer-toggle can morph into a back button.
        pushCoordinator?.onStackChanged = { [weak self] in
            guard let self else { return }
            self.chromeState.canGoBack = self.pushCoordinator?.canPop ?? false
        }
    }

    // MARK: - Navigation entry points (called by bridge in task #5)

    func pushNavigation(toPath path: String) {
        pushCoordinator?.push(toPath: path)
    }

    @discardableResult
    func popNavigation() -> Bool {
        pushCoordinator?.pop() ?? false
    }

    var navigationStack: [String] {
        pushCoordinator?.stack ?? []
    }

    private func embedBottomChromeOverlay() {
        addChild(bottomChromeHostingVC)
        view.addSubview(bottomChromeContainerView)
        bottomChromeContainerView.addSubview(bottomChromeHostingVC.view)

        bottomChromeHostingVC.view.translatesAutoresizingMaskIntoConstraints = false

        let heightConstraint = bottomChromeContainerView.heightAnchor.constraint(equalToConstant: resolvedBottomChromeHeight())
        bottomChromeHeightConstraint = heightConstraint

        // iPad: top bar under the status bar. iPhone: dock above the home
        // indicator.
        let edgeConstraint = isPadChrome
            ? bottomChromeContainerView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor)
            : bottomChromeContainerView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)

        let leadingConstraint = bottomChromeContainerView.leadingAnchor.constraint(equalTo: view.leadingAnchor)
        bottomChromeLeadingConstraint = leadingConstraint

        NSLayoutConstraint.activate([
            leadingConstraint,
            bottomChromeContainerView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            edgeConstraint,
            heightConstraint,
            bottomChromeHostingVC.view.leadingAnchor.constraint(equalTo: bottomChromeContainerView.leadingAnchor),
            bottomChromeHostingVC.view.trailingAnchor.constraint(equalTo: bottomChromeContainerView.trailingAnchor),
            bottomChromeHostingVC.view.topAnchor.constraint(equalTo: bottomChromeContainerView.topAnchor),
            bottomChromeHostingVC.view.bottomAnchor.constraint(equalTo: bottomChromeContainerView.bottomAnchor),
        ])

        bottomChromeContainerView.isHidden = true
        bottomChromeContainerView.alpha = 0
        bottomChromeContainerView.isUserInteractionEnabled = false

        bottomChromeHostingVC.didMove(toParent: self)
    }

    private func embedBridgeFullscreen() {
        addChild(bridgeVC)
        view.addSubview(bridgeVC.view)
        bridgeVC.view.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            bridgeVC.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bridgeVC.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bridgeVC.view.topAnchor.constraint(equalTo: view.topAnchor),
            bridgeVC.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        bridgeVC.didMove(toParent: self)
    }

    private func observeBottomChromeState() {
        chromeVisibilityCancellable = chromeState.$isVisible
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.applyBottomBarVisibility(animated: true)
            }

        bottomBarVisibilityCancellable = chromeState.$isBottomBarHidden
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.applyBottomBarVisibility(animated: true)
            }

        bottomBarLayoutCancellable = chromeState.$isBottomBarCollapsed
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                guard let self else { return }
                self.updateBottomChromeSizeConstraint()
                UIView.animate(
                    withDuration: 0.32,
                    delay: 0,
                    usingSpringWithDamping: 0.9,
                    initialSpringVelocity: 0.2,
                    options: [.curveEaseInOut, .beginFromCurrentState]
                ) {
                    self.bottomChromeHostingVC.view.invalidateIntrinsicContentSize()
                    self.view.layoutIfNeeded()
                }
            }
    }

    // MARK: - Layout helpers

    private func resolvedBottomChromeHeight() -> CGFloat {
        // iPad top bar is fixed-height — no scroll-collapse (the collapse
        // messages still arrive from the web; the pad layout ignores them).
        if isPadChrome { return nativeChromePadBarHeight }
        return chromeState.isBottomBarCollapsed ? 42 : 64
    }

    private func updateBottomChromeSizeConstraint() {
        bottomChromeHeightConstraint?.constant = resolvedBottomChromeHeight()
    }

    private func resolvedDrawerWidth() -> CGFloat {
        let screenWidth = max(view.bounds.width, UIScreen.main.bounds.width)
        return min(max(screenWidth * 0.84, 292), 340)
    }

    private func resolvedDrawerSlideOffset() -> CGFloat {
        min(resolvedDrawerWidth(), max(view.bounds.width - 52, 0))
    }

    private func updateDrawerWidthConstraints() {
        leftDrawerWidthConstraint?.constant = resolvedDrawerWidth()
    }

    private func layoutDrawerTapShield() {
        drawerTapShieldView.frame = mainShellContainerView.frame
    }

    private func applyBottomBarVisibility(animated: Bool) {
        guard shouldUseNativeTopChrome else { return }
        updateBottomChromeSizeConstraint()

        let shouldShowBottomBar = chromeState.isVisible && !chromeState.isBottomBarHidden
        // Slide off toward the edge the bar lives on: up on iPad (top bar),
        // down on iPhone (bottom dock).
        let hiddenMagnitude = max(bottomChromeContainerView.bounds.height, 96) + 12
        let hiddenOffset = isPadChrome ? -hiddenMagnitude : hiddenMagnitude

        let animations = {
            if shouldShowBottomBar {
                self.bottomChromeContainerView.isHidden = false
                self.bottomChromeContainerView.alpha = 1
                self.bottomChromeContainerView.transform = .identity
            } else {
                self.bottomChromeContainerView.alpha = 0
                self.bottomChromeContainerView.transform = CGAffineTransform(translationX: 0, y: hiddenOffset)
            }
        }

        let completion: (Bool) -> Void = { _ in
            self.bottomChromeContainerView.isHidden = !shouldShowBottomBar
            self.bottomChromeContainerView.isUserInteractionEnabled = shouldShowBottomBar
        }

        if animated {
            UIView.animate(
                withDuration: 0.32,
                delay: 0,
                usingSpringWithDamping: 0.9,
                initialSpringVelocity: 0.18,
                options: [.curveEaseInOut, .beginFromCurrentState],
                animations: animations,
                completion: completion
            )
        } else {
            animations()
            completion(true)
        }
    }

    // MARK: - Drawer open / close

    private func toggleDrawer() {
        if isDrawerOpen {
            closeDrawer(animated: true)
        } else {
            openDrawer(animated: true)
        }
    }

    private func openDrawer(animated: Bool) {
        guard shouldUseNativeTopChrome else { return }
        guard !drawerDisabledForPadLandscape else { return }
        guard !isDrawerOpen else { return }
        isDrawerOpen = true

        leftDrawerContainerView.isUserInteractionEnabled = true
        drawerTapShieldView.isHidden = false
        view.bringSubviewToFront(drawerTapShieldView)
        view.bringSubviewToFront(bottomChromeContainerView)

        let apply = { self.applyDrawerVisualState() }
        let completion: (Bool) -> Void = { _ in
            self.mainShellContainerView.isUserInteractionEnabled = false
            self.layoutDrawerTapShield()
        }

        if animated {
            UIView.animate(
                withDuration: 0.34,
                delay: 0,
                usingSpringWithDamping: 0.9,
                initialSpringVelocity: 0.18,
                options: [.curveEaseInOut, .beginFromCurrentState],
                animations: apply,
                completion: completion
            )
        } else {
            apply()
            completion(true)
        }
    }

    private func closeDrawer(animated: Bool) {
        guard shouldUseNativeTopChrome else { return }
        guard isDrawerOpen else { return }
        isDrawerOpen = false

        let apply = { self.applyDrawerVisualState() }
        let completion: (Bool) -> Void = { _ in
            self.mainShellContainerView.isUserInteractionEnabled = true
            self.leftDrawerContainerView.isUserInteractionEnabled = false
            self.drawerTapShieldView.isHidden = true
            self.layoutDrawerTapShield()
        }

        if animated {
            UIView.animate(
                withDuration: 0.34,
                delay: 0,
                usingSpringWithDamping: 0.9,
                initialSpringVelocity: 0.18,
                options: [.curveEaseInOut, .beginFromCurrentState],
                animations: apply,
                completion: completion
            )
        } else {
            apply()
            completion(true)
        }
    }

    private func applyDrawerVisualState() {
        // We never set isHidden on the drawer container — WKWebView (if rail
        // ever hosts one) would suspend JS. Rail is pure SwiftUI today, so
        // this is belt-and-suspenders for the architecture, not a current
        // requirement. Z-order + interaction toggle is the pattern.
        let offset = resolvedDrawerSlideOffset()
        if isDrawerOpen {
            mainShellContainerView.transform = CGAffineTransform(translationX: offset, y: 0)
            mainShellContainerView.layer.shadowOffset = CGSize(width: -10, height: 0)
            mainShellContainerView.layer.shadowOpacity = 0.16
            drawerTapShieldView.alpha = 1
        } else {
            mainShellContainerView.transform = .identity
            mainShellContainerView.layer.shadowOpacity = 0
            drawerTapShieldView.alpha = 0
        }

        // Side-drawer open state, consumed by the hamburger button's tint +
        // accessibility label. Safe to publish on both idioms now that the
        // legacy top-drawer reveal (which also read this) is gone.
        chromeState.drawerProgress = isDrawerOpen ? 1 : 0

        // iPad top bar compacts into the remaining content width instead of
        // staying full-width under the drawer. Constraint change + layout
        // inside the caller's animate block so it rides the same spring.
        if isPadChrome {
            bottomChromeLeadingConstraint?.constant = isDrawerOpen ? offset : 0
            view.layoutIfNeeded()
        }
    }

    // MARK: - Rail actions

    private func handleRailSelect(_ tab: RailTab) {
        // Optimistic local update — React will confirm via activeNavItemId
        // round-trip, but we update immediately so the highlight and header
        // don't lag the tap.
        railState.selectedId = tab.id
        railHeaderState.title = tab.title
        closeDrawer(animated: true)
        // tab.id is the route path (e.g. "/ai/chat") — exactly the navItemId
        // shape that handleNativeTopDrawerNavItemTap expects in App.tsx.
        chromePlugin?.emitNavItemTap(navItemId: tab.id)
    }

    // MARK: - Gesture handlers

    @objc private func handleDrawerTapShield() {
        closeDrawer(animated: true)
    }

    // Edge-pan commit thresholds for the back-pop path. Lighter than rail-open
    // thresholds because back-swipe convention on iOS is a quick flick;
    // velocity matters as much as distance.
    private let popSwipeTranslationThreshold: CGFloat = 50
    private let popSwipeVelocityThreshold: CGFloat = 400
    private let popSwipeVerticalDriftTolerance: CGFloat = 100

    /// True while we're driving an interactive pop. Decided at .began based
    /// on whether the coordinator can pop; we don't re-decide mid-gesture
    /// so we don't strand the snapshot.
    private var edgePanDrivingPop: Bool = false

    @objc private func handleLeftEdgePan(_ recognizer: UIScreenEdgePanGestureRecognizer) {
        let translation = recognizer.translation(in: view)
        let velocity = recognizer.velocity(in: view)

        // Branch by gesture state. Decide what this gesture means at .began
        // (drive interactive pop vs. open rail), then commit to it.
        switch recognizer.state {
        case .began:
            edgePanDrivingPop = (pushCoordinator?.canPop == true)
            if edgePanDrivingPop {
                _ = pushCoordinator?.beginInteractivePop()
            }

        case .changed:
            if edgePanDrivingPop {
                pushCoordinator?.updateInteractivePop(translation: translation.x)
                return
            }
            // Rail-open path: existing fire-on-threshold-during-changed.
            guard !isDrawerOpen else { return }
            guard abs(translation.y) <= drawerVerticalDriftTolerance else { return }
            if translation.x >= drawerOpenThreshold {
                openDrawer(animated: true)
                recognizer.isEnabled = false
                recognizer.isEnabled = true
            }

        case .ended:
            if edgePanDrivingPop {
                let commit = abs(translation.y) <= popSwipeVerticalDriftTolerance
                    && (translation.x >= popSwipeTranslationThreshold || velocity.x >= popSwipeVelocityThreshold)
                if commit {
                    pushCoordinator?.completeInteractivePop()
                } else {
                    pushCoordinator?.cancelInteractivePop()
                }
                edgePanDrivingPop = false
            }

        case .cancelled, .failed:
            if edgePanDrivingPop {
                pushCoordinator?.cancelInteractivePop()
                edgePanDrivingPop = false
            }

        default:
            break
        }
    }

    @objc private func handleDrawerClosePan(_ recognizer: UIPanGestureRecognizer) {
        guard isDrawerOpen else { return }
        let translation = recognizer.translation(in: view)
        guard abs(translation.y) <= drawerVerticalDriftTolerance else { return }

        if translation.x <= drawerCloseThreshold {
            closeDrawer(animated: true)
            recognizer.isEnabled = false
            recognizer.isEnabled = true
        }
    }
}

extension RootShellViewController: UIGestureRecognizerDelegate {
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        // Only our left-edge pan opts into simultaneous recognition — it
        // must track alongside WKWebView's internal scroll recognizers or
        // it never fires over web content.
        gestureRecognizer === leftEdgeGestureRecognizer
    }
}

/// Stand-in bridge used until task #5 wires the Capacitor plugin.
/// `requestRender` fires `completion` on the next runloop so the snapshot
/// dance can be felt without React actually navigating — useful for tuning
/// the spring curve on-device against an unchanging React state.
final class StubPushNavigationBridge: PushNavigationBridge {
    func requestRender(path: String, direction: PushNavigationDirection, completion: @escaping () -> Void) {
        NSLog("[PushNav] (stub) requestRender [%@] → %@", direction.rawValue, path)
        DispatchQueue.main.async(execute: completion)
    }

    func notifyDidFinish(path: String) {
        NSLog("[PushNav] (stub) didFinish ← %@", path)
    }
}
