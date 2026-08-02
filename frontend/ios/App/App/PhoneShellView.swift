import SwiftUI
import UIKit

/// Hosts the web content plus the native status-bar scrim (TopChromeView).
/// Navigation lives exclusively in the LEFT side drawer (RailView, managed by
/// RootShellViewController) — the legacy pull-down top drawer menu was removed
/// 2026-07-19: it double-rendered behind the content whenever the side drawer
/// set `drawerProgress`, and the side drawer is the only menu the shell wants.
struct PhoneShellView: View {
    @ObservedObject var chromeState: TopChromeState

    let bridgeController: UIViewController

    var body: some View {
        GeometryReader { proxy in
            // The outer `.ignoresSafeArea()` zeroes the proxy's insets, so read
            // the real status-bar inset from the key window. With 0 here the
            // top scrim rendered as a 16pt band at the physical top edge
            // instead of covering the status-bar area.
            let safeTop = max(proxy.safeAreaInsets.top, resolvedKeyWindowSafeAreaTopInset())

            ZStack {
                // Instagram model: the web content fills all the way to the top
                // edge and slides under the status bar. The web owns its own top
                // inset via `--ltm-safe-top` (env(safe-area-inset-top)) on
                // non-bleed pages, and edge-bleed pages (Home) deliberately let
                // their backdrop run under the clock. The native TopChromeView
                // is just an adaptive scrim, not a reserved opaque band — so
                // nothing is reserved here.
                BridgeControllerContainerView(controller: bridgeController)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .ignoresSafeArea(edges: .all)

                // Top chrome overlay
                VStack {
                    // iPad: an opaque Safari-style toolbar covering the whole
                    // native top-bar zone, ending in a hairline. iPhone keeps
                    // the short progressive status-bar veil.
                    let isPad = UIDevice.current.userInterfaceIdiom == .pad
                    TopChromeView(state: chromeState, coversPadBarZone: isPad)
                        // iPad ends exactly at the bar's edge — no feather
                        // room, since there is nothing to feather (2026-08-02);
                        // the extra height would just push the hairline down
                        // past the clearance the web reserves (index.css, 54px).
                        // iPhone's extra height gives the progressive blur room
                        // to fade out instead of cutting off hard at the
                        // status-bar line.
                        .frame(height: isPad ? safeTop + nativeChromePadBarHeight : safeTop + 24, alignment: .top)
                        .opacity(chromeState.isVisible && !chromeState.isTopScrimHidden ? 1 : 0)
                        .offset(y: chromeState.isVisible ? 0 : -18)
                        // NEVER hit-tests, visible or not. TopChromeView is a
                        // scrim — a masked material rectangle with no controls
                        // in it on either idiom — so every touch it receives is
                        // a touch stolen from the web content beneath.
                        //
                        // This was `.allowsHitTesting(chromeState.isVisible)`,
                        // which only fixed the hidden case (immersive focus
                        // mode, where the invisible strip blocked the focus
                        // header's Exit button). The visible case is the same
                        // bug: the veil runs `safeTop + 24`, so its feathered
                        // tail covers the top ~24pt of whatever the page puts
                        // directly under the status bar. New Note's title-bar
                        // controls live exactly there, and half of each 44pt
                        // tap target was dead before this (2026-08-01).
                        .allowsHitTesting(false)
                    Spacer()
                }
                .ignoresSafeArea(edges: .top)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .animation(.easeOut(duration: 0.18), value: chromeState.isVisible)
        }
        .ignoresSafeArea()
        .background(Color(UIColor.systemGroupedBackground))
    }
}

private struct BridgeControllerContainerView: UIViewControllerRepresentable {
    let controller: UIViewController

    func makeUIViewController(context: Context) -> UIViewController {
        controller
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
