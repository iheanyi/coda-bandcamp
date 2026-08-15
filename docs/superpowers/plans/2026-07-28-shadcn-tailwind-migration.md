# Coda shadcn and Tailwind 4 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Coda's renderer styling on Tailwind CSS 4 and owned shadcn/Base UI components while preserving the current UI pixel-for-pixel and leaving every playback, queue, navigation, native-window, accessibility, and security contract intact.

**Architecture:** A fresh `codex/shadcn-tailwind` worktree starts from fetched `origin/main`. Tailwind 4 supplies CSS-first tokens, Preflight, and direct utilities; generated Base UI shadcn files supply accessible generic controls; Coda domain surfaces remain focused React components. A temporary legacy stylesheet bridge keeps the app usable during migration, but one integration owner removes that bridge before completion.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4.3.3, `@tailwindcss/vite`, shadcn CLI 4.14.1, Base UI 1.6.0, class-variance-authority, clsx, tailwind-merge, Vitest, Testing Library, Tauri 2.

## Global Constraints

- Start from a newly fetched `origin/main`; do not merge or cherry-pick `codex/tailwind-migration` or PR #2.
- Work in `/Users/iheanyi/development/coda-bandcamp/.worktrees/shadcn-tailwind` on `codex/shadcn-tailwind`.
- Preserve all dirty files in `/Users/iheanyi/development/coda-bandcamp`.
- Do not stage, commit, push, close PR #2, or mutate any other pull request.
- Use `apply_patch` for semantic file edits. Use mechanical move/split tooling only for the initial 6,420-line stylesheet migration, and verify its output.
- Never use `rm -rf`; use `trash` for obsolete files after verification.
- Use Tailwind 4 CSS-first `@theme`; do not add `tailwind.config.js` or `tailwind.config.ts`.
- Explicitly configure shadcn `"style": "base-nova"` and Base UI; do not rely on a mutable CLI default.
- Keep exact Coda colors, pixels, opacity, radii, shadows, typography, and motion.
- Use direct Tailwind utilities in JSX. Do not recreate application selectors with `@apply`.
- Preserve the minimum main-window width of 760 px and mini-player size of 368 x 240.
- Preserve current lazy imports, virtualizer ownership, queue behavior, player render isolation, and View Transition behavior.
- Do not add a shadcn `Sheet`, `Sidebar`, or `ScrollArea` to the queue, anchored navigation, or virtualized lists.
- Do not add Tauri capabilities, CSP sources, native commands, remote assets, or credential handling.
- Tailwind 4 officially targets Chrome 111+, Safari 16.4+, and Firefox 128+. Report older system-WebView compatibility as unverified; do not silently raise a native deployment target.
- Only the supervisor edits the temporary legacy stylesheet during parallel domain work.

## Agent Ownership and Scheduling

After Tasks 1-4 complete serially, the supervisor may run domain tasks in parallel with these exclusive owners:

| Task | Exclusive source ownership |
| --- | --- |
| Task 5 | `App.tsx`, `App.test.tsx`, album/artist grids, queue list, App legacy selectors |
| Task 6 | `DiscoverView.tsx`, `DiscoverView.test.tsx` |
| Task 7 | Radio, Radio chapter metadata, Now Playing, their tests |
| Task 8 | Mini-player files and tests |
| Task 9 | Updater UI files and tests |
| Task 10 | Saved Library and saved-list virtualizer files and tests |

Task 10 starts only after Task 5 freezes the library scroll-root contract. No two agents edit `src/App.tsx`, `src/styles.css`, `src/legacy.css`, `package.json`, or `package-lock.json` concurrently.

---

### Task 1: Fresh worktree and formal baseline

**Files:**
- Read: repository and native app at fetched `origin/main`
- Create outside repository: local native screenshot baseline
- Modify: none

**Interfaces:**
- Consumes: approved design at `docs/superpowers/specs/2026-07-28-shadcn-tailwind-migration-design.md`
- Produces: `/Users/iheanyi/development/coda-bandcamp/.worktrees/shadcn-tailwind`, branch `codex/shadcn-tailwind`, baseline test/build results, baseline bundle measurements, and native screenshots

- [x] **Step 1: Verify workspace and refs without changing them**

```sh
git status --short
git worktree list
git branch --list codex/shadcn-tailwind
```

Expected: dirty main-worktree files are recorded; no existing worktree or branch collides with the requested target.

- [x] **Step 2: Fetch and create the isolated worktree**

Use the `superpowers:using-git-worktrees` skill. Fetch `origin/main`, verify the fetched SHA, then create:

```sh
git fetch origin main
git worktree add /Users/iheanyi/development/coda-bandcamp/.worktrees/shadcn-tailwind \
  -b codex/shadcn-tailwind origin/main
```

Expected: the new worktree is clean and its `HEAD` equals fetched `origin/main`.

- [x] **Step 3: Install the exact baseline**

```sh
npm ci
npm test
npm run build
```

Expected: all existing tests pass and the production renderer builds before migration.

- [x] **Step 4: Record bundle measurements**

Run this from the fresh worktree after `npm run build`:

```sh
node --input-type=module -e '
import { readdir, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { gzipSync } from "node:zlib";
const directory = new URL("./dist/assets/", import.meta.url);
const assets = await Promise.all((await readdir(directory)).map(async (name) => {
  const bytes = await readFile(new URL(name, directory));
  return { name, extension: extname(name), raw: bytes.byteLength, gzip: gzipSync(bytes, { level: 9 }).byteLength };
}));
const js = assets.filter((asset) => asset.extension === ".js");
const css = assets.filter((asset) => asset.extension === ".css");
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
console.log(JSON.stringify({
  assets,
  totalJavaScriptRaw: sum(js, "raw"),
  totalJavaScriptGzip: sum(js, "gzip"),
  totalCssRaw: sum(css, "raw"),
  totalCssGzip: sum(css, "gzip")
}, null, 2));
'
```

Expected: the supervisor records the complete output in its task notes, not in a committed generated file.

- [x] **Step 5: Capture the native visual baseline**

Run `npm run dev` and capture identical local states at:

- 1360 x 860;
- approximately 900 px wide;
- 760 px wide;
- mini-player 368 x 240.

Capture Collection, artist, album, Favorites, playlists, Discover, Radio, dialogs, queue closed/open, Now Playing, disconnected, loading, empty, disabled, hover, and focus-visible states. Store screenshots outside the repository.

- [x] **Step 6: Baseline handoff**

Report the fetched SHA, test/build results, bundle JSON, screenshot location, host OS/WebView, and any baseline failures. Do not begin dependency changes until baseline failures are understood.

---

### Task 2: Tailwind 4, shadcn/Base UI, and the compatibility bridge

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Modify: `tsconfig.json`
- Create: `components.json`
- Move mechanically: `src/styles.css` to `src/legacy.css`
- Create: `src/styles.css`
- Create: `src/lib/utils.ts`

**Interfaces:**
- Consumes: clean Task 1 worktree and baseline
- Produces: `@/*` alias, Tailwind Vite plugin, CSS-first Coda tokens, Preflight, Base UI shadcn configuration, `cn(...inputs)`, and a visually stable temporary legacy bridge

- [x] **Step 1: Preserve the old stylesheet**

Move the existing stylesheet without rewriting it:

```sh
mv src/styles.css src/legacy.css
```

Use `apply_patch` to remove the old `:root`, universal reset, element focus/disabled rules, and `.sr-only` block from `src/legacy.css`. Leave application selectors and CSS-native behavior in their original order.

- [x] **Step 2: Install the pinned foundation**

```sh
npm install --save-dev \
  tailwindcss@4.3.3 \
  @tailwindcss/vite@4.3.3 \
  shadcn@4.14.1 \
  @types/node \
  @testing-library/user-event

npm install \
  @base-ui/react@1.6.0 \
  class-variance-authority@0.7.1 \
  clsx@2.1.1 \
  tailwind-merge@3.6.0 \
  tw-animate-css@1.4.0
```

Expected: `package-lock.json` retains optional Tailwind Oxide packages for all platforms.

- [x] **Step 3: Add the source alias**

Add to `compilerOptions` in `tsconfig.json`:

```json
"baseUrl": ".",
"paths": {
  "@/*": ["./src/*"]
}
```

Add to `vite.config.ts`:

```ts
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Preserve the existing server, test, and build configuration.
});
```

- [x] **Step 4: Add deterministic shadcn configuration**

Create `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [x] **Step 5: Add the standard class composer**

Create `src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [x] **Step 6: Create the CSS-first Coda theme**

Create `src/styles.css` with imports first:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "./legacy.css" layer(components);

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-coda-player: var(--coda-player);
  --color-coda-field: var(--coda-field);
  --color-coda-hover: var(--coda-hover);
  --color-coda-active: var(--coda-active);
  --radius-sm: 5px;
  --radius-md: 7px;
  --radius-lg: 10px;
  --radius-xl: 14px;
}

:root {
  --background: #111315;
  --foreground: #f2efe8;
  --card: #17191b;
  --card-foreground: #f2efe8;
  --popover: #1d2022;
  --popover-foreground: #f2efe8;
  --primary: #dd6549;
  --primary-foreground: #ffffff;
  --secondary: rgba(255, 255, 255, 0.035);
  --secondary-foreground: #dddcd6;
  --muted: #202326;
  --muted-foreground: #969992;
  --accent: rgba(221, 101, 73, 0.12);
  --accent-foreground: #ee9179;
  --destructive: #dd6549;
  --border: rgba(255, 255, 255, 0.085);
  --input: rgba(255, 255, 255, 0.14);
  --ring: rgba(221, 101, 73, 0.72);
  --sidebar: #141618;
  --sidebar-foreground: #b9bbb5;
  --sidebar-border: rgba(255, 255, 255, 0.085);
  --coda-player: #17191b;
  --coda-field: #191c1e;
  --coda-hover: #242729;
  --coda-active: #292c2e;
  color-scheme: dark;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

@layer base {
  html,
  body,
  #root {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  body {
    margin: 0;
    background: var(--background);
    color: var(--foreground);
    font-family: var(--font-sans);
  }
}
```

Expand the token map from the approved design using exact current values. Do not approximate values onto Tailwind's stock scale.

- [x] **Step 7: Restore Preflight-sensitive legacy semantics**

Audit headings, paragraphs, images, lists, buttons, form controls, borders, and placeholders. At minimum, explicitly restore ordered-list numbering for the connection steps until Task 5 migrates that markup:

```css
.connection-steps {
  list-style: decimal;
}
```

- [x] **Step 8: Verify the bridge**

```sh
npm test
npm run build
npm ls tailwindcss @tailwindcss/vite shadcn @base-ui/react class-variance-authority clsx tailwind-merge tw-animate-css
git diff --check
```

Expected: build passes, package bases are Base UI rather than Radix/React Aria, and same-host screenshots match the Task 1 baseline before domain migration.

---

### Task 3: Generate and customize foundational shadcn components

**Files:**
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/textarea.tsx`
- Create: `src/components/ui/label.tsx`
- Create: `src/components/ui/native-select.tsx`
- Create: `src/components/ui/toggle.tsx`
- Create: `src/components/ui/toggle-group.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/ui/skeleton.tsx`
- Create: `src/components/ui/spinner.tsx`
- Create: `src/components/ui/separator.tsx`
- Create: `src/components/ui/alert.tsx`
- Create: `src/components/ui/basic-primitives.test.tsx`
- Modify if the generator adds component dependencies: `package.json`
- Modify if the generator adds component dependencies: `package-lock.json`
- Modify only to reconcile generator-owned imports: `src/styles.css`

**Interfaces:**
- Consumes: `cn()` and tokens from Task 2
- Produces: Coda-styled variants used by every domain task

- [x] **Step 1: Generate the approved source**

Run once; do not use a barrel:

```sh
npx --yes shadcn@4.14.1 add \
  button input textarea label native-select toggle toggle-group \
  badge skeleton spinner separator alert \
  dialog alert-dialog slider tooltip \
  --yes
```

Expected: generated interactive imports use `@base-ui/react`, not Radix or React Aria.

- [x] **Step 2: Write the primitive contract tests**

Create tests covering the public Coda variants:

```tsx
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

it("renders the exact Coda artwork button contract", () => {
  render(<Button variant="artwork">Shuffle all</Button>);
  expect(screen.getByRole("button", { name: "Shuffle all" })).toHaveClass(
    "h-[39px]",
    "rounded-md",
  );
});

it("keeps labels and fields explicitly associated", () => {
  render(
    <>
      <Label htmlFor="username">Username</Label>
      <Input id="username" />
    </>,
  );
  expect(screen.getByLabelText("Username")).toHaveAttribute("id", "username");
});
```

Add assertions for primary, secondary, danger, text, ghost, artwork, icon, compact, and default Button contracts; NativeSelect value/keyboard behavior; Toggle/ToggleGroup pressed state; Badge; Skeleton; Spinner; Separator; and Alert semantics.

- [x] **Step 3: Run tests and confirm stock output fails Coda contracts**

```sh
npm test -- src/components/ui/basic-primitives.test.tsx
```

Expected: generated stock sizes, colors, transitions, or missing Coda variants fail.

- [x] **Step 4: Replace stock appearance with Coda variants**

Keep generated accessible behavior, but remove stock active translation,
`transition-all`, approximate translucent colors, stock focus-ring thickness,
and stock radii. Implement variants through CVA:

```ts
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center font-bold outline-none disabled:cursor-default disabled:opacity-[0.38]",
  {
    variants: {
      variant: {
        primary: "border-0 bg-primary text-primary-foreground hover:bg-[#ee7456]",
        secondary:
          "border border-input bg-secondary text-secondary-foreground hover:bg-white/[0.08]",
        artwork:
          "border border-input bg-white/[0.025] text-[#aaada8] hover:bg-white/[0.065] hover:text-[#e5e3dd]",
        danger:
          "border border-primary/35 bg-primary/10 text-[#ee9179] hover:bg-primary/[0.18]",
        text: "border-0 bg-transparent text-[#969992] hover:text-foreground",
        ghost:
          "border-0 bg-transparent text-[#969992] hover:bg-white/[0.06] hover:text-foreground",
      },
      size: {
        compact: "h-8 gap-1.5 rounded-sm px-2.5 text-[11px]",
        default: "h-[39px] gap-2 rounded-md px-[15px] text-xs",
        icon: "size-8 rounded-md p-0",
        "icon-compact": "size-7 rounded-sm p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
);
```

Preserve exact current colors; promote repeated exact values into `@theme`
rather than leaving the illustrative literals duplicated.

- [x] **Step 5: Verify the foundational primitives**

```sh
npm test -- src/components/ui/basic-primitives.test.tsx
npm run build
git diff --check
```

Expected: focused tests pass and no UI barrel or unused registry block exists.

---

### Task 4: Interactive shadcn primitives and browser-test shims

**Files:**
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/components/ui/alert-dialog.tsx`
- Modify: `src/components/ui/slider.tsx`
- Modify: `src/components/ui/tooltip.tsx`
- Create: `src/components/ui/interactive-primitives.test.tsx`
- Modify: `test/setup.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: generated Base UI source and Coda Button/tokens
- Produces: controlled Dialog, AlertDialog, continuous Slider, Tooltip, and root TooltipProvider contracts for domain tasks

- [x] **Step 1: Add browser shims required by Base UI tests**

Extend `test/setup.ts` with deterministic `PointerEvent`, pointer capture,
`ResizeObserver`, `matchMedia`, and element geometry shims. Keep each shim
feature-detected so jsdom upgrades can supply the native implementation.

- [x] **Step 2: Write interaction-first tests**

Cover:

```tsx
it("restores focus after a dialog closes", async () => {
  const user = userEvent.setup();
  render(<DialogHarness />);
  const trigger = screen.getByRole("button", { name: "Open settings" });
  await user.click(trigger);
  expect(screen.getByRole("dialog")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
});

it("reports continuous scalar slider changes", async () => {
  const onValueChange = vi.fn();
  render(
    <Slider
      aria-label="Volume"
      min={0}
      max={1}
      step={0.01}
      value={[0.72]}
      onValueChange={onValueChange}
    />,
  );
  screen.getByRole("slider").focus();
  fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
  expect(onValueChange).toHaveBeenCalled();
});
```

Also assert Tab/Shift+Tab containment, outside/Escape close, busy close rejection
through a controlled harness, AlertDialog cancel/confirm exactly once, Slider
Home/End/bounds/disabled behavior, and Tooltip triggers retaining their own
`aria-label`.

- [x] **Step 3: Run the tests and observe missing Coda contracts**

```sh
npm test -- src/components/ui/interactive-primitives.test.tsx
```

Expected: stock generated behavior or appearance fails at least the Coda
variant, focus, or continuous-value contract.

- [x] **Step 4: Customize owned interactive components**

Use Base UI state attributes and direct utilities. Keep Dialog portals and
focus management. Export the same compound APIs used by shadcn examples.
Keep Slider's array-based public API and use `onValueChange` for continuous
playback changes; domain adapters convert between scalar player state and a
single-item array.

- [x] **Step 5: Install one root tooltip provider**

Wrap both the main and mini-player render branches in `TooltipProvider` in
`src/main.tsx`. Do not let Tooltip content replace an icon trigger's
`aria-label`.

- [x] **Step 6: Verify the interaction layer**

```sh
npm test -- \
  src/components/ui/basic-primitives.test.tsx \
  src/components/ui/interactive-primitives.test.tsx
npm run build
git diff --check
```

Expected: all primitive tests pass and the native app opens/closes one sample
dialog without focus or portal stacking regressions.

---

### Task 5: Migrate the App shell, library, connection, queue, and compact player

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/AlbumVirtualGrid.tsx`
- Modify: `src/ArtistVirtualGrid.tsx`
- Modify: `src/TrackQueueList.tsx`
- Modify: `src/VirtualizedQueueList.tsx`
- Modify: `src/VirtualizedQueueList.test.tsx`
- Delete after replacement: `src/queuePanelStyles.test.ts`
- Supervisor-only modify: `src/legacy.css`

**Interfaces:**
- Consumes: Tasks 3-4 primitives
- Produces: direct-utility App surface and stable
  `data-coda-library-scroll` scroll-root contract for Task 10

- [x] **Step 1: Strengthen characterization coverage**

Add or retain tests proving:

- queue Show and Hide both work;
- compact-player controls remain reachable when the queue is open;
- clearing keeps Now Playing;
- connection dialog restores focus and rejects dismissal while busy;
- search, filters, sorting, contextual shuffle, album/artist navigation, and
  Back behavior are unchanged;
- virtual queue focus/reorder/removal remains bounded.

Add the scroll-root assertion:

```tsx
expect(
  document.querySelector("[data-coda-library-scroll]"),
).toBeInstanceOf(HTMLElement);
```

- [x] **Step 2: Run the App characterization suite**

```sh
npm test -- \
  src/App.test.tsx \
  src/VirtualizedQueueList.test.tsx \
  src/ResponsiveVirtualGrid.test.tsx \
  src/queuePanelStyles.test.ts
```

Expected: the pre-refactor suite passes.

- [x] **Step 3: Migrate shell and library surfaces**

Replace shell, sidebar, headers, search, tabs, filters, album/artist cards,
heroes, album detail, skeletons, and empty states with direct utilities and
owned primitives. Restore the connection-step numbering with `list-decimal`
on the `<ol>` rather than a global selector.

Add `data-coda-library-scroll` to the element that owns library scrolling.
Do not change TanStack Query state, navigation state, virtualizer thresholds,
or click contracts.

- [x] **Step 4: Migrate ConnectionDialog**

Use controlled shadcn Dialog:

```tsx
<Dialog
  open
  onOpenChange={(open) => {
    if (!open && !busy) onClose();
  }}
>
  {/* exact existing content and actions */}
</Dialog>
```

Reject Escape/outside dismissal while connection or Last.fm work is pending.
Preserve Subsonic credential copy and error handling.

- [x] **Step 5: Migrate queue and compact player**

Keep the queue a custom non-modal drawer. Use Button, Tooltip, Slider, Badge,
and direct utilities inside it. Do not use Sheet.

Adapt scalar player state to Slider:

```tsx
<Slider
  aria-label="Track position"
  min={0}
  max={duration || 1}
  step={1}
  value={[Math.min(currentTime, duration || 1)]}
  disabled={!track}
  onValueChange={([nextPosition]) => onSeek(nextPosition)}
/>
```

Use the same continuous pattern for volume. Preserve immediate playback
updates, queue animation, current-track state, dynamic artwork variables, and
bounded rendering.

- [x] **Step 6: Replace the raw-CSS queue test**

Delete `src/queuePanelStyles.test.ts` with
`trash src/queuePanelStyles.test.ts` after its opaque background, gutter,
shrinking metadata, and long-title invariants are covered by rendered component
behavior and the native pixel baseline. Do not make tests inspect Tailwind
source strings.

- [x] **Step 7: Supervisor removes accepted App legacy rules**

The App agent returns the legacy class prefixes it stopped emitting. The
supervisor removes those blocks from `src/legacy.css` serially and reruns the
focused suite.

- [x] **Step 8: Verify Task 5**

```sh
npm test -- \
  src/App.test.tsx \
  src/VirtualizedQueueList.test.tsx \
  src/ResponsiveVirtualGrid.test.tsx
npm run build
git diff --check
```

Expected: App behavior passes, lazy imports remain, and
`data-coda-library-scroll` is frozen for Task 10.

---

### Task 6: Migrate Discover

**Files:**
- Modify: `src/DiscoverView.tsx`
- Modify: `src/DiscoverView.test.tsx`
- Supervisor-only modify: `src/legacy.css`

**Interfaces:**
- Consumes: Button, NativeSelect, ToggleGroup, Badge, Skeleton, Alert
- Produces: direct-utility lazy Discover view with unchanged query behavior

- [x] **Step 1: Preserve observable behavior**

Ensure tests cover native select changes, tag selection, `aria-pressed`, pending
disabled states, preview playback, pagination, and retained last usable data.

- [x] **Step 2: Run the focused tests**

```sh
npm test -- src/DiscoverView.test.tsx
```

Expected: characterization tests pass.

- [x] **Step 3: Port Discover markup**

Use direct utilities for intro, search, filters, grid, cards, and status
surfaces. Use NativeSelect and owned control primitives. Preserve the lazy
boundary in `App.tsx`, TanStack Query keys, cursor validation, and anonymous
data isolation.

- [x] **Step 4: Supervisor removes accepted Discover legacy rules**

Remove the unused Discover selector blocks from `src/legacy.css`; do not edit
other domain source.

- [x] **Step 5: Verify Task 6**

```sh
npm test -- src/DiscoverView.test.tsx
npm run build
git diff --check
```

---

### Task 7: Migrate Radio, shared chapter metadata, and Now Playing

**Files:**
- Modify: `src/RadioView.tsx`
- Modify: `src/RadioView.test.tsx`
- Modify: `src/RadioChapterMetadata.tsx`
- Modify: `src/RadioChapterMetadata.test.tsx`
- Modify: `src/NowPlayingView.tsx`
- Modify: `src/NowPlayingView.test.tsx`
- Read-only: `src/viewTransitions.ts`
- Supervisor-only modify: `src/legacy.css`

**Interfaces:**
- Consumes: owned primitives and existing Radio domain types
- Produces: unchanged `RadioChapterCopy` public props and direct-utility
  Radio/Now Playing surfaces

- [x] **Step 1: Preserve Radio and transition characterization**

Ensure tests cover archive selection, chapter metadata links, chapter seek,
Now Playing playback/queue controls, slider bounds, continuation actions,
focus restoration, and reduced-motion behavior.

- [x] **Step 2: Run focused characterization**

```sh
npm test -- \
  src/RadioView.test.tsx \
  src/RadioChapterMetadata.test.tsx \
  src/NowPlayingView.test.tsx \
  src/viewTransitions.test.ts
```

- [x] **Step 3: Port Radio and chapter metadata**

Use direct utilities and owned primitives without changing anonymous feed
validation, series navigation, queue representation, chapter links, scrobble
eligibility, or `RadioChapterCopy`'s public interface.

- [x] **Step 4: Port Now Playing**

Use Button, Tooltip, Slider, Badge, and direct utilities. Preserve exact
artwork sizing, palette variables, seek behavior, queue toggle semantics,
View Transition names, reverse focus restoration, and reduced-motion bypass.
Keep browser View Transition pseudo-elements in CSS rather than JSX.

- [x] **Step 5: Supervisor moves CSS-native rules and removes legacy rules**

Move only required Radio/Now Playing keyframes, pseudo-elements, and
reduced-motion rules into the focused native/global CSS section. Remove
superseded semantic selectors from `src/legacy.css`.

- [x] **Step 6: Verify Task 7**

```sh
npm test -- \
  src/RadioView.test.tsx \
  src/RadioChapterMetadata.test.tsx \
  src/NowPlayingView.test.tsx \
  src/viewTransitions.test.ts
npm run build
git diff --check
```

---

### Task 8: Migrate the mini-player

**Files:**
- Modify: `src/MiniPlayerWindow.tsx`
- Modify: `src/MiniPlayerWindow.test.tsx`
- Read-only unless a failing behavior proves otherwise: `src/MiniPlayerBridge.tsx`
- Supervisor-only modify: `src/legacy.css`

**Interfaces:**
- Consumes: Button, Tooltip, Slider, Coda tokens
- Produces: exact 368 x 240 direct-utility mini-player

- [x] **Step 1: Add missing control characterization**

Test seek and volume keyboard changes, continuous value updates, bounds,
disabled/empty state, accessible names, playback controls, and bridge actions.

- [x] **Step 2: Run focused tests**

```sh
npm test -- \
  src/MiniPlayerWindow.test.tsx \
  src/MiniPlayerBridge.test.tsx
```

- [x] **Step 3: Port the mini-player**

Use owned Button, Tooltip, and Slider components plus direct utilities.
Preserve native bridge behavior, palette variables, always-on-top window
geometry, empty state, and current playback semantics.

- [x] **Step 4: Supervisor removes mini-player legacy rules**

Remove only accepted mini-player selectors from `src/legacy.css`.

- [x] **Step 5: Verify Task 8**

```sh
npm test -- \
  src/MiniPlayerWindow.test.tsx \
  src/MiniPlayerBridge.test.tsx
npm run build
git diff --check
```

Perform a native 368 x 240 screenshot comparison.

---

### Task 9: Migrate updater surfaces

**Files:**
- Modify: `src/AppUpdater.tsx`
- Modify: `src/AppUpdater.test.tsx`
- Supervisor-only modify: `src/legacy.css`

**Interfaces:**
- Consumes: Dialog, Button, Alert, Spinner, progress styling
- Produces: pixel-matched updater prompt and settings controls with unchanged
  updater/network behavior

- [x] **Step 1: Add focus and busy-state characterization**

Test initial focus, Escape/outside dismissal while idle, focus restoration,
rejected dismissal while downloading/installing/restarting, progress, Later,
Update now, and restart behavior.

- [x] **Step 2: Run the focused tests**

```sh
npm test -- src/AppUpdater.test.tsx
```

- [x] **Step 3: Port updater UI**

Use controlled Dialog and owned primitives. Keep automatic checks silent on
failure, manual failures actionable, and installation behind explicit user
action. Do not change native updater imports or permissions.

- [x] **Step 4: Supervisor removes updater legacy rules**

Remove accepted updater selectors from `src/legacy.css`.

- [x] **Step 5: Verify Task 9**

```sh
npm test -- src/AppUpdater.test.tsx
npm run build
git diff --check
```

---

### Task 10: Migrate Saved Library and playlist dialogs

**Files:**
- Modify: `src/SavedLibraryView.tsx`
- Modify: `src/SavedLibraryView.test.tsx`
- Modify: `src/VirtualizedSavedTrackList.tsx`
- Modify: `src/VirtualizedSavedTrackList.test.tsx`
- Supervisor-only modify: `src/legacy.css`

**Interfaces:**
- Consumes: Task 5 `data-coda-library-scroll`, Dialog, AlertDialog, Button,
  Input, Label, Badge, Skeleton, Alert
- Produces: direct-utility Favorites/playlists with unchanged optimistic
  mutations and bounded 25,000-row virtualization

- [x] **Step 1: Replace the styling-class scroll lookup contract**

Change the virtualizer lookup from the styling class to the stable ancestor
attribute:

```ts
root.closest<HTMLElement>("[data-coda-library-scroll]")
```

The list root is nested inside the scroll owner, so a descendant
`querySelector()` would be incorrect. Preserve the existing parent fallback
and update focused tests to use the same stable data attribute.

- [x] **Step 2: Strengthen dialog and deletion tests**

Add tests proving Add-to-playlist initial focus, Escape/backdrop close when
idle, focus restoration, pending close rejection, playlist delete cancel,
explicit confirmation, exactly-once mutation, rollback, and focus restoration.

- [x] **Step 3: Run characterization**

```sh
npm test -- \
  src/SavedLibraryView.test.tsx \
  src/VirtualizedSavedTrackList.test.tsx
```

- [x] **Step 4: Port Saved Library**

Use direct utilities and owned primitives. Use controlled Dialog for
Add-to-playlist and AlertDialog for deletion. Preserve local Favorites,
Bandcamp playlist synchronization, optimistic updates, error rollback, Radio
favorites, lazy loading, and bounded rendering.

- [x] **Step 5: Supervisor removes Saved Library legacy rules**

Remove accepted Saved selectors from `src/legacy.css`.

- [x] **Step 6: Verify Task 10**

```sh
npm test -- \
  src/SavedLibraryView.test.tsx \
  src/VirtualizedSavedTrackList.test.tsx
npm run build
git diff --check
```

Expected: the 25,000-track virtualized test still proves bounded DOM output.

---

### Task 11: Remove the bridge and perform final integration

**Files:**
- Modify: `src/styles.css`
- Delete with `trash` after verification: `src/legacy.css`
- Modify only for returned domain defects: files owned by Tasks 5-10
- Modify: `package.json` and `package-lock.json` only to remove proven unused dependencies

**Interfaces:**
- Consumes: every accepted domain migration
- Produces: final Tailwind/shadcn renderer with no parallel legacy styling

- [ ] **Step 1: Audit remaining legacy emissions**

Search every remaining semantic class and map it to either:

- an approved CSS-native behavior;
- a Tailwind utility migration defect returned to its domain owner;
- an unused legacy selector safe to delete.

Commands:

```sh
rg -n 'legacy\\.css|@apply|className=' src
rg -n 'primary-button|secondary-button|icon-button|dialog-backdrop|queue-panel|now-playing__|saved-|discover-|radio-' src --glob '*.tsx'
```

Expected: no application styling survives merely because it has a familiar
semantic class name.

- [ ] **Step 2: Preserve only approved CSS-native behavior**

Keep focused CSS for:

- View Transition pseudo-elements and directional keyframes;
- reduced-motion overrides;
- required scrollbar or media pseudo-elements;
- browser/platform rules that cannot be expressed cleanly as component
  utilities.

Move these rules into a clearly labeled section or focused imported stylesheet.
Do not preserve ordinary layout, spacing, color, or component-state selectors.

- [ ] **Step 3: Remove the compatibility bridge**

After all domain source no longer depends on it:

```sh
trash src/legacy.css
```

Remove its import from `src/styles.css`. Build immediately.

- [ ] **Step 4: Audit generated dependencies and imports**

```sh
npm ls --depth=0
npm audit --omit=dev
rg -n '@radix-ui|react-aria|from "@/components/ui/index"|from "./components/ui/index"' src package.json
```

Expected: Base UI is the only shadcn foundation, no UI barrel exists, and no
unused generated component or dependency remains.

- [ ] **Step 5: Run complete automated verification**

```sh
npm test
npm run test:coverage
npm run build
git diff --check
```

Expected: all commands pass. Coverage remains at least 40% statements, 40%
branches, 35% functions, and 45% lines.

The automated gate must include rendered interaction coverage, not only static
class/build checks, for every Slider consumer (compact player, Now Playing,
and mini-player); Dialog/AlertDialog Escape, outside dismissal, focus
restoration, and busy-state rejection; queue open/close/remove; playback
buttons and toggles; native selects; playlist dialogs and mutations; and the
updater dialog.

- [ ] **Step 6: Measure the final bundle**

Run the exact Node measurement from Task 1. Compare entry, each lazy chunk,
total JavaScript, and CSS raw/gzip sizes. Explain deltas by generated component
and confirm Discover, Radio, and Saved Library remain lazy chunks.

- [ ] **Step 7: Run native pixel and behavior verification**

Repeat every Task 1 capture with the same host, content, playback state, window
geometry, and reduced-motion setting. Correct differences rather than
approximating them.

Exercise:

- connection failure/retry and busy close rejection;
- library loading, search, filters, sorting, and navigation;
- playback, seek, volume, queue Show/Hide, reorder, remove, clear, and shuffle;
- Now Playing forward/back transitions and reduced motion;
- Favorites, playlist create/rename/delete/add;
- Discover and Radio;
- artwork retry;
- updater idle/busy dialogs without publishing;
- mini-player 368 x 240;
- tray restore and native main-window behavior.

Repeat the same interaction matrix in the native WebView wherever the host can
reach the state safely. Record credential-, signed-update-, and
platform-dependent cases honestly instead of substituting static CSS or DOM
inspection for the native behavior.

- [ ] **Step 8: Cross-platform handoff**

Report the exact automated commands and native macOS paths exercised. State
that Windows/Linux runtime visuals and focus behavior require their native
hosts even when cross-platform CI passes. Call out Tailwind 4's WebView floor
and confirm no native deployment target or capability changed.

- [ ] **Step 9: Final supervisor review**

Review every subagent diff and claim. Confirm file ownership was respected,
the old Tailwind branch was not merged, current dirty work was untouched, no
generated output is tracked, and no staging/commit/push/PR mutation occurred.

---

### Task 12: Start the native main window maximized on first launch

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/lib.rs` tests; change runtime setup only if the
  ordering audit proves configuration alone cannot satisfy the contract

**Interfaces:**
- Consumes: existing `tauri-plugin-window-state` restore flow
- Produces: a maximized first-launch main window while persisted state remains
  authoritative on subsequent launches

- [x] **Step 1: Audit native startup ordering**

Confirm the window-state plugin owns `POSITION`, `SIZE`, `MAXIMIZED`, and
`VISIBLE` restoration and that neither `ensure_window_is_visible` nor
`show_main_window` unmaximizes a restored window. Audit the installed plugin's
saved-false behavior and dynamic registration lifecycle. Keep the mini-player
denylist unchanged and do not depend on restore completing before best-effort
off-monitor recovery.

- [x] **Step 2: Write the focused config regression first**

Extend the existing main-window configuration test and add focused helper
tests to require:

- config `maximized` is absent or false, so a saved normal state can remain
  authoritative;
- no OS fullscreen or simple-fullscreen default;
- no absolute `center: true` first-launch default;
- native decorations, visible title bar, resizing, minimizing, and maximizing
  remain enabled;
- an absent `.window-state.json` means first launch and triggers maximize;
- an existing file or metadata error never overrides persisted state.

Run the focused Rust test and observe the expected failure before changing
configuration.

- [x] **Step 3: Apply the bounded first-launch configuration**

Remove or disable the absolute centering default and keep config unmaximized.
Register the unchanged window-state plugin statically on the Tauri Builder
before configured windows and user setup, so its ready hook restores and
tracks the main window. In user setup, resolve its public default filename in
`app_config_dir`; maximize main only when metadata reports NotFound, after the
normal ready-hook restore and before off-monitor recovery. Treat an existing
file or any other metadata error as persisted/unknown state and do not
override it. Saved true is maximized by the plugin and saved false stays
normal. Do not add manual restore or `skip_initial_state`; do not set
fullscreen or change the mini-player, capabilities, CSP, permissions, or
security surface.

- [x] **Step 4: Verify Rust and native behavior**

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Smoke the native app on the host without deleting or overwriting a user's real
window-state file. Record that a clean first-launch state and restored
subsequent-launch state require an isolated app-data profile or manual native
verification if the host cannot supply one safely.

- [x] **Step 5: Cross-platform handoff**

Report the exact macOS behavior exercised and leave Windows/Linux runtime
window-manager validation to their native hosts and CI. State explicitly that
this task adds no capability or security permission.
