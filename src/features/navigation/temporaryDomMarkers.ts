export type MarkerRelease = () => void;

type TemporaryClassState = {
  baseline: boolean;
  leases: Set<symbol>;
};

type TemporaryAttributeState = {
  baseline: string | null;
  leases: Array<Readonly<{ token: symbol; value: string }>>;
};

type TemporaryStylePropertyValue = Readonly<{
  priority: string;
  value: string;
}>;

type TemporaryStylePropertyState = {
  baseline: TemporaryStylePropertyValue;
  leases: Array<
    Readonly<
      {
        observedPriority: string;
        token: symbol;
      } & TemporaryStylePropertyValue
    >
  >;
};

const temporaryClassStates = new WeakMap<
  HTMLElement,
  Map<string, TemporaryClassState>
>();
const temporaryAttributeStates = new WeakMap<
  HTMLElement,
  Map<string, TemporaryAttributeState>
>();
const temporaryStylePropertyStates = new WeakMap<
  HTMLElement,
  Map<string, TemporaryStylePropertyState>
>();

function writeStyleProperty(
  element: HTMLElement,
  name: string,
  value: string,
  priority: string,
) {
  // Clear the old declaration first. Besides making priority replacement
  // explicit, this avoids WebKit/jsdom retaining an older !important flag
  // when a nested lease restores a normal-priority value.
  element.style.removeProperty(name);
  if (value) element.style.setProperty(name, value, priority);
}

export function combineMarkerReleases(
  releases: readonly MarkerRelease[],
): MarkerRelease {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (let index = releases.length - 1; index >= 0; index -= 1) {
      releases[index]?.();
    }
  };
}

export function acquireTemporaryClass(
  element: HTMLElement,
  className: string,
): MarkerRelease {
  let elementStates = temporaryClassStates.get(element);
  if (!elementStates) {
    elementStates = new Map();
    temporaryClassStates.set(element, elementStates);
  }
  let state = elementStates.get(className);
  if (!state) {
    state = {
      baseline: element.classList.contains(className),
      leases: new Set(),
    };
    elementStates.set(className, state);
  }
  const token = Symbol(className);
  state.leases.add(token);
  element.classList.add(className);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.leases.delete(token);
    if (state.leases.size) return;
    elementStates.delete(className);
    if (!state.baseline) element.classList.remove(className);
  };
}

export function acquireTemporaryAttribute(
  element: HTMLElement,
  name: string,
  value: string,
): MarkerRelease {
  let elementStates = temporaryAttributeStates.get(element);
  if (!elementStates) {
    elementStates = new Map();
    temporaryAttributeStates.set(element, elementStates);
  }
  let state = elementStates.get(name);
  if (!state) {
    state = {
      baseline: element.getAttribute(name),
      leases: [],
    };
    elementStates.set(name, state);
  }
  const token = Symbol(name);
  state.leases.push({ token, value });
  element.setAttribute(name, value);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = state.leases.findIndex((lease) => lease.token === token);
    if (index < 0) return;
    const wasActive = index === state.leases.length - 1;
    state.leases.splice(index, 1);
    if (!wasActive) return;
    const stillOwnsAttribute = element.getAttribute(name) === value;
    const next = state.leases.at(-1);
    if (next) {
      if (stillOwnsAttribute) element.setAttribute(name, next.value);
      return;
    }
    elementStates.delete(name);
    if (!stillOwnsAttribute) return;
    if (state.baseline === null) element.removeAttribute(name);
    else element.setAttribute(name, state.baseline);
  };
}

export function acquireTemporaryStyleProperty(
  element: HTMLElement,
  name: string,
  value: string,
  priority = "",
): MarkerRelease {
  let elementStates = temporaryStylePropertyStates.get(element);
  if (!elementStates) {
    elementStates = new Map();
    temporaryStylePropertyStates.set(element, elementStates);
  }
  let state = elementStates.get(name);
  if (!state) {
    state = {
      baseline: {
        value: element.style.getPropertyValue(name),
        priority: element.style.getPropertyPriority(name),
      },
      leases: [],
    };
    elementStates.set(name, state);
  }
  const token = Symbol(name);
  writeStyleProperty(element, name, value, priority);
  // Some test/browser CSSOMs accept an unknown property but drop its priority.
  // Compare against what the CSSOM actually committed, not what was requested.
  const lease = {
    token,
    value,
    priority,
    observedPriority: element.style.getPropertyPriority(name),
  };
  state.leases.push(lease);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = state.leases.findIndex(
      (candidate) => candidate.token === token,
    );
    if (index < 0) return;
    const wasActive = index === state.leases.length - 1;
    state.leases.splice(index, 1);
    if (!wasActive) return;

    const stillOwnsProperty =
      element.style.getPropertyValue(name) === lease.value &&
      element.style.getPropertyPriority(name) === lease.observedPriority;
    const next = state.leases.at(-1);
    if (next) {
      if (stillOwnsProperty) {
        writeStyleProperty(element, name, next.value, next.priority);
      }
      return;
    }

    elementStates.delete(name);
    if (!stillOwnsProperty) return;
    writeStyleProperty(
      element,
      name,
      state.baseline.value,
      state.baseline.priority,
    );
  };
}
