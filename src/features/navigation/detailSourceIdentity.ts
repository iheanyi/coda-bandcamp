import type {
  DetailTransitionEndpointTargets,
  DetailTransitionSource,
} from "@/detailNavigation";
import {
  DETAIL_TRANSITION_DESCRIPTORS,
  type DetailTransitionDomIdentity,
  type DetailTransitionDomIdentityTarget,
  type DetailTransitionKey,
} from "@/detailTransitionDescriptors";

export type PreparedDetailSource = DetailTransitionSource;

type MutablePreparedDetailSource = {
  identity: string;
  sharedIdentityAvailable: boolean;
  sourceTrigger?: HTMLElement;
  targets?: DetailTransitionEndpointTargets;
};

type MutableDetailTransitionEndpointTargets = {
  owner: HTMLElement;
  secondary?: HTMLElement;
  shared?: HTMLElement;
};

export function detailTransitionEndpointTargets(
  owner: HTMLElement,
  shared?: HTMLElement,
  secondary?: HTMLElement,
): DetailTransitionEndpointTargets {
  const targets: MutableDetailTransitionEndpointTargets = { owner };
  if (shared) targets.shared = shared;
  if (secondary) targets.secondary = secondary;
  return targets;
}

function preparedDetailSource(
  identity: string,
  sharedIdentityAvailable: boolean,
  sourceTrigger?: HTMLElement,
  targets?: DetailTransitionEndpointTargets,
): PreparedDetailSource {
  const prepared: MutablePreparedDetailSource = {
    identity,
    sharedIdentityAvailable,
  };
  if (sourceTrigger) prepared.sourceTrigger = sourceTrigger;
  if (targets) prepared.targets = targets;
  return Object.freeze(prepared);
}

function isFromOwnerTarget(
  target: DetailTransitionDomIdentityTarget,
): target is Extract<
  DetailTransitionDomIdentityTarget,
  Readonly<{ fromOwner: true }>
> {
  return "fromOwner" in target;
}

function matchingElement(
  owner: HTMLElement,
  target: DetailTransitionDomIdentityTarget,
  identity: string,
  ownerIdentityAttribute: string | undefined,
  locatedOwner: HTMLElement | undefined,
): HTMLElement | undefined {
  if (isFromOwnerTarget(target) && locatedOwner === undefined) return undefined;
  if (
    ownerIdentityAttribute !== undefined &&
    owner.getAttribute(ownerIdentityAttribute) !== identity
  ) {
    return undefined;
  }
  const candidates = [
    ...(owner.matches(target.selector) ? [owner] : []),
    ...owner.querySelectorAll<HTMLElement>(target.selector),
  ];
  if (isFromOwnerTarget(target)) return candidates[0];
  const identityElement = candidates.find(
    (candidate) =>
      candidate.getAttribute(target.identityAttribute) === identity,
  );
  if (!identityElement) return undefined;
  if (!target.targetSelector) return identityElement;
  return (
    identityElement.querySelector<HTMLElement>(target.targetSelector) ??
    identityElement
  );
}

function identityOwner(
  trigger: HTMLElement,
  definition: DetailTransitionDomIdentity,
): HTMLElement | undefined {
  const ownerSelector =
    "ownerSelector" in definition ? definition.ownerSelector : undefined;
  if (!ownerSelector) return trigger;
  return trigger.closest<HTMLElement>(ownerSelector) ?? undefined;
}

function triggerMatchesIdentity(
  trigger: HTMLElement | undefined,
  definition: DetailTransitionDomIdentity,
  identity: string,
): boolean {
  return Boolean(
    trigger?.matches(definition.trigger.selector) &&
      trigger.getAttribute(definition.trigger.identityAttribute) === identity,
  );
}

export function resolveDetailTransitionEndpointTargets(
  kind: DetailTransitionKey,
  trigger: HTMLElement,
  identity: string,
): DetailTransitionEndpointTargets {
  const definition = DETAIL_TRANSITION_DESCRIPTORS[kind].domIdentity;
  const locatedOwner = identityOwner(trigger, definition);
  const owner = locatedOwner ?? trigger;
  const ownerIdentityAttribute =
    "ownerIdentityAttribute" in definition
      ? definition.ownerIdentityAttribute
      : undefined;
  const secondaryTarget =
    "secondary" in definition ? definition.secondary : undefined;
  return detailTransitionEndpointTargets(
    owner,
    matchingElement(
      owner,
      definition.shared,
      identity,
      ownerIdentityAttribute,
      locatedOwner,
    ),
    secondaryTarget
      ? matchingElement(
          owner,
          secondaryTarget,
          identity,
          ownerIdentityAttribute,
          locatedOwner,
        )
      : undefined,
  );
}

export function findDetailTransitionTrigger(
  kind: DetailTransitionKey,
  identity: string,
  slot?: string,
): HTMLElement | undefined {
  const definition = DETAIL_TRANSITION_DESCRIPTORS[kind].domIdentity;
  const slotAttribute = definition.trigger.slotAttribute;
  return Array.from(
    document.querySelectorAll<HTMLElement>(definition.trigger.selector),
  ).find((candidate) => {
    if (
      candidate.getAttribute(definition.trigger.identityAttribute) !== identity
    ) {
      return false;
    }
    return (
      slot === undefined ||
      (slotAttribute !== undefined &&
        candidate.getAttribute(slotAttribute) === slot)
    );
  });
}

/**
 * Slot attributes persist on every previously clicked trigger, so a bare slot
 * query can land on another release's card. Only accept a candidate whose
 * identity is confirmed by the trigger attribute or the descriptor's owner
 * identity attribute.
 */
export function findSlottedDetailReturnTrigger(
  kind: DetailTransitionKey,
  identity: string,
  slot: string,
): HTMLElement | undefined {
  const definition = DETAIL_TRANSITION_DESCRIPTORS[kind].domIdentity;
  const slotAttribute = definition.trigger.slotAttribute;
  if (!slotAttribute) return undefined;
  const ownerIdentityAttribute =
    "ownerIdentityAttribute" in definition
      ? definition.ownerIdentityAttribute
      : undefined;
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[${slotAttribute}="${slot}"]`),
  ).find((candidate) => {
    if (triggerMatchesIdentity(candidate, definition, identity)) return true;
    if (ownerIdentityAttribute === undefined) return false;
    return (
      identityOwner(candidate, definition)?.getAttribute(
        ownerIdentityAttribute,
      ) === identity
    );
  });
}

function interactiveTrigger(
  trigger: HTMLElement | undefined,
): HTMLElement | undefined {
  return (
    trigger?.closest<HTMLElement>("a[href], button, [role=button]") ?? trigger
  );
}

function sourceBelongsToIdentity(
  kind: DetailTransitionKey,
  trigger: HTMLElement,
  identity: string,
): boolean {
  const definition = DETAIL_TRANSITION_DESCRIPTORS[kind].domIdentity;
  if (triggerMatchesIdentity(trigger, definition, identity)) return true;
  if (!(trigger instanceof HTMLAnchorElement)) return false;
  const owner = identityOwner(trigger, definition);
  if (!owner) return false;
  const ownerIdentityAttribute =
    "ownerIdentityAttribute" in definition
      ? definition.ownerIdentityAttribute
      : undefined;
  return ownerIdentityAttribute
    ? owner.getAttribute(ownerIdentityAttribute) === identity
    : true;
}

function rememberReturnTrigger(
  kind: DetailTransitionKey,
  trigger: HTMLElement,
): void {
  const slotAttribute =
    DETAIL_TRANSITION_DESCRIPTORS[kind].domIdentity.trigger.slotAttribute;
  if (!slotAttribute || trigger.getAttribute(slotAttribute)) return;
  trigger.setAttribute(
    slotAttribute,
    trigger.hasAttribute("data-player-album-link")
      ? "player-album"
      : "return-trigger",
  );
}

function assignSharedReturnSlot(
  kind: DetailTransitionKey,
  trigger: HTMLElement,
  targets: DetailTransitionEndpointTargets,
): void {
  const descriptor = DETAIL_TRANSITION_DESCRIPTORS[kind];
  const slotAttribute = descriptor.domIdentity.trigger.slotAttribute;
  const slots =
    "sharedReturnSlots" in descriptor ? descriptor.sharedReturnSlots : undefined;
  if (!slotAttribute || !slots?.length || trigger.getAttribute(slotAttribute)) {
    return;
  }
  if (targets.shared?.contains(trigger)) {
    trigger.setAttribute(slotAttribute, slots[0]);
    return;
  }
  const secondarySlot = slots[1] ?? slots[0];
  if (
    targets.secondary &&
    (trigger.contains(targets.secondary) ||
      targets.secondary.closest("a[href], button, [role=button]") === trigger)
  ) {
    trigger.setAttribute(slotAttribute, secondarySlot);
  }
}

export function prepareDetailSource(
  kind: DetailTransitionKey,
  identity: string,
  sharedIdentityAvailable: boolean,
  sourceCandidate?: HTMLElement,
): DetailTransitionSource {
  const requested = interactiveTrigger(
    sourceCandidate ??
      (kind === "now-playing"
        ? undefined
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined),
  );
  const trigger =
    kind === "now-playing"
      ? findDetailTransitionTrigger(kind, identity)
      : requested && sourceBelongsToIdentity(kind, requested, identity)
        ? requested
        : undefined;
  if (!trigger) {
    if (requested) rememberReturnTrigger(kind, requested);
    return preparedDetailSource(identity, false, requested);
  }
  const targets = resolveDetailTransitionEndpointTargets(
    kind,
    trigger,
    identity,
  );
  assignSharedReturnSlot(kind, trigger, targets);
  return preparedDetailSource(
    identity,
    Boolean(sharedIdentityAvailable && targets.shared),
    trigger,
    targets,
  );
}
