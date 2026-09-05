import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactNode, type Ref } from "react";
import { describe, expect, it, vi } from "vitest";

import { DrawerTrigger } from "@/components/ui/drawer";

import { AppShell } from "./AppShell";

function shell(
  outlet: ReactNode,
  options: Readonly<{
    libraryPaneRef?: Ref<HTMLElement>;
    nowPlayingOpen?: boolean;
    onQueueOpenChange?: (open: boolean) => void;
    queueOpen?: boolean;
    transitionKey?: string;
  }> = {},
) {
  return (
    <AppShell
      className="shell-test-class"
      nowPlayingOpen={options.nowPlayingOpen ?? false}
      overlays={<div data-testid="overlays">Overlays</div>}
      persistentServices={
        <div data-testid="persistent-services">Persistent services</div>
      }
      playback={{
        dock: (
          <footer data-testid="player-dock">
            <DrawerTrigger render={<button type="button">Show queue</button>} />
          </footer>
        ),
      }}
      queue={{
        onOpenChange: options.onQueueOpenChange ?? vi.fn(),
        open: options.queueOpen ?? false,
        panel: <aside data-testid="queue-panel">Queue</aside>,
      }}
      route={{
        chrome: <header data-testid="route-chrome">Chrome</header>,
        libraryPaneRef: options.libraryPaneRef,
        outlet,
        sidebar: <aside data-testid="sidebar">Sidebar</aside>,
        transitionKey: options.transitionKey ?? "test-route",
      }}
    />
  );
}

describe("AppShell", () => {
  it("keeps the queue, player, and persistent services mounted across route changes", () => {
    const { rerender } = render(
      shell(<section data-testid="route-outlet">Collection</section>),
    );
    const queuePanel = screen.getByTestId("queue-panel");
    const playerDock = screen.getByTestId("player-dock");
    const persistentServices = screen.getByTestId("persistent-services");

    rerender(shell(<section data-testid="route-outlet">Album</section>));

    expect(screen.getByTestId("route-outlet")).toHaveTextContent("Album");
    expect(screen.getByTestId("queue-panel")).toBe(queuePanel);
    expect(screen.getByTestId("player-dock")).toBe(playerDock);
    expect(screen.getByTestId("persistent-services")).toBe(persistentServices);
  });

  it("keeps navigation and route content semantic while the queue stays outside main", () => {
    const onQueueOpenChange = vi.fn();
    render(
      shell(<section data-testid="route-outlet">Collection</section>, {
        onQueueOpenChange,
      }),
    );

    const main = screen.getByRole("main");
    const shellRoot = main.closest('[data-slot="app-shell"]');
    expect(main).toContainElement(screen.getByTestId("route-chrome"));
    expect(main).toContainElement(screen.getByTestId("route-outlet"));
    expect(main).not.toContainElement(screen.getByTestId("sidebar"));
    expect(main).not.toContainElement(screen.getByTestId("queue-panel"));
    expect(shellRoot).toContainElement(screen.getByTestId("queue-panel"));
    expect(shellRoot).toContainElement(screen.getByTestId("player-dock"));
    expect(shellRoot).toContainElement(screen.getByTestId("overlays"));
    expect(shellRoot).toHaveClass("shell-test-class");

    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
    expect(onQueueOpenChange.mock.calls[0]?.[0]).toBe(true);
  });

  it("publishes queue visibility for detail snapshot isolation", () => {
    const { container, rerender } = render(
      shell(<section>Album detail</section>, { queueOpen: false }),
    );
    const workspace = container.querySelector(
      '[data-slot="app-shell-workspace"]',
    );
    expect(workspace).toHaveAttribute("data-queue-open", "false");

    rerender(shell(<section>Album detail</section>, { queueOpen: true }));
    expect(workspace).toHaveAttribute("data-queue-open", "true");
  });

  it("forwards the main element to callback and object refs", () => {
    const callbackRef = vi.fn();
    const { rerender } = render(
      shell(<section>Collection</section>, {
        libraryPaneRef: callbackRef,
      }),
    );
    const main = screen.getByRole("main");
    expect(callbackRef).toHaveBeenLastCalledWith(main);

    const objectRef = createRef<HTMLElement>();
    rerender(
      shell(<section>Collection</section>, {
        libraryPaneRef: objectRef,
      }),
    );
    expect(objectRef.current).toBe(main);
  });
});
