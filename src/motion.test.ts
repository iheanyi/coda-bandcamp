import { describe, expect, it } from "vitest";
import { codaMotion } from "./motion";

describe("Coda motion presets", () => {
  it("keeps routine choreography inside the existing timing budget", () => {
    expect(codaMotion.feedback.duration).toBeLessThanOrEqual(0.14);
    expect(codaMotion.componentEnter.duration).toBeLessThanOrEqual(0.18);
    expect(codaMotion.componentExit.duration).toBeLessThanOrEqual(0.14);
    expect(codaMotion.view.duration).toBeLessThanOrEqual(0.22);
    expect(codaMotion.sharedArtwork.duration).toBeLessThanOrEqual(0.44);
  });

  it("uses a restrained spring without decorative overshoot", () => {
    expect(codaMotion.gentleSpring).toMatchObject({
      type: "spring",
      visualDuration: 0.22,
      bounce: 0.08,
    });
  });
});
