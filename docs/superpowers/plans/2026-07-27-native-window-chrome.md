# Native macOS Window Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Coda's real macOS traffic lights while displaying a native, accessible `Coda` title centered against the full window.

**Architecture:** Make the Tauri native-window policy explicit, then install a macOS-only AppKit label in the existing `NSWindow` frame during setup. Keep the renderer's dynamic `NSWindow` title as system metadata, and hide its default leading visual only after the centered label has been installed successfully.

**Tech Stack:** Rust, Tauri 2, objc2 AppKit bindings, serde_json tests, macOS Accessibility, Computer Use.

## Global Constraints

- Native traffic lights and standard title-bar behavior remain owned by macOS.
- No HTML chrome, overlay title bar, frameless window, private macOS API, renderer capability, or new Tauri command.
- The visible title is exactly `Coda`; the semantic window title remains dynamic.
- Windows and Linux behavior must remain unchanged.
- Queue layout and styling files are out of scope.
- Work remains isolated on `codex/native-window-chrome`.

---

### Task 1: Lock the native-window policy

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: Tauri's serialized `app.windows` configuration.
- Produces: An explicit native-window contract with `Visible` title-bar style and enabled close, minimize, and maximize controls.

- [ ] **Step 1: Add the failing configuration regression test**

Add this test to the existing `tests` module in `src-tauri/src/lib.rs`:

```rust
#[test]
fn main_window_keeps_native_chrome_enabled() {
    let config: Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");
    let main_window = config["app"]["windows"]
        .as_array()
        .and_then(|windows| {
            windows
                .iter()
                .find(|window| window["label"].as_str() == Some("main"))
        })
        .expect("main window config");

    assert_eq!(main_window["decorations"], Value::Bool(true));
    assert_eq!(main_window["titleBarStyle"], Value::String("Visible".into()));
    assert_eq!(main_window["closable"], Value::Bool(true));
    assert_eq!(main_window["minimizable"], Value::Bool(true));
    assert_eq!(main_window["maximizable"], Value::Bool(true));
    assert_eq!(main_window["resizable"], Value::Bool(true));
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml tests::main_window_keeps_native_chrome_enabled -- --exact
```

Expected: FAIL because `titleBarStyle`, `closable`, `minimizable`, and
`maximizable` are not explicit in the current main-window config.

- [ ] **Step 3: Make the native-window policy explicit**

Add these values to the main entry in `src-tauri/tauri.conf.json`:

```json
"decorations": true,
"titleBarStyle": "Visible",
"closable": true,
"minimizable": true,
"maximizable": true,
"resizable": true
```

Do not add `hiddenTitle`, `trafficLightPosition`, or an overlay title-bar style.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml tests::main_window_keeps_native_chrome_enabled -- --exact
```

Expected: PASS.

- [ ] **Step 5: Commit the native-window policy**

```sh
git add src-tauri/src/lib.rs src-tauri/tauri.conf.json
git commit -m "test: lock native window chrome policy"
```

### Task 2: Add the native centered-title integration

**Files:**
- Create: `src-tauri/src/macos_window.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `docs/superpowers/specs/2026-07-27-native-window-chrome-design.md`

**Interfaces:**
- Consumes: `tauri::WebviewWindow`, Tauri's macOS `ns_window()` handle, and AppKit's existing window frame and close button.
- Produces: `pub(crate) fn install_centered_title(window: &tauri::WebviewWindow) -> Result<(), String>`.

- [ ] **Step 1: Add a failing test for the safe title-visibility policy**

Create `src-tauri/src/macos_window.rs` with a test module that references the
wished-for policy:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_title_is_hidden_only_after_centered_title_installation() {
        assert_eq!(
            system_title_visibility(false),
            SystemTitleVisibility::Visible
        );
        assert_eq!(
            system_title_visibility(true),
            SystemTitleVisibility::Hidden
        );
    }
}
```

Declare the module near the top of `src-tauri/src/lib.rs`:

```rust
#[cfg(target_os = "macos")]
mod macos_window;
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml macos_window::tests::system_title_is_hidden_only_after_centered_title_installation -- --exact
```

Expected: compilation fails because `SystemTitleVisibility` and
`system_title_visibility` do not exist.

- [ ] **Step 3: Add only the macOS AppKit dependencies**

Add these target-specific dependencies in `src-tauri/Cargo.toml`:

```toml
objc2 = { version = "0.6.2", default-features = false, features = ["std"] }
objc2-app-kit = { version = "0.3.2", default-features = false, features = [
  "NSAccessibilityProtocols",
  "NSColor",
  "NSControl",
  "NSFont",
  "NSFontDescriptor",
  "NSLayoutAnchor",
  "NSLayoutConstraint",
  "NSResponder",
  "NSText",
  "NSTextField",
  "NSView",
  "NSWindow",
  "objc2-core-foundation",
] }
objc2-foundation = { version = "0.3.2", default-features = false, features = [
  "NSArray",
  "NSObject",
  "NSString",
] }
```

Keep them under `[target.'cfg(target_os = "macos")'.dependencies]` so other
platforms do not compile or link AppKit.

- [ ] **Step 4: Implement the safe visibility policy and AppKit installer**

Implement this structure in `src-tauri/src/macos_window.rs`:

```rust
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSAccessibility, NSColor, NSFont, NSLayoutConstraint, NSTextAlignment, NSTextField, NSView,
    NSWindow, NSWindowButton, NSWindowTitleVisibility, NSFontWeightSemibold,
};
use objc2_foundation::{NSArray, NSString};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SystemTitleVisibility {
    Visible,
    Hidden,
}

fn system_title_visibility(centered_title_installed: bool) -> SystemTitleVisibility {
    if centered_title_installed {
        SystemTitleVisibility::Hidden
    } else {
        SystemTitleVisibility::Visible
    }
}

pub(crate) fn install_centered_title(window: &tauri::WebviewWindow) -> Result<(), String> {
    let marker = MainThreadMarker::new()
        .ok_or_else(|| "the native title must be installed on the macOS main thread".to_string())?;
    let native_window = window
        .ns_window()
        .map_err(|error| format!("could not access the main NSWindow: {error}"))?;
    if native_window.is_null() {
        return Err("the main NSWindow handle is null".into());
    }

    // SAFETY: Tauri owns this NSWindow for the lifetime of the setup callback,
    // and setup executes on AppKit's main thread as verified above.
    let native_window = unsafe { &*native_window.cast::<NSWindow>() };
    let content_view = native_window
        .contentView()
        .ok_or_else(|| "the main NSWindow has no content view".to_string())?;
    let frame_view = content_view
        .superview()
        .ok_or_else(|| "the main NSWindow has no frame view".to_string())?;
    let close_button = native_window
        .standardWindowButton(NSWindowButton::CloseButton)
        .ok_or_else(|| "the main NSWindow has no native close button".to_string())?;

    let title = NSTextField::labelWithString(&NSString::from_str("Coda"), marker);
    title.setAlignment(NSTextAlignment::Center);
    title.setFont(Some(&NSFont::systemFontOfSize_weight(
        13.0,
        NSFontWeightSemibold,
    )));
    title.setTextColor(Some(&NSColor::labelColor()));
    title.setAccessibilityElement(true);
    title.setTranslatesAutoresizingMaskIntoConstraints(false);
    frame_view.addSubview(&title);

    let constraints = NSArray::from_retained_slice(&[
        title
            .centerXAnchor()
            .constraintEqualToAnchor(&frame_view.centerXAnchor()),
        title
            .centerYAnchor()
            .constraintEqualToAnchor(&close_button.centerYAnchor()),
    ]);
    NSLayoutConstraint::activateConstraints(&constraints);

    if system_title_visibility(true) == SystemTitleVisibility::Hidden {
        native_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
    }
    Ok(())
}
```

Adjust imports or enabled objc2 features only as required by the compiler; do
not widen the implementation beyond the approved public AppKit APIs.

- [ ] **Step 5: Install the title during Tauri setup with a visible fallback**

In `src-tauri/src/lib.rs`, after the main window state has been restored and
made visible, call:

```rust
#[cfg(target_os = "macos")]
if let Some(window) = app.get_webview_window("main") {
    if let Err(error) = macos_window::install_centered_title(&window) {
        eprintln!("Could not install Coda's centered native title: {error}");
    }
}
```

Do not propagate the error or hide the default title on failure.

- [ ] **Step 6: Keep the centered title discoverable to accessibility**

Update the approved design spec to state that the visual `Coda` label is
exposed as native static text so Computer Use and assistive technology can
locate it, while the `NSWindow` retains the contextual dynamic title.

- [ ] **Step 7: Format and run the focused test for GREEN**

Run:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml macos_window::tests::system_title_is_hidden_only_after_centered_title_installation -- --exact
```

Expected: PASS.

- [ ] **Step 8: Compile all native targets and run the Rust suite**

Run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: both commands exit successfully with no warnings.

- [ ] **Step 9: Commit the native title integration**

```sh
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/macos_window.rs docs/superpowers/specs/2026-07-27-native-window-chrome-design.md
git commit -m "feat: center the native macOS window title"
```

### Task 3: Validate the complete desktop experience

**Files:**
- Modify only if validation exposes a defect in the scoped native-window implementation.

**Interfaces:**
- Consumes: the complete Tauri desktop app.
- Produces: fresh automated and native accessibility evidence for the branch state.

- [ ] **Step 1: Run frontend verification under the supported Node behavior**

The local Node 25 runtime exposes experimental global web storage that conflicts
with jsdom, so disable that Node experiment for the test command:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm test
npm run build
```

Expected: all frontend tests pass and the production renderer build exits zero.

- [ ] **Step 2: Run final native verification**

Run:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 3: Launch the complete app**

Run `npm run dev`. If port `1420` is already occupied by another worktree, stop
only this new process and relaunch with an isolated temporary Tauri/Vite
configuration; do not terminate another Coda process.

- [ ] **Step 4: Validate native semantics with Computer Use**

Use Computer Use against the new Coda process where possible:

- verify AX buttons for close, minimize, and full screen;
- verify the static text `Coda` is present in native chrome;
- compare the title and window frame centers within a one-point tolerance;
- resize and move the window, then re-check the center;
- capture a screenshot for the handoff;
- do not perform a real Bandcamp, playback, or AirPlay test.

If Computer Use cannot distinguish the new process from another Coda instance,
record that limitation and rely on the AppKit accessibility inspection plus the
automated checks; do not kill user-owned processes.

- [ ] **Step 5: Review the final diff**

Confirm the branch changes only:

- the spec and plan;
- `src-tauri/tauri.conf.json`;
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`;
- `src-tauri/src/lib.rs`;
- `src-tauri/src/macos_window.rs`.

Run `git status --short` and inspect `git diff main...HEAD`.

### Task 4: Publish for review

**Files:**
- No new source files.

**Interfaces:**
- Consumes: verified commits on `codex/native-window-chrome`.
- Produces: a pushed branch and pull request targeting `main`.

- [ ] **Step 1: Commit any verification-driven scoped fixes**

If validation required a source fix, repeat the relevant RED/GREEN cycle and
commit only those scoped files. Otherwise, leave the verified commits intact.

- [ ] **Step 2: Push the branch**

```sh
git push -u origin codex/native-window-chrome
```

- [ ] **Step 3: Create the pull request**

Create a ready-for-review PR against `main` titled:

```text
Polish native macOS window chrome
```

The body must summarize the native AppKit-centered title, explicit traffic-light
policy, accessibility behavior, and exact verification commands. It must state
that Computer Use's purple screen-control pill is external to Coda and note any
remaining native-smoke-test limitation.
