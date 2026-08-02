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
                    // iPad: the veil deepens to hold the whole native
                    // top-bar zone (58pt bar + feather room), Files-app
                    // style — the buttons float in blurred space and
                    // scrolled content passes beneath them. iPhone keeps
                    // the short status-bar-only scrim.
                    let isPad = UIDevice.current.userInterfaceIdiom == .pad
                    TopChromeView(state: chromeState, coversPadBarZone: isPad)
                        // Extra height past the safe area gives the
                        // progressive blur room to feather out instead of
                        // cutting off hard at the status-bar line — and
                        // when scrolled content frosts the band, the clock
                        // keeps a comfortable legibility margin under it.
                        .frame(height: isPad ? safeTop + nativeChromePadBarHeight + 26 : safeTop + 24, alignment: .top)
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
