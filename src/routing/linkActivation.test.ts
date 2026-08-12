import { describe, expect, it, vi } from "vitest";
import {
  handleCodaLinkActivation,
  isUnmodifiedPrimaryActivation,
} from "./linkActivation";

function activation(overrides: Partial<{
  altKey: boolean;
  button: number;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}> = {}) {
  return {
    altKey: false,
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("Coda Link activation", () => {
  it("intercepts only an unmodified primary activation", () => {
    expect(isUnmodifiedPrimaryActivation(activation())).toBe(true);
    expect(isUnmodifiedPrimaryActivation(activation({ button: 1 }))).toBe(false);
    expect(isUnmodifiedPrimaryActivation(activation({ metaKey: true }))).toBe(false);
    expect(isUnmodifiedPrimaryActivation(activation({ ctrlKey: true }))).toBe(false);
    expect(isUnmodifiedPrimaryActivation(activation({ shiftKey: true }))).toBe(false);
    expect(isUnmodifiedPrimaryActivation(activation({ altKey: true }))).toBe(false);
    expect(
      isUnmodifiedPrimaryActivation(activation({ defaultPrevented: true })),
    ).toBe(false);
  });

  it("hands the anchor to the transition controller after preventing navigation", () => {
    const anchor = document.createElement("a");
    const preventDefault = vi.fn();
    const navigate = vi.fn();

    handleCodaLinkActivation(
      {
        ...activation(),
        currentTarget: anchor,
        preventDefault,
      },
      navigate,
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(anchor);
  });
});
