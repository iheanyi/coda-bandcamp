export type PageViewTransitionKind =
  "page-forward" | "page-back" | "page-crossfade";

export type DetailTransitionMarker =
  | Readonly<{
      kind: "attribute";
      name: string;
      selector: `[${string}]`;
    }>
  | Readonly<{
      kind: "class";
      name: string;
      selector: `.${string}`;
    }>;

type DetailTransitionMarkerEndpoint = Readonly<{
  selectors?: readonly string[];
  shared?: DetailTransitionMarker;
  secondary?: DetailTransitionMarker;
}>;

export type DetailTransitionIdentifiedTarget = Readonly<{
  identityAttribute: string;
  selector: string;
  targetSelector?: string;
}>;

export type DetailTransitionFromOwnerTarget = Readonly<{
  fromOwner: true;
  selector: string;
}>;

export type DetailTransitionDomIdentityTarget =
  | DetailTransitionIdentifiedTarget
  | DetailTransitionFromOwnerTarget;

type DetailTransitionDomIdentityTrigger = Readonly<{
  identityAttribute: string;
  selector: string;
  slotAttribute?: string;
}>;

type DetailTransitionDomIdentityBase = Readonly<{
  secondary?: DetailTransitionDomIdentityTarget;
  shared: DetailTransitionDomIdentityTarget;
  trigger: DetailTransitionDomIdentityTrigger;
}>;

export type DetailTransitionDomIdentity =
  | (DetailTransitionDomIdentityBase &
      Readonly<{
        ownerIdentityAttribute: string;
        ownerSelector: string;
      }>)
  | (DetailTransitionDomIdentityBase &
      Readonly<{
        ownerSelector: string;
      }>)
  | DetailTransitionDomIdentityBase;

type MutableDomIdentityTarget<Attribute extends string> = {
  identityAttribute: Attribute;
  selector: `[${Attribute}]`;
  targetSelector?: string;
};

type MutableDomIdentityTrigger<Attribute extends string> = {
  identityAttribute: Attribute;
  selector: string;
  slotAttribute?: string;
};

type DetailTransitionDefinition = Readonly<{
  closeKind: string;
  destinationHeadingId: string;
  detailSelectors: readonly string[];
  domIdentity: DetailTransitionDomIdentity;
  markerEndpoints: Readonly<{
    return: DetailTransitionMarkerEndpoint;
    source: DetailTransitionMarkerEndpoint;
  }>;
  openKind: string;
  returnFocusFallsBackToHeading?: true;
  routeKey: string;
  sharedElementOwner: string;
  sharedReturnSlots?: readonly string[];
}>;

type DetailTransitionDescriptor<
  Definition extends DetailTransitionDefinition,
> = Readonly<
  Definition & {
    closeClassName: `coda-transition--${Definition["closeKind"]}`;
    openClassName: `coda-transition--${Definition["openKind"]}`;
    returnSelectors: readonly string[];
    sourceSelectors: readonly string[];
    transitionNames: readonly [
      Definition["sharedElementOwner"],
      "coda-detail-surface",
    ];
  }
>;

function detailTransitionClass<const Kind extends string>(
  kind: Kind,
): `coda-transition--${Kind}` {
  return `coda-transition--${kind}`;
}

function attributeMarker<const Name extends string>(
  name: Name,
): Readonly<{
  kind: "attribute";
  name: Name;
  selector: `[${Name}]`;
}> {
  return Object.freeze({
    kind: "attribute",
    name,
    selector: `[${name}]`,
  });
}

function classMarker<const Name extends string>(
  name: Name,
): Readonly<{
  kind: "class";
  name: Name;
  selector: `.${Name}`;
}> {
  return Object.freeze({
    kind: "class",
    name,
    selector: `.${name}`,
  });
}

function identifiedDomIdentityTarget<const Attribute extends string>(
  identityAttribute: Attribute,
  targetSelector?: string,
): DetailTransitionIdentifiedTarget {
  const target: MutableDomIdentityTarget<Attribute> = {
    identityAttribute,
    selector: `[${identityAttribute}]`,
  };
  if (targetSelector) target.targetSelector = targetSelector;
  return Object.freeze(target);
}

function fromOwnerDomIdentityTarget(
  selector: string,
): DetailTransitionFromOwnerTarget {
  return Object.freeze({ fromOwner: true, selector });
}

const domIdentityTarget = Object.assign(identifiedDomIdentityTarget, {
  fromOwner: fromOwnerDomIdentityTarget,
});

function domIdentityTrigger<const Attribute extends string>(
  identityAttribute: Attribute,
  slotAttribute?: string,
): DetailTransitionDomIdentityTrigger {
  const trigger: MutableDomIdentityTrigger<Attribute> = {
    identityAttribute,
    selector: `[${identityAttribute}]`,
  };
  if (slotAttribute) trigger.slotAttribute = slotAttribute;
  return Object.freeze(trigger);
}

function locatedDomIdentityTrigger<const Attribute extends string>(
  identityAttribute: Attribute,
  selector: string,
  slotAttribute?: string,
): DetailTransitionDomIdentityTrigger {
  const trigger: MutableDomIdentityTrigger<Attribute> = {
    identityAttribute,
    selector,
  };
  if (slotAttribute) trigger.slotAttribute = slotAttribute;
  return Object.freeze(trigger);
}

function markerEndpointSelectors(
  endpoint: DetailTransitionMarkerEndpoint,
): readonly string[] {
  if (endpoint.selectors) return Object.freeze([...endpoint.selectors]);
  return endpoint.shared
    ? Object.freeze([endpoint.shared.selector])
    : Object.freeze([]);
}

function defineDetailTransition<
  const Definition extends DetailTransitionDefinition,
>(definition: Definition): DetailTransitionDescriptor<Definition> {
  return Object.freeze({
    ...definition,
    closeClassName: detailTransitionClass<Definition["closeKind"]>(
      definition.closeKind,
    ),
    openClassName: detailTransitionClass<Definition["openKind"]>(
      definition.openKind,
    ),
    returnSelectors: markerEndpointSelectors(
      definition.markerEndpoints.return,
    ),
    sourceSelectors: markerEndpointSelectors(
      definition.markerEndpoints.source,
    ),
    transitionNames: Object.freeze([
      definition.sharedElementOwner,
      "coda-detail-surface",
    ] as const),
  });
}

export const DETAIL_TRANSITION_DESCRIPTORS = {
  album: defineDetailTransition({
    closeKind: "album-detail-close",
    destinationHeadingId: "album-detail-heading",
    detailSelectors: ["[data-coda-album-artwork-detail]"],
    domIdentity: {
      ownerIdentityAttribute: "data-album-card",
      ownerSelector: "[data-album-card]",
      secondary: domIdentityTarget(
        "data-coda-album-title-target",
        '[data-slot="overflow-marquee-text"]',
      ),
      shared: domIdentityTarget.fromOwner("[data-slot=cover]"),
      trigger: locatedDomIdentityTrigger(
        "data-album-open",
        "a[data-album-open]",
        "data-navigation-slot",
      ),
    },
    markerEndpoints: {
      return: {
        secondary: attributeMarker("data-coda-album-title-return"),
        shared: attributeMarker("data-coda-album-artwork-return"),
      },
      source: {
        secondary: attributeMarker("data-coda-album-title-source"),
        shared: classMarker("coda-album-artwork-source"),
      },
    },
    openKind: "album-detail",
    routeKey: "album-detail",
    sharedElementOwner: "coda-album-artwork",
  }),
  artist: defineDetailTransition({
    closeKind: "artist-detail-close",
    destinationHeadingId: "artist-detail-heading",
    detailSelectors: [
      "[data-coda-artist-artwork-detail][data-slot='cover']",
      "[data-coda-artist-artwork-detail] [data-slot='cover']",
    ],
    domIdentity: {
      ownerSelector:
        ":is([data-coda-artist-card], [data-album-card], [data-coda-album-detail-surface])",
      secondary: domIdentityTarget(
        "data-coda-artist-name-target",
        '[data-slot="overflow-marquee-text"]',
      ),
      shared: domIdentityTarget.fromOwner("[data-slot=cover]"),
      trigger: domIdentityTrigger("data-artist-open", "data-navigation-slot"),
    },
    markerEndpoints: {
      return: {
        secondary: attributeMarker("data-coda-artist-name-return"),
        shared: attributeMarker("data-coda-artist-artwork-return"),
      },
      source: {
        secondary: attributeMarker("data-coda-artist-name-source"),
        shared: attributeMarker("data-coda-artist-artwork-source"),
      },
    },
    openKind: "artist-detail",
    routeKey: "artist-detail",
    sharedElementOwner: "coda-artist-artwork",
  }),
  daily: defineDetailTransition({
    closeKind: "daily-detail-close",
    destinationHeadingId: "daily-article-heading",
    detailSelectors: ["[data-coda-daily-artwork-detail]"],
    domIdentity: {
      ownerSelector: "article",
      secondary: domIdentityTarget("data-daily-article-title"),
      shared: domIdentityTarget("data-daily-article-artwork"),
      trigger: domIdentityTrigger("data-daily-article-open"),
    },
    markerEndpoints: {
      return: {
        secondary: attributeMarker("data-coda-daily-title-return"),
        shared: attributeMarker("data-coda-daily-artwork-return"),
      },
      source: {
        secondary: attributeMarker("data-coda-daily-title-source"),
        shared: attributeMarker("data-coda-daily-artwork-source"),
      },
    },
    openKind: "daily-detail",
    routeKey: "daily-detail",
    sharedElementOwner: "coda-daily-artwork",
  }),
  "discover-release": defineDetailTransition({
    closeKind: "discover-detail-close",
    destinationHeadingId: "discover-release-heading",
    detailSelectors: ["[data-coda-discover-artwork-detail]"],
    domIdentity: {
      ownerIdentityAttribute: "data-discover-release-card",
      ownerSelector: "[data-discover-release-card]",
      secondary: domIdentityTarget("data-coda-discover-title"),
      shared: domIdentityTarget("data-coda-discover-artwork"),
      trigger: domIdentityTrigger(
        "data-coda-discover-artwork",
        "data-navigation-slot",
      ),
    },
    markerEndpoints: {
      return: {
        secondary: attributeMarker("data-coda-discover-title-return"),
        shared: attributeMarker("data-coda-discover-artwork-return"),
      },
      source: {
        secondary: attributeMarker("data-coda-discover-title-source"),
        shared: attributeMarker("data-coda-discover-artwork-source"),
      },
    },
    openKind: "discover-detail",
    returnFocusFallsBackToHeading: true,
    routeKey: "discover-detail",
    sharedElementOwner: "coda-discover-artwork",
    sharedReturnSlots: ["discover-artwork", "discover-title"],
  }),
  playlist: defineDetailTransition({
    closeKind: "playlist-detail-close",
    destinationHeadingId: "playlist-detail-heading",
    detailSelectors: ["[data-coda-playlist-identity-detail]"],
    domIdentity: {
      secondary: domIdentityTarget(
        "data-playlist-title",
        '[data-slot="overflow-marquee-text"]',
      ),
      shared: domIdentityTarget("data-playlist-identity"),
      trigger: domIdentityTrigger("data-playlist-open"),
    },
    markerEndpoints: {
      return: {
        secondary: attributeMarker("data-coda-playlist-title-return"),
        shared: attributeMarker("data-coda-playlist-identity-return"),
      },
      source: {
        secondary: attributeMarker("data-coda-playlist-title-source"),
        shared: attributeMarker("data-coda-playlist-identity-source"),
      },
    },
    openKind: "playlist-detail",
    routeKey: "playlist-detail",
    sharedElementOwner: "coda-playlist-identity",
  }),
  radio: defineDetailTransition({
    closeKind: "radio-detail-close",
    destinationHeadingId: "radio-detail-title",
    detailSelectors: ["[data-coda-radio-artwork-detail]"],
    domIdentity: {
      ownerSelector: "article",
      secondary: domIdentityTarget(
        "data-radio-show-title",
        ':is([data-slot="overflow-marquee-text"], [data-coda-radio-title-text])',
      ),
      shared: domIdentityTarget("data-radio-show-artwork"),
      trigger: domIdentityTrigger(
        "data-radio-show-open",
        "data-radio-show-navigation-slot",
      ),
    },
    markerEndpoints: {
      return: {
        secondary: attributeMarker("data-coda-radio-title-return"),
        shared: attributeMarker("data-coda-radio-artwork-return"),
      },
      source: {
        secondary: attributeMarker("data-coda-radio-title-source"),
        shared: attributeMarker("data-coda-radio-artwork-source"),
      },
    },
    openKind: "radio-detail",
    routeKey: "radio-detail",
    sharedElementOwner: "coda-radio-artwork",
  }),
  "now-playing": defineDetailTransition({
    closeKind: "now-playing-close",
    destinationHeadingId: "now-playing-heading",
    detailSelectors: [".now-playing__artwork"],
    domIdentity: {
      shared: domIdentityTarget("data-coda-track-id"),
      trigger: locatedDomIdentityTrigger(
        "data-coda-track-id",
        ".player__art-link[data-coda-track-id]",
      ),
    },
    markerEndpoints: {
      return: { selectors: [".player__art-link"] },
      source: { selectors: [".player__art-link"] },
    },
    openKind: "now-playing-open",
    returnFocusFallsBackToHeading: true,
    routeKey: "now-playing-detail",
    sharedElementOwner: "coda-now-playing-artwork",
  }),
} as const satisfies Record<
  string,
  ReturnType<typeof defineDetailTransition>
>;

export type DetailTransitionKey = keyof typeof DETAIL_TRANSITION_DESCRIPTORS;
type DetailTransitionDescriptorUnion =
  (typeof DETAIL_TRANSITION_DESCRIPTORS)[DetailTransitionKey];
export type DetailViewTransitionKind =
  | DetailTransitionDescriptorUnion["openKind"]
  | DetailTransitionDescriptorUnion["closeKind"];
export type CodaViewTransitionKind =
  DetailViewTransitionKind | PageViewTransitionKind;
export type CodaViewTransitionClassName =
  `coda-transition--${CodaViewTransitionKind}`;

export const PAGE_VIEW_TRANSITION_KINDS = [
  "page-forward",
  "page-back",
  "page-crossfade",
] as const satisfies readonly PageViewTransitionKind[];

export const ALL_CODA_VIEW_TRANSITION_KINDS = Object.freeze([
  ...Object.values(DETAIL_TRANSITION_DESCRIPTORS).flatMap((descriptor) => [
    descriptor.openKind,
    descriptor.closeKind,
  ]),
  ...PAGE_VIEW_TRANSITION_KINDS,
] satisfies CodaViewTransitionKind[]);

export const CODA_VIEW_TRANSITION_CLASSES = Object.freeze(
  [
    ...Object.values(DETAIL_TRANSITION_DESCRIPTORS).flatMap((descriptor) => [
      descriptor.openClassName,
      descriptor.closeClassName,
    ]),
    ...PAGE_VIEW_TRANSITION_KINDS.map(codaViewTransitionClass),
  ] satisfies CodaViewTransitionClassName[],
);

export type ResolvedDetailTransition = Readonly<{
  className: CodaViewTransitionClassName;
  destinationSelectors: readonly string[];
  direction: "open" | "close";
  kind: DetailViewTransitionKind;
  sharedOwner: string;
  sourceSelectors: readonly string[];
  transitionNames: readonly [string, "coda-detail-surface"];
}>;

export function codaViewTransitionClass(
  kind: CodaViewTransitionKind,
): CodaViewTransitionClassName {
  return `coda-transition--${kind}`;
}

export function resolveDetailTransition(
  kind: CodaViewTransitionKind,
): ResolvedDetailTransition | undefined {
  for (const descriptor of Object.values(DETAIL_TRANSITION_DESCRIPTORS)) {
    if (kind === descriptor.openKind) {
      return {
        className: descriptor.openClassName,
        destinationSelectors: descriptor.detailSelectors,
        direction: "open",
        kind: descriptor.openKind,
        sharedOwner: descriptor.sharedElementOwner,
        sourceSelectors: descriptor.sourceSelectors,
        transitionNames: descriptor.transitionNames,
      };
    }
    if (kind === descriptor.closeKind) {
      return {
        className: descriptor.closeClassName,
        destinationSelectors: descriptor.returnSelectors,
        direction: "close",
        kind: descriptor.closeKind,
        sharedOwner: descriptor.sharedElementOwner,
        sourceSelectors: descriptor.detailSelectors,
        transitionNames: descriptor.transitionNames,
      };
    }
  }
  return undefined;
}
