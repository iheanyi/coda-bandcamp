// @ts-expect-error Vitest runs this regression in Node; renderer types stay DOM-only.
import { readFileSync } from "node:fs";
// @ts-expect-error Vitest runs this regression in Node; renderer types stay DOM-only.
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const queueStyles = readFileSync(resolve("src/styles.css"), "utf8");

beforeEach(() => {
  const style = document.createElement("style");
  style.dataset.queueStyleTest = "true";
  style.textContent = queueStyles;
  document.head.append(style);
});

afterEach(() => {
  document.head.querySelector("[data-queue-style-test]")?.remove();
  document.body.replaceChildren();
});

describe("queue panel styling", () => {
  it("uses an opaque surface so artwork cannot bleed through the drawer", () => {
    const panel = document.createElement("aside");
    panel.className = "queue-panel queue-panel--open";
    document.body.append(panel);

    expect(getComputedStyle(panel).backgroundColor).toBe("rgb(21, 23, 25)");
  });

  it("bounds empty-state copy within the queue drawer", () => {
    const empty = document.createElement("div");
    empty.className = "queue-empty";
    const copy = document.createElement("span");
    copy.textContent =
      "Not sure what comes next? Let Coda pick from your collection.";
    empty.append(copy);
    document.body.append(empty);

    expect(getComputedStyle(copy).maxWidth).toBe("250px");
  });

  it("lets Now Playing metadata shrink before it reaches the drawer edge", () => {
    const row = document.createElement("div");
    row.className = "queue-now__main";
    const metadata = document.createElement("div");
    metadata.className = "queue-track__meta";
    row.append(metadata);
    document.body.append(row);

    expect(getComputedStyle(metadata).flexGrow).toBe("1");
  });

  it("aligns queue cards and drawer chrome to one horizontal gutter", () => {
    const header = document.createElement("div");
    header.className = "queue-panel__header";
    const nowPlaying = document.createElement("div");
    nowPlaying.className = "queue-now";
    const list = document.createElement("div");
    list.className = "queue-list";
    const empty = document.createElement("div");
    empty.className = "queue-empty";
    const footer = document.createElement("div");
    footer.className = "queue-panel__footer";
    list.append(empty);
    document.body.append(header, nowPlaying, list, footer);

    const gutter = Number.parseFloat(getComputedStyle(nowPlaying).marginLeft);
    const recommendationGutter =
      Number.parseFloat(getComputedStyle(list).paddingLeft) +
      Number.parseFloat(getComputedStyle(empty).paddingLeft);

    expect(recommendationGutter).toBe(gutter);
    expect(Number.parseFloat(getComputedStyle(header).paddingLeft)).toBe(gutter);
    expect(Number.parseFloat(getComputedStyle(footer).paddingLeft)).toBe(gutter);
  });

  it("forces long Now Playing titles to yield space inside the card", () => {
    const row = document.createElement("div");
    row.className = "queue-now__main";
    const metadata = document.createElement("div");
    metadata.className = "queue-track__meta";
    row.append(metadata);
    document.body.append(row);

    expect(getComputedStyle(metadata).flexBasis).toBe("0px");
    expect(getComputedStyle(metadata).overflow).toBe("hidden");
  });
});
