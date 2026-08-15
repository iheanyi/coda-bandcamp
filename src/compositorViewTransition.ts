const KEYFRAME_META = new Set([
  "offset",
  "easing",
  "composite",
  "computedOffset",
]);
const LAYOUT_OR_FILTER_KEYS = new Set([
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "backdropFilter",
  "filter",
]);
const COMPOSITOR_KEYS = new Set(["transform", "opacity", "transformOrigin"]);

function framesNeedCompositorRewrite(frames: readonly Keyframe[]): boolean {
  return frames.some((frame) =>
    Object.keys(frame).some((key) => LAYOUT_OR_FILTER_KEYS.has(key)),
  );
}

function cssPx(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Number(match[1]) : undefined;
}

function lastDefinedPx(
  frames: readonly Keyframe[],
  property: "width" | "height",
): number | undefined {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const value = cssPx(frames[index]?.[property]);
    if (value !== undefined && value > 0) return value;
  }
  return undefined;
}

function nearly(value: number, expected: number) {
  return Math.abs(value - expected) < 0.001;
}

/**
 * Native group matrices translate the box's top-left. Scale is applied from
 * the default 50% origin of the destination box, so shift that translate to
 * the center delta or the morph arcs — Now Playing Back goes left/up, then
 * drops into the dock.
 */
function centerDeltaForScale(
  transform: string,
  width: number,
  height: number,
  destWidth: number,
  destHeight: number,
): { tx: number; ty: number } | undefined {
  const trimmed = transform.trim();
  if (trimmed === "none" || trimmed === "") {
    return {
      tx: (width - destWidth) / 2,
      ty: (height - destHeight) / 2,
    };
  }
  const match = trimmed.match(
    /^matrix\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/,
  );
  if (!match) return undefined;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const c = Number(match[3]);
  const d = Number(match[4]);
  const tx = Number(match[5]);
  const ty = Number(match[6]);
  if (![a, b, c, d, tx, ty].every(Number.isFinite)) return undefined;
  if (!nearly(a, 1) || !nearly(b, 0) || !nearly(c, 0) || !nearly(d, 1)) {
    return undefined;
  }
  return {
    tx: tx + (width - destWidth) / 2,
    ty: ty + (height - destHeight) / 2,
  };
}

/**
 * Native view-transition groups interpolate width/height. Bake that size
 * change into scale so the running animation only touches transform/opacity.
 */
export function flattenLayoutKeyframesToTransform(
  frames: readonly Keyframe[],
): Keyframe[] {
  const destWidth = lastDefinedPx(frames, "width");
  const destHeight = lastDefinedPx(frames, "height");

  return frames.map((frame) => {
    const next: Keyframe = {};
    if (frame.offset !== undefined) next.offset = frame.offset;
    if (frame.easing !== undefined) next.easing = frame.easing;
    if (frame.composite !== undefined) next.composite = frame.composite;
    if (frame.opacity !== undefined) next.opacity = frame.opacity;

    const width = cssPx(frame.width);
    const height = cssPx(frame.height);
    const scaleX =
      destWidth && width !== undefined ? width / destWidth : undefined;
    const scaleY =
      destHeight && height !== undefined ? height / destHeight : undefined;
    const existing =
      typeof frame.transform === "string" && frame.transform.length > 0
        ? frame.transform
        : "none";
    if (
      scaleX !== undefined &&
      scaleY !== undefined &&
      width !== undefined &&
      height !== undefined &&
      destWidth !== undefined &&
      destHeight !== undefined
    ) {
      const scale = `scale(${scaleX}, ${scaleY})`;
      const center = centerDeltaForScale(
        existing,
        width,
        height,
        destWidth,
        destHeight,
      );
      if (center) {
        next.transform = `matrix(1, 0, 0, 1, ${center.tx}, ${center.ty}) ${scale}`;
      } else {
        next.transform = existing === "none" ? scale : `${existing} ${scale}`;
      }
    } else if (frame.transform !== undefined) {
      next.transform = frame.transform;
    }
    return next;
  });
}

export function keyframePropertyNames(frames: readonly Keyframe[]): string[] {
  return [
    ...new Set(
      frames.flatMap((frame) =>
        Object.keys(frame).filter((key) => !KEYFRAME_META.has(key)),
      ),
    ),
  ].sort();
}

export function isCompositorOnlyKeyframeKeys(keys: readonly string[]): boolean {
  return keys.every((key) => COMPOSITOR_KEYS.has(key));
}

export type ViewTransitionAnimationKeySample = Readonly<{
  playState: string;
  pseudo: string;
  keys: readonly string[];
}>;

export function collectViewTransitionAnimationKeys(
  animations: readonly Animation[],
): ViewTransitionAnimationKeySample[] {
  const samples: ViewTransitionAnimationKeySample[] = [];
  for (const animation of animations) {
    const effect = animation.effect as KeyframeEffect | null;
    const pseudo = effect?.pseudoElement;
    if (!pseudo?.startsWith("::view-transition")) continue;
    if (typeof effect.getKeyframes !== "function") continue;
    samples.push({
      playState: animation.playState,
      pseudo,
      keys: keyframePropertyNames(effect.getKeyframes()),
    });
  }
  return samples;
}

export function rewriteDocumentViewTransitionGroupsToTransform(): number {
  if (typeof document.getAnimations !== "function") return 0;
  return rewriteRunningViewTransitionGroupsToTransform(
    document.getAnimations(),
  );
}

export function rewriteRunningViewTransitionGroupsToTransform(
  animations: readonly Animation[],
): number {
  let rewritten = 0;
  for (const animation of animations) {
    const effect = animation.effect as KeyframeEffect | null;
    if (!effect?.pseudoElement?.startsWith("::view-transition")) {
      continue;
    }
    if (
      typeof effect.getKeyframes !== "function" ||
      typeof effect.setKeyframes !== "function"
    ) {
      continue;
    }
    const frames = effect.getKeyframes();
    if (!framesNeedCompositorRewrite(frames)) {
      continue;
    }
    effect.setKeyframes(flattenLayoutKeyframesToTransform(frames));
    rewritten += 1;
  }
  return rewritten;
}
