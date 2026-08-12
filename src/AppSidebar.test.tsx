import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppSidebar, type AppSidebarNavigationRequest } from "@/AppSidebar";
import { createCodaMemoryRouter } from "@/router";
import { transitionCodaView } from "@/viewTransitions";

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);

afterEach(() => {
  vi.unstubAllEnvs();
  document.documentElement.classList.remove(
    "coda-view-transitioning",
    "coda-transition--page-crossfade",
  );
  if (originalStartViewTransition) {
    Object.defineProperty(
      document,
      "startViewTransition",
      originalStartViewTransition,
    );
  } else {
    Reflect.deleteProperty(document, "startViewTransition");
  }
});

describe("Coda sidebar", () => {
  it("uses semantic typed links and keeps connection settings accessible", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const router = createCodaMemoryRouter(new QueryClient(), ["/favorites"]);
    await router.load();

    render(
      <RouterContextProvider router={router}>
        <AppSidebar connected onConnect={onConnect} />
      </RouterContextProvider>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    const links = [
      "Collection",
      "Favorites",
      "Playlists",
      "Recently added",
      "Discover",
      "Bandcamp Radio",
    ].map((name) => screen.getByRole("link", { name }));

    expect(navigation).toContainElement(links[0]);
    expect(links).toHaveLength(6);
    expect(
      screen.queryByRole("button", { name: "Favorites" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Favorites" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Bandcamp Radio" }),
    ).toHaveAttribute("href", "/radio");

    await user.click(screen.getByRole("link", { name: "Recently added" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/recent");
    });
    expect(
      screen.getByRole("link", { name: "Recently added" }),
    ).toHaveAttribute("aria-current", "page");

    const connectionSettings = screen.getByRole("button", {
      name: "Connection settings",
    });
    await user.click(connectionSettings);
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("keeps a parent destination active on a nested detail route", () => {
    const router = createCodaMemoryRouter(new QueryClient(), [
      "/radio/shows/979",
    ]);

    render(
      <RouterContextProvider router={router}>
        <AppSidebar connected={false} onConnect={vi.fn()} />
      </RouterContextProvider>,
    );

    expect(
      screen.getByRole("link", { name: "Bandcamp Radio" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("hands plain activation to an async transition seam and preserves modified clicks", async () => {
    const user = userEvent.setup();
    const router = createCodaMemoryRouter(new QueryClient(), ["/favorites"]);
    await router.load();
    let capturedClassName = "";
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn(),
    });
    const onNavigate = vi.fn((request: AppSidebarNavigationRequest) => {
      const transition = transitionCodaView(request.navigate, "page-forward", {
        routerOwnedPage: true,
      });
      capturedClassName = document.documentElement.className;
      return transition;
    });

    render(
      <RouterContextProvider router={router}>
        <AppSidebar connected onConnect={vi.fn()} onNavigate={onNavigate} />
      </RouterContextProvider>,
    );

    const collection = screen.getByRole("link", { name: "Collection" });
    const modifiedClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    // Keep jsdom from trying to open a second browsing context after React has
    // observed the native modified activation.
    document.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    collection.dispatchEvent(modifiedClick);

    expect(onNavigate).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/favorites");

    await user.click(screen.getByRole("link", { name: "Recently added" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/recent");
    });
    expect(capturedClassName).not.toContain("coda-transition--page-crossfade");
    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(onNavigate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        destination: "/recent",
        navigate: expect.any(Function),
        trigger: screen.getByRole("link", { name: "Recently added" }),
      }),
    );
  });
});
