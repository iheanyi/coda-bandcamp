import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCodaMemoryRouter } from "./router";
import { CodaRouteError, CodaRoutePending } from "./routes/-route-status";

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderRouter(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const router = createCodaMemoryRouter(queryClient, [initialEntry]);

  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { ...view, queryClient, router };
}

describe("Coda router foundation", () => {
  it("exposes only route-safe library session capabilities to loaders", () => {
    const queryClient = new QueryClient();
    const router = createCodaMemoryRouter(queryClient);

    expect(Object.keys(router.options.context.librarySession).sort()).toEqual([
      "findCachedAlbum",
      "findCachedAlbumTracks",
      "getSnapshot",
      "preloadAlbum",
    ]);
    expect(router.options.context.librarySession).not.toHaveProperty(
      "commands",
    );
    expect(router.options.context.librarySession).not.toHaveProperty(
      "activate",
    );
  });

  it("redirects the root entry to Collection", async () => {
    const queryClient = new QueryClient();
    const router = createCodaMemoryRouter(queryClient, ["/"]);

    await router.load();

    expect(router.state.location.pathname).toBe("/collection");
  });

  it("opens Collection directly with an isolated memory history", async () => {
    const firstQueryClient = new QueryClient();
    const firstRouter = createCodaMemoryRouter(firstQueryClient, [
      "/collection",
    ]);

    await firstRouter.load();
    expect(firstRouter.state.location.pathname).toBe("/collection");

    const secondQueryClient = new QueryClient();
    const secondRouter = createCodaMemoryRouter(secondQueryClient, ["/"]);
    expect(secondRouter.history).not.toBe(firstRouter.history);
    expect(secondRouter.state.location.pathname).toBe("/");
  });

  it("renders the root not-found destination for an unknown route", async () => {
    renderRouter("/missing-route");

    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to Collection" }),
    ).toHaveAttribute(
      "href",
      "/collection?q=&genre=All&sort=recent&mode=releases",
    );
  });

  it("offers an accessible retry action from the root error UI", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<CodaRouteError onRetry={retry} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Coda couldn’t open this page",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The requested page could not be opened. Your library and player data are unchanged.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("surfaces the thrown message in development builds", () => {
    render(
      <CodaRouteError
        cause={new ReferenceError("shuffleActionLabel is not defined")}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "shuffleActionLabel is not defined",
    );
  });

  it("announces the root pending UI without exposing internal details", () => {
    render(<CodaRoutePending />);

    const status = screen.getByRole("status", { name: "Opening Coda…" });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Preparing your music library.");
  });
});
