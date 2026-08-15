# Coda shadcn and Tailwind 4 Migration Design

## Goal

Replace Coda's current global semantic stylesheet with a Tailwind 4 and
shadcn/Base UI component system while preserving the application's existing
appearance, native desktop behavior, accessibility, playback semantics, and
performance characteristics.

This is a fresh migration from the latest `origin/main`. The existing
`codex/tailwind-migration` branch and PR #2 are reference material only. Their
mechanical CSS-to-`@apply` conversion will not be merged or used as the new
branch's foundation.

## Success criteria

- Existing Coda screens, controls, states, dimensions, colors, typography,
  shadows, and motion remain visually equivalent.
- Generic controls use owned shadcn components generated on the Base UI
  foundation and restyled with Coda tokens.
- Page and domain components use Tailwind utilities directly in JSX.
- Tailwind 4 uses its CSS-first `@theme` configuration rather than a legacy
  JavaScript configuration file.
- Tailwind Preflight provides the cross-WebView reset.
- Global CSS is limited to theme configuration, app-root behavior, platform or
  browser pseudo-elements, view transitions, reduced motion, and other
  CSS-native behavior that is materially clearer outside JSX.
- The final implementation has no mass `@apply` translation and no parallel
  legacy styling system.
- Queue, playback, navigation, persistence, Radio, Last.fm, virtualization,
  window, and tray product contracts remain unchanged.

## Non-goals

- Redesigning Coda to look like shadcn's stock examples or a generic dashboard.
- Changing information architecture, navigation, playback behavior, or queue
  semantics.
- Evaluating whether to replace the anchored sidebar with shadcn's dashboard sidebar; retaining the existing anchored sidebar is acceptable if it continues to meet Coda's needs.- Replacing the non-modal queue drawer with a modal sheet.
- Replacing virtualizer-owned scroll containers with shadcn `ScrollArea`. `ScrollArea` is not virtualized; it provides scroll behavior and styling but does not reduce DOM size or own item measurement. Virtualizer-owned scroll elements remain the more performant choice for large lists because they preserve bounded DOM output and measurement control.- Introducing new features merely because shadcn offers a component for them.
- Refactoring unrelated data, network, native, or state-management code.
- Broadly rewriting existing imports to use the new source alias.

## Branch and workspace strategy

Implementation begins by fetching the current `origin/main` and creating a new
linked worktree on `codex/shadcn-tailwind`. This protects the existing dirty
release worktree and leaves `codex/tailwind-migration` and PR #2 untouched.

The new branch must start from the fetched remote commit, not the stale local
`main` reference and not the old Tailwind migration commit. No code is
cherry-picked from PR #2. Small ideas from that branch may be reimplemented
after review, but the new component and styling architecture is built directly
on current Coda.

## Tailwind and shadcn foundation

The renderer uses:

- Tailwind CSS 4 through `@tailwindcss/vite`;
- Tailwind's CSS-first theme configuration;
- shadcn configured for React, Vite, TypeScript, CSS variables, Lucide icons,
  and the current Base UI foundation;
- `class-variance-authority` for component variants;
- `clsx` and `tailwind-merge` through the standard `cn()` helper;
- shadcn's current animation support only when required by generated
  components.

The implementation adds `components.json` and a `@/*` alias for `src/*` so
generated shadcn components follow their standard structure. Existing
application imports are not mass-converted to the alias.

Only components used by Coda are generated. shadcn is an owned-source
foundation, not a runtime theme or a reason to import an entire component
catalog. Generated files are reviewed, customized, tested, and maintained as
Coda code.

## Theme configuration

`src/styles.css` is the Tailwind entry point. It imports Tailwind, Preflight,
the shadcn support layer, and the Coda theme. It does not load a
`tailwind.config.js` or `tailwind.config.ts`.

The theme has two token levels.

### Semantic shadcn tokens

Coda's existing exact values map to the standard shadcn roles:

- background and foreground;
- card and card foreground;
- popover and popover foreground;
- primary and primary foreground;
- secondary and secondary foreground;
- muted and muted foreground;
- accent and accent foreground;
- destructive and destructive foreground;
- border, input, and focus ring;
- sidebar roles where they match Coda's anchored navigation.

These roles let generated components share a consistent API without adopting
shadcn's stock palette.

### Coda-specific tokens

Additional `@theme` variables describe product surfaces that do not fit a
generic semantic role:

- player and queue surfaces;
- field, hover, and active surfaces;
- artwork and Radio treatments;
- success and playback state;
- Coda-specific shadows;
- exact Coda radii;
- transition easing and duration values used across views.

Token values preserve existing hexadecimal, RGB/RGBA, pixel, and timing values.
Repeated values become named tokens. Deliberately unique values remain explicit
arbitrary utilities rather than gaining speculative tokens.

The radius scale maps to Coda's exact established values rather than deriving
fractional sizes from one generic radius. Fonts retain the existing Segoe UI
Variable and system fallback stack.

## Preflight and global CSS

Tauri renders Coda through WebView2, WebKit, or WebKitGTK, so a deterministic
browser baseline is still required. Tailwind Preflight replaces Coda's
hand-written reset.

The remaining base layer owns only:

- full-size `html`, `body`, and `#root` geometry;
- root overflow behavior;
- base background, foreground, font, and `color-scheme`;
- `font-synthesis` and text-rendering choices when still needed;
- the startup background shared with `tauri.conf.json`;
- platform-specific or browser pseudo-elements that cannot be expressed
  cleanly as component utilities.

Tailwind's `sr-only` utility replaces the custom screen-reader-only selector.
Focus, disabled, hover, and active behavior belongs to component variants
rather than global element selectors.

View Transition pseudo-elements, reverse-direction behavior, unique transition
names, and reduced-motion bypasses remain in CSS because they are browser-level
behavior. Native scrollbar and media-control rules may also remain when the
native smoke test proves they are necessary.

## Temporary legacy bridge

The migration remains buildable by temporarily importing the current
application stylesheet into Tailwind's `components` layer. Preflight and theme
configuration load first; Tailwind utilities retain higher layer priority.

Before the bridge is introduced, the old reset is separated from application
selectors so it does not override shadcn focus, color, or disabled states.
Migrated components stop emitting their legacy styling classes, and the
corresponding selectors are deleted in the same migration slice.

The bridge is temporary and is removed before completion. The final build must
not contain both legacy semantic selectors and utility-based replacements for
the same surface. `!important` is not used to resolve migration-order
conflicts.

## Component system

### Owned shadcn primitives

The following generic controls use generated shadcn/Base UI components,
customized to Coda's exact appearance:

| Coda need | Component |
| --- | --- |
| Primary, secondary, danger, text, artwork, and icon actions | `Button` variants and sizes |
| Text fields | `Input` |
| Multiline fields | `Textarea` |
| Form naming and accessible relationships | `Label` |
| Genre and sort controls | `NativeSelect` |
| Connection and add-to-playlist flows | `Dialog` |
| Destructive playlist confirmation | `AlertDialog` |
| Seek and volume controls | `Slider` |
| Icon-control descriptions | `Tooltip` |
| Filter chips and segmented controls | `Toggle` and `ToggleGroup` |
| Counts and compact status labels | `Badge` |
| Loading placeholders | `Skeleton` and a lightweight spinner |
| Structural dividers | `Separator` |
| User-visible inline failures | `Alert` where its semantics fit |

Components keep semantic HTML, accessible names, keyboard support, and visible
focus. Coda-specific variants are added to the owned component source rather
than recreated with call-site selector overrides.

### Coda domain components

shadcn primitives do not replace Coda's domain boundaries. These remain
Coda-owned React components styled with direct Tailwind utilities:

- app shell and anchored sidebar;
- compact player and transport;
- floating, non-modal queue drawer;
- artwork, album cards, artist cards, and track rows;
- responsive virtualized grids and lists;
- album, artist, Discover, Radio, Favorites, and playlist surfaces;
- Now Playing and its Radio chapter timeline;
- mini-player window.

The queue does not use shadcn `Sheet`, because it must remain non-modal and keep
the player reachable. Virtualized lists do not use shadcn `ScrollArea`, because
the virtualizers must retain their existing scroll element and measurement
ownership. Coda's sidebar does not use shadcn `Sidebar`, because its anchored
desktop layout and navigation transitions are product contracts.

Generic shadcn `Card` wrappers are not added to performance-sensitive album,
track, or Radio lists unless they preserve the exact DOM and measurement
contracts without extra wrappers.

Repeated React components are extracted when they share structure, behavior,
accessibility, or a stable variant API. Components are not created solely to
hide a long class string.

## Styling rules

- Use direct Tailwind utilities for layout, spacing, type, color, borders,
  sizing, responsive behavior, and ordinary state variants.
- Use `cn()` for conditional state and class composition.
- Use component variants for repeated control states.
- Use data attributes and ARIA state exposed by Base UI for styling instead of
  parallel React state used only by CSS.
- Preserve intentional exact values with theme tokens or arbitrary utilities.
- Keep dynamic artwork color variables as bounded inline CSS custom properties.
- Keep complex pseudo-elements or browser APIs in focused CSS, colocated by
  purpose in the Tailwind entry point.
- Do not add application-level `@apply` selectors. A small shadcn-generated
  base rule may remain if the current generator requires it, but application
  components must not recreate the old selector architecture through
  `@apply`.
- Do not use selector specificity or `!important` as a component API.

## Migration sequence

### 1. Establish the baseline

- Create the fresh worktree from fetched `origin/main`.
- Install dependencies without changing application behavior.
- Record the current production asset sizes.
- Capture current native views and relevant interaction states on the same
  host, WebView, window sizes, data, and playback state used for comparisons.
- Keep baseline screenshots outside committed generated-output directories.

### 2. Add the foundation and compatibility bridge

- Configure Tailwind 4, shadcn/Base UI, aliases, Preflight, and theme tokens.
- Split the existing reset from legacy component styling.
- Import legacy component CSS into the temporary compatibility layer.
- Verify that the pre-migration UI remains visually stable before converting
  individual surfaces.

### 3. Build and validate primitives

- Generate only the approved components.
- Implement Coda variants and exact token mappings.
- Add focused tests for variants, prop forwarding, accessible state, focus
  management, keyboard behavior, and slider semantics.
- Exercise primitives in the native WebView before broad adoption.

### 4. Migrate low-risk shared surfaces

- Forms, dialogs, alerts, empty states, badges, skeletons, filter controls, and
  page headings.
- Delete replaced selectors as each surface moves.
- Verify standalone and composite focus treatments to prevent duplicate rings.

### 5. Migrate library and lazy-loaded views

- Collection, search, sorting, Recent, artist, and album pages.
- Favorites, playlists, and playlist dialogs.
- Discover and Radio while preserving lazy loading and TanStack Query
  boundaries.
- Preserve current virtualizer thresholds, row measurements, scrolling, and
  bounded DOM output.

### 6. Migrate playback surfaces

- Compact player and transport controls.
- Floating queue drawer and queue row states.
- Now Playing, Radio chapters, and transitions.
- Mini-player window.
- Verify playback updates do not create new broad renderer rerenders.

### 7. Remove the bridge and finish

- Delete all superseded legacy component selectors and obsolete styling tests
  or canonicalization tooling.
- Remove the temporary stylesheet bridge.
- Review the generated dependency graph and owned shadcn source.
- Confirm that no unused component packages, blocks, themes, or remote assets
  remain.

## Product-contract preservation

The migration must not change:

- connection credential behavior or the Rust security boundary;
- queue order, clearing, shuffle scope, or Now Playing preservation;
- player session restore or scrobble accounting;
- album, artist, and track click behavior;
- directional navigation and Back restoration;
- View Transition scope, reduced-motion behavior, or focus restoration;
- queue visibility, accessibility labels, non-modal behavior, or single player
  entry point;
- Favorites, playlists, Discover, or Radio ownership and isolation;
- Last.fm authorization and keyring storage;
- window decorations, tray lifecycle, or mini-player/native window behavior.

No Tauri capability, CSP, network, credential, or native command change is
required by this migration.

## Pixel-parity verification

Before-and-after captures use identical native window geometry, content,
playback state, and reduced-motion settings.

Required window sizes:

- default `1360 x 860`;
- a layout near `900px` width;
- the supported `760px` minimum width;
- mini-player `368 x 240`.

Required surfaces and states:

- Collection, Recent, search, filtering, and sorting;
- artist and album detail;
- Favorites and playlists;
- Discover and Radio;
- connection, add-to-playlist, and destructive dialogs;
- compact player, queue open and closed, and Now Playing;
- mini-player;
- disconnected, loading, empty, failure, disabled, active, hover, and
  focus-visible states.

Pixel differences are corrected rather than dismissed as framework defaults.
An intentional visual change requires separate user approval. Native screenshots
are local verification artifacts and are not committed unless deliberately
sanitized and requested.

## Behavior and accessibility verification

Tests assert observable behavior rather than generated component internals:

- dialogs trap and restore focus and close through the expected paths;
- destructive actions still require explicit confirmation;
- tooltips do not replace accessible names;
- sliders preserve keyboard, pointer, seek, volume, disabled, and bounded value
  behavior;
- toggles expose correct pressed or selected state;
- native selects retain their value and keyboard behavior;
- queue show/hide, recovery, reorder, remove, clear, and shuffle remain intact;
- player controls remain immediately usable during queue and navigation
  changes;
- virtualized surfaces retain complete logical collections and bounded DOM
  output;
- reduced motion bypasses decorative motion and View Transition morphing.

The native smoke test covers platform WebView behavior that jsdom cannot prove.
The current host validates macOS; Windows and Linux receive CI compilation and
tests, with their native visual behavior reported as not locally exercised.

## Performance and bundle verification

The migration records renderer entry, lazy-chunk, total JavaScript, and CSS
sizes before and after. Bundle changes are explained component by component
instead of silently relaxing an obsolete ceiling.

- Generate and import only used shadcn components.
- Avoid barrel imports that pull unused Base UI modules into the entry chunk.
- Preserve lazy loading for Discover, Radio, Saved Library, and other existing
  lazy boundaries.
- Preserve virtualizer behavior and playback render isolation.
- Do not add production source maps.
- Do not block startup or playback on styling or component initialization.

Whether to restore a maintained CI bundle budget is a separate follow-up
decision. This migration must still report the measured delta.

## Final verification

Run:

```sh
npm test
npm run test:coverage
npm run build
git diff --check
```

Run the native Tauri app and exercise the relevant connection, navigation,
playback, queue, artwork, tray, window, and mini-player paths. Rust tests are
required only if the final diff unexpectedly touches Rust or native
configuration; such changes should first be justified because they are outside
the intended design.

Cross-platform CI must pass on Windows, macOS, and Linux before merge.

## Completion criteria

The migration is complete when:

- the fresh branch contains the Tailwind 4 and shadcn/Base UI implementation;
- Coda tokens drive generic and domain components;
- all in-scope application styling uses utilities or approved CSS-native rules;
- the temporary legacy bridge and superseded selectors are gone;
- required behavior tests and native visual checks pass;
- measured bundle changes are documented;
- no security, capability, credential, or network boundary changed;
- the old Tailwind migration branch was not merged into the result.
