import { spring } from "motion";
import type { Transition } from "motion/react";

export const MOTION_PROFILE_VERSION = 1 as const;

export type MotionEase = "emphasized" | "standard" | "accelerate" | "linear";

export type MotionTiming = Readonly<{
  type: "tween" | "spring";
  durationMs: number;
  bounce: number;
  ease: MotionEase;
}>;

export type MotionProfile = Readonly<{
  version: typeof MOTION_PROFILE_VERSION;
  speed: number;
  feedback: Readonly<{
    timing: MotionTiming;
  }>;
  component: Readonly<{
    enter: MotionTiming;
    exit: MotionTiming;
    translationPx: number;
    scaleFrom: number;
    opacityFrom: number;
  }>;
  page: Readonly<{
    mode: "slide" | "crossfade";
    enter: MotionTiming;
    exit: MotionTiming;
    enterDelayMs: number;
    translationPx: number;
    scaleFrom: number;
    opacityFrom: number;
  }>;
  shared: Readonly<{
    choreography: "morph" | "crossfade";
    artwork: MotionTiming;
    identity: MotionTiming;
    title: MotionTiming;
    crossfade: MotionTiming;
    scaleFrom: number;
    opacityFrom: number;
  }>;
  detail: Readonly<{
    surface: MotionTiming;
    translationPx: number;
    scaleFrom: number;
    opacityFrom: number;
  }>;
  selection: MotionTiming;
}>;

export type MotionPreset = Readonly<{
  id: string;
  name: string;
  builtin: boolean;
  profile: MotionProfile;
}>;

export type ViewTransitionTiming = Readonly<
  | {
      type: typeof spring;
      visualDuration: number;
      bounce: number;
    }
  | {
      duration: number;
      ease: [number, number, number, number] | "linear";
    }
>;

export type ResolvedMotionProfile = Readonly<{
  profile: MotionProfile;
  feedback: Transition;
  componentEnter: Transition;
  componentExit: Transition;
  viewExit: Transition;
  view: Transition;
  viewEnter: Transition;
  sharedArtwork: Transition;
  detailArtwork: Transition;
  detailIdentity: Transition;
  detailTitle: Transition;
  detailIdentityFade: Transition;
  detailSurfaceEnter: Transition;
  gentleSpring: Transition;
  selectionPill: Transition;
  viewTransition: Readonly<{
    detailArtwork: ViewTransitionTiming;
    detailIdentity: ViewTransitionTiming;
    detailTitle: ViewTransitionTiming;
  }>;
  configuredDurationMs: number;
}>;

const EASINGS = {
  emphasized: [0.22, 1, 0.36, 1],
  standard: [0.4, 0, 0.2, 1],
  accelerate: [0.4, 0, 1, 1],
  linear: "linear",
} satisfies Record<
  MotionEase,
  [number, number, number, number] | "linear"
>;

function timing(
  durationMs: number,
  ease: MotionEase,
  type: MotionTiming["type"] = "tween",
  bounce = 0,
): MotionTiming {
  return { type, durationMs, bounce, ease };
}

export const CURRENT_MOTION_PROFILE: MotionProfile = {
  version: MOTION_PROFILE_VERSION,
  speed: 1,
  feedback: { timing: timing(140, "emphasized") },
  component: {
    enter: timing(180, "emphasized"),
    exit: timing(140, "accelerate"),
    translationPx: 8,
    scaleFrom: 0.98,
    opacityFrom: 0,
  },
  page: {
    mode: "slide",
    enter: timing(180, "emphasized"),
    exit: timing(120, "accelerate"),
    enterDelayMs: 15,
    translationPx: 10,
    scaleFrom: 1,
    opacityFrom: 0,
  },
  shared: {
    choreography: "morph",
    artwork: timing(300, "emphasized", "spring", 0.06),
    identity: timing(280, "emphasized", "spring", 0.04),
    title: timing(260, "emphasized", "spring", 0),
    crossfade: timing(200, "linear"),
    scaleFrom: 1,
    opacityFrom: 0,
  },
  detail: {
    surface: timing(300, "emphasized"),
    translationPx: 8,
    scaleFrom: 1,
    opacityFrom: 1,
  },
  selection: timing(300, "emphasized", "spring", 0.04),
};

function withProfile(
  profile: MotionProfile,
  changes: Partial<MotionProfile>,
): MotionProfile {
  return { ...profile, ...changes };
}

const CRISP_PROFILE = withProfile(CURRENT_MOTION_PROFILE, {
  speed: 1,
  component: {
    ...CURRENT_MOTION_PROFILE.component,
    enter: timing(170, "emphasized"),
    exit: timing(130, "accelerate"),
    translationPx: 5,
  },
  page: {
    ...CURRENT_MOTION_PROFILE.page,
    enter: timing(210, "emphasized"),
    exit: timing(130, "accelerate"),
    translationPx: 7,
  },
  shared: {
    ...CURRENT_MOTION_PROFILE.shared,
    artwork: timing(250, "emphasized", "spring", 0.03),
    identity: timing(250, "emphasized", "spring", 0.02),
    title: timing(250, "emphasized", "spring", 0),
    crossfade: timing(170, "linear"),
  },
});

const SOFT_PROFILE = withProfile(CURRENT_MOTION_PROFILE, {
  speed: 0.82,
  component: {
    ...CURRENT_MOTION_PROFILE.component,
    enter: timing(240, "standard"),
    exit: timing(180, "standard"),
    translationPx: 10,
    scaleFrom: 0.985,
  },
  page: {
    ...CURRENT_MOTION_PROFILE.page,
    enter: timing(280, "standard"),
    exit: timing(190, "standard"),
    translationPx: 14,
    scaleFrom: 0.992,
  },
  shared: {
    ...CURRENT_MOTION_PROFILE.shared,
    artwork: timing(560, "emphasized", "spring", 0.03),
    identity: timing(520, "emphasized", "spring", 0.02),
  },
});

const ELASTIC_PROFILE = withProfile(CURRENT_MOTION_PROFILE, {
  shared: {
    ...CURRENT_MOTION_PROFILE.shared,
    artwork: timing(620, "emphasized", "spring", 0.3),
    identity: timing(580, "emphasized", "spring", 0.22),
    title: timing(500, "emphasized", "spring", 0.12),
  },
  detail: {
    ...CURRENT_MOTION_PROFILE.detail,
    surface: timing(420, "emphasized", "spring", 0.12),
    scaleFrom: 0.97,
  },
  selection: timing(420, "emphasized", "spring", 0.2),
});

const CROSSFADE_PROFILE = withProfile(CURRENT_MOTION_PROFILE, {
  component: {
    ...CURRENT_MOTION_PROFILE.component,
    translationPx: 0,
    scaleFrom: 1,
  },
  page: {
    ...CURRENT_MOTION_PROFILE.page,
    mode: "crossfade",
    enter: timing(180, "linear"),
    exit: timing(140, "linear"),
    translationPx: 0,
  },
  shared: {
    ...CURRENT_MOTION_PROFILE.shared,
    choreography: "crossfade",
    artwork: timing(220, "linear"),
    identity: timing(220, "linear"),
    title: timing(180, "linear"),
  },
  detail: {
    ...CURRENT_MOTION_PROFILE.detail,
    translationPx: 0,
    opacityFrom: 0,
  },
});

export const BUILTIN_MOTION_PRESETS: readonly MotionPreset[] = [
  {
    id: "current",
    name: "Current",
    builtin: true,
    profile: CURRENT_MOTION_PROFILE,
  },
  { id: "crisp", name: "Crisp 250", builtin: true, profile: CRISP_PROFILE },
  { id: "soft", name: "Soft", builtin: true, profile: SOFT_PROFILE },
  { id: "elastic", name: "Elastic", builtin: true, profile: ELASTIC_PROFILE },
  {
    id: "crossfade-baseline",
    name: "Crossfade Baseline",
    builtin: true,
    profile: CROSSFADE_PROFILE,
  },
];

function isPrimitiveNumber<Value>(value: Value): value is Value & number {
  return (
    Object.prototype.toString.call(value) === "[object Number]" &&
    value === Number(value)
  );
}

function isPrimitiveString<Value>(value: Value): value is Value & string {
  return (
    Object.prototype.toString.call(value) === "[object String]" &&
    value === String(value)
  );
}

function hasPlainObjectTag<Value>(value: Value): value is Value & object {
  try {
    return Object.prototype.toString.call(value) === "[object Object]";
  } catch {
    return false;
  }
}

export function isPlainMotionObject<Value>(
  value: Value,
): value is Value & object {
  if (!hasPlainObjectTag(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseMotionWireString<Value>(
  value: Value,
): string | undefined {
  return isPrimitiveString(value) ? value : undefined;
}

function finiteNumber<Value>(
  value: Value,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  return isPrimitiveNumber(value) && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function stringChoice<const Choice extends string, Value>(
  value: Value,
  choices: readonly Choice[],
  fallback: Choice,
): Choice {
  if (!isPrimitiveString(value)) return fallback;
  const parsed: string = value;
  for (const choice of choices) {
    if (parsed === choice) return choice;
  }
  return fallback;
}

function validateTiming<Value>(
  value: Value,
  fallback: MotionTiming,
): MotionTiming {
  const input = isPlainMotionObject(value) ? value : undefined;
  const type = input && "type" in input ? input.type : undefined;
  const durationMs =
    input && "durationMs" in input ? input.durationMs : undefined;
  const bounce = input && "bounce" in input ? input.bounce : undefined;
  const ease = input && "ease" in input ? input.ease : undefined;
  return {
    type: stringChoice(type, ["tween", "spring"], fallback.type),
    durationMs: finiteNumber(durationMs, fallback.durationMs, 40, 4_000),
    bounce: finiteNumber(bounce, fallback.bounce, 0, 1),
    ease: stringChoice(
      ease,
      ["emphasized", "standard", "accelerate", "linear"],
      fallback.ease,
    ),
  };
}

function validateFeedbackSection<Value>(
  value: Value,
): MotionProfile["feedback"] {
  const input = isPlainMotionObject(value) ? value : undefined;
  const candidate =
    input && "feedback" in input ? input.feedback : undefined;
  const feedback = isPlainMotionObject(candidate) ? candidate : undefined;
  const timing = feedback && "timing" in feedback ? feedback.timing : undefined;
  return {
    timing: validateTiming(timing, CURRENT_MOTION_PROFILE.feedback.timing),
  };
}

function validateComponentSection<Value>(
  value: Value,
): MotionProfile["component"] {
  const input = isPlainMotionObject(value) ? value : undefined;
  const candidate =
    input && "component" in input ? input.component : undefined;
  const component = isPlainMotionObject(candidate) ? candidate : undefined;
  const enter = component && "enter" in component ? component.enter : undefined;
  const exit = component && "exit" in component ? component.exit : undefined;
  const translationPx =
    component && "translationPx" in component
      ? component.translationPx
      : undefined;
  const scaleFrom =
    component && "scaleFrom" in component ? component.scaleFrom : undefined;
  const opacityFrom =
    component && "opacityFrom" in component ? component.opacityFrom : undefined;
  return {
    enter: validateTiming(enter, CURRENT_MOTION_PROFILE.component.enter),
    exit: validateTiming(exit, CURRENT_MOTION_PROFILE.component.exit),
    translationPx: finiteNumber(
      translationPx,
      CURRENT_MOTION_PROFILE.component.translationPx,
      0,
      80,
    ),
    scaleFrom: finiteNumber(
      scaleFrom,
      CURRENT_MOTION_PROFILE.component.scaleFrom,
      0.5,
      1.5,
    ),
    opacityFrom: finiteNumber(
      opacityFrom,
      CURRENT_MOTION_PROFILE.component.opacityFrom,
      0,
      1,
    ),
  };
}

function validatePageSection<Value>(value: Value): MotionProfile["page"] {
  const input = isPlainMotionObject(value) ? value : undefined;
  const candidate = input && "page" in input ? input.page : undefined;
  const page = isPlainMotionObject(candidate) ? candidate : undefined;
  const mode = page && "mode" in page ? page.mode : undefined;
  const enter = page && "enter" in page ? page.enter : undefined;
  const exit = page && "exit" in page ? page.exit : undefined;
  const enterDelayMs =
    page && "enterDelayMs" in page ? page.enterDelayMs : undefined;
  const translationPx =
    page && "translationPx" in page ? page.translationPx : undefined;
  const scaleFrom = page && "scaleFrom" in page ? page.scaleFrom : undefined;
  const opacityFrom =
    page && "opacityFrom" in page ? page.opacityFrom : undefined;
  return {
    mode: stringChoice(
      mode,
      ["slide", "crossfade"],
      CURRENT_MOTION_PROFILE.page.mode,
    ),
    enter: validateTiming(enter, CURRENT_MOTION_PROFILE.page.enter),
    exit: validateTiming(exit, CURRENT_MOTION_PROFILE.page.exit),
    enterDelayMs: finiteNumber(
      enterDelayMs,
      CURRENT_MOTION_PROFILE.page.enterDelayMs,
      0,
      1_000,
    ),
    translationPx: finiteNumber(
      translationPx,
      CURRENT_MOTION_PROFILE.page.translationPx,
      0,
      120,
    ),
    scaleFrom: finiteNumber(
      scaleFrom,
      CURRENT_MOTION_PROFILE.page.scaleFrom,
      0.5,
      1.5,
    ),
    opacityFrom: finiteNumber(
      opacityFrom,
      CURRENT_MOTION_PROFILE.page.opacityFrom,
      0,
      1,
    ),
  };
}

function validateSharedSection<Value>(value: Value): MotionProfile["shared"] {
  const input = isPlainMotionObject(value) ? value : undefined;
  const candidate = input && "shared" in input ? input.shared : undefined;
  const shared = isPlainMotionObject(candidate) ? candidate : undefined;
  const choreography =
    shared && "choreography" in shared ? shared.choreography : undefined;
  const artwork =
    shared && "artwork" in shared ? shared.artwork : undefined;
  const identity =
    shared && "identity" in shared ? shared.identity : undefined;
  const title = shared && "title" in shared ? shared.title : undefined;
  const crossfade =
    shared && "crossfade" in shared ? shared.crossfade : undefined;
  const scaleFrom =
    shared && "scaleFrom" in shared ? shared.scaleFrom : undefined;
  const opacityFrom =
    shared && "opacityFrom" in shared ? shared.opacityFrom : undefined;
  return {
    choreography: stringChoice(
      choreography,
      ["morph", "crossfade"],
      CURRENT_MOTION_PROFILE.shared.choreography,
    ),
    artwork: validateTiming(artwork, CURRENT_MOTION_PROFILE.shared.artwork),
    identity: validateTiming(identity, CURRENT_MOTION_PROFILE.shared.identity),
    title: validateTiming(title, CURRENT_MOTION_PROFILE.shared.title),
    crossfade: validateTiming(
      crossfade,
      CURRENT_MOTION_PROFILE.shared.crossfade,
    ),
    scaleFrom: finiteNumber(
      scaleFrom,
      CURRENT_MOTION_PROFILE.shared.scaleFrom,
      0.5,
      1.5,
    ),
    opacityFrom: finiteNumber(
      opacityFrom,
      CURRENT_MOTION_PROFILE.shared.opacityFrom,
      0,
      1,
    ),
  };
}

function validateDetailSection<Value>(value: Value): MotionProfile["detail"] {
  const input = isPlainMotionObject(value) ? value : undefined;
  const candidate = input && "detail" in input ? input.detail : undefined;
  const detail = isPlainMotionObject(candidate) ? candidate : undefined;
  const surface = detail && "surface" in detail ? detail.surface : undefined;
  const translationPx =
    detail && "translationPx" in detail ? detail.translationPx : undefined;
  const scaleFrom =
    detail && "scaleFrom" in detail ? detail.scaleFrom : undefined;
  const opacityFrom =
    detail && "opacityFrom" in detail ? detail.opacityFrom : undefined;
  return {
    surface: validateTiming(surface, CURRENT_MOTION_PROFILE.detail.surface),
    translationPx: finiteNumber(
      translationPx,
      CURRENT_MOTION_PROFILE.detail.translationPx,
      0,
      120,
    ),
    scaleFrom: finiteNumber(
      scaleFrom,
      CURRENT_MOTION_PROFILE.detail.scaleFrom,
      0.5,
      1.5,
    ),
    opacityFrom: finiteNumber(
      opacityFrom,
      CURRENT_MOTION_PROFILE.detail.opacityFrom,
      0,
      1,
    ),
  };
}

export function validateMotionProfile<Value>(value: Value): MotionProfile {
  const input = isPlainMotionObject(value) ? value : undefined;
  const speed = input && "speed" in input ? input.speed : undefined;
  const selection =
    input && "selection" in input ? input.selection : undefined;
  return {
    version: MOTION_PROFILE_VERSION,
    speed: finiteNumber(speed, CURRENT_MOTION_PROFILE.speed, 0.1, 4),
    feedback: validateFeedbackSection(value),
    component: validateComponentSection(value),
    page: validatePageSection(value),
    shared: validateSharedSection(value),
    detail: validateDetailSection(value),
    selection: validateTiming(selection, CURRENT_MOTION_PROFILE.selection),
  };
}

export function cloneMotionProfile(profile: MotionProfile): MotionProfile {
  return validateMotionProfile(JSON.parse(JSON.stringify(profile)));
}

function resolveTiming(value: MotionTiming, speed: number): Transition {
  const duration = value.durationMs / speed / 1_000;
  if (value.type === "spring") {
    return { type: "spring", visualDuration: duration, bounce: value.bounce };
  }
  return { duration, ease: EASINGS[value.ease] };
}

function resolveViewTiming(
  value: MotionTiming,
  speed: number,
): ViewTransitionTiming {
  const duration = value.durationMs / speed / 1_000;
  if (value.type === "spring") {
    return { type: spring, visualDuration: duration, bounce: value.bounce };
  }
  return { duration, ease: EASINGS[value.ease] };
}

export function resolveMotionProfile(
  profile: MotionProfile,
): ResolvedMotionProfile {
  const validated = validateMotionProfile(profile);
  const { speed } = validated;
  const feedback = resolveTiming(validated.feedback.timing, speed);
  const componentEnter = resolveTiming(validated.component.enter, speed);
  const componentExit = resolveTiming(validated.component.exit, speed);
  const viewExit = resolveTiming(validated.page.exit, speed);
  const view = resolveTiming(validated.page.enter, speed);
  const viewEnter = {
    ...view,
    delay: validated.page.enterDelayMs / speed / 1_000,
  };
  const sharedArtwork = resolveTiming(validated.shared.artwork, speed);
  const detailArtwork =
    validated.shared.choreography === "crossfade"
      ? resolveTiming(validated.shared.crossfade, speed)
      : sharedArtwork;
  const detailIdentity =
    validated.shared.choreography === "crossfade"
      ? resolveTiming(validated.shared.crossfade, speed)
      : resolveTiming(validated.shared.identity, speed);
  const detailTitle =
    validated.shared.choreography === "crossfade"
      ? resolveTiming(validated.shared.crossfade, speed)
      : resolveTiming(validated.shared.title, speed);
  const detailIdentityFade = resolveTiming(validated.shared.crossfade, speed);
  const detailSurfaceEnter = resolveTiming(validated.detail.surface, speed);
  const selectionPill = resolveTiming(validated.selection, speed);
  const durations = [
    validated.feedback.timing.durationMs,
    validated.component.enter.durationMs,
    validated.component.exit.durationMs,
    validated.page.enter.durationMs + validated.page.enterDelayMs,
    validated.page.exit.durationMs,
    validated.shared.artwork.durationMs,
    validated.shared.identity.durationMs,
    validated.shared.title.durationMs,
    validated.shared.crossfade.durationMs,
    validated.detail.surface.durationMs,
    validated.selection.durationMs,
  ];
  return {
    profile: validated,
    feedback,
    componentEnter,
    componentExit,
    viewExit,
    view,
    viewEnter,
    sharedArtwork,
    detailArtwork,
    detailIdentity,
    detailTitle,
    detailIdentityFade,
    detailSurfaceEnter,
    gentleSpring: resolveTiming(
      { ...validated.feedback.timing, type: "spring", bounce: 0.08 },
      speed,
    ),
    selectionPill,
    viewTransition: {
      detailArtwork: resolveViewTiming(
        validated.shared.choreography === "crossfade"
          ? validated.shared.crossfade
          : validated.shared.artwork,
        speed,
      ),
      detailIdentity: resolveViewTiming(
        validated.shared.choreography === "crossfade"
          ? validated.shared.crossfade
          : validated.shared.identity,
        speed,
      ),
      detailTitle: resolveViewTiming(
        validated.shared.choreography === "crossfade"
          ? validated.shared.crossfade
          : validated.shared.title,
        speed,
      ),
    },
    configuredDurationMs: Math.max(...durations) / speed,
  };
}

export const codaMotion = resolveMotionProfile(CURRENT_MOTION_PROFILE);
