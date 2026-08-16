import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("view transition CSS ownership", () => {
  it("keeps page transitions live and snapshots only detail identities", () => {
    expect(styles).not.toContain("view-transition-name: coda-page-content");
    expect(styles).not.toContain("view-transition-name: coda-album-title");
    expect(styles).not.toContain(
      "view-transition-name: coda-now-playing-title",
    );
    expect(styles).not.toContain(".coda-motion-");
  });

  it("keeps persistent queue and player chrome out of native snapshot groups", () => {
    expect(styles).not.toMatch(
      /view-transition-name:\s*coda-(?:queue|player)\s*;/,
    );
    expect(styles).not.toMatch(
      /::view-transition-(?:group|old|new)\(coda-(?:queue|player)\)/,
    );
  });

  it("uses the bounded album header only for the close snapshot", () => {
    expect(styles).toMatch(
      /html\.coda-transition--album-detail-close\s+\[data-coda-album-detail-surface\]\s*\{\s*view-transition-name:\s*none;/,
    );
    expect(styles).toMatch(
      /html\.coda-transition--album-detail-close\s+\[data-slot="app-shell-workspace"\]\[data-queue-open="false"\]\s+\[data-coda-album-detail-close-surface\]\s*\{[\s\S]*?contain:\s*paint;[\s\S]*?overflow:\s*clip;[\s\S]*?view-transition-name:\s*coda-detail-surface;/,
    );
    expect(
      styles.match(/\[data-coda-album-detail-close-surface\]/g),
    ).toHaveLength(1);
  });

  it("isolates every detail from the root snapshot and uses one surface group", () => {
    const rootIsolation = styles.match(
      /html:is\(([\s\S]*?)\)\s*\{\s*view-transition-name:\s*none;/,
    )?.[1];

    expect(rootIsolation).toContain(".coda-transition--album-detail");
    expect(rootIsolation).toContain(".coda-transition--album-detail-close");
    expect(rootIsolation).toContain(".coda-transition--now-playing-open");
    expect(rootIsolation).toContain(".coda-transition--now-playing-close");
    expect(styles).toContain("view-transition-name: coda-detail-surface");
  });

  it("visibly fades the non-shared detail surface in both directions", () => {
    expect(styles).toMatch(
      /::view-transition-old\(coda-detail-surface\)\s*\{\s*animation:\s*coda-detail-surface-out var\(--duration-coda-standard\)/,
    );
    expect(styles).toMatch(
      /@keyframes coda-detail-surface-in\s*\{\s*from\s*\{\s*opacity:\s*0;/,
    );
    expect(styles).toMatch(
      /@keyframes coda-detail-surface-out\s*\{\s*to\s*\{\s*opacity:\s*0;/,
    );
  });

  it("bounds detail snapshots and disables native pseudo crossfades", () => {
    expect(styles).toMatch(
      /html\.coda-view-transitioning[\s\S]*?\[data-coda-now-playing-detail-surface\][\s\S]*?contain:\s*paint;[\s\S]*?max-height:\s*100dvh;[\s\S]*?overflow:\s*clip;/,
    );
    expect(styles).toMatch(
      /::view-transition-old\(coda-detail-surface\),\s*::view-transition-new\(coda-detail-surface\)\s*\{\s*animation:\s*none;\s*mix-blend-mode:\s*normal;/,
    );
    expect(styles).toMatch(
      /::view-transition-old\(coda-playlist-identity\),\s*::view-transition-new\(coda-playlist-identity\)\s*\{[\s\S]*?animation:\s*none;[\s\S]*?mix-blend-mode:\s*normal;/,
    );
  });

  it("keeps live desktop controls clickable while snapshots animate", () => {
    expect(styles).toMatch(
      /::view-transition,\s*::view-transition-group\(\*\),\s*::view-transition-image-pair\(\*\),\s*::view-transition-old\(\*\),\s*::view-transition-new\(\*\)\s*\{\s*pointer-events:\s*none;\s*\}/,
    );
  });
});
