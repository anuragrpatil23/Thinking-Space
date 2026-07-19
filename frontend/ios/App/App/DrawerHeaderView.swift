import SwiftUI

final class DrawerHeaderState: ObservableObject {
    @Published var sectionLabel: String
    @Published var title: String

    init(sectionLabel: String = "Menu", title: String = "Thinking Space") {
        self.sectionLabel = sectionLabel
        self.title = title
    }
}

struct DrawerHeaderView: View {
    @ObservedObject var state: DrawerHeaderState
    var onClose: () -> Void

    // Follows the drawer container's trait override (dark when the web
    // reports a dark surface).
    @Environment(\.colorScheme) private var colorScheme

    private let beigeLighter = Color(red: 245.0 / 255.0, green: 243.0 / 255.0, blue: 238.0 / 255.0)
    private let beigeDarker  = Color(red: 241.0 / 255.0, green: 239.0 / 255.0, blue: 232.0 / 255.0)
    private let nightLighter = Color(red: 28.0 / 255.0, green: 28.0 / 255.0, blue: 33.0 / 255.0)
    private let nightDarker  = Color(red: 24.0 / 255.0, green: 24.0 / 255.0, blue: 28.0 / 255.0)

    private var mutedTextColor: Color {
        colorScheme == .dark ? Color(white: 0.62) : Color(white: 0.45)
    }

    @ViewBuilder
    private var sectionLabelText: some View {
        let base = Text(state.sectionLabel)
            .font(.system(size: 11, weight: .semibold))
            .textCase(.uppercase)
            .foregroundColor(mutedTextColor)
        if #available(iOS 16.0, *) {
            base.kerning(2.4)
        } else {
            base
        }
    }

    @ViewBuilder
    private var titleText: some View {
        let base = Text(state.title)
            .font(.system(size: 17, weight: .semibold))
            .foregroundColor(.primary)
            .lineLimit(1)
        if #available(iOS 16.0, *) {
            base.kerning(-0.4)
        } else {
            base
        }
    }

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                sectionLabelText
                titleText
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(mutedTextColor)
                    .frame(width: 40, height: 40)
                    .background(colorScheme == .dark ? Color.white.opacity(0.10) : Color.white.opacity(0.85))
                    .clipShape(Circle())
                    .overlay(
                        Circle()
                            .stroke(colorScheme == .dark ? Color.white.opacity(0.14) : Color.black.opacity(0.12), lineWidth: 0.5)
                    )
                    .shadow(color: .black.opacity(0.04), radius: 2, y: 1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .padding(.top, 4)
        .background(
            // Dark: flat, matching the drawer container + rail exactly — a
            // gradient here starts lighter than the safe-area strip above it
            // and reads as a seam. Light: the original beige gradient (both
            // ends match the beige container, so no seam there).
            colorScheme == .dark
                ? AnyShapeStyle(nightDarker)
                : AnyShapeStyle(LinearGradient(colors: [beigeLighter, beigeDarker], startPoint: .top, endPoint: .bottom))
        )
    }
}
