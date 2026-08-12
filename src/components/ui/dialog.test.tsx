import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { CodaMotionProvider } from "@/MotionProvider";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";

function DialogHarness({ onExited = vi.fn() }: { onExited?: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <CodaMotionProvider>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <Dialog open={open} onExitComplete={onExited} onOpenChange={setOpen}>
        <DialogContent finalFocus={triggerRef} showCloseButton={false}>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Change application settings.</DialogDescription>
          <DialogClose>Done</DialogClose>
        </DialogContent>
      </Dialog>
    </CodaMotionProvider>
  );
}

describe("Dialog", () => {
  it("keeps Base UI mounted until the Motion exit completes", async () => {
    const user = userEvent.setup();
    const onExited = vi.fn();
    render(<DialogHarness onExited={onExited} />);

    const trigger = screen.getByRole("button", { name: "Open settings" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });

    await waitFor(() => expect(dialog).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(dialog).toBeInTheDocument();
    expect(onExited).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Settings" }),
      ).not.toBeInTheDocument();
    });
    expect(onExited).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
    expect(
      document.querySelector('[data-slot="dialog-portal"]'),
    ).not.toBeInTheDocument();
  });

  it("keeps a rapidly reopened dialog mounted when the prior exit settles", async () => {
    const user = userEvent.setup();
    const onExited = vi.fn();
    render(<DialogHarness onExited={onExited} />);

    const trigger = screen.getByRole("button", { name: "Open settings" });
    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    await user.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible(),
    );
    expect(onExited).not.toHaveBeenCalled();
  });
});
