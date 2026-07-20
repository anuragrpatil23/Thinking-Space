import SwiftUI
import UIKit

/// Total height of the iPad top chrome below the status bar (a single
/// toolbar row: buttons + centered Files-style tab pill). Shared with
/// RootShellViewController (container constraint) and PhoneShellView (veil
/// depth) — keep the three in sync with the web's clearance rule in
/// index.css (48px).
let nativeChromePadBarHeight: CGFloat = 48

private enum NativeChromeMetrics {
    static let outerHorizontalPadding: CGFloat = 16
    static let padCompactButtonSize: CGFloat = 38
    static let padTabPillSegmentHeight: CGFloat = 30
    static let padTabPillMaxWidth: CGFloat = 520
    static let bottomChromeBottomPadding: CGFloat = 0
    static let floatingControlHeight: CGFloat = 40
    static let floatingCollapsedControlHeight: CGFloat = 34
    static let groupedControlHeight: CGFloat = 42
    static let groupedCollapsedControlHeight: CGFloat = 36
    static let iconButtonSize: CGFloat = 40
    static let collapsedIconButtonSize: CGFloat = 34
    static let floatingCornerRadius: CGFloat = 21
    static let smallCornerRadius: CGFloat = 15
    static let fixedTabSwitcherWidth: CGFloat = 204
}

private enum NativeTopDrawerMetrics {
    static let horizontalPadding: CGFloat = 20
    static let titleTopSpacing: CGFloat = 10
    static let sectionSpacing: CGFloat = 14
    static let maxContentWidth: CGFloat = 312
    static let sectionCornerRadius: CGFloat = 14
    static let sectionStrokeOpacity: CGFloat = 0.1
    static let rowHorizontalPadding: CGFloat = 12
    static let rowMinimumHeight: CGFloat = 46
    static let rowIconSize: CGFloat = 26
    static let rowIconCornerRadius: CGFloat = 8
    static let rowSpacing: CGFloat = 14
    static let dividerInset: CGFloat = 50
}

private func nativeTopDrawerSectionShape() -> RoundedRectangle {
    RoundedRectangle(cornerRadius: NativeTopDrawerMetrics.sectionCornerRadius, style: .continuous)
}

/// Key-window safe-area top. GeometryReader proxies inside `.ignoresSafeArea()`
/// subtrees report 0 insets, so both the top drawer and the phone shell's
/// status-bar scrim resolve the real inset from the window instead.
func resolvedNativeTopDrawerSafeAreaTopInset() -> CGFloat {
    UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
        .filter(\.isKeyWindow)
        .map(\.safeAreaInsets.top)
        .max() ?? 0
}

/// Liquid-glass capsule for the floating chrome controls. On iOS 26+ this is
/// the REAL system Liquid Glass (`glassEffect`) with actual lensing and
/// automatic light/dark adaptation. Older OSes get the hand-built
/// approximation: blur base, top specular highlight, and a gradient rim that
/// catches light at the top and dissolves at the bottom.
private struct FloatingGlassCapsuleView: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        if #available(iOS 26.0, *) {
            Color.clear
                .glassEffect(.regular.interactive(), in: Capsule())
        } else {
            legacyGlassCapsule
        }
    }

    @ViewBuilder
    private var legacyGlassCapsule: some View {
        let dark = colorScheme == .dark
        Capsule()
            .fill(.ultraThinMaterial)
            .overlay {
                // Top specular sheen — the "liquid" part of the glass.
                Capsule()
                    .fill(
                        LinearGradient(
                            stops: [
                                .init(color: .white.opacity(dark ? 0.10 : 0.32), location: 0.0),
                                .init(color: .clear, location: 0.55),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .allowsHitTesting(false)
            }
            .overlay {
                // Gradient rim: bright where light hits, fading out below.
                Capsule()
                    .stroke(
                        LinearGradient(
                            colors: [
                                .white.opacity(dark ? 0.26 : 0.7),
                                .white.opacity(dark ? 0.05 : 0.3),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 0.75
                    )
                    .allowsHitTesting(false)
            }
            .shadow(color: Color.black.opacity(dark ? 0.4 : 0.09), radius: 18, x: 0, y: 8)
    }
}

private func floatingChromeCapsule() -> some View {
    FloatingGlassCapsuleView()
}

// NOTE (2026-07-19): do NOT put `glassEffect` shapes inside a ScrollView
// (ghost backdrop copies at unscrolled positions) and do NOT wrap this bar
// in a GlassEffectContainer (washed every button into a translucent ghost).
// The Safari-style segmented tab bar avoids both by being flat translucency.

private func formatBadgeCount(_ count: Int) -> String {
    count > 99 ? "99+" : "\(max(0, count))"
}

private enum NativeTopDrawerIconStyle {
    case symbol(String)
}

private struct NativeTopDrawerItem: Identifiable {
    let id: String
    let title: String
    let iconStyle: NativeTopDrawerIconStyle
    let badgeColor: Color
}

private struct NativeTopDrawerSection: Identifiable {
    let id: String
    let title: String
    let items: [NativeTopDrawerItem]
}

private let nativeTopDrawerSections: [NativeTopDrawerSection] = [
    NativeTopDrawerSection(id: "core", title: "Core", items: [
        NativeTopDrawerItem(id: "/", title: "Home", iconStyle: .symbol("house"), badgeColor: .black),
        NativeTopDrawerItem(id: "/thinking-space", title: "Thinking Space", iconStyle: .symbol("safari"), badgeColor: .black),
        NativeTopDrawerItem(id: "/new-thought", title: "New Note", iconStyle: .symbol("plus.rectangle"), badgeColor: .black),
        NativeTopDrawerItem(id: "/git-insights", title: "Insights", iconStyle: .symbol("tuningfork"), badgeColor: .black),
        NativeTopDrawerItem(id: "/chat", title: "AI", iconStyle: .symbol("bubble.left"), badgeColor: .black),
        NativeTopDrawerItem(id: "/web", title: "Web", iconStyle: .symbol("globe"), badgeColor: .black),
        NativeTopDrawerItem(id: "/webull", title: "F9", iconStyle: .symbol("chart.xyaxis.line"), badgeColor: .black),
        NativeTopDrawerItem(id: "/thinking-organizer", title: "Thinking Organizer", iconStyle: .symbol("tablecells"), badgeColor: .black),
    ]),
    NativeTopDrawerSection(id: "workspace", title: "Workspace", items: [
        NativeTopDrawerItem(id: "/terminal", title: "Terminal", iconStyle: .symbol("terminal"), badgeColor: .black),
        NativeTopDrawerItem(id: "/settings", title: "Settings", iconStyle: .symbol("gearshape"), badgeColor: .black),
    ]),
    NativeTopDrawerSection(id: "search", title: "", items: [
        NativeTopDrawerItem(id: "search", title: "Search", iconStyle: .symbol("magnifyingglass"), badgeColor: .black),
    ]),
]

private struct NativeTopDrawerRowView: View {
    let item: NativeTopDrawerItem
    let active: Bool
    let action: () -> Void

    private var rowBackgroundColor: Color {
        .clear
    }

    private var rowForegroundColor: Color {
        Color.primary.opacity(0.9)
    }

    private var rowChevronColor: Color {
        Color.primary.opacity(0.42)
    }

    private var iconBackgroundColor: Color {
        active ? item.badgeColor : Color.white.opacity(0.14)
    }

    private var iconForegroundColor: Color {
        active ? .white : .primary
    }

    private var iconStrokeColor: Color {
        active ? item.badgeColor : Color.white.opacity(0.28)
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: NativeTopDrawerMetrics.rowSpacing) {
                iconView

                Text(item.title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(rowForegroundColor)
                    .lineLimit(1)

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(rowChevronColor)
            }
            .padding(.horizontal, NativeTopDrawerMetrics.rowHorizontalPadding)
            .frame(minHeight: NativeTopDrawerMetrics.rowMinimumHeight)
            .background(rowBackgroundColor)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var iconView: some View {
        switch item.iconStyle {
        case .symbol(let systemImage):
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(iconForegroundColor)
                .frame(width: NativeTopDrawerMetrics.rowIconSize, height: NativeTopDrawerMetrics.rowIconSize)
                .background(
                    RoundedRectangle(cornerRadius: NativeTopDrawerMetrics.rowIconCornerRadius, style: .continuous)
                        .fill(iconBackgroundColor)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: NativeTopDrawerMetrics.rowIconCornerRadius, style: .continuous)
                        .stroke(iconStrokeColor, lineWidth: 0.75)
                )
        }
    }
}

private struct NativeTopDrawerSectionCardView: View {
    let state: TopChromeState
    let section: NativeTopDrawerSection
    let onSelectNavItem: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(section.items.enumerated()), id: \.element.id) { index, item in
                NativeTopDrawerRowView(
                    item: item,
                    active: state.activeNavItemId == item.id,
                    action: { onSelectNavItem(item.id) }
                )

                if index < section.items.count - 1 {
                    Divider()
                        .padding(.leading, NativeTopDrawerMetrics.dividerInset)
                }
            }
        }
        .background {
            nativeTopDrawerSectionShape()
                .fill(.ultraThinMaterial)
                .overlay {
                    nativeTopDrawerSectionShape()
                        .fill(Color.white.opacity(0.08))
                }
        }
        .clipShape(nativeTopDrawerSectionShape())
        .overlay {
            nativeTopDrawerSectionShape()
                .stroke(Color.white.opacity(0.34), lineWidth: 0.8)
        }
        .shadow(color: Color.black.opacity(0.08), radius: 16, x: 0, y: 8)
    }
}

// MARK: - Top Chrome (adaptive status-bar scrim)

/// Instagram/Safari-style status-bar treatment: an always-on *progressive*
/// blur — strong right under the clock, feathering out toward the content —
/// keeps the status glyphs legible no matter what scrolls beneath, without
/// ever reading as an opaque bar. The veil is STATIC (decided 2026-07-19):
/// scroll no longer deepens the mask — the earlier scroll-linked "breathing"
/// read as the bar visibly changing mid-scroll, which felt like a glitch.
/// Dark mode is inherited from the root trait override in
/// RootShellViewController — no per-view color scheme handling here.
struct TopChromeView: View {
    @ObservedObject var state: TopChromeState
    @Environment(\.colorScheme) private var colorScheme

    /// iPad (Files-app model, decided 2026-07-19): the veil is tall enough
    /// to hold the whole top-bar button zone, so the mask stays solid much
    /// deeper before feathering — content scrolls under the buttons through
    /// frosted glass, not past a thin status strip.
    var coversPadBarZone: Bool = false

    /// Instagram model: the veil is GLASS, not frost — content color bleeds
    /// through and the mask fades early. Same soft short mask at rest and
    /// while scrolling.
    private var maskStops: [Gradient.Stop] {
        coversPadBarZone
            ? [
                .init(color: .black, location: 0.0),
                .init(color: .black, location: 0.72),
                .init(color: .black.opacity(0.5), location: 0.86),
                .init(color: .clear, location: 1.0),
            ]
            : [
                .init(color: .black, location: 0.0),
                .init(color: .black, location: 0.3),
                .init(color: .black.opacity(0.5), location: 0.6),
                .init(color: .clear, location: 1.0),
            ]
    }

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)

            // Whisper of tint to keep the status glyphs legible, mirrored per
            // scheme. Kept faint on purpose — the glass should refract the
            // content's own color, not paint over it.
            LinearGradient(
                stops: colorScheme == .dark
                    ? [
                        .init(color: .black.opacity(0.22), location: 0.0),
                        .init(color: .black.opacity(0.08), location: 0.6),
                        .init(color: .clear, location: 1.0),
                    ]
                    : [
                        .init(color: .white.opacity(0.16), location: 0.0),
                        .init(color: .white.opacity(0.06), location: 0.6),
                        .init(color: .clear, location: 1.0),
                    ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .mask(
            LinearGradient(stops: maskStops, startPoint: .top, endPoint: .bottom)
        )
    }
}

struct TopChromeDrawerButtonView: View {
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(active ? Color.accentColor : .primary)
                .frame(width: NativeChromeMetrics.iconButtonSize, height: NativeChromeMetrics.iconButtonSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(active ? "Close navigation" : "Open navigation")
        .padding(6)
        .background {
            floatingChromeCapsule()
                .overlay {
                    if active {
                        Capsule()
                            .stroke(Color.accentColor.opacity(0.28), lineWidth: 1)
                    }
                }
        }
    }
}

struct TopDrawerMenuView: View {
    @ObservedObject var state: TopChromeState

    let onSelectNavItem: (String) -> Void

    var body: some View {
        GeometryReader { proxy in
            let safeTopInset = max(proxy.safeAreaInsets.top, resolvedNativeTopDrawerSafeAreaTopInset())

            ScrollView {
                LazyVStack(alignment: .leading, spacing: NativeTopDrawerMetrics.sectionSpacing) {
                    Text("Thinking Space")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(Color.primary.opacity(0.92))
                        .padding(.bottom, 2)

                    ForEach(nativeTopDrawerSections) { section in
                        VStack(alignment: .leading, spacing: 8) {
                            if !section.title.isEmpty {
                                Text(section.title)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Color.primary.opacity(0.42))
                                    .padding(.horizontal, 2)
                            }

                            NativeTopDrawerSectionCardView(
                                state: state,
                                section: section,
                                onSelectNavItem: onSelectNavItem
                            )
                        }
                    }
                }
                .frame(maxWidth: NativeTopDrawerMetrics.maxContentWidth)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, NativeTopDrawerMetrics.horizontalPadding)
                .padding(.top, safeTopInset + NativeTopDrawerMetrics.titleTopSpacing)
                .padding(.bottom, 28)
            }
        }
        .background {
            ZStack {
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .opacity(0.82)

                LinearGradient(
                    stops: [
                        .init(color: Color.white.opacity(0.22), location: 0.0),
                        .init(color: Color.white.opacity(0.08), location: 0.3),
                        .init(color: Color.clear, location: 0.85),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )

                LinearGradient(
                    stops: [
                        .init(color: Color(red: 0.86, green: 0.9, blue: 1.0).opacity(0.16), location: 0.0),
                        .init(color: Color(red: 1.0, green: 0.95, blue: 0.98).opacity(0.08), location: 0.38),
                        .init(color: Color.clear, location: 1.0),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
            .ignoresSafeArea()
        }
    }
}

// MARK: - Bottom Chrome

struct BottomChromeView: View {
    @ObservedObject var state: TopChromeState

    /// iPad renders this chrome as a persistent TOP bar with a Safari-style
    /// tab strip (decided 2026-07-19): the floating phone dock read as a
    /// blown-up iPhone at 11–13", and iPad convention puts primary chrome at
    /// the top. Phone keeps the collapsing bottom dock.
    var padLayout: Bool = false

    let onDrawerToggleTap: () -> Void
    let onSidebarToggleTap: () -> Void
    let onBackTap: () -> Void
    let onSearchTap: () -> Void
    let onCreateTap: () -> Void
    let onExpandTap: () -> Void
    let onTabSwitcherWillPresent: () -> Void
    let onSelectTab: (String) -> Void
    let onCloseTab: (String) -> Void
    let onDebugTap: () -> Void
    let onRefreshTap: () -> Void
    let onSyncTap: () -> Void
    let onRebuildTap: () -> Void
    let onGitCommitTap: () -> Void
    let onGitPushTap: () -> Void
    let onHeaderToggleTap: () -> Void

    @State private var tabSwitcherPresented = false
    @State private var toolsMenuPresented = false

    var body: some View {
        if padLayout {
            padTopBar
        } else {
            phoneBottomBar
        }
    }

    // MARK: - iPad top bar

    /// Persistent top bar, ONE row (Files-app model, decided 2026-07-19,
    /// replacing the two-row Safari segmented bar — a lone tab stretched into
    /// a full-width strip read as a broken title bar): hamburger/back on the
    /// left, a centered glass pill holding the sidebar toggle + tab segments
    /// (active segment gets the soft highlight and its ✕), action buttons on
    /// the right. No scroll-collapse on iPad — the bar simply stays.
    private var padTopBar: some View {
        ZStack {
            HStack(spacing: 8) {
                // Landscape iPad shows the React desktop nav rail — the
                // native drawer would be a second nav, so the hamburger
                // hides. The slot still appears as a back button when the
                // push stack allows it.
                if !state.isPadLandscape || state.canGoBack {
                    padDrawerButton
                }

                // Landscape = web desktop layout; the side-panel toggle
                // separates out of the pill into its own glass button at the
                // far left, mirroring Electron's SidebarChromeButtonBlock
                // position. Portrait keeps it inside the Files-style pill.
                if state.isPadLandscape && state.canToggleSidebar {
                    padGlassIconButton(
                        systemName: state.sidebarToggleActive
                            ? "rectangle.lefthalf.inset.filled.arrow.left"
                            : "sidebar.left",
                        action: onSidebarToggleTap,
                        accessibilityLabel: state.sidebarToggleLabel
                    )
                    .animation(.easeInOut(duration: 0.22), value: state.sidebarToggleActive)
                }

                Spacer(minLength: 0)

                if state.showSearch {
                    padGlassIconButton(
                        systemName: "magnifyingglass",
                        action: onSearchTap,
                        accessibilityLabel: "Search"
                    )
                }

                padRefreshButton

                padOverflowMenu
            }

            padFilesTabPill
                .frame(maxWidth: NativeChromeMetrics.padTabPillMaxWidth)
        }
        .padding(.horizontal, NativeChromeMetrics.outerHorizontalPadding)
        .padding(.top, 2)
        .animation(.easeInOut(duration: 0.22), value: state.isPadLandscape)
    }

    private var padDrawerButton: some View {
        Button(action: {
            if state.canGoBack {
                onBackTap()
            } else {
                onDrawerToggleTap()
            }
        }) {
            morphingDrawerOrBackIcon
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(state.drawerProgress > 0.01 ? Color.accentColor : .primary)
                .frame(width: NativeChromeMetrics.padCompactButtonSize, height: NativeChromeMetrics.padCompactButtonSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(state.canGoBack ? "Back" : "Open navigation")
        .background {
            floatingChromeCapsule()
        }
        .animation(.easeInOut(duration: 0.22), value: state.canGoBack)
    }

    // MARK: - Files-style tab pill

    /// One centered glass capsule, exactly the Files-app top-center pill:
    /// sidebar toggle on the leading edge (when the surface has a native
    /// side panel), then the tab segments hugging their content — the
    /// active one carries the soft highlight and its ✕ — and the tab
    /// controls (+ new, grid switcher) folded into the trailing edge like
    /// Safari's tab bar. The pill never stretches: a single "Home" tab is a
    /// small centered chip, not a full-width strip. The grid button opens
    /// the switcher as an anchored POPOVER, not the phone's modal sheet.
    private var padFilesTabPill: some View {
        HStack(spacing: 2) {
            if state.canToggleSidebar && !state.isPadLandscape {
                padPillIconButton(
                    systemName: state.sidebarToggleActive
                        ? "rectangle.lefthalf.inset.filled.arrow.left"
                        : "sidebar.left",
                    action: onSidebarToggleTap,
                    accessibilityLabel: state.sidebarToggleLabel
                )
            }

            ForEach(state.tabs, id: \.id) { tab in
                padPillTabSegment(tab)
            }

            padPillDivider

            padPillIconButton(
                systemName: "plus",
                action: onCreateTap,
                accessibilityLabel: "Create note"
            )

            padPillIconButton(
                systemName: "square.grid.2x2",
                action: {
                    onTabSwitcherWillPresent()
                    tabSwitcherPresented = true
                },
                accessibilityLabel: "Tab switcher"
            )
            .popover(isPresented: $tabSwitcherPresented, arrowEdge: .top) {
                padTabSwitcherPopover
            }
        }
        .padding(.horizontal, 5)
        .frame(height: NativeChromeMetrics.padCompactButtonSize)
        .background {
            floatingChromeCapsule()
        }
        .animation(.easeInOut(duration: 0.18), value: state.tabs)
        .animation(.easeInOut(duration: 0.22), value: state.sidebarToggleActive)
    }

    private var padPillDivider: some View {
        Rectangle()
            .fill(Color.primary.opacity(0.14))
            .frame(width: 0.5, height: 16)
            .padding(.horizontal, 3)
    }

    private func padPillIconButton(
        systemName: String,
        action: @escaping () -> Void,
        accessibilityLabel: String
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.primary)
                .frame(width: 34, height: NativeChromeMetrics.padTabPillSegmentHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    /// Compact anchored version of the tab grid: no title row, cards sized
    /// for a popover (the phone's full-sheet grid blew up into giant cards
    /// inside the iPad form sheet). Width follows the card count so two
    /// tabs make a small two-up popover, not a screen-wide modal.
    private var padTabSwitcherPopover: some View {
        let cardCount = state.tabs.count + 1  // + the New Tab card
        let columns = min(max(cardCount, 2), 3)
        let cardWidth: CGFloat = 168
        let spacing = NativeTabGridMetrics.gridSpacing
        let width = CGFloat(columns) * cardWidth + CGFloat(columns - 1) * spacing + 40
        let rows = Int(ceil(Double(cardCount) / Double(columns)))
        let cardHeight = cardWidth / NativeTabGridMetrics.cardAspectRatio + 30
        let height = CGFloat(min(rows, 2)) * (cardHeight + NativeTabGridMetrics.rowSpacing) + 24

        return NativeTabSwitcherSheetView(
            state: state,
            compact: true,
            onSelectTab: { tabId in
                tabSwitcherPresented = false
                onSelectTab(tabId)
            },
            onCloseTab: onCloseTab,
            onCreateTap: {
                tabSwitcherPresented = false
                onCreateTap()
            }
        )
        .frame(width: width, height: height)
    }

    @ViewBuilder
    private func padPillTabSegment(_ tab: TopChromeTabItem) -> some View {
        let active = tab.active
        let closable = active && state.tabs.count > 1
        HStack(spacing: 5) {
            if closable {
                Button(action: { onCloseTab(tab.id) }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 20, height: 20)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close \(tab.label)")
            }

            Text(tab.label)
                .font(.system(size: 13, weight: active ? .semibold : .regular))
                .foregroundStyle(active ? Color.primary : Color.primary.opacity(0.7))
                .lineLimit(1)
        }
        .padding(.horizontal, closable ? 10 : 14)
        .frame(height: NativeChromeMetrics.padTabPillSegmentHeight)
        .background {
            if active {
                Capsule().fill(padActiveSegmentFill)
            }
        }
        .contentShape(Capsule())
        .onTapGesture {
            if !active {
                onSelectTab(tab.id)
            }
        }
    }

    @Environment(\.colorScheme) private var padColorScheme

    private var padActiveSegmentFill: Color {
        padColorScheme == .dark ? Color.white.opacity(0.14) : Color.black.opacity(0.07)
    }

    private var padOverflowMenu: some View {
        Menu {
            if state.canToggleHeader {
                Button(action: onHeaderToggleTap) {
                    Label(state.headerToggleLabel, systemImage: "switch.2")
                }
            }

            Button(action: onDebugTap) {
                Label("Debug Console", systemImage: "ladybug")
            }

            Button(action: onSyncTap) {
                Label("Sync Folder", systemImage: "arrow.triangle.2.circlepath")
            }
            .disabled(!state.canSync)

            Button(action: onRebuildTap) {
                Label("Rebuild Index + Cache", systemImage: "externaldrive")
            }
            .disabled(!state.canRebuild)

            if state.canGitCommit {
                Divider()

                Button(action: onGitCommitTap) {
                    Label("Git Commit", systemImage: "checkmark.circle")
                }
            }

            if state.canGitPush {
                Button(action: onGitPushTap) {
                    Label("Git Push", systemImage: "arrow.up.circle")
                }
            }
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "ellipsis")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.primary)
                    .frame(width: NativeChromeMetrics.padCompactButtonSize, height: NativeChromeMetrics.padCompactButtonSize)
                    .contentShape(Rectangle())

                if state.toolsBadgeCount > 0 {
                    Text(formatBadgeCount(state.toolsBadgeCount))
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .frame(minWidth: 15, minHeight: 15)
                        .background(Color.red)
                        .clipShape(Capsule())
                        .offset(x: 3, y: 0)
                }
            }
        }
        // Menus tint their label with the accent color regardless of the
        // label's own foregroundStyle — force the neutral primary.
        .buttonStyle(.plain)
        .tint(.primary)
        .background {
            floatingChromeCapsule()
        }
        .accessibilityLabel("More options")
    }

    /// Refresh + sync in one control: the arrow spins while a vault sync is
    /// in flight (state.syncActive from the web side), mirroring Electron's
    /// SyncRefreshButtonBlock. Tap still fires the plain UI refresh.
    private var padRefreshButton: some View {
        Button(action: onRefreshTap) {
            SyncSpinIconView(
                spinning: state.syncActive,
                size: 14,
                tint: state.canRefresh ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary)
            )
            .frame(width: NativeChromeMetrics.padCompactButtonSize, height: NativeChromeMetrics.padCompactButtonSize)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!state.canRefresh)
        .accessibilityLabel(state.syncActive ? "Syncing vault" : "Refresh workspace")
        .background {
            floatingChromeCapsule()
        }
    }

    /// Compact Safari-sized glass button — no outer padding halo; the glass
    /// capsule IS the 38pt hit target (the earlier 52pt capsules read as
    /// "huge", 2026-07-19).
    private func padGlassIconButton(
        systemName: String,
        action: @escaping () -> Void,
        accessibilityLabel: String,
        enabled: Bool = true
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(enabled ? .primary : .secondary)
                .frame(width: NativeChromeMetrics.padCompactButtonSize, height: NativeChromeMetrics.padCompactButtonSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(accessibilityLabel)
        .background {
            floatingChromeCapsule()
        }
    }

    // MARK: - Phone bottom bar

    @ViewBuilder
    private var phoneBottomBar: some View {
        // Safari model (decided 2026-07-19): at rest the bar is hamburger/back
        // + tabs pill + side-panel toggle + chevron menu. On scroll everything
        // except the pill scale-fades away and the pill shrinks into a single
        // small CENTERED chip (badge + current tab name) — one object, two
        // states, like Safari's minimized address bar. Tapping the chip (or
        // scrolling up) springs the full bar back.
        let collapsed = state.isBottomBarCollapsed
        HStack(spacing: 8) {
            if collapsed {
                Spacer(minLength: 0)
            } else {
                drawerToggleButton
                    .transition(chromeButtonTransition)
                if state.canToggleSidebar {
                    sidebarToggleButton
                        .transition(chromeButtonTransition)
                }
            }
            morphingBottomPill
            if collapsed {
                Spacer(minLength: 0)
            } else {
                toolsMenuButton
                    .padding(6)
                    .background {
                        floatingChromeCapsule()
                    }
                    .transition(chromeButtonTransition)
            }
        }
        .padding(.horizontal, NativeChromeMetrics.outerHorizontalPadding)
        .padding(.top, 4)
        .padding(.bottom, NativeChromeMetrics.bottomChromeBottomPadding)
        .animation(.spring(response: 0.34, dampingFraction: 0.86), value: state.isBottomBarCollapsed)
    }

    private var chromeButtonTransition: AnyTransition {
        .scale(scale: 0.6).combined(with: .opacity)
    }

    // MARK: - More menu (search + tools combined)

    private var toolsMenuButton: some View {
        Button(action: { toolsMenuPresented = true }) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: toolsMenuPresented ? "chevron.down" : "chevron.up")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: NativeChromeMetrics.iconButtonSize, height: NativeChromeMetrics.iconButtonSize)
                    .contentShape(Rectangle())

                if state.toolsBadgeCount > 0 {
                    Text(formatBadgeCount(state.toolsBadgeCount))
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Color.red)
                        .clipShape(Capsule())
                        .offset(x: 5, y: -4)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("More options")
        .confirmationDialog("More Options", isPresented: $toolsMenuPresented, titleVisibility: .visible) {
            if state.showSearch {
                Button(action: onSearchTap) {
                    Label("Search", systemImage: "magnifyingglass")
                }
            }

            if state.canToggleHeader {
                Button(action: onHeaderToggleTap) {
                    Label(state.headerToggleLabel, systemImage: "switch.2")
                }
            }

            Button(action: onDebugTap) {
                Label("Debug Console", systemImage: "ladybug")
            }

            Button(action: onRefreshTap) {
                Label("Refresh Workspace", systemImage: "arrow.clockwise")
            }
            .disabled(!state.canRefresh)

            Button(action: onSyncTap) {
                Label("Sync Folder", systemImage: "arrow.triangle.2.circlepath")
            }
            .disabled(!state.canSync)

            Button(action: onRebuildTap) {
                Label("Rebuild Index + Cache", systemImage: "externaldrive")
            }
            .disabled(!state.canRebuild)

            if state.canGitCommit {
                Divider()

                Button(action: onGitCommitTap) {
                    Label("Git Commit", systemImage: "checkmark.circle")
                }
            }

            if state.canGitPush {
                Button(action: onGitPushTap) {
                    Label("Git Push", systemImage: "arrow.up.circle")
                }
            }
        }
    }

    private var drawerToggleButton: some View {
        // Morphs between hamburger (≡) and back chevron (←) based on
        // canGoBack — the iOS-app pattern where the same chrome slot does
        // "open menu" at root and "go back" once you've drilled in.
        Button(action: {
            if state.canGoBack {
                onBackTap()
            } else {
                onDrawerToggleTap()
            }
        }) {
            morphingDrawerOrBackIcon
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(state.drawerProgress > 0.01 ? Color.accentColor : .primary)
                .frame(width: NativeChromeMetrics.iconButtonSize, height: NativeChromeMetrics.iconButtonSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            state.canGoBack
                ? "Back"
                : (state.drawerProgress > 0.01 ? "Close navigation" : "Open navigation")
        )
        .padding(6)
        .background {
            floatingChromeCapsule()
        }
        .animation(.easeInOut(duration: 0.22), value: state.canGoBack)
    }

    private var sidebarToggleButton: some View {
        // Mirrors Electron's SidebarChromeButtonBlock: toggles the current
        // page's side panel (explorer/chat list/etc), NOT the nav drawer.
        // Same icon language too — panel-close glyph while the panel is
        // open, plain panel glyph while collapsed.
        Button(action: onSidebarToggleTap) {
            Image(systemName: state.sidebarToggleActive
                ? "rectangle.lefthalf.inset.filled.arrow.left"
                : "sidebar.left")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.primary)
                .frame(width: NativeChromeMetrics.iconButtonSize, height: NativeChromeMetrics.iconButtonSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(state.sidebarToggleLabel)
        .padding(6)
        .background {
            floatingChromeCapsule()
        }
        .animation(.easeInOut(duration: 0.22), value: state.sidebarToggleActive)
    }

    @ViewBuilder
    private var morphingDrawerOrBackIcon: some View {
        let symbolName = state.canGoBack ? "chevron.backward" : "line.3.horizontal"
        let img = Image(systemName: symbolName)
        if #available(iOS 17.0, *) {
            // SF Symbol replace transition for the slick morph on modern iOS.
            img.contentTransition(.symbolEffect(.replace))
        } else {
            // Plain fade transition on older OS — the .animation modifier on
            // the parent button picks this up.
            img
        }
    }

    // MARK: - Tab controls

    private var activeTabLabel: String {
        state.tabs.first(where: { $0.active })?.label ?? "Tabs"
    }

    /// A single pill that continuously morphs between the expanded state
    /// (full-width tab switcher + create button) and the collapsed state (a
    /// content-hugging "Tabs" chip). Keeping it one view tree — rather than
    /// swapping two separate pills — lets the parent's spring animation
    /// interpolate the capsule width, badge size, label and padding smoothly
    /// instead of cross-fading between two layouts.
    private var morphingBottomPill: some View {
        let collapsed = state.isBottomBarCollapsed
        return HStack(spacing: 2) {
            Button(action: {
                if collapsed {
                    onExpandTap()
                } else {
                    onTabSwitcherWillPresent()
                    tabSwitcherPresented = true
                }
            }) {
                HStack(spacing: 9) {
                    tabCountBadge
                        .frame(width: collapsed ? 20 : 24, height: collapsed ? 18 : 20)

                    // Vault-sync heartbeat: a small accent arrow spins beside
                    // the badge while the web side reports a sync in flight —
                    // visible in both the full bar and the minimized chip.
                    if state.syncActive {
                        SyncSpinIconView(
                            spinning: true,
                            size: collapsed ? 11 : 12,
                            tint: AnyShapeStyle(Color.accentColor)
                        )
                        .transition(.scale(scale: 0.5).combined(with: .opacity))
                    }

                    // Safari-style: the minimized chip keeps showing WHERE you
                    // are (active tab name), not a generic "Tabs" word.
                    Text(activeTabLabel)
                        .font(.system(size: collapsed ? 13 : 15, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .frame(maxWidth: collapsed ? nil : .infinity, alignment: .leading)
                }
                .padding(.horizontal, collapsed ? 13 : 18)
                .frame(maxWidth: collapsed ? nil : .infinity, alignment: .leading)
                .frame(height: collapsed
                    ? NativeChromeMetrics.floatingCollapsedControlHeight
                    : NativeChromeMetrics.floatingControlHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(collapsed ? "Expand tab controls" : "Tab switcher")

            if !collapsed {
                bottomBarIconButton(
                    systemName: "plus",
                    action: onCreateTap,
                    accessibilityLabel: "Create note",
                    enabled: true
                )
                .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        .frame(maxWidth: collapsed ? nil : .infinity)
        .background {
            floatingChromeCapsule()
        }
        .sheet(isPresented: $tabSwitcherPresented) {
            tabSwitcherSheet
        }
        .animation(.easeInOut(duration: 0.2), value: state.syncActive)
    }

    @ViewBuilder
    private var tabSwitcherSheet: some View {
        let content = NativeTabSwitcherSheetView(
            state: state,
            onSelectTab: { tabId in
                tabSwitcherPresented = false
                onSelectTab(tabId)
            },
            onCloseTab: onCloseTab,
            onCreateTap: {
                tabSwitcherPresented = false
                onCreateTap()
            }
        )

        if #available(iOS 16.0, *) {
            content
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        } else {
            content
        }
    }

    private func bottomBarIconButton(
        systemName: String,
        action: @escaping () -> Void,
        accessibilityLabel: String,
        enabled: Bool
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(enabled ? .primary : .secondary)
                .frame(width: NativeChromeMetrics.iconButtonSize, height: NativeChromeMetrics.floatingControlHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(accessibilityLabel)
    }

    private var tabCountBadge: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6.5, style: .continuous)
                .fill(Color.primary.opacity(0.09))

            RoundedRectangle(cornerRadius: 6.5, style: .continuous)
                .stroke(Color.primary.opacity(0.18), lineWidth: 0.8)

            Text("\(max(state.tabs.count, 1))")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.primary)
        }
    }
}

// MARK: - Sync spin icon

/// The refresh arrow that doubles as the vault-sync indicator. While
/// `spinning` it rotates continuously; when the sync ends it settles
/// without snapping (the repeatForever animation is replaced by a short
/// ease-out back to rest).
private struct SyncSpinIconView: View {
    let spinning: Bool
    let size: CGFloat
    let tint: AnyShapeStyle

    @State private var angle: Double = 0

    var body: some View {
        Image(systemName: "arrow.clockwise")
            .font(.system(size: size, weight: .medium))
            .foregroundStyle(tint)
            .rotationEffect(.degrees(angle))
            .onAppear {
                if spinning { startSpin() }
            }
            .onChange(of: spinning) { isSpinning in
                if isSpinning {
                    startSpin()
                } else {
                    withAnimation(.easeOut(duration: 0.3)) {
                        angle = 0
                    }
                }
            }
    }

    private func startSpin() {
        angle = 0
        withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) {
            angle = 360
        }
    }
}

// MARK: - Tab Switcher Sheet (Safari-style card grid)

private enum NativeTabGridMetrics {
    static let cardCornerRadius: CGFloat = 18
    static let cardAspectRatio: CGFloat = 0.74
    static let gridSpacing: CGFloat = 14
    static let rowSpacing: CGFloat = 20
    static let activeRingWidth: CGFloat = 2.5
}

private func nativeTabCardShape() -> RoundedRectangle {
    RoundedRectangle(cornerRadius: NativeTabGridMetrics.cardCornerRadius, style: .continuous)
}

/// One tab card: live snapshot (or a monogram placeholder until the tab has
/// been visited), accent ring on the active tab, floating ✕, label beneath.
private struct NativeTabCardView: View {
    let tab: TopChromeTabItem
    let snapshot: UIImage?
    let showClose: Bool
    let onSelect: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            ZStack(alignment: .topTrailing) {
                Button(action: onSelect) {
                    Color.clear
                        .aspectRatio(NativeTabGridMetrics.cardAspectRatio, contentMode: .fit)
                        .overlay {
                            if let snapshot {
                                Image(uiImage: snapshot)
                                    .resizable()
                                    .scaledToFill()
                            } else {
                                monogramPlaceholder
                            }
                        }
                        .clipShape(nativeTabCardShape())
                        .contentShape(nativeTabCardShape())
                }
                .buttonStyle(.plain)

                if showClose {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.primary.opacity(0.85))
                            .frame(width: 26, height: 26)
                            .background(.thinMaterial, in: Circle())
                            .overlay {
                                Circle().stroke(Color.white.opacity(0.18), lineWidth: 0.6)
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close \(tab.label)")
                    .padding(7)
                }
            }
            .overlay {
                nativeTabCardShape()
                    .stroke(
                        tab.active ? Color.accentColor : Color.primary.opacity(0.12),
                        lineWidth: tab.active ? NativeTabGridMetrics.activeRingWidth : 1
                    )
            }
            .shadow(color: Color.black.opacity(0.18), radius: 12, x: 0, y: 6)

            Text(tab.label)
                .font(.system(size: 13, weight: tab.active ? .semibold : .medium))
                .foregroundStyle(tab.active ? Color.primary : Color.secondary)
                .lineLimit(1)
                .padding(.horizontal, 4)
        }
    }

    /// Un-visited tabs have no snapshot yet — show a soft glass card with the
    /// tab's initial instead of a generic icon, so cards stay tellable apart.
    private var monogramPlaceholder: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            LinearGradient(
                colors: [Color.white.opacity(0.10), Color.white.opacity(0.02)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Text(String(tab.label.prefix(1)).uppercased())
                .font(.system(size: 42, weight: .semibold, design: .rounded))
                .foregroundStyle(Color.primary.opacity(0.22))
        }
    }
}

private struct NativeTabSwitcherSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var state: TopChromeState

    /// Popover mode (iPad pill): no title row, cards at a fixed compact
    /// size — the host sizes the popover frame to the card count. The
    /// phone keeps the full sheet with the Tabs/Done header.
    var compact: Bool = false

    let onSelectTab: (String) -> Void
    let onCloseTab: (String) -> Void
    let onCreateTap: () -> Void

    private var columns: [GridItem] {
        if compact {
            return [GridItem(.adaptive(minimum: 150, maximum: 200), spacing: NativeTabGridMetrics.gridSpacing)]
        }
        return [
            GridItem(.flexible(), spacing: NativeTabGridMetrics.gridSpacing),
            GridItem(.flexible(), spacing: NativeTabGridMetrics.gridSpacing),
        ]
    }

    var body: some View {
        VStack(spacing: 0) {
            if !compact {
                HStack {
                    Text("Tabs")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(.primary)

                    Spacer()

                    Button("Done") { dismiss() }
                        .font(.system(size: 16, weight: .semibold))
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.accentColor)
                }
                .padding(.horizontal, 20)
                .padding(.top, 22)
                .padding(.bottom, 10)
            }

            ScrollView {
                LazyVGrid(columns: columns, spacing: NativeTabGridMetrics.rowSpacing) {
                    ForEach(state.tabs) { tab in
                        NativeTabCardView(
                            tab: tab,
                            snapshot: state.tabSnapshots[tab.id],
                            showClose: state.tabs.count > 1,
                            onSelect: { onSelectTab(tab.id) },
                            onClose: { onCloseTab(tab.id) }
                        )
                        .transition(.scale(scale: 0.85).combined(with: .opacity))
                    }

                    newTabCard
                }
                .padding(.horizontal, 20)
                .padding(.top, compact ? 16 : 8)
                .padding(.bottom, compact ? 16 : 28)
                .animation(.spring(response: 0.34, dampingFraction: 0.86), value: state.tabs)
            }
        }
    }

    private var newTabCard: some View {
        VStack(spacing: 8) {
            Button(action: onCreateTap) {
                Color.clear
                    .aspectRatio(NativeTabGridMetrics.cardAspectRatio, contentMode: .fit)
                    .overlay {
                        Image(systemName: "plus")
                            .font(.system(size: 26, weight: .medium))
                            .foregroundStyle(Color.primary.opacity(0.55))
                    }
                    .background {
                        nativeTabCardShape()
                            .fill(Color.primary.opacity(0.045))
                    }
                    .overlay {
                        nativeTabCardShape()
                            .strokeBorder(
                                Color.primary.opacity(0.22),
                                style: StrokeStyle(lineWidth: 1.2, dash: [6, 5])
                            )
                    }
                    .contentShape(nativeTabCardShape())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("New tab")

            Text("New Tab")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.secondary)
        }
    }
}
