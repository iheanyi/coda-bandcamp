import type { CodaViewTransitionKind } from "./viewTransitions";

export type DetailTransitionKind = Extract<
  CodaViewTransitionKind,
  | "artist-detail"
  | "artist-detail-close"
  | "daily-detail"
  | "daily-detail-close"
  | "discover-detail"
  | "discover-detail-close"
  | "playlist-detail"
  | "playlist-detail-close"
  | "radio-detail"
  | "radio-detail-close"
>;

type DetailTransitionEndpoint = Readonly<{
  sourceSelector: string;
  sourceIdentityAttributes: readonly string[];
  destinationAttribute?: string;
  destinationSelector: string;
}>;

export type DetailTransitionDescriptor = Readonly<{
  kind: DetailTransitionKind;
  sharedKind: "artwork" | "identity";
  shared: DetailTransitionEndpoint;
  title: DetailTransitionEndpoint;
  detailSurfaceSelector?: string;
  diagnosticFallbackToTitle?: boolean;
  preserveSourceVisual?: boolean;
}>;

export type ResolvedDetailTransition = Readonly<{
  descriptor: DetailTransitionDescriptor;
  sharedSource: Element | null;
  sharedDestination: string;
  titleSource: Element | null;
  titleDestination: string;
  diagnosticSource: HTMLElement | null;
  diagnosticSourceCount: number;
  snapshotDestinations: readonly string[];
}>;

function endpoint(
  sourceSelector: string,
  destinationSelector: string,
  sourceIdentityAttributes: readonly string[] = [],
  destinationAttribute?: string,
): DetailTransitionEndpoint {
  return {
    sourceSelector,
    sourceIdentityAttributes,
    destinationAttribute,
    destinationSelector,
  };
}

const detailTransitionDescriptors: Record<
  DetailTransitionKind,
  DetailTransitionDescriptor
> = {
  "artist-detail": {
    kind: "artist-detail",
    sharedKind: "artwork",
    shared: endpoint(
      ":is([data-coda-artist-artwork-source] [data-slot='cover'], [data-coda-artist-artwork-source][data-slot='cover'])",
      ":is([data-coda-artist-artwork-detail][data-slot='cover'], [data-coda-artist-artwork-detail] [data-slot='cover'])",
    ),
    title: endpoint(
      "[data-coda-artist-name-source]",
      "[data-coda-artist-name-detail]",
    ),
    detailSurfaceSelector: "[data-coda-artist-detail-surface]",
    diagnosticFallbackToTitle: true,
  },
  "artist-detail-close": {
    kind: "artist-detail-close",
    sharedKind: "artwork",
    shared: endpoint(
      "[data-coda-artist-artwork-detail][data-slot='cover']",
      "[data-coda-artist-artwork-return]",
      ["data-coda-artist-artwork-detail"],
      "data-coda-artist-artwork-return",
    ),
    title: endpoint(
      "[data-coda-artist-name-detail]",
      "[data-coda-artist-name-return]",
      ["data-coda-artist-name-detail"],
      "data-coda-artist-name-return",
    ),
    diagnosticFallbackToTitle: true,
  },
  "daily-detail": {
    kind: "daily-detail",
    sharedKind: "artwork",
    shared: endpoint(
      "[data-coda-daily-artwork-source]",
      "[data-coda-daily-artwork-detail]",
      ["data-coda-daily-artwork-source"],
      "data-coda-daily-artwork-detail",
    ),
    title: endpoint(
      "[data-coda-daily-title-source]",
      "[data-coda-daily-title-detail]",
      ["data-coda-daily-title-source"],
      "data-coda-daily-title-detail",
    ),
    detailSurfaceSelector: "[data-coda-daily-detail-surface]",
  },
  "daily-detail-close": {
    kind: "daily-detail-close",
    sharedKind: "artwork",
    shared: endpoint(
      "[data-coda-daily-artwork-detail]",
      "[data-coda-daily-artwork-return]",
      ["data-coda-daily-artwork-detail"],
      "data-coda-daily-artwork-return",
    ),
    title: endpoint(
      "[data-coda-daily-title-detail]",
      "[data-coda-daily-title-return]",
      ["data-coda-daily-title-detail"],
      "data-coda-daily-title-return",
    ),
    preserveSourceVisual: true,
  },
  "discover-detail": {
    kind: "discover-detail",
    sharedKind: "artwork",
    shared: endpoint(
      "[data-coda-discover-artwork-source]",
      "[data-coda-discover-artwork-detail]",
      ["data-coda-discover-artwork-source", "data-coda-discover-artwork"],
      "data-coda-discover-artwork-detail",
    ),
    title: endpoint(
      "[data-coda-discover-title-source]",
      "[data-coda-discover-title-detail]",
      ["data-coda-discover-title-source", "data-coda-discover-title"],
      "data-coda-discover-title-detail",
    ),
    detailSurfaceSelector: "[data-coda-discover-detail-surface]",
  },
  "discover-detail-close": {
    kind: "discover-detail-close",
    sharedKind: "artwork",
    shared: endpoint(
      "[data-coda-discover-artwork-detail]",
      "[data-coda-discover-artwork-return]",
      ["data-coda-discover-artwork-detail"],
      "data-coda-discover-artwork-return",
    ),
    title: endpoint(
      "[data-coda-discover-title-detail]",
      "[data-coda-discover-title-return]",
      ["data-coda-discover-title-detail"],
      "data-coda-discover-title-return",
    ),
  },
  "radio-detail": {
    kind: "radio-detail",
    sharedKind: "artwork",
    shared: endpoint(
      "[data-coda-radio-artwork-source]",
      "[data-coda-radio-artwork-detail]",
      ["data-coda-radio-artwork-source"],
      "data-coda-radio-artwork-detail",
    ),
    title: endpoint(
      "[data-coda-radio-title-source]",
      "[data-coda-radio-title-detail]",
      ["data-coda-radio-title-source"],
      "data-coda-radio-title-detail",
    ),
    detailSurfaceSelector: "[data-coda-radio-detail-surface]",
  },
  "radio-detail-close": {
    kind: "radio-detail-close",
    sharedKind: "artwork",
    shared: endpoint(
      "[data-coda-radio-artwork-detail]",
      "[data-coda-radio-artwork-return]",
      ["data-coda-radio-artwork-detail"],
      "data-coda-radio-artwork-return",
    ),
    title: endpoint(
      "[data-coda-radio-title-detail]",
      "[data-coda-radio-title-return]",
      ["data-coda-radio-title-detail"],
      "data-coda-radio-title-return",
    ),
  },
  "playlist-detail": {
    kind: "playlist-detail",
    sharedKind: "identity",
    shared: endpoint(
      "[data-coda-playlist-identity-source]",
      "[data-coda-playlist-identity-detail]",
      ["data-coda-playlist-identity-source"],
      "data-coda-playlist-identity-detail",
    ),
    title: endpoint(
      "[data-coda-playlist-title-source]",
      "[data-coda-playlist-title-detail]",
      ["data-coda-playlist-title-source"],
      "data-coda-playlist-title-detail",
    ),
    detailSurfaceSelector: "[data-coda-playlist-detail-surface]",
  },
  "playlist-detail-close": {
    kind: "playlist-detail-close",
    sharedKind: "identity",
    shared: endpoint(
      "[data-coda-playlist-identity-detail]",
      "[data-coda-playlist-identity-return]",
      ["data-coda-playlist-identity-detail"],
      "data-coda-playlist-identity-return",
    ),
    title: endpoint(
      "[data-coda-playlist-title-detail]",
      "[data-coda-playlist-title-return]",
      ["data-coda-playlist-title-detail"],
      "data-coda-playlist-title-return",
    ),
  },
};

function cssAttributeValue(value: string) {
  let escaped = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === '"' || character === "\\") {
      escaped += `\\${character}`;
    } else if (codePoint === 0) {
      escaped += "\\fffd ";
    } else if (codePoint < 0x20 || codePoint === 0x7f) {
      escaped += `\\${codePoint.toString(16)} `;
    } else {
      escaped += character;
    }
  }
  return escaped;
}

function destinationFor(
  endpoint: DetailTransitionEndpoint,
  source: Element | null,
) {
  if (!source || endpoint.sourceIdentityAttributes.length === 0) {
    return endpoint.destinationSelector;
  }
  for (const attribute of endpoint.sourceIdentityAttributes) {
    const identity = source.getAttribute(attribute);
    if (identity && endpoint.destinationAttribute) {
      return `[${endpoint.destinationAttribute}="${cssAttributeValue(identity)}"]`;
    }
  }
  return endpoint.destinationSelector;
}

export function getDetailTransitionDescriptor(
  kind: CodaViewTransitionKind,
): DetailTransitionDescriptor | undefined {
  return detailTransitionDescriptors[kind as DetailTransitionKind];
}

export function resolveDetailTransition(
  kind: CodaViewTransitionKind,
  root: ParentNode = document,
): ResolvedDetailTransition | undefined {
  const descriptor = getDetailTransitionDescriptor(kind);
  if (!descriptor) return undefined;

  const sharedSource = root.querySelector(descriptor.shared.sourceSelector);
  const titleSource = root.querySelector(descriptor.title.sourceSelector);
  const diagnosticEndpoint =
    sharedSource || !descriptor.diagnosticFallbackToTitle
      ? descriptor.shared
      : descriptor.title;
  const diagnosticSource = (sharedSource ??
    (descriptor.diagnosticFallbackToTitle
      ? titleSource
      : null)) as HTMLElement | null;
  const diagnosticSourceCount = diagnosticSource
    ? root.querySelectorAll(diagnosticEndpoint.sourceSelector).length
    : 0;
  const sharedDestination = destinationFor(descriptor.shared, sharedSource);
  const titleDestination = destinationFor(descriptor.title, titleSource);

  return {
    descriptor,
    sharedSource,
    sharedDestination,
    titleSource,
    titleDestination,
    diagnosticSource,
    diagnosticSourceCount,
    snapshotDestinations: diagnosticSource
      ? [
          diagnosticEndpoint === descriptor.shared
            ? sharedDestination
            : titleDestination,
        ]
      : [],
  };
}
