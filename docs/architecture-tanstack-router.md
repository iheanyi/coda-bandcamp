# TanStack Router plan for Coda

Research date: 2026-08-11. This note covers TanStack Router v1's current React
documentation and applies it to Coda's Tauri desktop renderer. It is an
implementation plan, not an assertion that the migration has already happened.

## Accepted decision

Coda will use TanStack Router's recommended **file-based routing** with its Vite
plugin, automatic code splitting, and `createHashHistory` for the main Tauri
window. The choice of file-based generation is settled; the remaining work is
the staged implementation and native verification described below.

- Install `@tanstack/react-router` as an application dependency and
  `@tanstack/router-plugin` as a development dependency. Add `tanstackRouter`
  before the React plugin in `vite.config.ts`, with `target: "react"` and
  `autoCodeSplitting: true`. The Vite plugin discovers `src/routes`, generates
  `src/routeTree.gen.ts` during development/build, and owns that generated file.
  [Vite installation](https://tanstack.com/router/latest/docs/installation/with-vite)
- File-based routing is TanStack's preferred configuration. It maps the route
  hierarchy to files, generates the type links between routes, and supports
  automatic route code splitting through a supported bundler. Do not hand-build
  a parallel route tree. [File-based routing](https://tanstack.com/router/latest/docs/routing/file-based-routing)
- Treat `src/routeTree.gen.ts` as generated output: import it into the router,
  but do not review or edit it as application source. Configure formatters,
  linters, and editor search/watch behavior to ignore it where necessary. The
  plugin's defaults already use `src/routes` and `src/routeTree.gen.ts`.
  [File-based routing API](https://tanstack.com/router/latest/docs/api/file-based-routing)
- Use the URL for navigation state, not for playback or credentials. Paths
  replace the current `view`, `nowPlayingOpen`, `selectedAlbum`,
  `selectedArtist`, `discoverDetail`, and Radio-detail booleans/IDs. Queue,
  playback, connection-dialog, add-to-playlist-dialog, updater, and toast state
  remain owned by their feature controllers.
- Keep TanStack Query as the owner of remote library, album, playlist, Discover,
  and Radio data. Route loaders should coordinate `queryClient.ensureQueryData`
  rather than create a second copy in the router cache. TanStack explicitly
  supports this external-cache model. [External data loading](https://tanstack.com/router/latest/docs/guide/external-data-loading)

Current Coda requirements already exceed Router's documented baseline: the app
uses React 19 and TypeScript 5.7, while the current quick start requires React 18
or later and recommends TypeScript 5.3 or later. [Quick start](https://tanstack.com/router/latest/docs/quick-start)

## History choice for Tauri

TanStack exposes browser, hash, and memory histories through the same router
interface. [History types](https://tanstack.com/router/latest/docs/guide/history-types)

| History | Coda fit | Consequence |
| --- | --- | --- |
| `createHashHistory()` | Recommended for the main window | Back/forward and the current destination survive a WebView reload, while every asset request still targets the app entry URL. |
| `createMemoryHistory()` | Recommended for tests; acceptable only if product navigation must never touch the URL | No URL interaction, but the route stack is lost on a full reload or process restart. |
| Default browser history | Do not adopt until verified in packaged builds on all three desktop platforms | A reload at `/collection/albums/$albumId` asks the host protocol to resolve that pathname. |

The hash recommendation is an inference from the two projects' documented
contracts: TanStack says hash routing is useful where an environment cannot
rewrite arbitrary paths to `index.html`, and Tauri states that packaged WebView
assets use a native protocol rather than a localhost server. [TanStack history types](https://tanstack.com/router/latest/docs/guide/history-types),
[Tauri source repository](https://github.com/tauri-apps/tauri#features)

Keep the existing `?view=mini-player` branch in `main.tsx` ahead of router
creation. Only the main window should instantiate the application router. A
typical main-window URL would therefore be `.../#/collection`; the mini-player
continues to use its dedicated entry branch.

## Vite generation and route files

Add the router plugin without changing the current Tailwind or React behavior:

```ts
// vite.config.ts
import { tanstackRouter } from "@tanstack/router-plugin/vite";

plugins: [
  tanstackRouter({ target: "react", autoCodeSplitting: true }),
  react(),
  tailwindcss(),
];
```

The plugin must precede the React plugin, and automatic splitting requires the
bundler plugin rather than the standalone CLI. [Vite installation](https://tanstack.com/router/latest/docs/installation/with-vite),
[automatic code splitting](https://tanstack.com/router/latest/docs/guide/code-splitting#using-automatic-code-splitting)

Mirror Coda's destination hierarchy under `src/routes/`. A directory route's
`route.tsx` provides the layout and its `index.tsx` provides the index page;
files prefixed with `$` provide typed dynamic path params.

```text
src/routes/
├── __root.tsx
├── index.tsx                         # replace redirect to /collection
├── collection/
│   ├── route.tsx                     # collection layout
│   ├── index.tsx                     # CollectionPage
│   ├── albums/$albumId.tsx           # AlbumDetailPage
│   └── artists/$artistKey.tsx        # ArtistDetailPage
├── recent.tsx
├── favorites.tsx
├── playlists/
│   ├── index.tsx
│   └── $playlistId.tsx
├── discover/
│   ├── index.tsx
│   └── releases/$releaseId.tsx
├── radio/
│   ├── index.tsx
│   ├── series/$seriesId.tsx
│   └── shows/$showId.tsx
└── now-playing.tsx
```

This is the source route tree. `src/routeTree.gen.ts` is its generated,
type-linked representation and should never receive hand-written application
logic. TanStack supports flat, directory, and mixed file layouts; this plan
uses directories where Coda has a natural route family.
[File naming and directory routes](https://tanstack.com/router/latest/docs/routing/file-based-routing)

## Resulting route tree

The root route is the persistent application shell. It renders the sidebar,
route outlet, queue drawer, compact player, hidden audio element, mini-player
bridge, connection/update/playlist dialogs, and toaster. Playback must not
unmount during page navigation.

```text
root (AppShell)
├── /                         -> replace redirect to /collection
├── /collection              -> CollectionPage
│   ├── /albums/$albumId      -> AlbumDetailPage
│   └── /artists/$artistKey   -> ArtistDetailPage
├── /recent                  -> RecentPage
├── /favorites               -> FavoritesPage
├── /playlists               -> PlaylistsPage
│   └── /$playlistId          -> PlaylistDetailPage
├── /discover                -> DiscoverPage
│   └── /releases/$releaseId  -> DiscoverReleasePage
├── /radio                   -> RadioPage
│   ├── /series/$seriesId     -> RadioSeriesPage
│   └── /shows/$showId        -> RadioShowPage
└── /now-playing             -> NowPlayingPage
```

This makes impossible combinations unrepresentable. For example, a stale
Discover detail can no longer render on top of a Radio destination, and album,
artist, Radio, and Now Playing destinations cannot all be active simultaneously.
Opening `/now-playing`, then an album, then navigating back naturally restores
Now Playing because history records the actual destination stack.

Prefer semantic `<Link>` navigation for sidebar and in-content destination
links. Use `useNavigate` for actions that navigate only after work succeeds or
that require source-element transition setup. TanStack recommends links when
possible and imperative navigation for side-effect-driven cases. [Navigation](https://tanstack.com/router/latest/docs/guide/navigation)

## Router composition

The generated tree replaces manual `addChildren` assembly. Keep the router
factory outside React so production and tests can inject different history
implementations while using exactly the same generated routes:

```tsx
import {
  createHashHistory,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";

type CodaRouterContext = {
  queryClient: QueryClient;
};

export function createCodaRouter(
  queryClient: QueryClient,
  history: RouterHistory = createHashHistory(),
) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    scrollRestorationBehavior: "instant",
    scrollToTopSelectors: ["[data-coda-library-scroll]"],
  });
}

export type CodaRouter = ReturnType<typeof createCodaRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: CodaRouter;
  }
}
```

`src/routes/__root.tsx` uses `createRootRouteWithContext<CodaRouterContext>()`
and renders `AppShell`, whose route-content slot is an `<Outlet />`. It must not
switch over path strings or reintroduce a second `view` state. The generated
tree and module registration make `Link`, `useNavigate`, route params, route
search, and route APIs aware of Coda's exact routes.
[Creating a router](https://tanstack.com/router/latest/docs/guide/creating-a-router),
[type safety](https://tanstack.com/router/latest/docs/guide/type-safety)

## Router context and feature state

Use router context as a small dependency-injection interface:

- Include the `QueryClient` and only stable adapters a loader genuinely needs.
- Do not put credentials, signed URLs, the queue, the audio element, playback
  position, or a giant `App` controller object in router context.
- React hooks cannot run inside `beforeLoad` or loaders. If a loader requires a
  React-derived dependency, obtain it above `RouterProvider` and pass only the
  stable result through context. TanStack documents typed root context,
  per-route augmentation, invalidation, and this hooks constraint. [Router context](https://tanstack.com/router/latest/docs/guide/router-context)
- Keep high-frequency playback position on the existing external playback clock;
  routing must not make every route rerender on media-time updates.

## URL ownership and type-safe navigation

The URL owns state that is meaningful to copy, reload, or traverse with Back and
Forward:

- Destination and detail identity belong in path params: album, artist,
  playlist, Discover release, Radio series/show, and Now Playing.
- Collection query, genre, sort, and display mode belong in validated search
  params. Other route families may add similarly bounded, shareable filters.
- Source-focus or transition hints that must survive one history entry may use
  typed history state, but they must not become a second destination model.

File names such as `$albumId.tsx` generate the path-param contract. Where a
param needs more than string typing, use the route's `params.parse` and
`params.stringify` pair to validate/bound it and preserve typed navigation.
TanStack requires params when linking to a dynamic route and infers their shape
from the route tree. [Path params](https://tanstack.com/router/latest/docs/guide/path-params)

Use validated search parameters for view-local, reload-worthy collection state:

```ts
type CollectionSearch = {
  q: string;
  genre: string;
  sort: "recent" | "artist" | "title" | "year";
  mode: "releases" | "artists" | "albums" | "singles";
};
```

`validateSearch` receives untrusted `unknown`/JSON-like input and should return
bounded values with safe fallbacks. TanStack explicitly treats search params as
an untrusted serialization boundary. [Search-param validation](https://tanstack.com/router/latest/docs/guide/search-params)

Use route-scoped APIs (`Route.useParams`, `Route.useSearch`) and give shared
links/hooks a precise `from` or `to`. Prefer semantic `<Link>` for normal
navigation and `useNavigate({ from: Route.fullPath })` for navigation after a
successful action. Registering the generated router makes invalid destinations,
missing params, and incompatible search objects TypeScript errors.
[Type safety](https://tanstack.com/router/latest/docs/guide/type-safety)

Use `replace: true` when updating `q` on each keystroke so typing does not create
one back-stack entry per character. A navigation with `replace: true` replaces
the current history entry; the default is to push. [Navigate options](https://tanstack.com/router/latest/docs/api/router/NavigateOptionsType)

Privacy and state exclusions are strict: do not put credentials, Last.fm session
keys, signed media/artwork URLs, queue contents, current time, volume, scrobble
progress, dialog-open flags, updater state, or toast state into params, search,
hash fragments, or history state. The hash URL is still user-visible and may be
copied or retained locally. Playback and device-local state remain in their
existing controllers and persistence boundaries.

## Route loaders, preloading, and boundaries

Loaders run after matching/search validation and `beforeLoad`; matched route
loaders then run in parallel. They receive typed params, typed search
dependencies, context, location, and an abort controller. Pass the abort signal
through whenever the underlying operation supports cancellation.
[Data-loading lifecycle](https://tanstack.com/router/latest/docs/guide/data-loading)

For Coda:

- The album route loader validates `albumId`, finds its bounded library summary,
  and calls the existing album Query `ensureQueryData` helper.
- Playlist, Discover-release, and Radio-show loaders similarly ensure their
  existing TanStack Query entries. Mutations remain in feature code, followed by
  focused Query invalidation and router-match invalidation where needed.
- Keep credentials and signed URLs out of loader return values and router cache.
  A loader may coordinate a typed native/query adapter through context; it must
  not serialize secrets into a location or expose raw failures in route UI.
- The root connection/library-startup controller remains outside page loaders.
  It owns native credential availability, cached startup, background sync, and
  generation cancellation; frequently revalidating it would conflate app
  startup with page data.

Enable `defaultPreload: "intent"`. Hover or touch intent on a `<Link>` then
preloads its route chunk and loader dependencies before activation. Because
TanStack Query owns freshness, use `defaultPreloadStaleTime: 0`; this lets the
loader run and lets `ensureQueryData` decide whether network work is necessary.
[Preloading](https://tanstack.com/router/latest/docs/guide/preloading)

Define boundaries at the nearest route family that can recover usefully:

- `pendingComponent` gives slow detail loaders a stable skeleton without
  unmounting the root shell, audio, compact player, or queue.
- `errorComponent` presents an actionable, sanitized retry and resets or
  invalidates the failed match; it never prints raw native/server responses.
- `notFoundComponent` handles malformed, absent, or no-longer-visible resources
  without falling back to a stale legacy view.
- Root boundaries are the final safety net. A detail-route failure must not take
  playback controls down with it.

TanStack supports route-level pending thresholds and error components for both
loader and render failures. Tune `pendingMs`/`pendingMinMs` only after observing
native navigation so fast cached loads do not flash a spinner.
[Pending and error states](https://tanstack.com/router/latest/docs/guide/data-loading#handling-slow-loaders)

## Scroll, focus, and view transitions

Enable router scroll restoration and target Coda's nested library pane via
`scrollToTopSelectors`. The old `<ScrollRestoration />` component is deprecated
in favor of router configuration. [Scroll restoration](https://tanstack.com/router/latest/docs/guide/scroll-restoration)

Coda's virtualized grids require an explicit follow-up: TanStack documents
`useElementScrollRestoration`, `data-scroll-restoration-id`, and feeding the
restored offset to the virtualizer. Do not delete the current manual scroll refs
until equivalent back-navigation behavior has native and component coverage.
[Virtualized scroll restoration](https://tanstack.com/router/latest/docs/guide/scroll-restoration#manual-scroll-restoration)

Routing does not remove Coda's focus contract. Preserve source-trigger and
destination-heading focus restoration. Router `onRendered` events are suitable
for DOM-dependent focus work after the destination is mounted. [Router events](https://tanstack.com/router/latest/docs/guide/router-events)

TanStack navigation accepts `viewTransition: true` or typed transition names.
Choose one owner for `document.startViewTransition`: either adapt
`transitionCodaView` to drive `navigate`, or use Router's transition option, but
never nest both. Preserve unique shared-element names, directional back/forward
types, and reduced-motion bypasses. [View-transition navigation](https://tanstack.com/router/latest/docs/api/router/NavigateOptionsType#viewTransition)

## Navigation blocking

`useBlocker` can synchronously or asynchronously prevent router navigation and
can expose `proceed`, `reset`, and `status` for custom confirmation UI.
`enableBeforeUnload` separately controls the browser unload prompt.
[Navigation blocking](https://tanstack.com/router/latest/docs/guide/navigation-blocking)

Use blockers only for genuinely unsaved user work. Do not block route changes
because music is playing, a background sync is running, or a Query request is in
flight. A browser `beforeunload` handler is not a substitute for Coda's native
close-to-tray and explicit-Quit lifecycle; native window handling still owns
that product contract.

The current `useBlocker` API reference labels the new API experimental, so pin
the dependency through the lockfile and recheck its interface before adopting a
custom blocker. [useBlocker API](https://tanstack.com/router/latest/docs/api/router/useBlockerHook)

## Testing strategy

Create a fresh router per test with `createMemoryHistory({ initialEntries })`,
the generated `routeTree`, and an isolated test `QueryClient`/adapter context.
Render `RouterProvider` only after constructing that router; do not reuse the
production singleton between tests. The official file-routing test guide uses
the generated tree with memory history and configures the Vite router plugin in
the test build so route discovery/types stay current.
[File-based router testing](https://tanstack.com/router/latest/docs/how-to/test-file-based-routing)

Minimum route-level coverage:

- Direct rendering of every path, including malformed and missing params.
- Sidebar links, album/artist drill-ins, Now Playing, and browser-style
  back/forward behavior.
- Search validation/defaults and `replace` behavior for collection typing.
- Loader success, pending, cancellation/stale completion, error, and retry.
- Intent preload of both route chunks and Query-backed loader data without a
  duplicate network request on activation.
- Back-navigation scroll and source-focus restoration, including virtual grids.
- Automatically split route loading, pending UI, and nearest error boundaries.
- A packaged macOS smoke test using hash URLs: reload on a detail path, move
  between Collection/Discover/Radio, open and close Now Playing, traverse Back,
  and confirm the mini-player query entry still bypasses the main router.

Keep native E2E coverage for playback, queue, tray/window lifecycle, Keychain,
media controls, and real WebView focus. A memory-router jsdom test cannot prove
those behaviors.

## Code splitting

Enable the Vite plugin's `autoCodeSplitting: true` and let it split each
file-based route into critical route configuration and non-critical UI. This is
available only with file-based routing through a supported bundler, which is why
Coda should use the Vite plugin rather than only the Router CLI.
[Automatic code splitting](https://tanstack.com/router/latest/docs/guide/code-splitting#using-automatic-code-splitting)

Keep the root shell, compact player, queue drawer, audio/desktop bridges, and
shared controllers outside destination chunks so navigation never tears down
playback. Route files can colocate their loader, validation, component, pending,
and error configuration; the plugin decides the generated split. Do not add a
second `React.lazy`, `.lazy.tsx`, or `Route.lazy()` layer unless bundle analysis
shows a concrete boundary the automatic transform cannot provide.

Verify the production manifest/chunks and intent-preload behavior after the
migration. Automatic splitting is a build transformation, so a component test
alone does not prove the packaged route chunks are emitted or requested as
expected.

## Safe migration sequence

1. Add the Vite plugin, generated-tree ignores, root route, router factory, and
   memory-history test harness. Confirm `npm run build` generates the route tree
   and automatic chunks before moving behavior.
2. Extract the persistent `AppShell` and feature controllers without changing
   behavior. Keep the player, queue, audio, bridges, dialogs, and toaster above
   the route outlet.
3. Add the hash router and make `/collection` the sole source of truth for the
   initial destination; do not mirror it into `view` state.
4. Move sidebar destinations one at a time, replacing handlers with typed
   `<Link>` options and deleting each corresponding local navigation branch in
   the same change.
5. Move album, artist, Discover, Radio, playlist, and Now Playing details to
   typed path params. Let Back operate on router history and retain the existing
   transition/focus metadata until equivalent behavior is verified.
6. Move shareable collection controls to validated search params, using history
   replacement for live typing while keeping private/ephemeral state out.
7. Add Query-backed route loaders, intent preloading, and nearest pending/error/
   not-found boundaries. Remove component fetch waterfalls only after parity
   tests pass.
8. Remove redundant destination-level `React.lazy` wrappers, verify automatic
   production chunks, and run the full native macOS smoke suite.

At every stage, route location must be the sole destination state. A temporary
adapter may translate a route into legacy props, but it must not maintain a
second mutable route model.
