use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, ClassType, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAccessibility, NSColor, NSFont, NSFontWeightSemibold, NSLayoutConstraint, NSLineBreakMode,
    NSObjectNSKeyValueBindingCreation, NSTextAlignment, NSTextField, NSValueBinding, NSWindow,
    NSWindowButton, NSWindowTitleVisibility,
};
use objc2_foundation::{NSArray, NSInteger, NSString, NSUserDefaults};

const MACOS_TITLE_DOUBLE_CLICK_ACTION_KEY: &str = "AppleActionOnDoubleClick";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TitleDoubleClickAction {
    Zoom,
    Fill,
    Minimize,
    None,
}

fn title_double_click_action(preference: Option<&str>) -> TitleDoubleClickAction {
    match preference {
        Some("Fill") => TitleDoubleClickAction::Fill,
        Some("Minimize") => TitleDoubleClickAction::Minimize,
        Some("None") => TitleDoubleClickAction::None,
        _ => TitleDoubleClickAction::Zoom,
    }
}

fn current_title_double_click_action() -> TitleDoubleClickAction {
    let defaults = NSUserDefaults::standardUserDefaults();
    let preference =
        defaults.stringForKey(&NSString::from_str(MACOS_TITLE_DOUBLE_CLICK_ACTION_KEY));
    let preference = preference.as_ref().map(|value| value.to_string());

    title_double_click_action(preference.as_deref())
}

fn perform_title_double_click_action(window: &NSWindow) {
    match current_title_double_click_action() {
        TitleDoubleClickAction::Zoom => {
            // SAFETY: `performZoom:` is an NSWindow action that accepts a nil sender.
            unsafe {
                let _: () = msg_send![window, performZoom: Option::<&AnyObject>::None];
            }
        }
        TitleDoubleClickAction::Fill => {
            if let Some(screen) = window.screen() {
                window.setFrame_display_animate(screen.visibleFrame(), true, true);
            }
        }
        TitleDoubleClickAction::Minimize => {
            // SAFETY: `performMiniaturize:` is an NSWindow action that accepts a nil sender.
            unsafe {
                let _: () = msg_send![window, performMiniaturize: Option::<&AnyObject>::None];
            }
        }
        TitleDoubleClickAction::None => {}
    }
}

define_class!(
    // SAFETY: This subclass only overrides mouse handling for the title label and
    // adds no ivars, so it preserves NSTextField's layout and lifetime rules.
    #[unsafe(super = NSTextField)]
    #[thread_kind = MainThreadOnly]
    struct CodaTitleTextField;

    impl CodaTitleTextField {
        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, event: &AnyObject) {
            // SAFETY: AppKit sends an NSEvent for mouseDown:, and clickCount is
            // available on mouse events.
            let click_count: NSInteger = unsafe { msg_send![event, clickCount] };
            // SAFETY: The field is installed in an NSWindow-owned title-bar view.
            let window: *mut NSWindow = unsafe { msg_send![self, window] };

            if click_count == 2 {
                if let Some(window) = unsafe { window.as_ref() } {
                    perform_title_double_click_action(window);
                }
                return;
            }

            if let Some(window) = unsafe { window.as_ref() } {
                // SAFETY: AppKit permits forwarding the original mouse-down
                // event to preserve native title-bar dragging.
                unsafe {
                    let _: () = msg_send![window, performWindowDragWithEvent: event];
                }
                return;
            }

            // SAFETY: Falling back to NSTextField keeps default event handling if
            // the view is ever detached from a window.
            unsafe {
                let _: () = msg_send![super(self), mouseDown: event];
            }
        }

        #[unsafe(method(mouseDownCanMoveWindow))]
        fn mouse_down_can_move_window(&self) -> bool {
            true
        }
    }
);

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
    // SAFETY: The standard close button and its containing title-bar view are
    // owned by AppKit and accessed synchronously on the main thread.
    let titlebar_view = unsafe { close_button.superview() }
        .ok_or_else(|| "the main NSWindow has no managed title-bar view".to_string())?;

    let semantic_title = native_window.title().to_string();
    let title = NSTextField::labelWithString(
        &NSString::from_str(centered_title_text(&semantic_title)),
        marker,
    );
    // SAFETY: `CodaTitleTextField` is an NSTextField subclass with no ivars, so
    // the label instance keeps the same layout while gaining native title-bar
    // double-click handling.
    unsafe {
        let title_object: &AnyObject = (*title).as_ref();
        AnyObject::set_class(title_object, CodaTitleTextField::class());
    }
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
    // Keep the custom title inside AppKit's managed title-bar hierarchy so it
    // retracts and returns with the traffic lights during native full-screen
    // transitions.
    titlebar_view.addSubview(&title);

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

    #[test]
    fn title_double_click_action_matches_macos_preference() {
        assert_eq!(
            title_double_click_action(Some("Minimize")),
            TitleDoubleClickAction::Minimize
        );
        assert_eq!(
            title_double_click_action(Some("None")),
            TitleDoubleClickAction::None
        );
        assert_eq!(
            title_double_click_action(Some("Maximize")),
            TitleDoubleClickAction::Zoom
        );
        assert_eq!(
            title_double_click_action(Some("Fill")),
            TitleDoubleClickAction::Fill
        );
        assert_eq!(
            title_double_click_action(None),
            TitleDoubleClickAction::Zoom
        );
    }
}
