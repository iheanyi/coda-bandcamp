import { QueryClient } from "@tanstack/react-query"
import { RouterContextProvider } from "@tanstack/react-router"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppSidebar } from "@/AppSidebar"
import { createCodaMemoryRouter } from "@/router"

const mocks = vi.hoisted(() => ({
  fetchCoverUrl: vi.fn(),
  fetchPlaylist: vi.fn(),
  fetchPlaylists: vi.fn(),
  fetchRadioShows: vi.fn(),
  fetchStreamUrl: vi.fn(),
  readLocalFavoritesAsync: vi.fn(),
}))

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>()
  return {
    ...actual,
    fetchCoverUrl: mocks.fetchCoverUrl,
    fetchPlaylist: mocks.fetchPlaylist,
    fetchPlaylists: mocks.fetchPlaylists,
    fetchRadioShows: mocks.fetchRadioShows,
    fetchStreamUrl: mocks.fetchStreamUrl,
  }
})

vi.mock("@/localFavoritesStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/localFavoritesStore")>()
  return {
    ...actual,
    readLocalFavoritesAsync: mocks.readLocalFavoritesAsync,
  }
})

async function renderSidebar(connected: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createCodaMemoryRouter(queryClient, [
    "/collection?q=&genre=All&sort=recent&mode=releases",
  ])
  await router.load()
  const onConnect = vi.fn()

  render(
    <RouterContextProvider router={router}>
      <AppSidebar connected={connected} onConnect={onConnect} />
    </RouterContextProvider>,
  )

  return { onConnect, queryClient, router }
}

beforeEach(() => {
  mocks.fetchCoverUrl.mockReset()
  mocks.fetchPlaylist.mockReset()
  mocks.fetchPlaylists.mockReset()
  mocks.fetchRadioShows.mockReset().mockResolvedValue({
    hasMore: false,
    results: [],
  })
  mocks.fetchStreamUrl.mockReset()
  mocks.readLocalFavoritesAsync.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("Coda sidebar intent preloading", () => {
  it.each([
    ["hover", (link: HTMLElement) => fireEvent.mouseEnter(link)],
    ["keyboard focus", (link: HTMLElement) => fireEvent.focus(link)],
  ])(
    "uses the router intent policy on %s and reuses the prefetched Radio query",
    async (_intent, expressIntent) => {
      const { queryClient, router } = await renderSidebar(true)
      const radioLink = screen.getByRole("link", { name: "Bandcamp Radio" })

      expect(router.options.defaultPreload).toBe("intent")
      expressIntent(radioLink)

      await waitFor(() => {
        expect(mocks.fetchRadioShows).toHaveBeenCalledOnce()
      })
      expect(
        queryClient.getQueryData(["bandcamp-radio", "all"]),
      ).toBeDefined()

      fireEvent.click(radioLink)
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/radio")
      })
      expect(mocks.fetchRadioShows).toHaveBeenCalledOnce()
      expect(mocks.fetchCoverUrl).not.toHaveBeenCalled()
      expect(mocks.fetchStreamUrl).not.toHaveBeenCalled()
    },
  )

  it("makes disconnected playlist intent a complete no-op", async () => {
    const { onConnect, router } = await renderSidebar(false)
    const preloadRoute = vi.spyOn(router, "preloadRoute")
    const playlistsLink = screen.getByRole("link", { name: "Playlists" })

    fireEvent.mouseEnter(playlistsLink)
    fireEvent.focus(playlistsLink)
    fireEvent.touchStart(playlistsLink)

    expect(preloadRoute).not.toHaveBeenCalled()
    expect(mocks.fetchPlaylists).not.toHaveBeenCalled()
    expect(mocks.fetchPlaylist).not.toHaveBeenCalled()
    expect(mocks.readLocalFavoritesAsync).not.toHaveBeenCalled()
    expect(mocks.fetchCoverUrl).not.toHaveBeenCalled()
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalled()
    expect(onConnect).not.toHaveBeenCalled()
  })

  it("allows playlist route code to preload only after connection is resolved", async () => {
    const { router } = await renderSidebar(true)
    const preloadRoute = vi.spyOn(router, "preloadRoute")

    fireEvent.focus(screen.getByRole("link", { name: "Playlists" }))

    await waitFor(() => {
      expect(preloadRoute).toHaveBeenCalledOnce()
    })
    expect(mocks.fetchPlaylists).not.toHaveBeenCalled()
    expect(mocks.fetchPlaylist).not.toHaveBeenCalled()
    expect(mocks.readLocalFavoritesAsync).not.toHaveBeenCalled()
    expect(mocks.fetchCoverUrl).not.toHaveBeenCalled()
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalled()
  })
})
