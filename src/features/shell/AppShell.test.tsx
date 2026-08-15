import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { DrawerTrigger } from "@/components/ui/drawer";

import { AppShell } from "./AppShell";

function shell(
  outlet: ReactNode,
  options: Readonly<{
    nowPlayingOpen?: boolean;
    onQueueOpenChange?: (open: boolean) => void;
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
        open: false,
        panel: <aside data-testid="queue-panel">Queue</aside>,
      }}
      route={{
        chrome: <header data-testid="route-chrome">Chrome</header>,
        outlet,
        sidebar: <aside data-testid="sidebar">Sidebar</aside>,
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

  it("projects persistent services before route content so title can publish before the pane paint", () => {
    render(shell(<section data-testid="route-outlet">Collection</section>));

    const main = screen.getByRole("main");
    const services = screen.getByTestId("persistent-services");
    const chrome = screen.getByTestId("route-chrome");
    expect(main).toContainElement(services);
    expect(
      services.compareDocumentPosition(chrome) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("uses the immersive one-row layout without padding the route pane", () => {
    render(
      shell(<section data-testid="route-outlet">Now playing</section>, {
        nowPlayingOpen: true,
      }),
    );

    expect(screen.getByTestId("route-outlet").closest("main")).toHaveClass(
      "p-0",
    );
    expect(
      screen.getByTestId("route-outlet").closest('[data-slot="app-shell"]'),
    ).toHaveClass("grid-rows-[minmax(0,1fr)]");
  });
});
