import { describe, expect, it } from "vitest";

import { applyDomEdits } from "./domSnapshot";

describe("applyDomEdits", () => {
  it("restores attributes, classes, and styles exactly once", () => {
    const element = document.createElement("span");
    element.setAttribute("data-temporary-artwork", "baseline");
    element.classList.add("kept");
    element.style.setProperty("content-visibility", "auto");

    const restore = applyDomEdits([
      {
        element,
        kind: "attribute",
        name: "data-temporary-artwork",
        value: "show:active",
      },
      { className: "coda-album-artwork-source", element, kind: "class" },
      {
        element,
        kind: "style",
        name: "content-visibility",
        value: "visible",
      },
    ]);

    expect(element).toHaveAttribute("data-temporary-artwork", "show:active");
    expect(element).toHaveClass("coda-album-artwork-source");
    expect(element.style.getPropertyValue("content-visibility")).toBe("visible");

    restore();
    restore();
    expect(element).toHaveAttribute("data-temporary-artwork", "baseline");
    expect(element).toHaveClass("kept");
    expect(element).not.toHaveClass("coda-album-artwork-source");
    expect(element.style.getPropertyValue("content-visibility")).toBe("auto");
  });

  it("removes an attribute that had no baseline", () => {
    const element = document.createElement("span");
    const restore = applyDomEdits([
      {
        element,
        kind: "attribute",
        name: "data-coda-album-title-source",
        value: "album-1",
      },
    ]);
    expect(element).toHaveAttribute("data-coda-album-title-source", "album-1");
    restore();
    expect(element).not.toHaveAttribute("data-coda-album-title-source");
  });

  it("restores an important style priority", () => {
    const element = document.createElement("div");
    element.style.setProperty("opacity", "0.5", "important");
    const restore = applyDomEdits([
      {
        element,
        kind: "style",
        name: "opacity",
        priority: "important",
        value: "1",
      },
    ]);
    expect(element.style.getPropertyValue("opacity")).toBe("1");
    restore();
    expect(element.style.getPropertyValue("opacity")).toBe("0.5");
    expect(element.style.getPropertyPriority("opacity")).toBe("important");
  });
});
