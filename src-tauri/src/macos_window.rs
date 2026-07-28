use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSAccessibility, NSColor, NSFont, NSFontWeightSemibold, NSLayoutConstraint, NSTextAlignment,
    NSTextField, NSWindow, NSWindowButton, NSWindowTitleVisibility,
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

    let title = NSTextField::labelWithString(&NSString::from_str("Coda"), marker);
    title.setAlignment(NSTextAlignment::Center);
    // SAFETY: NSFontWeightSemibold is an immutable AppKit framework constant.
    let title_weight = unsafe { NSFontWeightSemibold };
    title.setFont(Some(&NSFont::systemFontOfSize_weight(13.0, title_weight)));
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
}
