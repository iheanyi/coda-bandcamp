# Coda Motion and View Transition Migration Plan

**Status:** Proposed

**Design source:** `docs/superpowers/specs/2026-07-29-motion-react-migration-design.md`

**Goal:** Adopt Motion for React for component presence and interruptible local
feedback while making Coda's existing platform View Transitions more reliable,
directional, and polished. Preserve playback continuity, immediate loading
feedback, exact Back behavior, the anchored sidebar/player, and every existing
accessibility and security contract.

**Architecture:** Coda will use a strict hybrid ownership model. Platform View
Transitions, coordinated only by `transitionCodaView`, continue to own major
destinations, detail drill-ins, and shared artwork. Motion owns local component
presence and interruptible feedback. CSS keeps continuous effects, simple
hover/focus transitions, Base UI gesture mechanics, and View Transition
pseudo-elements.

**Tech stack:** React 19.2, TypeScript, Motion for React, Base UI, Tailwind CSS
4, TanStack Query, TanStack Virtual, Vitest, Testing Library, and Tauri 2.

## Why this sequence

The current foundation is stronger than a typical migration starting point:

- `transitionCodaView` already cancels superseded snapshots, ignores stale
  callbacks, commits React state with `flushSync`, and bypasses reduced motion.
- Page snapshots animate only transform and opacity on `.library-pane`, keeping
  the sidebar and bottom player outside the named snapshot.
- Forward and Back already use opposite directions.
- Now Playing already restores the exact underlying view, scroll position, and
  compact-player focus.
- Cold albums, playlists, and Radio details already favor a live loading state
  over freezing the source page in a snapshot.
- Most authored CSS motion is compositor-only.

The migration therefore starts with correctness and ownership, not a mechanical
conversion of every `transition-*` class or `@keyframes` rule.

The initial static audit found 132 animation-related pattern hits across 26
production files and 28 CSS keyframes. Most Coda-owned motion is already
S-tier. The meaningful sub-S work is concentrated in Toast, Drawer, Base UI
presence, equalizers, updater progress, and the intentional TanStack
virtualizer/queue-drag paths. No F-tier animation loop or root-level animated
custom-property inheritance bomb was found.

## Audit findings that change the order

### P0: fallback suppression tracks capability, not successful capture

`coda-view-transitions-supported` is set before snapshot creation has proven
successful, while the compositor fallback is disabled whenever that class is
present. A later `ready` rejection or transient WebView failure can therefore
produce neither a native transition nor the fallback.

The coordinator must track active/ready/failed lifecycle explicitly.

### P1: some major transitions are intentionally bypassed

Top-level destination changes, all album opens, and Radio series/show opens
currently use `skipSnapshot`. This preserves responsiveness but means several
important view changes do not animate.

The migration will make eligibility explicit:

- synchronous, ready destinations use a View Transition;
- cold or uncertain destinations commit their live shell immediately;
- local Motion presence may introduce loaded content after that immediate
  commit;
- no route waits on network work merely to earn an animation.

### P1: mount animations can compete with snapshots

Saved Library, Radio, album detail, and Discover detail can mount with their own
CSS entrance while also being captured as the new View Transition snapshot.
Every navigation must have one owner: native snapshot, Motion presence, or
immediate state. It must never double-compose a snapshot and a separate page
entrance.

### P1: detail focus/return behavior is inconsistent

Now Playing and Discover detail have strong focus and return-scroll behavior.
Album, Artist, Playlist, and Radio detail do not consistently capture their
trigger, focus a destination heading, and restore the exact trigger on Back.
Animation work must not widen that gap.

### P2: Now Playing uses the same choreography in both directions

The artwork geometry reverses naturally, but both open and close use the same
`now-playing` transition kind. Header and detail staging therefore communicate
the same direction on forward and Back.

Now Playing needs explicit open and close intent.

### P2: two known layout-cost animations are decorative

The compact equalizer and Radio equalizer animate `height`. Those are D-tier
layout animations even though the same effect can be expressed as S-tier
`transform: scaleY(...)` with a bottom transform origin.

These should be corrected early without waiting for Motion.

## Ownership matrix

| Surface | Owner after migration | Notes |
| --- | --- | --- |
| Primary Library, Recent, Favorites, Playlists, Discover, and Radio destinations | `transitionCodaView` + platform View Transitions | Restrained crossfade of the named content snapshot; sidebar/player remain anchored |
| Album, Artist, Playlist, Radio, and Discover detail drill-ins | `transitionCodaView` + platform View Transitions | Directional snapshot transform/opacity when ready; cold states remain immediate |
| Compact player artwork to/from Now Playing | Platform shared-element View Transition | Separate open/close intent and exactly one artwork owner per snapshot |
| Collection artwork to cached album detail | Platform shared-element View Transition | Warm path only; forward first, reverse only after virtualization-safe proof |
| Page-local loading to content | Motion `AnimatePresence` or a Motion component | Must not obscure a live loading status |
| Play/pause and similarly interruptible icon replacement | Motion | Semantic state changes immediately |
| Dialog content where a real exit is visibly useful | Motion through Base UI `render` | Pilot one primitive; Base UI retains semantics and focus management |
| Toast presence, stacking, and swipe | Base UI + Motion | Adapt the verified official Base UI Toast pattern; preserve Coda geometry, announcements, priority, timeout, and dismissal |
| Queue drawer swipe/open/close | Base UI Drawer + CSS | Retain the proven non-reflowing gesture contract; profile before changing |
| Spinner, skeleton shimmer, equalizer, marquee, status pulse | CSS | Equalizers switch from height to transform; repeating effects respect reduced motion |
| Color, border, and focus feedback | CSS | Paint cost is acceptable on small controls unless runtime profiling proves otherwise |

## Global constraints

- Never install or import `framer-motion`; import React APIs from `motion/react`
  and lazy components from `motion/react-m`.
- Do not add `motion-plus` as an application runtime dependency in the baseline
  migration. `AnimateView` is early access and requires separate Motion+
  installation. Evaluate it only in an isolated, non-shipping spike.
- Continue routing major destinations and detail drill-ins through
  `transitionCodaView`.
- Keep search, filtering, sorting, browse tabs, playback commands, queue
  mutations, volume, and seeking immediate.
- Authored page-transition keyframes may animate only snapshot transform and
  opacity. Platform shared-element geometry still incurs one-time measurement
  and size/position interpolation, so each shared transition is an explicitly
  bounded mixed-tier exception with its own runtime gate.
- Do not animate full virtualized collections or retain an exiting 25,000-track
  queue solely for decoration.
- Do not introduce `layout` or `layoutId` broadly. They add measurement work,
  require `domMax`, and are unnecessary for platform-owned shared artwork.
- Preserve Discover and Radio lazy loading.
- Do not delay navigation for a fetch. Cold destinations show a live shell and
  accessible loading status immediately.
- Keep the sidebar, bottom player, queue, and native window chrome outside the
  named page-content snapshot.
- Preserve exact Now Playing and Discover focus/scroll restoration. Extend the
  same observable contract to other details before polishing them.
- Respect `prefers-reduced-motion` at both the Motion provider and CSS/platform
  boundary. Reduced motion removes spatial travel and repeating decoration;
  short opacity feedback may remain.
- Do not add Tauri commands, capabilities, CSP sources, remote assets, or new
  credential/cache behavior.
- Do not edit or remove the two pre-existing untracked shadcn migration
  documents in the main worktree.
- Never use `rm -rf`; move obsolete files with `trash` only after verification.

## Delivery strategy

Use one isolated branch/worktree from current `origin/main`. Keep the commits
below small and working. Do not parallelize edits to `src/App.tsx`,
`src/styles.css`, `src/viewTransitions.ts`, `package.json`, or
`package-lock.json`.

Recommended review shape:

1. View Transition correctness and Motion foundation.
2. Focus/return unification and View Transition polish.
3. Component presence, Base UI primitives, and Toast.
4. Performance cleanup, native QA, and final CSS removal.
5. Optional warm album shared artwork after the baseline ships.

The smaller commit sequence below remains the implementation source of truth.

---

## Task 0: Restore and record the baseline

**Files:**

- Read: `package.json`, `package-lock.json`, `vite.config.ts`
- Read: current frontend tests and build output
- Modify: none
- Create outside the repository: screenshots and MotionScore reports

**Purpose:** Establish a trustworthy baseline before adding a runtime
dependency. The current checkout's `node_modules` is stale and cannot load
`@tailwindcss/vite`, despite the package being present in the lockfile.

- [ ] Record `git status --short`, current branch, current SHA, and worktrees.
- [ ] Create an isolated `codex/motion-migration` worktree from freshly fetched
  `origin/main`.
- [ ] Ensure this approved plan is present in the implementation worktree before
  source changes begin. If it has not yet been committed to the source branch,
  add it in a docs-only first commit or use this absolute main-worktree file as
  the read-only source until that commit lands.
- [ ] Run `npm ci`; do not repair the stale main-worktree installation with
  ad-hoc package changes.
- [ ] Run focused transition tests, then the full frontend suite:

  ```sh
  npx vitest run src/viewTransitions.test.ts src/NowPlayingView.test.tsx \
    --exclude '.worktrees/**'
  npm test
  npm run build
  ```

- [ ] Record production JavaScript and CSS raw/gzip asset sizes.
- [ ] Run the MotionScore static audit across renderer animation surfaces.
- [ ] If the native dev renderer exposes a stable local URL, run
  `npx motionscore <url> --agent`; keep the static report if the native runtime
  cannot be audited honestly.
- [ ] Capture native macOS baselines at 1360×860, approximately 900px, and the
  760px minimum. Include Collection, warm/cold album, Now Playing open/close,
  queue-open Now Playing, dialogs, Discover, Radio, and reduced motion.

**Commit:** none.

**Exit gate:** Tests and build either pass or every baseline failure is recorded
before migration work begins.

---

## Task 1: Fix native View Transition lifecycle correctness

**Files:**

- Modify: `src/viewTransitions.ts`
- Modify: `src/viewTransitions.test.ts`
- Modify: `src/styles.css`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Purpose:** Make the current native path safe before Motion expands the number
of animated surfaces.

- [ ] Extend Coda's local View Transition type with `ready` and
  `updateCallbackDone` where supported.
- [ ] Separate permanent feature detection from transient transition activity.
  Fallback suppression must depend on a successful active snapshot, not merely
  the existence of `document.startViewTransition`.
- [ ] When `ready` rejects, ensure application state still commits, transition
  classes are cleaned up, and the next navigation may use the compositor
  fallback.
- [ ] Keep current latest-wins cancellation and stale callback protection.
- [ ] Add a scoped cleanup registration mechanism so shared-element attributes
  and classes are removed for success, rejection, cancellation, and synchronous
  failure.
- [ ] Preserve and document the current player-mode invariant: the compact
  artwork is not rendered in `now-playing-queue` mode, so each old/new snapshot
  has exactly one `coda-now-playing-artwork` owner. Add gating only if the
  regression proves a duplicate.
- [ ] Add observable regressions for:
  - asynchronous `ready` rejection;
  - `updateCallbackDone` rejection;
  - queue-open Now Playing Back;
  - rapid open → close → open;
  - class and shared-name cleanup after cancellation;
  - reduced-motion bypass.

**Commit:** `Harden native view transition lifecycle`

**Exit gate:** Existing focus/scroll tests remain green; a rejected native
snapshot cannot suppress future fallbacks.

---

## Task 2: Add the Motion runtime with no visual change

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.tsx`
- Create: `src/motion.ts`
- Create: `src/motion.test.ts`

**Purpose:** Establish one reduced-motion policy and a small typed vocabulary
before migrating components.

- [ ] Install `motion`; verify neither `framer-motion` nor `motion-plus` is
  installed.
- [ ] Add one `MotionConfig reducedMotion="user"` and one strict `LazyMotion`
  provider with `domAnimation` around both the main and mini-player renderer
  trees.
- [ ] Use `m` from `motion/react-m` beneath `LazyMotion`.
- [ ] Add typed semantic presets only for:
  - `feedback`;
  - `componentEnter`;
  - `componentExit`;
  - `panel`;
  - `page`;
  - `sharedArtwork`.
- [ ] Author transform keyframes as literal `transform` strings where a single
  WAAPI transform is sufficient. Do not default to `x`, `y`, or `scale`
  shorthands.
- [ ] Keep springs low-bounce and only for physical, interruptible movement.
  Opacity and nonphysical state changes use duration/easing transitions.
- [ ] Add a pure reduced-motion variant helper so tests can assert the intended
  transform-free alternative without inspecting Motion's generated styles.
- [ ] Run the build and report the initial-chunk and total JavaScript delta from
  Task 0.
- [ ] Stop before Task 3 if the foundation adds more than 25 KiB gzip to the
  initial JavaScript or 35 KiB gzip to total JavaScript. Continue only after
  removing accidental full-component imports, proving a lazy split, or
  explicitly approving a revised measured budget.

**Commit:** `Add the Coda Motion foundation`

**Exit gate:** No intentional visual change, no full `motion` component import,
and the production bundle delta is recorded.

---

## Task 3: Prove the Motion pattern with one vertical slice

**Files:**

- Modify: `src/components/ui/playback-icon.tsx`
- Create or modify: nearest playback-icon tests
- Modify only if needed: call-site tests in `src/App.test.tsx` and
  `src/NowPlayingView.test.tsx`

**Purpose:** Prove presence, interruption, reduced motion, and test strategy on
a tiny surface before migrating views.

- [ ] Replace the overlapping CSS play/pause icon crossfade with one stable
  semantic icon slot and keyed Motion presence.
- [ ] Keep the owning button's `aria-label`, `aria-pressed`, disabled state, and
  click behavior authoritative. Animation completion never changes playback.
- [ ] Use opacity plus a restrained transform; repeated Play/Pause input must
  settle on current React state without queued stale exits.
- [ ] Disable spatial travel under reduced motion while preserving immediate
  state recognition.
- [ ] Test observable icon state and rapid toggling. Do not assert generated
  inline styles.
- [ ] Remove only the superseded playback-icon transition classes.

**Commit:** `Migrate playback feedback to Motion`

**Exit gate:** The vertical slice passes in Strict Mode, repeated input has no
stale icon, and bundle output remains within the recorded expectation.

---

## Task 4: Remove decorative layout animation costs

**Files:**

- Modify: `src/styles.css`
- Modify: `src/App.tsx`
- Modify: `src/NowPlayingView.tsx`
- Modify: nearest observable tests

**Purpose:** Take the obvious MotionScore wins without adding JavaScript.

- [ ] Convert `bar` and `radio-equalizer` from animated `height` to
  `transform: scaleY(...)` with `transform-origin: bottom`.
- [ ] Preserve the three-bar phase offsets and current visual amplitude.
- [ ] Keep reduced-motion rules that stop repeating animation while leaving a
  static playback indicator.
- [ ] Audit the updater progress indicator. If Base UI animates width, switch
  the visual fill to an origin-left scale transform while preserving the
  progressbar's numeric semantics.
- [ ] Do not replace small color/border transitions merely to improve a static
  score; profile them first.

**Commit:** `Move decorative motion to compositor transforms`

**Exit gate:** The equalizers are S-tier in the static audit and playback status
remains understandable without motion.

---

## Task 5: Unify detail focus and return transactions

**Files:**

- Create: focused navigation transaction module and tests
- Modify: `src/App.tsx`
- Modify: `src/SavedLibraryView.tsx`
- Modify: `src/RadioView.tsx`
- Modify: `src/DiscoverReleaseDetail.tsx`
- Modify: nearest tests

**Purpose:** Establish the keyboard/history contract before enabling additional
page movement.

- [ ] Define a bounded navigation transaction carrying:
  - route/detail key;
  - forward/back/crossfade intent;
  - source trigger;
  - return scroll position;
  - destination heading target;
  - optional shared-element owner.
- [ ] Keep React state as the navigation source of truth. The transaction may
  coordinate visuals/focus but must not become a second router.
- [ ] Focus a meaningful destination heading after forward Album, Artist,
  Playlist, Radio, and Discover drill-ins.
- [ ] Restore the exact still-connected trigger on Back; define a deterministic
  fallback when virtualization has unmounted it.
- [ ] Preserve Now Playing's compact artwork behavior and Discover's nested
  return-to-Now-Playing behavior.
- [ ] Never retain credentials, signed URLs, large result collections, or stale
  server objects in the transaction.
- [ ] Test keyboard entry, Back, source unmount, nested detail returns, rapid
  replacement, and scroll restoration.

**Commit:** `Unify detail focus and return behavior`

**Exit gate:** Every detail route has an observable destination-focus and Back
restoration contract before its animation policy changes.

---

## Task 6: Give each page navigation exactly one animation owner

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/DiscoverReleaseDetail.tsx`
- Modify: `src/SavedLibraryView.tsx`
- Modify: `src/RadioView.tsx`
- Modify: `src/styles.css`
- Modify: nearest tests

**Purpose:** Stop page mount CSS from being captured inside a second snapshot
animation while preserving immediate cold/loading routes.

Use this route matrix as the baseline policy:

| Route | Ready policy | Owner |
| --- | --- | --- |
| Library ↔ Recent | Always synchronous | Platform snapshot crossfade |
| Favorites or Playlists top level | First lazy/query load is cold; mounted usable view is warm | Cold immediate shell; warm platform snapshot crossfade |
| Discover top level | First lazy/query load is cold; mounted usable view is warm | Cold immediate shell; warm platform snapshot crossfade |
| Radio top level or series change | Query-dependent | Immediate live shell; local content presence after data |
| Album detail | Cached usable tracks are warm; missing tracks are cold | Warm directional page snapshot; cold immediate shell |
| Artist detail | Synchronous local library grouping | Directional page snapshot |
| Playlist detail | Cached detail is warm; missing detail is cold | Warm directional page snapshot; cold immediate shell |
| Discover release detail | Release metadata is already local once Discover is active | Directional page snapshot |
| Radio show detail | The current flow loads/validates details first | Directional page snapshot after data is ready |

- [ ] Continue calling `transitionCodaView` for every major destination and
  detail drill-in, including an explicit immediate/loading-shell policy.
- [ ] The `.library-pane` remains the only page snapshot; sidebar/player remain
  anchored.
- [ ] Remove `album-page-in`, `saved-page-in`, and `radio-view-in` only from
  routes whose snapshot or local Motion owner is now verified.
- [ ] Keep search, filters, sorting, browse-mode tabs, queue mutations, and
  playback immediate.
- [ ] Test every matrix row: warm routes call the native transition; cold routes
  commit immediately and expose their live loading contract.
- [ ] Test rapid destination changes settle on the last selected view and leave
  no inert/pointer-blocking snapshot.
- [ ] Smoke each row in the native app before its commit. Do not wait until the
  final migration gate to discover WebView snapshot latency or a frozen loader.

**Commits:**

- `Enable synchronous destination transitions`
- `Preserve immediate cold detail navigation`
- `Remove duplicate page entrance animations`

**Exit gate:** No page transition combines a native snapshot with an
independent page entrance, and every row passes its local native smoke gate.

---

## Task 7: Polish Now Playing open and close

**Files:**

- Modify: `src/viewTransitions.ts`
- Modify: `src/styles.css`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify only if required: `src/NowPlayingView.tsx`

**Purpose:** Make the flagship transition communicate direction and keep its
shared artwork path reliable.

- [ ] Replace the single `now-playing` kind with explicit open and close intent.
- [ ] Preserve one shared artwork group, but reverse header/details
  choreography on Back rather than replaying the forward entrance.
- [ ] Keep the shared artwork as the hero. Supporting content uses restrained
  opacity and at most 4–8px of snapshot translation.
- [ ] Remove hard-coded timing drift by mapping View Transition CSS to the same
  semantic duration/easing vocabulary used by Motion.
- [ ] Tune the artwork and page curves in the native app. Target a complete
  sequence around 400–450ms; the current artwork group is 520ms and must earn
  any longer duration through visual QA.
- [ ] Ensure the root shell, sidebar, and any player surface that should remain
  visible do not fade or slide with `.library-pane`.
- [ ] Preserve immediate heading focus on open and compact-artwork focus plus
  exact scroll restoration on close. Do not wait for decorative animation
  completion to focus.
- [ ] Test open, close, queue-open close, rapid reversal, underlying Discover
  detail return, reduced motion, and unsupported/rejected View Transition
  fallback.

**Commit:** `Polish directional Now Playing transitions`

**Exit gate:** Forward and Back feel spatially opposite, every snapshot has a
unique artwork owner, and focus/scroll behavior is unchanged.

---

## Task 8: Deferred warm Collection-to-album artwork enhancement

**Files:**

- Modify: `src/App.tsx`
- Modify: album-card and album-detail artwork boundaries in `src/App.tsx` or
  focused extracted components
- Modify: `src/styles.css`
- Modify: `src/App.test.tsx`

**Purpose:** After the baseline lifecycle, focus, route-ownership, and Now
Playing work has shipped cleanly, add the highest-value new shared-element
transition without hiding network work or breaking virtualization.

This task is a separate enhancement PR and is not a blocker for the baseline
Motion migration. Do not execute it until Tasks 0–7 and 9–13 have shipped and
their native/runtime evidence is stable.

- [ ] Pass the clicked artwork/trigger identity into `openAlbum`.
- [ ] Treat an album as warm only when TanStack Query already contains usable
  track data and the destination artwork can render synchronously.
- [ ] Arm exactly one source artwork immediately before the old snapshot and
  exactly one destination artwork inside the state update.
- [ ] Require the source artwork to be connected, painted, and measurable:
  nonzero bounds, a loaded image (`complete` and nonzero `naturalWidth`), and no
  `content-visibility` skip. Warm query data alone is not sufficient.
- [ ] Use a scoped, fixed transition name only while the album-detail
  transaction is active. Cleanup runs after finish, rejection, cancellation,
  and fallback.
- [ ] Reuse the existing bounded artwork Promise cache. Do not add another
  cache, retain a signed URL in navigation state, or persist one.
- [ ] Warm path: use `transitionCodaView` with forward snapshot motion and a
  shared artwork group.
- [ ] Cold path: commit the album shell immediately, preserve known artwork and
  metadata, expose the live `Loading album tracks` status, and use only local
  content presence when tracks arrive.
- [ ] Back path: keep the current directional page snapshot initially. Do not
  attempt a reverse artwork morph until scroll restoration demonstrably mounts
  the virtualized source card before capture.
- [ ] Test warm, cold, rapid two-album selection, source unmount, rejection
  cleanup, unique naming, and reduced motion.
- [ ] Run a native performance trace for the warm path. Treat the browser's
  shared-element measurement/size interpolation as a bounded mixed B–D
  exception, and abort the enhancement if one hero snapshot produces visible
  frame drops, excessive bitmap memory, or pointer-blocking latency.

**Commit:** `Add warm album shared artwork transitions`

**Exit gate:** Cached albums morph; cold albums remain immediately responsive;
virtualization and signed-artwork bounds are unchanged.

---

## Task 9: Migrate local presence surfaces

**Files:**

- Modify: focused page components and their nearest tests
- Modify: `src/motion.ts`
- Modify: `src/styles.css` only to remove verified obsolete keyframes

**Purpose:** Use Motion where it is stronger than CSS: mount/unmount,
replacement, and rapid interruption.

Migrate one surface per commit in this order:

1. loading status → loaded local content;
2. empty state ↔ populated state;
3. queue current-item/recommendation replacement;
4. bounded visible queue-row insertion/removal, only if virtualization tests
   prove it does not retain or animate the whole queue;
5. Now Playing local recommendation and transient status content after the
   platform page transition is settled.

For each surface:

- [ ] Use stable semantic keys.
- [ ] Use opacity and a literal compositor transform.
- [ ] Keep exits shorter than entrances.
- [ ] Ensure exiting content cannot retain focus or intercept pointer input.
- [ ] Do not set application state from `onAnimationComplete`.
- [ ] Keep loading status and `aria-busy` truthful throughout.
- [ ] Disable spatial travel under reduced motion.
- [ ] Test rapid replacement and observable accessibility behavior.
- [ ] Remove only the replaced CSS animation after native visual verification.

**Commits:**

- `Animate local loading and empty-state presence`
- `Animate bounded queue content replacement`
- `Polish local Now Playing presence`

**Exit gate:** No stale exits, duplicate accessible content, playback-clock
rerenders, or virtualized-list growth.

---

## Task 10: Migrate bounded Base UI popup presence

**Files:**

- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/components/ui/alert-dialog.tsx`
- Modify: `src/components/ui/tooltip.tsx`
- Modify: `src/components/ui/select.tsx`
- Modify: their tests and affected observable App tests
- Read/profile only: Drawer primitive

**Purpose:** Prove the Base UI `render` integration with Dialog, then expand
only where native QA demonstrates visible value without replacing accessibility
or gesture behavior.

- [ ] Hoist open state only where the owning application already controls it or
  where the wrapper can expose a compatible controlled contract.
- [ ] Pass Motion elements through Base UI's `render` prop; do not use a
  function/spread-props workaround.
- [ ] For self-managing portals, use `keepMounted` only while
  `AnimatePresence` completes a compositor-property exit.
- [ ] Ensure at least opacity or transform is part of the exit so Base UI can
  detect the running animation through `getAnimations()`.
- [ ] Keep Base UI authoritative for focus trapping, Escape behavior, pointer
  dismissal, announcements, and final focus.
- [ ] Migrate Dialog as the baseline deliverable.
- [ ] After native Dialog QA, record whether Alert Dialog has a perceptible
  missing/rough exit. Migrate it only if the answer is yes and its focus/
  dismissal contract remains unchanged.
- [ ] Evaluate Tooltip with the verified Base UI Tooltip pattern. Migrate it
  only if the controlled-state conversion adds visible value. Tune Coda to a
  restrained, low-bounce entrance rather than copying the example's
  intentionally bouncy demo curve.
- [ ] Evaluate Select only after Tooltip proves the popup/portal wrapper. Keep
  positioning, keyboard selection, typeahead, and final focus Base UI-owned,
  and retain the CSS path if Motion does not materially improve it.
- [ ] Do not migrate:
  - Queue Drawer, because its swipe state and CSS variables are Base UI-owned;
  - popup surfaces whose exit is not perceptible or whose controlled-state
    conversion would weaken their current contract.
- [ ] Test observable focus, dismissal, urgent announcements, final focus, and
  reduced motion; do not test Motion internals.

**Commits:**

- `Animate Base UI dialog presence`
- Conditional: `Animate Base UI alert dialog presence`
- Conditional: `Animate Base UI tooltip and select presence`

**Exit gate:** Base UI semantics remain identical and no portal remains mounted
after exit.

---

## Task 11: Migrate Base UI Toast presence and stacking

**Files:**

- Modify: `src/components/ui/toast.tsx`
- Modify: Toast tests and affected observable App/Saved Library tests
- Modify: `src/styles.css` only for superseded Toast motion

**Purpose:** Remove the current D-tier height animation and add S-tier outer
presence without losing the bounded Base UI variable-driven stack/swipe or the
recent accessibility migration.

- [ ] Adapt the official `motion://examples/react/base-toast` lifecycle and
  `render`/presence structure rather than recreating the integration from
  memory. Do not copy its Motion `drag` path into the `domAnimation` baseline.
- [ ] Keep the Base UI provider, toast manager, root semantics, live
  announcements, high/low priority behavior, actions, close control, and
  promise/loading support.
- [ ] Preserve Coda's 320px maximum width, player clearance, 2.8-second timeout,
  tokens, and existing notifier call sites.
- [ ] Use `AnimatePresence` for entry/exit with direct transform/opacity.
- [ ] Let the small flex stack reflow without animating height in the baseline.
  If native QA proves the repositioning visually unacceptable, measure a
  separate `domMax`/layout experiment before changing the application-wide
  feature bundle.
- [ ] Keep Base UI's existing swipe variables and gesture on the inner Toast
  root. Put Motion presence on a separate outer wrapper so the two systems never
  write the same transform. Do not add Motion `drag` or `domMax` in this task.
  Closing state remains manager-owned rather than `onAnimationComplete`-owned.
- [ ] Ensure urgent toasts retain the current live `role="alert"` contract; do
  not regress to testing a hidden dialog implementation detail.
- [ ] Test multiple toasts, entry, timeout exit, close, swipe, action, urgent
  announcement, rapid replacement, player clearance, and reduced motion.
- [ ] Remove persistent `will-change` if Motion/WAAPI promotion makes it
  unnecessary.

**Commit:** `Migrate Base UI Toast motion`

**Exit gate:** Individual Toast outer presence is S-tier, the stack no longer
animates height, and every existing announcement/dismissal contract remains
observable.

---

## Task 12: Tune the remaining CSS-owned motion

**Files:**

- Modify: `src/styles.css`
- Modify: CSS-owned component classes
- Modify: nearest tests only where observable behavior changes

**Purpose:** Give retained CSS motion the same timing language and remove drift.

- [ ] Consolidate durations into semantic fast, standard, panel, page, and
  shared-artwork tokens.
- [ ] Use Motion's CSS easing generator for candidate panel/page curves and
  judge them in the native app. Do not adopt a spring merely because it exists.
- [ ] Tune the queue drawer within Base UI's existing contract. Test rapid
  Show/Hide, focus recovery, swipe cancel, and 760px behavior.
- [ ] Keep color/border hover transitions short and restrained.
- [ ] Pause marquee/equalizer/status pulse under reduced motion. Ensure their
  static alternative still communicates state.
- [ ] Remove obsolete `@keyframes` only after all call sites and tests have
  migrated.
- [ ] Search the repository for unowned `animation`, `transition`, and
  `will-change` declarations; assign each to Motion, CSS, Base UI, or platform
  View Transitions.

**Commit:** `Unify Coda motion timing and retained CSS effects`

**Exit gate:** No orphan keyframes, hard-coded page timing drift, or unexplained
persistent `will-change`.

---

## Task 13: Final MotionScore, bundle, accessibility, and native QA

**Files:**

- Modify: only regressions found by verification
- Create outside repository: final reports, screenshots, and comparison notes

- [ ] Run the full static MotionScore audit and compare it with Task 0.
- [ ] Run the runtime MotionScore audit against a usable renderer URL if
  available. Treat native Tauri smoke testing as the product acceptance test.
- [ ] Record:
  - initial JavaScript raw/gzip delta;
  - total JavaScript raw/gzip delta;
  - CSS raw/gzip delta;
  - lazy chunk changes;
  - MotionScore distribution and remaining B/C/D surfaces.
- [ ] Enforce the static performance gate:
  - no F-tier findings;
  - no new D-tier animation;
  - both equalizers are S-tier;
  - Toast outer entry/exit is S-tier and its retained Base UI swipe transform is
    documented as bounded C-tier;
  - every B–D platform shared-element transition is bounded to one hero element
    and has a passing native runtime check;
  - the queue Drawer remains the only accepted Base UI variable-driven panel
    path unless another exception is explicitly justified.
- [ ] Run:

  ```sh
  npm test
  npm run test:coverage
  npm run build
  git diff --check
  ```

- [ ] Run `npm run dev` and verify on macOS:
  - every primary destination;
  - Album, Artist, Playlist, Radio, and Discover forward/Back;
  - cached and cold album detail;
  - rapid repeated navigation;
  - Now Playing open/close with queue closed and open;
  - queue Show/Hide, swipe cancel, clearing, and focus recovery;
  - Play/Pause, Previous/Next, seek, volume, and repeat during animation;
  - Dialog, Alert Dialog, Tooltip, Select, and Toast;
  - large virtualized collections and queue;
  - 760px, approximately 900px, and wide layouts;
  - reduced motion toggled at the operating-system level.
- [ ] Check explicitly for:
  - blank frames or frozen loading indicators;
  - duplicate View Transition names;
  - stale destinations after rapid input;
  - pointer-blocking snapshots;
  - focus loss or focus inside exiting content;
  - scroll jumps;
  - sidebar/player movement;
  - retained off-screen virtualized DOM;
  - playback-clock-driven Motion rerenders;
  - new CSP, network, credential, or native-capability changes.

**Commit:** `Complete Motion migration verification`

**Exit gate:** All acceptance criteria below pass and the final PR reports every
unverified platform.

## Acceptance criteria

- Motion for React is the default abstraction for new component presence and
  interruptible local feedback.
- Platform View Transitions remain the only owner of major destination and
  detail-page snapshot movement through `transitionCodaView`.
- Forward and Back motion is directional; authored snapshot keyframes use only
  transform and opacity, while bounded platform shared-element geometry is
  measured and reported separately.
- Now Playing has distinct open/close choreography and exactly one artwork
  owner per snapshot, including with the queue open.
- A rejected or canceled native snapshot cannot strand Coda without a fallback
  or suppress later transitions.
- If deferred Task 8 ships, cached Collection albums receive a polished forward
  artwork morph without making the baseline migration contingent on it.
- Cold albums and other cold details expose a live loading affordance
  immediately.
- Each navigation has exactly one animation owner.
- Sidebar, player, queue, playback, scroll, focus, and history remain coherent.
- Search, filters, sorting, queue mutations, and playback commands remain
  immediate.
- Reduced motion removes spatial travel and repeating decorative motion while
  preserving short comprehensible feedback.
- Decorative equalizers no longer animate layout.
- Base UI remains authoritative for semantics, focus, dismissal, announcements,
  Toast state, and Drawer gestures; Motion owns only the verified visual layer.
- Virtualized lists remain bounded and do not receive broad layout animation.
- No credentials, signed URLs, or new sensitive state enter Motion or navigation
  state.
- Production bundle impact and MotionScore changes are measured and reported.
- Frontend tests, coverage, production build, and native macOS smoke validation
  pass.
- No CSP, Tauri capability, native command, or network-boundary change is
  introduced.

## Explicitly out of scope

- Replacing `transitionCodaView` with Motion layout animations.
- Shipping Motion+ `AnimateView` in the baseline migration.
- Adding a routing library.
- Reverse Collection artwork morphing before virtualized source restoration is
  proven.
- Animating search, filters, sorting, queue mutations, playback commands, seek,
  or volume state changes.
- Replacing Base UI Drawer behavior or Toast semantics/state management.
- Animating native title bars, tray UI, system dialogs, AirPlay, or mini-player
  window movement.
- Cross-platform native validation beyond the host OS; CI remains additional
  evidence, not visual proof.

## Optional follow-up spike: Motion+ AnimateView

After the baseline migration ships, a separate throwaway branch may compare
Motion+ `AnimateView` with `transitionCodaView` for one noncritical detail route.
The spike must answer:

- Does it preserve current latest-wins cancellation, focus, scroll, and loading
  behavior?
- Does it run on Coda's supported Tauri WebViews without a React/runtime
  upgrade?
- Does the private Motion+ package/token workflow belong in a desktop
  application build?
- Does typed direction or spring configuration produce a visible improvement
  over the existing CSS snapshot path?
- What is the bundle, memory, and runtime MotionScore delta?

The spike is discarded unless it clearly beats the stable platform path without
weakening Coda's build reproducibility or product contracts.
