# Native macOS Window Chrome Design

## Problem

Coda already asks Tauri for native window decorations, but the window contract
relies on defaults and the macOS title is rendered immediately after the
traffic-light controls. The long, dynamic now-playing title makes that leading
placement visually heavy and inconsistent with the centered balance expected
for Coda's otherwise restrained interface.

Computer Use also places its own purple screen-control indicator over the
traffic-light area while it controls the app. That indicator is not Coda UI and
cannot be styled or removed by Coda. Validation must therefore distinguish the
screen-control overlay from the native window underneath it.

## Goals

- Preserve real macOS close, minimize, and zoom/full-screen controls.
- Center a concise `Coda` title against the full native window width.
- Keep the dynamic track, album, artist, and destination title as the actual
  `NSWindow` title for accessibility, Window menu entries, and system metadata.
- Preserve native title-bar dragging, double-click behavior, inactive-window
  behavior, full-screen behavior, and system focus semantics.
- Leave Windows and Linux title rendering unchanged.
- Add no HTML title bar, fake traffic lights, private macOS API, new renderer
  capability, or renderer-to-native command.
- Avoid the queue-panel files being changed separately.

## Architecture

### Explicit native-window contract

`src-tauri/tauri.conf.json` will explicitly set the main window to:

- `decorations: true`
- `titleBarStyle: "Visible"`
- `closable: true`
- `minimizable: true`
- `maximizable: true`
- `resizable: true`

These values make the product contract reviewable rather than depending on
Tauri defaults. Coda will not set `trafficLightPosition`, because that option
requires overlay mode. It will not enable `hiddenTitle` in configuration,
because the ordinary system title is the safe fallback if native centering
cannot be installed.

### Native centered title

A focused `src-tauri/src/macos_window.rs` module, compiled only on macOS, will
install the visual title during Tauri setup:

1. Resolve the main `NSWindow` through Tauri's supported `ns_window()` handle.
2. Create an AppKit `NSTextField` label containing `Coda`.
3. Apply the system title font, system label color, centered text alignment, and
   truncation behavior.
4. Add the label to the native window frame view.
5. Use Auto Layout to constrain the label's horizontal center to the full frame
   view and its vertical center to the native close button.
6. Confirm the label participates in normal window dragging, then hide the
   built-in visual title using `NSWindow.titleVisibility`.

The title label is native AppKit, not HTML. The real traffic lights and title
bar remain owned by `NSWindow`. Auto Layout keeps the title centered when the
window is resized or enters and exits full screen.

`NSTextField(labelWithString:)` is noneditable and reports
`mouseDownCanMoveWindow = true`, so dragging over the title continues to move
the window. The centered label remains discoverable as native static text for
assistive technology and visual validation, while the window's dynamic
`AXTitle` remains the contextual semantic title.

The AppKit bindings will be declared only in the macOS target dependency
section. Other platforms will neither compile nor link the macOS module.

### Dynamic semantic title

The existing renderer title controller remains unchanged. It continues to set:

- `document.title` for the web surface; and
- the real Tauri/`NSWindow` title for desktop system semantics.

Only the native title's default visual field is hidden. A screen reader or
system window list therefore retains the useful contextual title such as
`Track Name — Coda`, while the visible chrome stays calm and centered.

## Failure Handling

The native visual title is installed before changing `titleVisibility`.
Failures return a contextual error from the macOS helper and leave the ordinary
system title visible. Coda must never launch with a blank title bar merely
because the centered-label enhancement could not be installed.

Setup will report installation failures without mutating traffic-light state or
window capabilities. No fallback path switches to overlay or frameless chrome.

## Testing and Validation

Automated coverage will assert the serialized Tauri window policy keeps native
decorations and all three standard controls enabled with the visible title-bar
style. The test must fail before the explicit policy is added.

The AppKit presentation requires a native macOS smoke test:

- launch the complete app with `npm run dev`;
- use Computer Use's accessibility tree to verify native close, minimize, and
  full-screen buttons remain exposed;
- measure the native `Coda` title frame against the window frame and confirm
  their horizontal centers align;
- resize and move the window to confirm centering and native dragging persist;
- distinguish Computer Use's purple control indicator from Coda's chrome.

Final verification will run the frontend test suite and build plus the Rust
format, test, and clippy checks required for native window changes. No live
Bandcamp connection, playback mutation, or real AirPlay receiver test is
needed.

## Scope

This change modifies only the native window configuration, the macOS title
integration, its focused regression coverage, and this documentation. Queue
layout and styling are intentionally excluded.
