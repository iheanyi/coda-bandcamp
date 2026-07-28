use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSAccessibility, NSColor, NSFont, NSFontWeightSemibold, NSLayoutConstraint, NSLineBreakMode,
    NSObjectNSKeyValueBindingCreation, NSTextAlignment, NSTextField, NSValueBinding, NSWindow,
    NSWindowButton, NSWindowTitleVisibility,
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

fn centered_title_text(window_title: &str) -> &str {
    window_title
}

fn centered_title_binding_key_path() -> &'static str {
    "title"
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

    // SAFETY: Tauri owns this NSWindow for the application lifetime, and setup
    // executes on AppKit's main thread as verified above.
    let native_window = unsafe { &*native_window.cast::<NSWindow>() };
    let content_view = native_window
        .contentView()
        .ok_or_else(|| "the main NSWindow has no content view".to_string())?;
    // SAFETY: AppKit's view hierarchy is accessed synchronously on its main
    // thread, and the returned superview is retained by objc2.
    let frame_view = unsafe { content_view.superview() }
        .ok_or_else(|| "the main NSWindow has no frame view".to_string())?;
    let close_button = native_window
        .standardWindowButton(NSWindowButton::CloseButton)
        .ok_or_else(|| "the main NSWindow has no native close button".to_string())?;

    let semantic_title = native_window.title().to_string();
    let title = NSTextField::labelWithString(
        &NSString::from_str(centered_title_text(&semantic_title)),
        marker,
    );
    title.setAlignment(NSTextAlignment::Center);
    title.setLineBreakMode(NSLineBreakMode::ByTruncatingTail);
    title.setMaximumNumberOfLines(1);
    // SAFETY: NSFontWeightSemibold is an immutable AppKit framework constant.
    let title_weight = unsafe { NSFontWeightSemibold };
    title.setFont(Some(&NSFont::systemFontOfSize_weight(13.0, title_weight)));
    title.setTextColor(Some(&NSColor::labelColor()));
    title.setAccessibilityElement(true);
    title.setTranslatesAutoresizingMaskIntoConstraints(false);

    // SAFETY: NSValueBinding is an immutable AppKit framework constant.
    let value_binding = unsafe { NSValueBinding };
    // SAFETY: NSWindow's `title` key path is KVC-compliant, NSTextField's
    // value binding accepts strings, and no binding options are supplied.
    unsafe {
        title.bind_toObject_withKeyPath_options(
            value_binding,
            native_window,
            &NSString::from_str(centered_title_binding_key_path()),
            None,
        );
    }
    frame_view.addSubview(&title);

    let constraints = NSArray::from_retained_slice(&[
        title
            .centerXAnchor()
            .constraintEqualToAnchor(&frame_view.centerXAnchor()),
        title
            .centerYAnchor()
            .constraintEqualToAnchor(&close_button.centerYAnchor()),
        title
            .widthAnchor()
            .constraintLessThanOrEqualToAnchor_constant(&frame_view.widthAnchor(), -220.0),
    ]);
    NSLayoutConstraint::activateConstraints(&constraints);

    match system_title_visibility(true) {
        SystemTitleVisibility::Visible => {
            native_window.setTitleVisibility(NSWindowTitleVisibility::Visible)
        }
        SystemTitleVisibility::Hidden => {
            native_window.setTitleVisibility(NSWindowTitleVisibility::Hidden)
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_title_is_hidden_only_after_centered_title_installation() {
        assert_eq!(
            system_title_visibility(false),
            SystemTitleVisibility::Visible
        );
        assert_eq!(system_title_visibility(true), SystemTitleVisibility::Hidden);
    }

    #[test]
    fn centered_title_preserves_and_observes_the_live_window_title() {
        let current_title = "SUDDEN DEATH — Coda";

        assert_eq!(centered_title_text(current_title), current_title);
        assert_eq!(centered_title_binding_key_path(), "title");
    }
}
