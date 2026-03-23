# Lexera Capture iOS — Setup Guide

## Prerequisites

### 1. Point xcode-select to Xcode.app

iOS builds require full Xcode (not just Command Line Tools):

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

### 2. Accept Xcode license (if needed)

```bash
sudo xcodebuild -license accept
```

### 3. iOS Rust targets (already installed)

`cargo tauri ios init` installed these automatically:
- `aarch64-apple-ios` (physical devices)
- `aarch64-apple-ios-sim` (simulator, Apple Silicon)
- `x86_64-apple-ios` (simulator, Intel)

## Project Structure

```
lexera-capture-ios/
  src-tauri/
    src/                    # Rust backend
      lib.rs                # Tauri setup, IosStorage init
      commands.rs           # Tauri commands (capture, search, boards)
      ios_storage.rs        # BoardStorage impl for iOS sandbox
    gen/apple/              # Generated Xcode project (already created)
      Sources/              # main.mm (modified with App Group setup)
      lexera-capture-ios_iOS/
        lexera-capture-ios_iOS.entitlements  # App Group configured
      project.yml           # XcodeGen spec
      lexera-capture-ios.xcodeproj/
  src/
    index.html              # Mobile web UI (Capture, Search, Boards, Settings)
  ShareExtension/           # Share Sheet extension files (to add in Xcode)
    ShareViewController.swift
    Info.plist
    ShareExtension.entitlements
```

## What's Already Done

- `cargo tauri ios init` — Xcode project generated
- `main.mm` — Modified to set `LEXERA_APP_GROUP_PATH` env var before Rust init
- Main app entitlements — `group.com.lexera.capture` App Group added
- Rust code builds and all 6 unit tests pass

## Remaining: Add Share Extension in Xcode

### Step 1: Switch xcode-select (one-time)

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

### Step 2: Open the project

```bash
open src-tauri/gen/apple/lexera-capture-ios.xcodeproj
```

### Step 3: Add Share Extension target

1. File > New > Target > Share Extension
   - Product Name: `ShareExtension`
   - Team: (your development team)
   - Bundle Identifier: `com.lexera.capture.ShareExtension`
   - Language: Swift
   - Embed in: `lexera-capture-ios_iOS`
2. Delete the auto-generated `ShareViewController.swift` from the new target
3. Add files from the `ShareExtension/` directory to the ShareExtension target:
   - Right-click ShareExtension group > Add Files
   - Select `ShareExtension/ShareViewController.swift`
   - Replace the auto-generated `Info.plist` with `ShareExtension/Info.plist`
4. Set the ShareExtension target's entitlements:
   - Build Settings > Code Signing Entitlements: point to `ShareExtension/ShareExtension.entitlements`

### Step 4: Configure App Group on ShareExtension

1. Select the ShareExtension target
2. Signing & Capabilities > + Capability > App Groups
3. Add: `group.com.lexera.capture`

(The main app already has this configured in its entitlements file.)

### Step 5: Match deployment targets

Ensure the ShareExtension minimum deployment target matches the main app (iOS 14.0).

## Build & Run

### Simulator:
```bash
cargo tauri ios dev
```

### Physical device:
```bash
cargo tauri ios dev --device
```

### Release build:
```bash
cargo tauri ios build
```

## Verify

1. Launch the app — should show Capture tab with board/column pickers
2. Type text and tap Capture — should see toast "Captured!"
3. Switch to Search tab — search for the captured text
4. Switch to Boards tab — tap Inbox to see captured cards
5. Open Safari, share a page — "Lexera Capture" should appear in Share Sheet
6. Return to app, go to Settings, tap "Process" — shared items become cards

## Troubleshooting

### Build fails with "unable to find utility simctl"
- Run `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`

### "Cannot access App Group container"
- Ensure both targets have the same App Group ID: `group.com.lexera.capture`
- App Groups require a paid Apple Developer account for physical device builds
- Simulator works without a paid account

### Boards not loading
- Check console for `[LexeraCapture] App Group path:` log message
- If App Group isn't available, the app falls back to its own data directory

### Share Extension not appearing
- Ensure the extension's `Info.plist` has `NSExtensionActivationRule` entries
- Rebuild and re-install after adding the extension target
- The extension minimum deployment target must match the main app
