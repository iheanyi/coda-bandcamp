import { QueryClient } from "@tanstack/react-query"
import { RouterContextProvider } from "@tanstack/react-router"
import type { InvokeArgs } from "@tauri-apps/api/core"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppSidebar } from "@/AppSidebar"
import { createLibrarySessionController } from "@/features/library-session"
import { createCodaMemoryRouter } from "@/router"
import {
  readTauriInvokeArguments,
  tauriNumber,
  tauriString,
} from "@/test/tauriInvoke"
import type {
  PlaylistDetail,
  PlaylistSummary,
  RadioShowsPage,
} from "@/types"

type RadioArchiveRequest = {
  cursor?: string
  seriesId?: number
}

const mocks = {
  fetchPlaylist:
    vi.fn<(playlistId: string) => Promise<PlaylistDetail>>(),
  fetchPlaylists: vi.fn<() => Promise<PlaylistSummary[]>>(),
  fetchRadioShows:
    vi.fn<(request: RadioArchiveRequest) => Promise<RadioShowsPage>>(),
  fetchStreamUrl: vi.fn<(trackId: string) => Promise<string>>(),
}

function installSidebarBridge(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke: async (command: string, args?: InvokeArgs) => {
        const values = readTauriInvokeArguments(args)
        switch (command) {
          case "fetch_playlist":
            return mocks.fetchPlaylist(
              tauriString(values.playlistId, "playlist ID"),
            )
          case "fetch_playlists":
            return mocks.fetchPlaylists()
          case "get_stream_url":
            return mocks.fetchStreamUrl(
              tauriString(values.trackId, "track ID"),
            )
          case "radio_shows": {
            const request: RadioArchiveRequest = {}
            if (values.cursor !== undefined) {
              request.cursor = tauriString(values.cursor, "Radio cursor")
            }
            if (values.seriesId !== undefined) {
              request.seriesId = tauriNumber(
                values.seriesId,
                "Radio series ID",
              )
            }
            return mocks.fetchRadioShows(request)
          }
          default:
            throw new Error(`Unexpected Sidebar command: ${command}`)
        }
      },
    },
  })
}

async function renderSidebar(connected: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const librarySession = createLibrarySessionController({ queryClient })
  if (connected) {
    librarySession.commands.acceptConnectedLibrary([], { announce: false })
  }
  const router = createCodaMemoryRouter(
    queryClient,
    ["/collection?q=&genre=All&sort=recent&mode=releases"],
    librarySession,
  )
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
  installSidebarBridge()
  mocks.fetchPlaylist.mockReset()
  mocks.fetchPlaylists.mockReset().mockResolvedValue([])
  mocks.fetchRadioShows.mockReset().mockResolvedValue({
    hasMore: false,
    results: [],
  })
  mocks.fetchStreamUrl.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
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
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalled()
    expect(onConnect).not.toHaveBeenCalled()
  })

  it("preloads connected playlists once and reuses the Query cache on activation", async () => {
    const { queryClient, router } = await renderSidebar(true)
    const preloadRoute = vi.spyOn(router, "preloadRoute")
    const playlistsLink = screen.getByRole("link", { name: "Playlists" })

    fireEvent.focus(playlistsLink)

    await waitFor(() => {
      expect(preloadRoute).toHaveBeenCalledOnce()
      expect(mocks.fetchPlaylists).toHaveBeenCalledOnce()
    })
    expect(queryClient.getQueryData(["bandcamp", "playlists"])).toEqual([])

    fireEvent.click(playlistsLink)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/playlists")
    })
    expect(mocks.fetchPlaylists).toHaveBeenCalledOnce()
    expect(mocks.fetchPlaylist).not.toHaveBeenCalled()
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalled()
  })
})
