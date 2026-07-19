import SwiftUI
import UIKit

private enum NativeChromeMetrics {
    static let outerHorizontalPadding: CGFloat = 16
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

private func floatingChromeCapsule() -> some View {
    Capsule()
        .fill(.ultraThinMaterial)
        .overlay {
            Capsule()
                .stroke(Color.white.opacity(0.6), lineWidth: 0.75)
        }
        .shadow(color: Color.black.opacity(0.09), radius: 18, x: 0, y: 8)
}

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

/// Instagram-style status-bar treatment: an always-on *progressive* blur —
/// strong right under the clock, feathering out toward the content — keeps the
/// status glyphs legible no matter what scrolls beneath, without ever reading
/// as an opaque bar. When the page scrolls (`isTopBarCollapsed`, set by the
/// App.tsx native chrome scroll handler) the scrim deepens to a full frosted
/// band with a hairline seam, then relaxes back to the feathered fade at rest.
struct TopChromeView: View {
    @ObservedObject var state: TopChromeState

    var body: some View {
        ZStack(alignment: .bottom) {
            // Resting scrim: material masked by a vertical fade. Solid across
            // the status-bar glyphs, dissolving before the frame's bottom edge
            // so content appears to slide "into" the blur, Instagram-style.
            Rectangle()
                .fill(.ultraThinMaterial)
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .black, location: 0.0),
                            .init(color: .black, location: 0.5),
                            .init(color: .black.opacity(0.6), location: 0.72),
                            .init(color: .clear, location: 1.0),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .opacity(state.isTopBarCollapsed ? 0 : 1)

            // Scrolled scrim: full frosted band edge-to-edge.
            Rectangle()
                .fill(.ultraThinMaterial)
                .opacity(state.isTopBarCollapsed ? 1 : 0)

            // Hairline seam under the frosted bar, only while frosted.
            Rectangle()
                .fill(Color.primary.opacity(0.08))
                .frame(height: 0.5)
                .opacity(state.isTopBarCollapsed ? 1 : 0)
        }
        .animation(.easeInOut(duration: 0.24), value: state.isTopBarCollapsed)
        // The web reports whether the content under the status bar is dark
        // (night backdrop / dark theme). Rendering the materials in the
        // matching color scheme keeps the scrim a subtle darkening veil there
        // instead of a pale frosted band over a dark canvas.
        .environment(\.colorScheme, state.isTopBarDark ? .dark : .light)
        .animation(.easeInOut(duration: 0.24), value: state.isTopBarDark)
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

    let onDrawerToggleTap: () -> Void
    let onBackTap: () -> Void
    let onSearchTap: () -> Void
    let onCreateTap: () -> Void
    let onExpandTap: () -> Void
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
        // Layout: hamburger/back morph button on the LEFT, tabs pill in the
        // middle, chevron-up "more options" menu on the RIGHT. The dedicated
        // sidebar-toggle button was removed — sidebar visibility is now
        // driven entirely by the list/detail mode on iPhone.
        HStack(spacing: 8) {
            drawerToggleButton
            morphingBottomPill
            if state.isBottomBarCollapsed {
                Spacer(minLength: 0)
            }
            toolsMenuButton
                .padding(6)
                .background {
                    floatingChromeCapsule()
                }
        }
        .padding(.horizontal, NativeChromeMetrics.outerHorizontalPadding)
        .padding(.top, 4)
        .padding(.bottom, NativeChromeMetrics.bottomChromeBottomPadding)
        .animation(.spring(response: 0.34, dampingFraction: 0.86), value: state.isBottomBarCollapsed)
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
                    tabSwitcherPresented = true
                }
            }) {
                HStack(spacing: 9) {
                    tabCountBadge
                        .frame(width: collapsed ? 20 : 24, height: collapsed ? 18 : 20)

                    Text(collapsed ? "Tabs" : activeTabLabel)
                        .font(.system(size: collapsed ? 14 : 15, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .frame(maxWidth: collapsed ? nil : .infinity, alignment: .leading)
                }
                .padding(.horizontal, collapsed ? 13 : 18)
                .frame(maxWidth: collapsed ? nil : .infinity, alignment: .leading)
                .frame(height: NativeChromeMetrics.floatingControlHeight)
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
    }

    @ViewBuilder
    private var tabSwitcherSheet: some View {
        let content = NativeTabSwitcherSheetView(
            tabs: state.tabs,
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

// MARK: - Tab Switcher Sheet

private struct NativeTabSwitcherSheetView: View {
    @Environment(\.dismiss) private var dismiss

    let tabs: [TopChromeTabItem]
    let onSelectTab: (String) -> Void
    let onCloseTab: (String) -> Void
    let onCreateTap: () -> Void

    var body: some View {
        NavigationView {
            List {
                ForEach(tabs) { tab in
                    HStack(spacing: 12) {
                        Button(action: { onSelectTab(tab.id) }) {
                            HStack(spacing: 12) {
                                Image(systemName: tab.active ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(tab.active ? .blue : .secondary)

                                Text(tab.label)
                                    .font(.system(size: 17, weight: tab.active ? .semibold : .regular))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        if tabs.count > 1 {
                            Button(action: { onCloseTab(tab.id) }) {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Close \(tab.label)")
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Tabs")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .primaryAction) {
                    Button(action: onCreateTap) {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Create tab")
                }
            }
        }
    }
}
