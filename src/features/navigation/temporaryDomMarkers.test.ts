import { describe, expect, it, vi } from "vitest";

import {
  acquireTemporaryAttribute,
  acquireTemporaryClass,
  acquireTemporaryStyleProperty,
  combineMarkerReleases,
} from "./temporaryDomMarkers";

const sharedMarkerAttributes = [
  "data-coda-album-title-source",
  "data-coda-artist-name-return",
  "data-coda-discover-artwork-source",
  "data-coda-radio-title-source",
  "data-coda-playlist-identity-return",
] as const;

describe("temporary DOM marker leases", () => {
  it.each(sharedMarkerAttributes)(
    "keeps the newest %s lease when older cleanup settles first",
    (attribute) => {
      const element = document.createElement("span");
      element.setAttribute(attribute, "baseline");
      const releaseOlder = acquireTemporaryAttribute(
        element,
        attribute,
        "entity:older",
      );
      const releaseNewer = acquireTemporaryAttribute(
        element,
        attribute,
        "entity:newer",
      );

      releaseOlder();
      releaseOlder();
      expect(element).toHaveAttribute(attribute, "entity:newer");

      releaseNewer();
      expect(element).toHaveAttribute(attribute, "baseline");
    },
  );

  it("restores the prior lease when newer cleanup settles first", () => {
    const element = document.createElement("span");
    const releaseOlder = acquireTemporaryAttribute(
      element,
      "data-coda-radio-artwork-source",
      "show:older",
    );
    const releaseNewer = acquireTemporaryAttribute(
      element,
      "data-coda-radio-artwork-source",
      "show:newer",
    );

    releaseNewer();
    expect(element).toHaveAttribute(
      "data-coda-radio-artwork-source",
      "show:older",
    );
    releaseOlder();
    expect(element).not.toHaveAttribute("data-coda-radio-artwork-source");
  });

  it.each([
    {
      label: "removes the attribute",
      mutate: (element: HTMLElement, attribute: string) =>
        element.removeAttribute(attribute),
      expected: null,
    },
    {
      label: "replaces the attribute",
      mutate: (element: HTMLElement, attribute: string) =>
        element.setAttribute(attribute, "external"),
      expected: "external",
    },
  ])(
    "preserves an external writer that $label after an equal-value lease",
    ({ expected, mutate }) => {
      const attribute = "data-coda-artist-name-source";
      const element = document.createElement("span");
      element.setAttribute(attribute, "artist:same");
      const release = acquireTemporaryAttribute(
        element,
        attribute,
        "artist:same",
      );

      mutate(element, attribute);
      release();

      expect(element.getAttribute(attribute)).toBe(expected);
    },
  );

  it("does not revive an older attribute lease after external ownership takes over", () => {
    const attribute = "data-coda-album-title-source";
    const element = document.createElement("span");
    element.setAttribute(attribute, "baseline");
    const releaseOlder = acquireTemporaryAttribute(
      element,
      attribute,
      "entity:older",
    );
    const releaseNewer = acquireTemporaryAttribute(
      element,
      attribute,
      "entity:newer",
    );

    element.setAttribute(attribute, "external");
    releaseNewer();
    releaseOlder();

    expect(element).toHaveAttribute(attribute, "external");
  });

  it("keeps a reused class until every lease releases", () => {
    const element = document.createElement("span");
    const releaseFirst = acquireTemporaryClass(
      element,
      "coda-album-artwork-source",
    );
    const releaseSecond = acquireTemporaryClass(
      element,
      "coda-album-artwork-source",
    );

    releaseFirst();
    expect(element).toHaveClass("coda-album-artwork-source");
    releaseSecond();
    expect(element).not.toHaveClass("coda-album-artwork-source");
  });

  it("does not let an older transition erase a newer shared-element name", () => {
    const element = document.createElement("span");
    const releaseOlder = acquireTemporaryStyleProperty(
      element,
      "view-transition-name",
      "coda-album-artwork-identity",
    );
    const releaseNewer = acquireTemporaryStyleProperty(
      element,
      "view-transition-name",
      "coda-album-artwork-identity",
    );

    releaseOlder();
    expect(element.style.viewTransitionName).toBe(
      "coda-album-artwork-identity",
    );

    releaseNewer();
    expect(element.style.viewTransitionName).toBe("");
  });

  it("restores nested style ownership and preserves an external writer", () => {
    const element = document.createElement("span");
    element.style.setProperty("view-transition-name", "baseline");
    const releaseName = acquireTemporaryStyleProperty(
      element,
      "view-transition-name",
      "coda-artist-name-identity",
    );
    const releaseSuppression = acquireTemporaryStyleProperty(
      element,
      "view-transition-name",
      "none",
      "important",
    );

    releaseSuppression();
    expect(element.style.viewTransitionName).toBe("coda-artist-name-identity");
    releaseName();
    expect(element.style.viewTransitionName).toBe("baseline");

    const releaseTemporary = acquireTemporaryStyleProperty(
      element,
      "view-transition-name",
      "temporary",
    );
    element.style.setProperty("view-transition-name", "motion-owned");
    releaseTemporary();
    expect(element.style.viewTransitionName).toBe("motion-owned");
  });

  it("combines cleanup as an exactly-once release", () => {
    const first = vi.fn();
    const second = vi.fn();
    const release = combineMarkerReleases([first, second]);

    release();
    release();

    expect(second).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    expect(second.mock.invocationCallOrder[0]).toBeLessThan(
      first.mock.invocationCallOrder[0]!,
    );
  });
});
