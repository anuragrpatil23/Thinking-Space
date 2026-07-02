# Building for iOS (iPad / iPhone)

## Prerequisites

- macOS with Xcode 15+ installed
- Apple Developer account (free works for simulator testing)
- Node.js 18+
- CocoaPods (`sudo gem install cocoapods`)

## Quick Start

```bash
cd frontend

# Build the web app and sync to iOS project
npm run build:ios

# Open in Xcode
npm run package:ios
```

This opens the Xcode project. From there you can run on a simulator or connected device.

## iCloud Setup (Required for iCloud Vault Storage)

The app supports storing the vault in iCloud Drive for cross-device sync. This requires additional Xcode configuration:

### 1. Enable iCloud Capability

1. Open `frontend/ios/App/App.xcworkspace` in Xcode
2. Select the **App** target in the project navigator
3. Go to **Signing & Capabilities** tab
4. Click **+ Capability** and add **iCloud**
5. Check **iCloud Documents**
6. Under Containers, click **+** and add: `iCloud.com.anurag.thinking-space`

### 2. Verify Entitlements

After enabling iCloud, Xcode creates `App.entitlements` with:

```xml
<key>com.apple.developer.icloud-container-identifiers</key>
<array>
    <string>iCloud.com.anurag.thinking-space</string>
</array>
<key>com.apple.developer.ubiquity-container-identifiers</key>
<array>
    <string>iCloud.com.anurag.thinking-space</string>
</array>
```

### 3. Native Plugin Registration

Folder selection is implemented by `FolderPickerPlugin` in `frontend/ios/App/App/AppDelegate.swift`.
It is registered manually from `LTMBridgeViewController.capacitorDidLoad()`.

Apple Pencil native bridge is implemented by `PencilEventsPlugin` in the same file and is also
registered from `LTMBridgeViewController.capacitorDidLoad()`.

`frontend/ios/App/App/Base.lproj/Main.storyboard` must use `LTMBridgeViewController` (module: `App`) as the bridge view controller class.

### 4. PencilEvents Plugin Contract (Capacitor iOS only)

JS plugin name: `PencilEvents`

Methods:
- `start(): Promise<{ monitoring: boolean }>`: attaches native Pencil interaction + sampling recognizer.
- `stop(): Promise<{ monitoring: boolean }>`: detaches listeners and stops sampling.
- `status(): Promise<{ monitoring: boolean; supportsPencilInteraction: boolean }>`

Events:
- `pencilDoubleTap`
  - `timestamp: number` (epoch ms)
  - `preferredAction: "switchPrevious" | "switchEraser" | "showColorPalette" | "ignore" | "unknown"`
- `pencilMetrics`
  - `phase: "began" | "moved" | "ended" | "cancelled"`
  - `timestamp: number` (epoch ms)
  - `force?: number`
  - `maxForce?: number`
  - `normalizedPressure?: number` (0..1 clamp)
  - `altitudeAngle?: number` (radians)
  - `azimuthAngle?: number` (radians)
  - `locationX?: number`
  - `locationY?: number`

Frontend integration path:
- `frontend/src/services/orchestrators/pencilBridgeOrch.ts`
- `frontend/src/components/lego_blocks/ExcalidrawDocumentBlock.tsx`

## Building for Simulator

1. In Xcode, select an iPad or iPhone simulator from the device dropdown
2. Press **Cmd+R** to build and run
3. On first launch, the app will prompt for vault folder selection (local or iCloud Drive)

## Building for Device

1. Connect your iOS device
2. In Xcode, select your device from the dropdown
3. Under Signing & Capabilities, select your development team
4. Press **Cmd+R** to build and run

## TestFlight Distribution

1. In Xcode, select **Product > Archive**
2. In the Organizer, click **Distribute App**
3. Choose **App Store Connect** > **Upload**
4. In App Store Connect, add the build to a TestFlight group

## Troubleshooting

### "iCloud is not available"
- Ensure the device is signed in to iCloud (Settings > Apple ID > iCloud)
- Ensure iCloud Drive is enabled
- The iCloud container may take a few minutes to provision on first use

### Web assets not updating
Run `npm run build:ios` again to rebuild and re-sync the web assets.

### Plugin not found
After modifying bridge/plugin Swift code, run:
```bash
cd frontend
npx cap sync ios
```
