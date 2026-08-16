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
const REWRITABLE_SIZE_KEYS = new Set(["width", "height"]);

function cssPixels(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Number(match[1]) : undefined;
}

function lastPositivePixels(
  frames: readonly Keyframe[],
  property: "width" | "height",
): number | undefined {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const value = cssPixels(frames[index]?.[property]);
    if (value !== undefined && value > 0) return value;
  }
  return undefined;
}

function nearly(value: number, expected: number) {
  return Math.abs(value - expected) < 0.001;
}

function centeredTranslation(
  transform: string,
  width: number,
  height: number,
  destinationWidth: number,
  destinationHeight: number,
): { x: number; y: number } | undefined {
  const trimmed = transform.trim();
  if (trimmed === "none" || trimmed === "") {
    return {
      x: (width - destinationWidth) / 2,
      y: (height - destinationHeight) / 2,
    };
  }
  const match = trimmed.match(
    /^matrix\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/,
  );
  if (!match) return undefined;
  const [a, b, c, d, x, y] = match.slice(1).map(Number);
  if (
    ![a, b, c, d, x, y].every(
      (value): value is number => value !== undefined && Number.isFinite(value),
    ) ||
    !nearly(a, 1) ||
    !nearly(b, 0) ||
    !nearly(c, 0) ||
    !nearly(d, 1)
  ) {
    return undefined;
  }
  return {
    x: x + (width - destinationWidth) / 2,
    y: y + (height - destinationHeight) / 2,
  };
}

export function flattenLayoutKeyframesToTransform(
  frames: readonly Keyframe[],
): Keyframe[] {
  const destinationWidth = lastPositivePixels(frames, "width");
  const destinationHeight = lastPositivePixels(frames, "height");

  return frames.map((frame) => {
    const next: Keyframe = {};
    if (frame.offset !== undefined) next.offset = frame.offset;
    if (frame.easing !== undefined) next.easing = frame.easing;
    if (frame.composite !== undefined) next.composite = frame.composite;
    if (frame.opacity !== undefined) next.opacity = frame.opacity;
    if (frame.transformOrigin !== undefined) {
      next.transformOrigin = frame.transformOrigin;
    }

    const width = cssPixels(frame.width);
    const height = cssPixels(frame.height);
    const scaleX =
      destinationWidth && width !== undefined
        ? width / destinationWidth
        : undefined;
    const scaleY =
      destinationHeight && height !== undefined
        ? height / destinationHeight
        : undefined;
    const transform =
      typeof frame.transform === "string" && frame.transform.length > 0
        ? frame.transform
        : "none";
    if (
      scaleX !== undefined &&
      scaleY !== undefined &&
      width !== undefined &&
      height !== undefined &&
      destinationWidth !== undefined &&
      destinationHeight !== undefined
    ) {
      const translation = centeredTranslation(
        transform,
        width,
        height,
        destinationWidth,
        destinationHeight,
      );
      const scale = `scale(${scaleX}, ${scaleY})`;
      next.transform = translation
        ? `matrix(1, 0, 0, 1, ${translation.x}, ${translation.y}) ${scale}`
        : transform === "none"
          ? scale
          : `${transform} ${scale}`;
    } else if (frame.transform !== undefined) {
      next.transform = frame.transform;
    }
    return next;
  });
}

export function keyframePropertyNames(frames: readonly Keyframe[]) {
  return [
    ...new Set(
      frames.flatMap((frame) =>
        Object.keys(frame).filter((key) => !KEYFRAME_META.has(key)),
      ),
    ),
  ].sort();
}

export function isCompositorOnlyKeyframeKeys(keys: readonly string[]) {
  return keys.every((key) => COMPOSITOR_KEYS.has(key));
}

function propertyChanges(frames: readonly Keyframe[], property: string) {
  const values = frames.map((frame) => frame[property]);
  const definedValues = values.filter((value) => value !== undefined);
  if (definedValues.length !== values.length) return true;
  return new Set(definedValues.map(String)).size > 1;
}

function hasCompleteSizeGeometry(
  frames: readonly Keyframe[],
  keys: readonly string[],
) {
  const sizeKeys = keys.filter((key) => REWRITABLE_SIZE_KEYS.has(key));
  if (sizeKeys.length === 0) return true;
  if (sizeKeys.length !== REWRITABLE_SIZE_KEYS.size) return false;
  return frames.every(
    (frame) =>
      cssPixels(frame.width) !== undefined &&
      cssPixels(frame.height) !== undefined,
  );
}

function viewTransitionName(pseudo: string | null | undefined) {
  return pseudo?.match(
    /^::view-transition-(?:group|image-pair|old|new)\(([^)]+)\)$/,
  )?.[1];
}

export type CompositorRewriteResult = Readonly<{
  inspected: number;
  rewritten: number;
  safe: boolean;
}>;

export function enforceCompositorOnlyViewTransitions(
  animations: readonly Animation[],
  transitionNames: readonly string[],
): CompositorRewriteResult {
  const allowedNames = new Set(transitionNames);
  const observedNames = new Set<string>();
  let inspected = 0;
  let rewritten = 0;
  let safe = true;

  for (const animation of animations) {
    const effect = animation.effect as KeyframeEffect | null;
    const name = viewTransitionName(effect?.pseudoElement);
    if (!name || !allowedNames.has(name)) continue;
    observedNames.add(name);
    if (typeof effect?.getKeyframes !== "function") {
      safe = false;
      continue;
    }
    inspected += 1;
    let frames: Keyframe[];
    try {
      frames = effect.getKeyframes();
    } catch {
      safe = false;
      continue;
    }
    if (frames.length === 0) {
      safe = false;
      continue;
    }
    const keys = keyframePropertyNames(frames);
    if (isCompositorOnlyKeyframeKeys(keys)) continue;
    const unsupportedKeys = keys.filter(
      (key) =>
        !COMPOSITOR_KEYS.has(key) && !REWRITABLE_SIZE_KEYS.has(key),
    );
    if (
      unsupportedKeys.some((key) => propertyChanges(frames, key)) ||
      !hasCompleteSizeGeometry(frames, keys)
    ) {
      safe = false;
      continue;
    }
    if (
      !keys.some((key) => LAYOUT_OR_FILTER_KEYS.has(key)) ||
      typeof effect.setKeyframes !== "function"
    ) {
      safe = false;
      continue;
    }
    const flattened = flattenLayoutKeyframesToTransform(frames);
    if (!isCompositorOnlyKeyframeKeys(keyframePropertyNames(flattened))) {
      safe = false;
      continue;
    }
    try {
      effect.setKeyframes(flattened);
      rewritten += 1;
    } catch {
      safe = false;
    }
  }

  if (
    allowedNames.size > 0 &&
    [...allowedNames].some((name) => !observedNames.has(name))
  ) {
    safe = false;
  }
  return { inspected, rewritten, safe };
}

export function enforceDocumentViewTransitionCompositing(
  transitionNames: readonly string[],
): CompositorRewriteResult {
  if (typeof document.getAnimations !== "function") {
    return {
      inspected: 0,
      rewritten: 0,
      safe: transitionNames.length === 0,
    };
  }
  try {
    return enforceCompositorOnlyViewTransitions(
      document.getAnimations(),
      transitionNames,
    );
  } catch {
    return { inspected: 0, rewritten: 0, safe: false };
  }
}
