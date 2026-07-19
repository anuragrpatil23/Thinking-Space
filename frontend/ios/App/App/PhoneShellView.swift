import SwiftUI
import UIKit

private let phoneShellDrawerDismissVelocityThreshold: CGFloat = 180
private let phoneShellDrawerOpenThreshold: CGFloat = 0.42
private let phoneShellContentCornerRadius: CGFloat = 44
private let phoneShellDrawerExtraContentOffset: CGFloat = 14

struct PhoneShellView: View {
    @ObservedObject var chromeState: TopChromeState

    let bridgeController: UIViewController
    let onSelectNavItem: (String) -> Void
    @State private var drawerDragStartProgress: CGFloat? = nil

    var body: some View {
        GeometryReader { proxy in
            // The outer `.ignoresSafeArea()` zeroes the proxy's insets, so read
            // the real status-bar inset from the key window (same workaround as
            // TopDrawerMenuView). With 0 here the top scrim rendered as a
            // 16pt band at the physical top edge instead of covering the
            // status-bar area.
            let safeTop = max(proxy.safeAreaInsets.top, resolvedNativeTopDrawerSafeAreaTopInset())
            let revealHeight = resolvedDrawerRevealHeight(containerHeight: proxy.size.height, safeTop: safeTop)
            let progress = chromeState.drawerProgress
            let visibleDrawerHeight = max(0, progress * revealHeight)
            let contentCornerRadius = phoneShellContentCornerRadius * progress
            // Instagram model: the web content fills all the way to the top edge
            // and slides under the status bar. The web owns its own top inset via
            // `--ltm-safe-top` (env(safe-area-inset-top)) on non-bleed pages, and
            // edge-bleed pages (Home) deliberately let their backdrop run under
            // the clock. The native TopChromeView is now just an adaptive scrim,
            // not a reserved opaque band — so nothing is reserved here.
            let topOverlayReservedHeight: CGFloat = 0
            let contentPanelShape = RoundedRectangle(cornerRadius: contentCornerRadius, style: .continuous)

            ZStack(alignment: .top) {
                // Menu behind content
                TopDrawerMenuView(
                    state: chromeState,
                    onSelectNavItem: { navItemId in
                        closeDrawer()
                        onSelectNavItem(navItemId)
                    }
                )
                // Match the web's reported surface darkness (can't trait-flip
                // the container here — it also hosts the WKWebView, whose
                // prefers-color-scheme must stay untouched).
                .environment(\.colorScheme, chromeState.isTopBarDark ? .dark : .light)
                .frame(maxWidth: .infinity, alignment: .top)
                .frame(height: visibleDrawerHeight + contentCornerRadius, alignment: .top)
                .clipped()
                .opacity(0.52 + 0.48 * progress)
                .allowsHitTesting(progress > 0.001)

                ZStack {
                    BridgeControllerContainerView(controller: bridgeController)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.top, topOverlayReservedHeight)
                        .background(LiquidGlassChromeView(progress: progress, cornerRadius: contentCornerRadius))
                        .ignoresSafeArea(edges: .all)

                    // Top chrome overlay
                    VStack {
                        TopChromeView(state: chromeState)
                            // Extra height past the safe area gives the
                            // progressive blur room to feather out instead of
                            // cutting off hard at the status-bar line — and
                            // when scrolled content frosts the band, the clock
                            // keeps a comfortable legibility margin under it.
                            .frame(height: safeTop + 24, alignment: .top)
                            .opacity(chromeState.isVisible ? 1 : 0)
                            .offset(y: chromeState.isVisible ? 0 : -18)
                            .contentShape(Rectangle())
                            .highPriorityGesture(topHandleDragGesture(revealHeight: revealHeight))
                        Spacer()
                    }
                    .ignoresSafeArea(edges: .top)

                    // Dismiss overlay
                    if progress > 0.001 {
                        Color.black.opacity(0.15 * progress)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                closeDrawer()
                            }
                            .highPriorityGesture(contentDismissDragGesture(revealHeight: revealHeight))
                    }
                }
                .ignoresSafeArea()
                .clipShape(contentPanelShape)
                .overlay {
                    contentPanelShape
                        .stroke(Color.white.opacity(0.42 * progress), lineWidth: 0.8)
                        .opacity(progress)
                }
                .offset(y: progress * (revealHeight + phoneShellDrawerExtraContentOffset))
                .shadow(color: Color.black.opacity(0.08 * progress), radius: 10, x: 0, y: 2)
                .shadow(color: Color.black.opacity(0.12 * progress), radius: 18, x: 0, y: 8)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .clipped()
            .animation(.easeOut(duration: 0.18), value: chromeState.isVisible)
        }
        .ignoresSafeArea()
        .background(Color(UIColor.systemGroupedBackground))
    }

    private func resolvedDrawerRevealHeight(containerHeight: CGFloat, safeTop: CGFloat) -> CGFloat {
        let minimumHeight: CGFloat = 360
        let preferredHeight = safeTop + 500
        let maxHeight = containerHeight * 0.78
        return max(minimumHeight, min(preferredHeight, maxHeight))
    }

    private func closeDrawer() {
        withAnimation(.spring(response: 0.26, dampingFraction: 0.92)) {
            chromeState.drawerProgress = 0
        }
    }

    private func topHandleDragGesture(revealHeight: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 6, coordinateSpace: .local)
            .onChanged { value in
                if drawerDragStartProgress == nil {
                    drawerDragStartProgress = chromeState.drawerProgress
                }
                guard let startProgress = drawerDragStartProgress else { return }
                let nextProgress = min(max(startProgress + (value.translation.height / max(revealHeight, 1)), 0), 1)
                chromeState.drawerProgress = nextProgress
            }
            .onEnded { value in
                finishDrawerDrag(translation: value.translation.height, predictedEndTranslation: value.predictedEndTranslation.height, revealHeight: revealHeight)
            }
    }

    private func contentDismissDragGesture(revealHeight: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 6, coordinateSpace: .local)
            .onChanged { value in
                if drawerDragStartProgress == nil {
                    drawerDragStartProgress = chromeState.drawerProgress
                }
                guard let startProgress = drawerDragStartProgress else { return }
                let nextProgress = min(max(startProgress + (value.translation.height / max(revealHeight, 1)), 0), 1)
                chromeState.drawerProgress = nextProgress
            }
            .onEnded { value in
                finishDrawerDrag(translation: value.translation.height, predictedEndTranslation: value.predictedEndTranslation.height, revealHeight: revealHeight)
            }
    }

    private func finishDrawerDrag(translation: CGFloat, predictedEndTranslation: CGFloat, revealHeight: CGFloat) {
        let velocityEstimate = predictedEndTranslation - translation
        let predictedProgress = min(
            max((drawerDragStartProgress ?? chromeState.drawerProgress) + (predictedEndTranslation / max(revealHeight, 1)), 0),
            1
        )

        drawerDragStartProgress = nil

        let shouldOpen: Bool
        if velocityEstimate > phoneShellDrawerDismissVelocityThreshold {
            shouldOpen = true
        } else if velocityEstimate < -phoneShellDrawerDismissVelocityThreshold {
            shouldOpen = false
        } else {
            shouldOpen = predictedProgress >= phoneShellDrawerOpenThreshold
        }

        withAnimation(.spring(response: 0.26, dampingFraction: 0.92)) {
            chromeState.drawerProgress = shouldOpen ? 1 : 0
        }
    }
}

private struct BridgeControllerContainerView: UIViewControllerRepresentable {
    let controller: UIViewController

    func makeUIViewController(context: Context) -> UIViewController {
        controller
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

// MARK: - Liquid Glass Chrome

private struct LiquidGlassChromeView: View {
    let progress: CGFloat
    let cornerRadius: CGFloat

    private var intensity: CGFloat { 1 - pow(1 - min(progress, 1), 2) }

    var body: some View {
        GeometryReader { geo in
            let r = min(cornerRadius, geo.size.width / 2, geo.size.height / 2)

            ZStack {
                // Base blur material
                Rectangle().fill(.ultraThinMaterial)

                // Soft inner glow fading top-to-bottom
                LinearGradient(
                    stops: [
                        .init(color: .white.opacity(0.20 * intensity), location: 0.00),
                        .init(color: .white.opacity(0.05 * intensity), location: 0.55),
                        .init(color: .clear,                           location: 1.00),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )

                // Chromatic fringe — blue-to-pink dispersion at the glass rim
                VStack(spacing: 0) {
                    LinearGradient(
                        stops: [
                            .init(color: Color(red: 0.62, green: 0.88, blue: 1.00).opacity(0.26 * intensity), location: 0.0),
                            .init(color: Color(red: 1.00, green: 0.92, blue: 0.96).opacity(0.08 * intensity), location: 0.5),
                            .init(color: .clear, location: 1.0),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 14)
                    .blur(radius: 1.5)
                    Spacer()
                }

                // ── Symmetric top-edge specular ────────────────────────────
                // Stroke the exact RoundedRectangle shape used for clipShape —
                // this is mathematically symmetric on both sides by construction.
                // The mask fades it out before reaching the straight bottom edge,
                // so no artifacts appear at the lower corners.
                RoundedRectangle(cornerRadius: r, style: .continuous)
                    .stroke(Color.white, lineWidth: 2.5)
                    .blur(radius: 3.5)
                    .opacity(0.75 * intensity)
                    .mask(
                        LinearGradient(
                            stops: [
                                .init(color: .black,              location: 0.00),
                                .init(color: .black.opacity(0.65), location: 0.22),
                                .init(color: .clear,              location: 0.52),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )

                // ── Bottom seam shadow ─────────────────────────────────────
                // Softens the hard boundary where frosted glass meets web content.
                VStack(spacing: 0) {
                    Spacer()
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.11 * intensity)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 14)
                }
            }
        }
    }
}
