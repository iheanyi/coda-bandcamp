# Coda Motion React Migration Design

**Status:** Proposed
**Target:** Follow-up work after the Tailwind 4 and shadcn/Base UI migration

## Decision

Coda will adopt [Motion for React](https://motion.dev/docs/react) as its default
component-animation abstraction while retaining the platform View Transitions
API for major destinations and shared artwork transitions.

This is a hybrid ownership model:

| Motion surface | Owner |
| --- | --- |
| Major destination changes and detail-page drill-ins | Platform View Transitions through `transitionCodaView` |
| Collection artwork into album detail | Platform shared-element View Transition |
| Now Playing compact artwork into the full player | Existing platform shared-element View Transition |
| Component mount, unmount, and replacement | Motion `AnimatePresence` |
| Local interactive feedback and interruptible movement | Motion components and transitions |
| Base UI popup content where an exit needs React presence | Motion through Base UI's `render` integration |
| Continuous status effects such as spinners, equalizers, and shimmer | CSS |
| Queue drawer drag and swipe mechanics | Base UI Drawer until profiling proves a replacement is better |

Motion will not replace every CSS transition simply to make the code uniform.
Color-only hover states, focus styles, native View Transition pseudo-elements,
and continuous decorative effects remain clearer and cheaper in CSS.

## Context

Coda currently has four overlapping motion systems:

1. `src/viewTransitions.ts` coordinates platform View Transitions for Now
   Playing and forward, backward, and crossfade navigation.
2. `src/styles.css` owns the corresponding snapshot pseudo-element animations
   plus page entrances and reduced-motion fallbacks.
3. Tailwind utilities and component CSS animate hover, press, loading, queue,
   and playback states.
4. Base UI components own popup, dialog, toast, select, and drawer lifecycle
   states.

The systems are individually reasonable, but there is no single component-level
presence model. That has encouraged duplicate entrance animations, inconsistent
durations, and situations where a CSS animation competes with a document
snapshot.

The recent View Transition hardening remains the correctness baseline. Motion
must build on it rather than recreate navigation sequencing in another layer.

## Goals

- Make Motion React the normal abstraction for component presence and
  interruptible micro-interactions.
- Give Coda a small, named motion vocabulary that matches its restrained visual
  character.
- Add a polished Collection-to-album-detail transition without hiding cold
  loading states.
- Preserve the anchored sidebar, player, non-reflowing queue, scroll restoration,
  focus restoration, and playback continuity.
- Make rapid repeated actions settle on the latest valid state.
- Respect `prefers-reduced-motion` from one application-level policy.
- Keep renderer startup and interaction performance measurable and bounded.
- Remove obsolete CSS animations after each migrated surface is verified.

## Non-goals

- Replacing the platform View Transitions API.
- Rewriting navigation or introducing a routing library.
- Animating search, filtering, sorting, queue mutations, or playback commands
  when immediate feedback is more appropriate.
- Animating height or large layout regions for decoration.
- Replacing Base UI's accessible behavior or its proven drawer gesture model.
- Adding animation to native title bars, system dialogs, tray UI, AirPlay, or
  other operating-system surfaces.
- Introducing `framer-motion`; imports must come from `motion/react`.

## Runtime and Bundle Architecture

Install the current `motion` package:

```sh
npm install motion
```

Add a single provider near the renderer root:

```tsx
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

<MotionConfig reducedMotion="user">
  <LazyMotion features={domAnimation} strict>
    {children}
  </LazyMotion>
</MotionConfig>
```

Components under `LazyMotion` will use the smaller `m` component:

```tsx
import * as m from "motion/react-m";
```

[Motion's bundle guidance](https://motion.dev/docs/react-reduce-bundle-size)
places the full `motion` component at roughly 34 kB, `domAnimation` around
15 kB, and the `m` entry below 4.6 kB before features are supplied.
`domAnimation` supports animation, variants, presence, and basic gestures.

`domMax` adds pan, drag, and layout animation support at a larger cost. Coda
will begin with `domAnimation`. A surface may move to `domMax` only if it needs
Motion's `layout`, `layoutId`, pan, or drag features and a production bundle
comparison justifies the change.

The album and Now Playing shared-element transitions do not require Motion
`layoutId`; the platform already owns those transitions. This keeps shared
navigation out of `domMax` and avoids two engines trying to animate the same
geometry.

Application motion constants will live in a focused module rather than being
repeated inline. They should be semantic, typed, and limited to the transitions
Coda actually uses:

```ts
export const codaMotion = {
  feedback: { duration: 0.12, ease: [0.2, 0, 0, 1] },
  enter: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  exit: { duration: 0.14, ease: [0.4, 0, 1, 1] },
  spring: {
    type: "spring",
    bounce: 0.08,
    visualDuration: 0.28,
  },
} as const;
```

The exact values must be tuned in the native app. Springs are reserved for
physical, interruptible movement. Opacity and nonphysical value changes use
predictable duration-based transitions. Coda should not overshoot during normal
navigation.

## Motion Language

Coda's motion should communicate state and spatial relationship rather than
decorate every action.

### Feedback

- Target duration: 100–140 ms.
- Use for icon replacement, button press, and immediate control feedback.
- A control's semantic state changes immediately; animation follows that state.
- Color-only hover and focus feedback stays in CSS.

### Component entrance and exit

- Target entrance: 180–240 ms.
- Target exit: 120–160 ms.
- Use opacity plus at most 4–8 px of translation.
- Exits are shorter than entrances.
- Avoid scale entrances on text-heavy panels.

### Physical movement

- Use a low-bounce spring with a visual duration around 280–360 ms.
- Movement must remain interruptible and settle at the latest state.
- Use `transform` when a single transform can be sent through WAAPI.
- Add `will-change` only while independently animated transforms need it.

### Shared navigation

- Artwork is the hero element.
- Title and artist use restrained opacity/translation rather than font-size
  geometry morphing.
- Supporting metadata follows after the destination is committed.
- The total sequence should complete in about 400–450 ms.
- The sidebar and player remain visually anchored.

### Reduced motion

`MotionConfig reducedMotion="user"` is the application default. Reduced-motion
behavior must:

- commit navigation and component state without spatial travel;
- preserve short opacity changes only where they aid comprehension;
- disable repeating decorative motion;
- leave spinners understandable through their accessible loading labels; and
- keep all controls immediately usable.

CSS `motion-reduce` rules remain necessary for CSS-owned animation and platform
View Transition fallbacks.

## Collection to Album Detail

The Collection-to-detail transition uses the existing navigation helper with a
new `album-detail` kind.

### Warm album

When TanStack Query already has usable album metadata:

1. The clicked Collection card is the only source armed with the album artwork
   transition name.
2. `transitionCodaView` captures the Collection state.
3. React commits album detail synchronously inside the transition update.
4. The detail artwork receives the matching transition name.
5. The platform morphs artwork geometry while Motion introduces the title,
   artist, metadata, actions, and track list after commit.
6. The old CSS `album-page-in` animation is disabled for this route so it does
   not compete with the snapshot.

Only the clicked card may be armed. Fixed names on every Collection card would
violate View Transition name uniqueness and can abort the transition.

The destination `CoverArt` must synchronously reuse a resolved value from the
existing bounded signed-artwork Promise cache. It must not create another
unbounded cache or persist a signed URL.

### Cold or revalidating album

When usable metadata is not cached:

1. Commit the detail shell immediately without a document snapshot.
2. Preserve the clicked album's known artwork and display metadata.
3. Show the live, accessible track-list spinner in the destination.
4. Let TanStack Query hydrate and replace the loading region in place.
5. Use Motion only for the loaded track region's local entrance.

A full-document snapshot must not cover the live loading affordance. Fast
navigation with visible progress is preferable to holding the Collection page
while a request finishes.

### Back behavior

The first migration keeps the existing directional Back transition. Large
Collection grids are virtualized, so the source card may not be mounted when a
reverse shared-element capture begins.

A reverse artwork morph is a later enhancement and requires proof that scroll
restoration mounts the target row before the new snapshot is captured. It must
not disable virtualization or retain the entire Collection DOM.

## Component Migration Map

### First wave: low-risk component presence

- Play/pause icon replacement.
- Album, Saved Library, Discover, and Radio loaded-region entrances.
- Queue row insertion and removal.
- Empty-state and recommendation replacement.
- Local loading-to-content transitions.

These surfaces establish shared variants and reduced-motion behavior without
changing navigation ownership.

### Second wave: Base UI surfaces

- Dialog and alert-dialog content.
- Select popup.
- Tooltip content where an exit is perceptible.
- Toast entry, exit, and stacking.

Base UI components receive Motion elements through their `render` prop. For
self-managing popup components, open state is hoisted and the portal remains
mounted while `AnimatePresence` completes the exit. Base UI semantics, focus
management, dismissal, and announcements remain authoritative.

Primitive tests should continue asserting Coda's observable contract rather
than retesting Motion or Base UI internals.

### Third wave: navigation composition

- Collection to album detail.
- Discover card to Discover release detail.
- Artist and playlist drill-ins.
- Now Playing interior staging around the existing artwork View Transition.

`transitionCodaView` remains the only coordinator for major destinations.
Motion components must not start a competing full-page exit before its snapshot
is captured.

### CSS that remains CSS

- Spinner rotation.
- Skeleton shimmer.
- Playing equalizer bars.
- Marquee overflow.
- Basic color and border hover states.
- Platform View Transition pseudo-elements.
- Base UI Drawer swipe transforms until separately justified.

## Sequencing and State Rules

- React state is the source of truth; animation completion must not decide
  playback, queue, or navigation state.
- A newer destination cancels or supersedes older visual work.
- Async data must be validated before committing a destination that requires
  it.
- Cold routes show their loading shell immediately.
- Exiting components use stable semantic keys.
- `AnimatePresence` must not retain credentials, signed URLs, or stale library
  data beyond the visual exit.
- Motion values are never read during React render.
- Animation callbacks and effects own their cleanup and remain safe under React
  Strict Mode.
- Virtualized list items do not receive broad `layout` animation by default.

## Performance Constraints

The migration must preserve Coda's fast renderer startup and bounded hot paths.

- Compare the production renderer's initial JavaScript and lazy chunk sizes
  before and after installing Motion.
- Begin with `LazyMotion`, `m`, and `domAnimation`.
- Do not add `domMax` solely for shared album artwork.
- Avoid per-frame object creation and full-list animation work.
- Do not animate all rows in a large virtualized list.
- Animate `transform` and `opacity` wherever practical.
- Do not leave broad `will-change` declarations active after an animation.
- Verify that playback time updates do not trigger Motion component rerenders.
- Keep Discover and Radio lazy-loaded.

The bundle increase must be reported in the migration PR. If Motion becomes
part of the initial renderer chunk, the PR must explain why the affected
interaction cannot load it with the owning lazy surface.

## Accessibility

- Respect the operating-system reduced-motion preference.
- Preserve visible focus throughout entrances and exits.
- Do not delay focus restoration until a decorative animation completes.
- Portals and exiting dialogs cannot leave focus trapped in visually removed
  content.
- Loading indicators retain `role="status"` or an equivalent accessible label.
- Animation cannot be the sole indication of playback, loading, selection, or
  queue visibility.
- Buttons remain semantic and keep their existing accessible names and pressed
  states.

## Testing

### Automated

- Keep the `transitionCodaView` cancellation, fallback, class-cleanup, and
  reduced-motion coverage.
- Test warm album navigation uses the shared transition path.
- Test cold album navigation commits the loading detail immediately.
- Test rapid album selections settle on the final selection.
- Test play/pause replacement follows actual playback state.
- Test queue Show and Hide through the player control after presence migration.
- Test reduced motion bypasses spatial Motion variants.
- Test Base UI dialogs, toasts, and selects through observable focus, status,
  dismissal, and announcement behavior.

Tests should not assert Motion's generated inline styles or implementation
details.

### Native visual QA

Run the complete application with `npm run dev` and verify:

- Collection to a cached album;
- Collection to a cold album;
- immediate Back during both paths;
- repeated rapid album clicks;
- compact player to and from Now Playing;
- queue Show, Hide, clearing, and rapid toggling;
- playback icon replacement during repeated Next and Play/Pause actions;
- dialogs, selects, tooltips, and toasts;
- large virtualized Collections;
- the 760 px minimum window width and behavior around 900 px; and
- macOS reduced-motion enabled.

Check for blank frames, duplicate snapshots, stale exits, scroll jumps, focus
loss, pointer interception, and player/sidebar movement.

### Final verification

```sh
npm test
npm run test:coverage
npm run build
git diff --check
```

No network, credential, CSP, native capability, or Tauri command change is
expected. The final PR should call out any deviation explicitly.

## Implementation Order

1. Record a production bundle baseline.
2. Install `motion` and add the root Motion provider.
3. Add typed Coda transitions and reusable presence variants.
4. Migrate play/pause and one simple entrance as a vertical slice.
5. Verify reduced motion, Strict Mode, tests, and bundle output.
6. Migrate the first-wave component surfaces and remove their replaced CSS.
7. Integrate Base UI presence one primitive at a time.
8. Implement the hybrid Collection-to-detail transition.
9. Compose Motion staging into Now Playing without replacing its platform
   artwork transition.
10. Audit remaining CSS animations and retain only the explicitly CSS-owned
    set.
11. Complete native visual QA and publish before/after bundle measurements.

Each step should be a reviewable commit. Do not perform a mechanical repository-
wide replacement of `transition-*` utilities or `@keyframes`.

## Acceptance Criteria

- Motion React is the default abstraction for new component-level presence and
  interruptible interaction animation.
- Major destinations still route through `transitionCodaView`.
- Cached Collection albums receive a polished shared artwork transition.
- Cold albums display a detail loading affordance immediately.
- No transition can leave Coda on a stale destination after rapid input.
- The sidebar and player remain anchored during navigation.
- Queue visibility, playback, scroll, focus, and Back behavior remain intact.
- Reduced motion removes spatial travel and repeating decorative movement.
- Obsolete CSS is removed only after its replacement is verified.
- Production bundle impact is measured and documented.
- Frontend tests, coverage, build, and native smoke validation pass.
