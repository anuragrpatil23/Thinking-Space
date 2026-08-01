import UIKit
import Capacitor
import UniformTypeIdentifiers
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    // MARK: UISceneSession Lifecycle

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        config.storyboard = UIStoryboard(name: "Main", bundle: nil)
        return config
    }

    func application(_ application: UIApplication, didDiscardSceneSessions sceneSessions: Set<UISceneSession>) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

// MARK: - SceneDelegate

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        // Window and root VC are created from Main.storyboard automatically
        window?.windowScene = windowScene
    }

    func sceneWillResignActive(_ scene: UIScene) {}

    func sceneDidEnterBackground(_ scene: UIScene) {
        if let vc = window?.rootViewController as? RootShellViewController {
            vc.suspendInlineWebView()
        }
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        if let vc = window?.rootViewController as? RootShellViewController {
            vc.resumeInlineWebView()
        }
    }
    func sceneDidBecomeActive(_ scene: UIScene) {}
    func sceneDidDisconnect(_ scene: UIScene) {}
}

// MARK: - Custom Bridge ViewController
// Subclass CAPBridgeViewController to register local plugins.
// Main.storyboard must reference "RootShellViewController" as the custom class.
 
class LTMBridgeViewController: CAPBridgeViewController, WKScriptMessageHandler {
    private let shellBackgroundColor = UIColor(
        red: 242.0 / 255.0,
        green: 242.0 / 255.0,
        blue: 247.0 / 255.0,
        alpha: 1.0
    )

    private var inlineWebViewPlugin: InlineWebViewPlugin?
    private var scrollObserver: NSKeyValueObservation?
    private var lastScrollOffset: CGFloat = 0
    
    // Scroll thresholds for chrome collapse behavior
    private let topChromeCollapseThreshold: CGFloat = 50
    private let bottomChromeCollapseThreshold: CGFloat = 150
    var chromeState: TopChromeState?
    var onTopChromePluginReady: ((TopChromePlugin) -> Void)?

    override open func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = shellBackgroundColor
        // Ensure view extends to bottom edge
        if #available(iOS 11.0, *) {
            view.insetsLayoutMarginsFromSafeArea = false
        }
        configureShellSurface()
    }

    /// Idioms that run the native SwiftUI chrome (mirrors
    /// RootShellViewController.shouldUseNativeTopChrome): iPhone AND iPad.
    private var nativeChromeIdiom: Bool {
        let idiom = UIDevice.current.userInterfaceIdiom
        return idiom == .phone || idiom == .pad
    }

    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        configureShellSurface()
        
        // Ensure WebView fills entire screen including safe areas
        if let webView = webView ?? bridge?.webView {
            webView.frame = view.bounds
            webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        }
        
        bridge?.registerPluginInstance(FolderPickerPlugin())
        bridge?.registerPluginInstance(PencilEventsPlugin())
        bridge?.registerPluginInstance(VaultWalkPlugin())
        bridge?.registerPluginInstance(IdleTimerPlugin())
        let webViewPlugin = InlineWebViewPlugin()
        inlineWebViewPlugin = webViewPlugin
        bridge?.registerPluginInstance(webViewPlugin)
        let topChromePlugin = TopChromePlugin()
        bridge?.registerPluginInstance(topChromePlugin)
        onTopChromePluginReady?(topChromePlugin)
        (parent as? RootShellViewController)?.wireTopChromePlugin(topChromePlugin)
    }
    
    override open func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)

        // WKContentView only exists once the web view has laid out, so this
        // cannot move up into capacitorDidLoad.
        installKeyboardAccessoryBar()

        // Set up native scroll detection on iPhone/iPad after view appears
        if nativeChromeIdiom && scrollObserver == nil {
            setupScrollDetection()
            
            // Register message handler for JS scroll events
            if let webView = webView ?? bridge?.webView {
                webView.configuration.userContentController.add(self, name: "chromeScroll")
                print("[Chrome] ✅ Registered chromeScroll message handler")
                
                // Remove bottom safe area padding from web content since we handle it natively
                removeBottomSafeAreaPadding(from: webView)
            }
        }
    }
    
    private func removeBottomSafeAreaPadding(from webView: WKWebView) {
        let removeBottomPaddingJS = """
        (function() {
            // Override any bottom safe area padding since native chrome handles it
            const style = document.createElement('style');
            style.id = 'native-chrome-override';
            style.textContent = `
                :root {
                    --safe-area-inset-bottom: 0px !important;
                }
                body {
                    padding-bottom: 0px !important;
                    margin-bottom: 0px !important;
                }
                html {
                    padding-bottom: 0px !important;
                    margin-bottom: 0px !important;
                }
            `;
            
            // Wait for document to be ready
            if (document.head) {
                const existing = document.getElementById('native-chrome-override');
                if (existing) existing.remove();
                document.head.appendChild(style);
                console.log('[Chrome] 🎨 Removed bottom safe area padding from web content');
            } else {
                document.addEventListener('DOMContentLoaded', function() {
                    const existing = document.getElementById('native-chrome-override');
                    if (existing) existing.remove();
                    document.head.appendChild(style);
                    console.log('[Chrome] 🎨 Removed bottom safe area padding from web content (deferred)');
                });
            }
        })();
        """
        
        webView.evaluateJavaScript(removeBottomPaddingJS) { result, error in
            if let error = error {
                print("[Chrome] ⚠️ Failed to inject bottom padding removal JS: \(error)")
            } else {
                print("[Chrome] ✅ Bottom padding removal JavaScript injected")
            }
        }
    }
    
    override open func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        
        // Ensure WebView always fills the entire view bounds
        if let webView = webView ?? bridge?.webView {
            webView.frame = view.bounds
        }
        
    }
    
    // WKScriptMessageHandler
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "chromeScroll",
              let body = message.body as? [String: Any],
              let scrollY = body["scrollY"] as? Double,
              let direction = body["direction"] as? String else {
            return
        }
        
        print("[Chrome] 🌐 JS scroll event: \(Int(scrollY))pt, direction: \(direction)")
        
        let scrollDirection: ScrollDirection = direction == "down" ? .down : .up
        updateChromeForScroll(offsetY: CGFloat(scrollY), direction: scrollDirection)
    }

    func dismissInlineWebView() {
        inlineWebViewPlugin?.closeWebView()
    }

    func suspendInlineWebView() {
        inlineWebViewPlugin?.suspendWebView()
    }

    func resumeInlineWebView() {
        inlineWebViewPlugin?.resumeWebView()
    }

    /// Replace UIKit's form accessory bar — the ‹prev› ‹next› ✓ strip meant for
    /// tabbing between fields in a web form — with our own single Done button.
    /// In a full-screen editor there is exactly one field, so the arrows are
    /// dead controls, but the ✓ is not: without something there the keyboard
    /// has no dismiss affordance at all (2026-08-01).
    ///
    /// There is no API for this; the getter lives on the private WKContentView,
    /// so the override goes on in the ObjC runtime. Same hook @capacitor/keyboard
    /// uses — done here so we do not take the plugin, whose resize modes would
    /// fight the visualViewport-based keyboard insets the web layer already
    /// computes (uiLayoutOrch).
    private func installKeyboardAccessoryBar() {
        guard let webView = webView ?? bridge?.webView else { return }
        guard let contentView = webView.scrollView.subviews.first(where: {
            String(describing: type(of: $0)).hasPrefix("WKContent")
        }) else { return }

        let contentClass: AnyClass = type(of: contentView)
        let selector = #selector(getter: UIResponder.inputAccessoryView)
        guard let template = class_getInstanceMethod(UIResponder.self, selector) else { return }

        let ourAccessory: @convention(block) (AnyObject) -> UIView? = { _ in
            LTMKeyboardAccessoryBar.shared
        }
        let imp = imp_implementationWithBlock(ourAccessory)

        // Patch WKContentView itself rather than re-classing the instance.
        // object_setClass on a live WKContentView also cost us the selection
        // grabbers — WebKit's text-interaction assistant is keyed off that
        // view, and swapping its class out from under UIKit left selection
        // with a callout menu but no handles (2026-08-01). class_addMethod is
        // scoped to WKContentView and changes no identity.
        if !class_addMethod(contentClass, selector, imp, method_getTypeEncoding(template)) {
            // Already overridden by WebKit (this is where the form bar comes
            // from). class_getInstanceMethod now resolves to WKContentView's
            // own method, so the replacement stays scoped to it — critically
            // NOT to UIResponder, which every responder in the app inherits.
            if let existing = class_getInstanceMethod(contentClass, selector) {
                method_setImplementation(existing, imp)
            }
        }

        // The class is patched for the process; reloading the accessory only
        // matters if a field is already focused, which it is not at first
        // appearance.
        contentView.reloadInputViews()
    }

    private func configureShellSurface() {
        view.backgroundColor = shellBackgroundColor
        guard let nativeWebView = webView ?? bridge?.webView else { return }
        nativeWebView.isOpaque = false
        nativeWebView.backgroundColor = shellBackgroundColor
        nativeWebView.scrollView.backgroundColor = shellBackgroundColor

        if #available(iOS 11.0, *) {
            nativeWebView.scrollView.contentInsetAdjustmentBehavior = nativeChromeIdiom
                ? .never
                : .automatic
            nativeWebView.scrollView.automaticallyAdjustsScrollIndicatorInsets = !nativeChromeIdiom
        }

        // Keep original scroll settings - changing these broke scrolling!
        nativeWebView.scrollView.bounces = false
        nativeWebView.scrollView.alwaysBounceVertical = false
        nativeWebView.scrollView.alwaysBounceHorizontal = false

        // Remove any bottom content inset that might create a gap
        if nativeChromeIdiom {
            nativeWebView.scrollView.contentInset = .zero
            nativeWebView.scrollView.scrollIndicatorInsets = .zero
        }
        
        print("[Chrome] 📱 Configured webView scrollView")
    }
    
    private func setupScrollDetection() {
        guard let webView = webView ?? bridge?.webView else {
            print("[Chrome] ⚠️ WebView not available for scroll detection")
            return
        }
        
        print("[Chrome] ✅ Setting up scroll detection")
        print("[Chrome] 📊 WebView scrollView contentSize: \(webView.scrollView.contentSize)")
        print("[Chrome] 📊 WebView scrollView frame: \(webView.scrollView.frame)")
        
        // Method 1: Observe native scrollView
        scrollObserver = webView.scrollView.observe(\.contentOffset, options: [.new, .old]) { [weak self] scrollView, change in
            guard let self = self else { return }
            
            let offsetY = scrollView.contentOffset.y
            let scrollDirection: ScrollDirection = offsetY > self.lastScrollOffset ? .down : .up
            
            if abs(offsetY - self.lastScrollOffset) > 5 {
                print("[Chrome] 📍 Native scroll: \(Int(offsetY))pt, direction: \(scrollDirection)")
            }
            
            self.updateChromeForScroll(offsetY: offsetY, direction: scrollDirection)
            self.lastScrollOffset = offsetY
        }
        
        // Method 2: Inject JavaScript to detect web-side scroll events
        let scrollDetectionJS = """
        (function() {
            let lastScrollY = 0;
            let ticking = false;
            
            function detectScroll() {
                const scrollY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
                
                if (Math.abs(scrollY - lastScrollY) > 5) {
                    const direction = scrollY > lastScrollY ? 'down' : 'up';
                    
                    // Send scroll info to native side
                    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.chromeScroll) {
                        window.webkit.messageHandlers.chromeScroll.postMessage({
                            scrollY: scrollY,
                            direction: direction
                        });
                    }
                    
                    // Also try via TopChrome plugin if available
                    if (window.TopChrome && window.TopChrome.setState) {
                        const shouldCollapseTop = direction === 'down' && scrollY > 50;
                        const shouldCollapseBottom = direction === 'down' && scrollY > 150;
                        
                        window.TopChrome.setState({
                            topBarCollapsed: shouldCollapseTop,
                            bottomBarCollapsed: shouldCollapseBottom
                        });
                    }
                    
                    lastScrollY = scrollY;
                }
                
                ticking = false;
            }
            
            function requestTick() {
                if (!ticking) {
                    window.requestAnimationFrame(detectScroll);
                    ticking = true;
                }
            }
            
            // Listen to both window scroll and all scroll events
            window.addEventListener('scroll', requestTick, { passive: true });
            document.addEventListener('scroll', requestTick, { passive: true, capture: true });
            
            console.log('[Chrome] 🌐 JavaScript scroll detection installed');
        })();
        """
        
        webView.evaluateJavaScript(scrollDetectionJS) { result, error in
            if let error = error {
                print("[Chrome] ⚠️ Failed to inject scroll detection JS: \(error)")
            } else {
                print("[Chrome] ✅ JavaScript scroll detection injected")
            }
        }
    }
    
    private enum ScrollDirection {
        case up, down
    }
    
    private func updateChromeForScroll(offsetY: CGFloat, direction: ScrollDirection) {
        guard let chromeState else {
            print("[Chrome] ⚠️ Top chrome state is unavailable")
            return
        }
        
        // Determine if top chrome should be collapsed
        let shouldCollapseTop: Bool
        if direction == .down && offsetY > topChromeCollapseThreshold {
            shouldCollapseTop = true
        } else if direction == .up || offsetY < 10 {
            shouldCollapseTop = false
        } else {
            shouldCollapseTop = chromeState.isTopBarCollapsed
        }
        
        // Determine if bottom chrome should be collapsed
        let shouldCollapseBottom: Bool
        if direction == .down && offsetY > bottomChromeCollapseThreshold {
            shouldCollapseBottom = true
        } else if direction == .up || offsetY < 100 {
            shouldCollapseBottom = false
        } else {
            shouldCollapseBottom = chromeState.isBottomBarCollapsed
        }
        
        // Only update if state changed (avoid unnecessary updates)
        if shouldCollapseTop != chromeState.isTopBarCollapsed {
            print("[Chrome] 🔄 Top chrome: \(shouldCollapseTop ? "COLLAPSED" : "EXPANDED")")
            chromeState.isTopBarCollapsed = shouldCollapseTop
        }
        
        if shouldCollapseBottom != chromeState.isBottomBarCollapsed {
            print("[Chrome] 🔄 Bottom chrome: \(shouldCollapseBottom ? "COLLAPSED" : "EXPANDED")")
            chromeState.isBottomBarCollapsed = shouldCollapseBottom
        }
    }
    
    deinit {
        scrollObserver?.invalidate()
        
        // Clean up message handler
        if let webView = webView ?? bridge?.webView {
            webView.configuration.userContentController.removeScriptMessageHandler(forName: "chromeScroll")
        }
    }
}

// MARK: - FolderPickerPlugin

/// Native Capacitor plugin that opens the iOS document picker for folder selection.
/// Shows both local storage and iCloud Drive. Bookmarks the selected folder
/// for persistent access across app launches.
@objc(FolderPickerPlugin)
public class FolderPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolderPickerPlugin"
    public let jsName = "FolderPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restoreBookmark", returnType: CAPPluginReturnPromise),
    ]

    private var pendingCall: CAPPluginCall?

    @objc func pickFolder(_ call: CAPPluginCall) {
        self.pendingCall = call

        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    @objc func restoreBookmark(_ call: CAPPluginCall) {
        guard let bookmarkData = UserDefaults.standard.data(forKey: "vault-folder-bookmark") else {
            call.reject("No bookmark saved")
            return
        }

        do {
            var isStale = false
            let url = try URL(
                resolvingBookmarkData: bookmarkData,
                options: [],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )

            let accessing = url.startAccessingSecurityScopedResource()

            if isStale {
                if let newData = try? url.bookmarkData(
                    options: .minimalBookmark,
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                ) {
                    UserDefaults.standard.set(newData, forKey: "vault-folder-bookmark")
                }
            }

            call.resolve([
                "url": url.path,
                "accessing": accessing,
            ])
        } catch {
            call.reject("Failed to restore bookmark: \(error.localizedDescription)")
        }
    }

    // MARK: - UIDocumentPickerDelegate

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else {
            pendingCall?.reject("No folder selected")
            pendingCall = nil
            return
        }

        let accessing = url.startAccessingSecurityScopedResource()

        do {
            let bookmarkData = try url.bookmarkData(
                options: .minimalBookmark,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            UserDefaults.standard.set(bookmarkData, forKey: "vault-folder-bookmark")
        } catch {
            print("Failed to create bookmark: \(error)")
        }

        pendingCall?.resolve([
            "url": url.path,
            "accessing": accessing,
        ])
        pendingCall = nil
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingCall?.reject("User cancelled folder selection")
        pendingCall = nil
    }
}

// MARK: - PencilEventsPlugin

/// Native Capacitor plugin that exposes Apple Pencil signals to the web layer.
/// Emits:
/// - `pencilDoubleTap`
/// - `pencilMetrics` (force/tilt/azimuth/location samples)
@objc(PencilEventsPlugin)
public class PencilEventsPlugin: CAPPlugin, CAPBridgedPlugin, UIPencilInteractionDelegate, UIGestureRecognizerDelegate {
    public let identifier = "PencilEventsPlugin"
    public let jsName = "PencilEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise),
    ]

    private var monitoring = false
    private var pencilInteraction: UIPencilInteraction?
    private var samplingGesture: PencilSamplingGestureRecognizer?

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.startMonitoring()
            call.resolve([
                "monitoring": self.monitoring,
            ])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopMonitoring()
            call.resolve([
                "monitoring": self.monitoring,
            ])
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve([
            "monitoring": monitoring,
            "supportsPencilInteraction": true,
        ])
    }

    private func startMonitoring() {
        if monitoring { return }
        guard let targetView = bridge?.webView ?? bridge?.viewController?.view else {
            return
        }

        if #available(iOS 12.1, *) {
            let interaction = UIPencilInteraction()
            interaction.delegate = self
            targetView.addInteraction(interaction)
            pencilInteraction = interaction
        }

        let recognizer = PencilSamplingGestureRecognizer()
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesBegan = false
        recognizer.delaysTouchesEnded = false
        recognizer.delegate = self
        recognizer.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        recognizer.onSample = { [weak self, weak targetView] touch, phase in
            self?.emitPencilMetrics(touch: touch, phase: phase, in: targetView)
        }
        targetView.addGestureRecognizer(recognizer)
        samplingGesture = recognizer

        monitoring = true
    }

    private func stopMonitoring() {
        if let recognizer = samplingGesture {
            recognizer.view?.removeGestureRecognizer(recognizer)
        }
        samplingGesture = nil

        if let interaction = pencilInteraction {
            bridge?.webView?.removeInteraction(interaction)
            bridge?.viewController?.view.removeInteraction(interaction)
        }
        pencilInteraction = nil
        monitoring = false
    }

    public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        return touch.type == .pencil
    }

    public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        return true
    }

    @available(iOS 12.1, *)
    public func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        notifyListeners("pencilDoubleTap", data: [
            "timestamp": Date().timeIntervalSince1970 * 1000,
            "preferredAction": preferredActionLabel(UIPencilInteraction.preferredTapAction),
        ])
    }

    private func emitPencilMetrics(touch: UITouch, phase: String, in view: UIView?) {
        var payload: [String: Any] = [
            "phase": phase,
            "timestamp": Date().timeIntervalSince1970 * 1000,
        ]

        let force = touch.force
        let maxForce = touch.maximumPossibleForce
        if force.isFinite { payload["force"] = force }
        if maxForce.isFinite && maxForce > 0 {
            payload["maxForce"] = maxForce
            payload["normalizedPressure"] = max(0, min(force / maxForce, 1))
        }

        let altitude = touch.altitudeAngle
        if altitude.isFinite { payload["altitudeAngle"] = altitude }

        if let view {
            let azimuth = touch.azimuthAngle(in: view)
            if azimuth.isFinite { payload["azimuthAngle"] = azimuth }
            let point = touch.preciseLocation(in: view)
            if point.x.isFinite { payload["locationX"] = point.x }
            if point.y.isFinite { payload["locationY"] = point.y }
        }

        notifyListeners("pencilMetrics", data: payload)
    }

    @available(iOS 12.1, *)
    private func preferredActionLabel(_ action: UIPencilPreferredAction) -> String {
        switch action {
        case .switchEraser:
            return "switchEraser"
        case .switchPrevious:
            return "switchPrevious"
        case .showColorPalette:
            return "showColorPalette"
        case .ignore:
            return "ignore"
        @unknown default:
            return "unknown"
        }
    }

    deinit {
        stopMonitoring()
    }
}

private final class PencilSamplingGestureRecognizer: UIGestureRecognizer {
    var onSample: ((UITouch, String) -> Void)?

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        handleTouches(touches, phase: "began")
        if state == .possible { state = .began }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        handleTouches(touches, phase: "moved")
        if state != .failed && state != .cancelled { state = .changed }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        handleTouches(touches, phase: "ended")
        if state != .failed && state != .cancelled { state = .ended }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        handleTouches(touches, phase: "cancelled")
        state = .cancelled
    }

    override func reset() {
        super.reset()
    }

    private func handleTouches(_ touches: Set<UITouch>, phase: String) {
        guard let touch = touches.first(where: { $0.type == .pencil }) else { return }
        onSample?(touch, phase)
    }
}

// MARK: - InlineWebViewPlugin

/// Native Capacitor plugin that overlays a real WKWebView over a React layout
/// slot, positioned using coordinates from getBoundingClientRect() in JS.
/// This lets the iOS app display external web pages inline (like Electron's
/// <webview>) without the cross-origin restrictions that block iframes in
/// WKWebView.
///
/// Coordinate mapping: JS getBoundingClientRect() returns CSS logical pixels
/// relative to the viewport. UIKit uses points. On iOS both are the same unit.
/// We add safeAreaInsets.top so that JS y=0 (top of visible content) maps to
/// the correct native y (below the status bar).
@objc(InlineWebViewPlugin)
public class InlineWebViewPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate, UIGestureRecognizerDelegate {
    public let identifier = "InlineWebViewPlugin"
    public let jsName = "InlineWebView"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTheme", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "suspend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateFrame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentUrl", returnType: CAPPluginReturnPromise),
    ]

    /// Map the JS theme string → a WKWebView trait. A WKWebView's
    /// `prefers-color-scheme` follows its `overrideUserInterfaceStyle`, so this
    /// is how the app's dark/light choice reaches the guest website. `.unspecified`
    /// (system) lets the device trait decide.
    private func interfaceStyle(for theme: String?) -> UIUserInterfaceStyle {
        switch theme {
        case "dark": return .dark
        case "light": return .light
        default: return .unspecified
        }
    }

    // Swipe gesture thresholds matching uiGestureBlock.ts DEFAULT_DRAWER_SWIPE_THRESHOLDS
    private let edgeStartMaxX: CGFloat = 24
    private let openDeltaXMin: CGFloat = 72
    private let closeDeltaXMax: CGFloat = -56
    private let maxVerticalDrift: CGFloat = 44

    private var inlineWebView: WKWebView?
    /// Transparent 28pt-wide overlay on the left edge — intercepts open-swipe touches
    /// before the WKWebView can consume them.
    private var edgeSwipeOverlay: UIView?

    // Convert JS viewport rect → UIKit frame.
    // getBoundingClientRect() returns coordinates in the WKWebView coordinate space,
    // which starts at y=0 = top of screen (the WKWebView extends behind the status bar).
    // The React app accounts for the safe area via env(safe-area-inset-top) CSS padding,
    // so all y values already include the status bar offset — do NOT add safeAreaInsets.top.
    private func nativeFrame(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) -> CGRect {
        return CGRect(x: x, y: y, width: width, height: height)
    }

    @objc func open(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Invalid URL"); return
        }
        let x = CGFloat(call.getFloat("x") ?? 0)
        let y = CGFloat(call.getFloat("y") ?? 0)
        let w = CGFloat(call.getFloat("width") ?? 0)
        let h = CGFloat(call.getFloat("height") ?? 0)

        DispatchQueue.main.async {
            guard let parentView = self.bridge?.viewController?.view else {
                call.reject("No parent view"); return
            }
            let frame = self.nativeFrame(x: x, y: y, width: w, height: h)

            if self.inlineWebView == nil {
                let config = WKWebViewConfiguration()
                config.allowsInlineMediaPlayback = true
                let wkView = WKWebView(frame: frame, configuration: config)
                wkView.navigationDelegate = self
                wkView.allowsBackForwardNavigationGestures = true
                wkView.backgroundColor = .systemBackground
                // Force the guest site's prefers-color-scheme to match the app.
                wkView.overrideUserInterfaceStyle = self.interfaceStyle(for: call.getString("theme"))
                parentView.addSubview(wkView)
                self.inlineWebView = wkView

                // Add close-swipe recognizer directly on the WKWebView.
                // cancelsTouchesInView=false + simultaneous delegate lets WKWebView
                // still receive all scrolling/tapping while we track the gesture.
                let closePan = UIPanGestureRecognizer(target: self, action: #selector(self.handleCloseSwipe(_:)))
                closePan.cancelsTouchesInView = false
                closePan.delaysTouchesBegan = false
                closePan.delegate = self
                wkView.addGestureRecognizer(closePan)
            } else {
                self.inlineWebView?.frame = frame
                self.inlineWebView?.overrideUserInterfaceStyle = self.interfaceStyle(for: call.getString("theme"))
            }

            self.inlineWebView?.load(URLRequest(url: url))
            self.setupEdgeSwipeOverlay(parentView: parentView, frame: frame)
            call.resolve()
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        closeWebView()
        call.resolve()
    }

    /// Live-update the guest webview's forced color scheme when the app theme is
    /// toggled while an article is open (no reload).
    @objc func setTheme(_ call: CAPPluginCall) {
        let theme = call.getString("theme")
        DispatchQueue.main.async {
            self.inlineWebView?.overrideUserInterfaceStyle = self.interfaceStyle(for: theme)
            call.resolve()
        }
    }

    func closeWebView() {
        DispatchQueue.main.async {
            self.inlineWebView?.removeFromSuperview()
            self.inlineWebView = nil
            self.edgeSwipeOverlay?.removeFromSuperview()
            self.edgeSwipeOverlay = nil
            self.isSuspended = false
        }
    }

    /// Internal: suspend for app background (called from bridge VC, not from JS).
    func suspendWebView() {
        DispatchQueue.main.async {
            guard let wkView = self.inlineWebView, !self.isSuspended else { return }
            self.suspendedFrame = wkView.frame
            wkView.frame = CGRect(x: -9999, y: 0, width: wkView.frame.width, height: wkView.frame.height)
            self.edgeSwipeOverlay?.isHidden = true
            self.isSuspended = true
        }
    }

    /// Internal: resume after app foreground (called from bridge VC, not from JS).
    func resumeWebView() {
        DispatchQueue.main.async {
            guard let wkView = self.inlineWebView, self.isSuspended else { return }
            wkView.frame = self.suspendedFrame
            self.edgeSwipeOverlay?.isHidden = false
            if let overlay = self.edgeSwipeOverlay {
                overlay.frame = CGRect(x: 0, y: self.suspendedFrame.minY, width: 28, height: self.suspendedFrame.height)
            }
            self.isSuspended = false
        }
    }

    private var isSuspended = false
    private var suspendedFrame: CGRect = .zero

    /// Move the WKWebView offscreen instead of destroying it, preserving all
    /// session state (cookies, scroll position, form data, auth sessions).
    @objc func suspend(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let wkView = self.inlineWebView else {
                call.resolve(); return
            }
            self.suspendedFrame = wkView.frame
            wkView.frame = CGRect(x: -9999, y: 0, width: wkView.frame.width, height: wkView.frame.height)
            self.edgeSwipeOverlay?.isHidden = true
            self.isSuspended = true
            call.resolve()
        }
    }

    /// Restore a previously suspended WKWebView to its frame without reloading.
    @objc func resume(_ call: CAPPluginCall) {
        let x = CGFloat(call.getFloat("x") ?? 0)
        let y = CGFloat(call.getFloat("y") ?? 0)
        let w = CGFloat(call.getFloat("width") ?? 0)
        let h = CGFloat(call.getFloat("height") ?? 0)

        DispatchQueue.main.async {
            guard let wkView = self.inlineWebView, self.isSuspended else {
                call.resolve(["resumed": false]); return
            }
            let frame = self.nativeFrame(x: x, y: y, width: w, height: h)
            wkView.frame = frame
            self.edgeSwipeOverlay?.isHidden = false
            if let overlay = self.edgeSwipeOverlay {
                overlay.frame = CGRect(x: 0, y: frame.minY, width: 28, height: frame.height)
            }
            self.isSuspended = false
            call.resolve(["resumed": true])
        }
    }

    @objc func updateFrame(_ call: CAPPluginCall) {
        let x = CGFloat(call.getFloat("x") ?? 0)
        let y = CGFloat(call.getFloat("y") ?? 0)
        let w = CGFloat(call.getFloat("width") ?? 0)
        let h = CGFloat(call.getFloat("height") ?? 0)
        DispatchQueue.main.async {
            let frame = self.nativeFrame(x: x, y: y, width: w, height: h)
            self.inlineWebView?.frame = frame
            if let overlay = self.edgeSwipeOverlay {
                overlay.frame = CGRect(x: 0, y: frame.minY, width: 28, height: frame.height)
            }
            call.resolve()
        }
    }

    // MARK: - Sidebar swipe gestures

    /// Adds a transparent 28pt-wide UIView on the left edge of the screen, above the WKWebView.
    /// Touches on this strip are captured here (not by the WKWebView), allowing us to detect
    /// the open-sidebar swipe without fighting the WKWebView's own gesture recognizers.
    private func setupEdgeSwipeOverlay(parentView: UIView, frame: CGRect) {
        edgeSwipeOverlay?.removeFromSuperview()
        let overlay = UIView(frame: CGRect(x: 0, y: frame.minY, width: 28, height: frame.height))
        overlay.backgroundColor = .clear
        overlay.isUserInteractionEnabled = true
        parentView.addSubview(overlay)
        edgeSwipeOverlay = overlay

        let openPan = UIPanGestureRecognizer(target: self, action: #selector(handleOpenSwipe(_:)))
        openPan.cancelsTouchesInView = false
        overlay.addGestureRecognizer(openPan)
    }

    /// Detects rightward swipe on the left-edge overlay → open sidebar.
    @objc private func handleOpenSwipe(_ pan: UIPanGestureRecognizer) {
        guard pan.state == .changed else { return }
        let t = pan.translation(in: pan.view)
        guard t.x >= openDeltaXMin, abs(t.y) < maxVerticalDrift else { return }
        // Disable+re-enable resets the recognizer so it fires only once per gesture.
        pan.isEnabled = false
        pan.isEnabled = true
        notifyListeners("inlineWebViewEdgeSwipeOpen", data: [:])
    }

    /// Detects leftward swipe anywhere on the WKWebView → close sidebar.
    @objc private func handleCloseSwipe(_ pan: UIPanGestureRecognizer) {
        guard pan.state == .changed else { return }
        let t = pan.translation(in: pan.view)
        guard t.x <= closeDeltaXMax, abs(t.y) < maxVerticalDrift else { return }
        pan.isEnabled = false
        pan.isEnabled = true
        notifyListeners("inlineWebViewEdgeSwipeClose", data: [:])
    }

    // MARK: - WKNavigationDelegate

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let url = webView.url?.absoluteString {
            notifyListeners("urlChanged", data: ["url": url])
        }
    }

    // MARK: - getCurrentUrl

    @objc func getCurrentUrl(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let url = self.inlineWebView?.url?.absoluteString ?? ""
            call.resolve(["url": url])
        }
    }

    // MARK: - UIGestureRecognizerDelegate

    public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        return true
    }
}

// MARK: - Keyboard accessory bar

/// The one control above the keyboard: a blue ✓ that dismisses it, the way
/// Notes and Numbers do it. A `UIToolbar` rather than a hand-rolled view so the
/// material, the hairline, and the height all come from UIKit and track the
/// system — the point of this being native at all.
///
/// One shared instance: only one field is first responder at a time, and the
/// runtime override that vends it (`installKeyboardAccessoryBar`) has no
/// per-webview state to carry.
final class LTMKeyboardAccessoryBar: UIToolbar {
    static let shared: LTMKeyboardAccessoryBar = {
        let bar = LTMKeyboardAccessoryBar()
        bar.configure()
        return bar
    }()

    /// Tall enough for the round prominent button UIKit draws for a `.done`
    /// item: at the toolbar's natural 44 the circle is bigger than its own bar
    /// and hangs over both edges, half-buried in the keyboard (2026-08-01).
    /// 56, not 64: the button is ~48pt, and the bar centers it, so every extra
    /// point of height is two points of gap above the keyboard.
    private static let barHeight: CGFloat = 56

    private func configure() {
        barStyle = .default
        tintColor = .systemBlue
        // No chrome of its own — the button is a filled circle that reads as a
        // floating control, and a bar behind it would be a second surface
        // stacked on the keyboard.
        isTranslucent = true
        setBackgroundImage(UIImage(), forToolbarPosition: .any, barMetrics: .default)
        setShadowImage(UIImage(), forToolbarPosition: .any)
        backgroundColor = .clear

        let done = UIBarButtonItem(
            image: UIImage(systemName: "checkmark"),
            style: .done,
            target: self,
            action: #selector(dismissKeyboard)
        )
        done.accessibilityLabel = "Dismiss keyboard"
        items = [
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
            done,
        ]
        // Toolbars inset their items by 16pt; the keyboard's own edge keys sit
        // closer than that, so the button looked indented next to them.
        insetsLayoutMarginsFromSafeArea = false
        directionalLayoutMargins = NSDirectionalEdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 2)

        // An inputAccessoryView is sized from its frame, not by sizeToFit.
        frame = CGRect(x: 0, y: 0, width: UIScreen.main.bounds.width, height: Self.barHeight)
        autoresizingMask = .flexibleWidth
    }

    /// Resign whoever holds first responder — no reference to the web view
    /// needed, and it stays correct if the focused field ever moves.
    @objc private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}
