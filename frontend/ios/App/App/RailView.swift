import SwiftUI

/// Source of an icon:
///   - `system`:   an SF Symbol, rendered as a monochrome glyph.
///   - `asset`:    a full-color image rendered app-icon style (rounded corners,
///                 full bleed) — used for the colorful tree-of-life Home mark.
///   - `template`: a monochrome vector asset (the real lucide/phosphor glyphs
///                 bundled from the web nav) rendered as a tintable template so
///                 the drawer is pixel-identical to the Electron rail.
enum RailIcon: Equatable {
    case system(String)
    case asset(String)
    case template(String)
}

/// `id` is the canonical route path — same value the React side sends as
/// `navItemId` (see frontend/src/App.tsx handleNativeTopDrawerNavItemTap).
struct RailTab: Identifiable, Equatable {
    let id: String
    let title: String
    let icon: RailIcon
    /// Additional pathnames that should also light up this tab as selected.
    /// Mirrors `activePaths` on the matching nav item in frontend/src/App.tsx.
    let activePaths: [String]
}

final class RailState: ObservableObject {
    @Published var tabs: [RailTab] = RailState.defaultTabs
    @Published var selectedId: String = "/"

    /// MANUAL SYNC REQUIRED: this list is hardcoded and must be kept in sync by
    /// hand with the React nav source of truth — `PRIMARY_NAV_ITEMS` and
    /// `TOOLS_NAV_ITEM` in frontend/src/App.tsx. (We deliberately do NOT
    /// data-drive this from React via the bridge — that caused ordering/timing
    /// problems, so the rail stays static here.)
    ///
    /// AI, Web and Insights are intentionally NOT top-level rail tabs: they live
    /// inside the Tools shell now. The Tools tab (`/tools`) covers them via
    /// `activePaths` so it stays highlighted on those routes — mirroring
    /// `nativeTopDrawerActiveNavItemId` in App.tsx, which funnels all tool
    /// sub-routes to `/tools`.
    ///
    /// Keep order AND icons matched to the React nav. The glyphs below are the
    /// EXACT lucide/phosphor icons the Electron rail uses, bundled as template
    /// vector assets (see Assets.xcassets/Rail*Icon.imageset) so the two shells
    /// render identical marks. Source of truth: PRIMARY_NAV_ITEMS in App.tsx.
    ///   Home             RailHomeIcon      (tree-of-life, full color)
    ///   Thinking Space   RailExplorerIcon  ↔ lucide Compass
    ///   New Note         RailNewNoteIcon   ↔ NewNoteNavIcon (rounded SquarePen)
    ///   Webull           chart.line…       ↔ WebullNavIcon (user-renamable; SF)
    ///   Thinking Organizer RailOrganizerIcon ↔ phosphor TreeView
    ///   Tools            RailToolsIcon     ↔ ToolsShapesNavIcon (Shapes)
    static let defaultTabs: [RailTab] = [
        RailTab(id: "/",                   title: "Home",               icon: .asset("RailHomeIcon"),                  activePaths: []),
        RailTab(id: "/thinking-space",     title: "Thinking Space Explorer", icon: .template("RailExplorerIcon"),      activePaths: []),
        RailTab(id: "/new-thought",        title: "New Note",           icon: .template("RailNewNoteIcon"),            activePaths: []),
        RailTab(id: "/webull",             title: "Webull",             icon: .system("chart.line.uptrend.xyaxis"),    activePaths: []),
        RailTab(id: "/thinking-organizer", title: "Thinking Organizer", icon: .template("RailOrganizerIcon"),          activePaths: ["/file-organizer"]),
        RailTab(id: "/tools",              title: "Tools",              icon: .template("RailToolsIcon"),              activePaths: [
            "/ai/chat", "/ai/schedules", "/web", "/git-insights",
            "/excalidraw-plus", "/capabilities", "/extension-builder",
            "/terminal", "/password-manager", "/personal-tools", "/personal-extension",
        ]),
    ]

    /// Resolve the selected tab from a current path. Used when React pushes
    /// route changes to Swift so the rail highlight stays in sync.
    func selectTab(forPath path: String) {
        if let match = tabs.first(where: { $0.id == path || $0.activePaths.contains(path) }) {
            selectedId = match.id
        }
    }

    /// Override the label for a tab. Used when React tells us a user-configured
    /// label (e.g. the user-renamed Webull → "F9"). No-op if no tab matches.
    func setLabel(forPath path: String, _ label: String) {
        guard !label.isEmpty else { return }
        guard let idx = tabs.firstIndex(where: { $0.id == path }) else { return }
        let old = tabs[idx]
        guard old.title != label else { return }
        tabs[idx] = RailTab(id: old.id, title: label, icon: old.icon, activePaths: old.activePaths)
    }
}

struct RailView: View {
    @ObservedObject var headerState: DrawerHeaderState
    @ObservedObject var railState: RailState
    var onSelect: (RailTab) -> Void
    var onClose: () -> Void

    // Follows the trait override RootShellViewController applies to the drawer
    // container when the web reports a dark surface (isTopBarDark).
    @Environment(\.colorScheme) private var colorScheme

    private let beigeBackground = Color(red: 245.0 / 255.0, green: 243.0 / 255.0, blue: 238.0 / 255.0)
    private let nightBackground = Color(red: 24.0 / 255.0, green: 24.0 / 255.0, blue: 28.0 / 255.0)

    var body: some View {
        VStack(spacing: 0) {
            DrawerHeaderView(state: headerState, onClose: onClose)

            ScrollView {
                VStack(spacing: 2) {
                    ForEach(railState.tabs) { tab in
                        RailRow(
                            tab: tab,
                            isSelected: tab.id == railState.selectedId,
                            onTap: { onSelect(tab) }
                        )
                    }
                }
                .padding(.horizontal, 8)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
        }
        .background((colorScheme == .dark ? nightBackground : beigeBackground).ignoresSafeArea())
    }
}

private struct RailRow: View {
    let tab: RailTab
    let isSelected: Bool
    let onTap: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var pressed: Bool = false

    private var selectedFill: Color {
        colorScheme == .dark ? Color.white.opacity(0.10) : Color.white.opacity(0.7)
    }

    private var pressedFill: Color {
        colorScheme == .dark ? Color.white.opacity(0.05) : Color.black.opacity(0.04)
    }

    private var mutedIconColor: Color {
        colorScheme == .dark ? Color(white: 0.72) : Color(white: 0.35)
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                iconView
                    .frame(width: 28, height: 28)

                Text(tab.title)
                    .font(.system(size: 16, weight: isSelected ? .semibold : .regular))
                    .foregroundColor(.primary)

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isSelected ? selectedFill : (pressed ? pressedFill : .clear))
            )
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in pressed = true }
                .onEnded { _ in pressed = false }
        )
    }

    @ViewBuilder
    private var iconView: some View {
        switch tab.icon {
        case .system(let name):
            Image(systemName: name)
                .font(.system(size: 18, weight: .regular))
                .foregroundColor(isSelected ? .primary : mutedIconColor)
        case .template(let name):
            // The bundled lucide/phosphor vector, tinted to match SF Symbol
            // rows: near-black when selected, muted grey otherwise.
            Image(name)
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 21, height: 21)
                .foregroundColor(isSelected ? .primary : mutedIconColor)
        case .asset(let name):
            // Render the asset like a mini app icon: full bleed with the
            // standard ~22% continuous-corner radius iOS uses for icons.
            Image(name)
                .resizable()
                .scaledToFill()
                .frame(width: 24, height: 24)
                .clipShape(RoundedRectangle(cornerRadius: 5.5, style: .continuous))
        }
    }
}
