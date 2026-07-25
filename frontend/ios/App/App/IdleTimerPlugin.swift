import Foundation
import Capacitor
import UIKit

/// Keeps the display awake while the user is reading (GoodNotes-style).
///
/// The Screen Wake Lock web API is not available inside WKWebView, so the only
/// way to hold the display on is the native `isIdleTimerDisabled` flag. iOS
/// clears it automatically when the app leaves the foreground, so there is no
/// way for a stale lease to drain the battery in the background — but we still
/// re-apply on foreground so returning to a note you were reading behaves the
/// same as never having left.
///
/// Lease counting lives on the JS side (`screenWakeLockBlock`); this plugin is
/// a dumb setter so the native surface stays one boolean.
@objc(IdleTimerPlugin)
public class IdleTimerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IdleTimerPlugin"
    public let jsName = "IdleTimer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise),
    ]

    /// Mirrors the JS-side lease state so foregrounding can restore it.
    private var wantsAwake = false

    override public func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc func setEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        wantsAwake = enabled
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve(["enabled": enabled])
        }
    }

    @objc private func applicationDidBecomeActive() {
        guard wantsAwake else { return }
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = true
        }
    }
}
