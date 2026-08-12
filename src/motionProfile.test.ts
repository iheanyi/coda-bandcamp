import { beforeEach, describe, expect, it } from "vitest";

import {
  BUILTIN_MOTION_PRESETS,
  CURRENT_MOTION_PROFILE,
  resolveMotionProfile,
  validateMotionProfile,
} from "./motionProfile";
import {
  duplicateMotionPreset,
  exportMotionProfile,
  getAllMotionPresets,
  getMotionProfileState,
  importMotionProfile,
  renameMotionPreset,
  resetMotionProfileStoreForTests,
  saveMotionPreset,
  selectMotionPreset,
  snapshotMotionProfile,
  updateMotionProfile,
} from "./motionProfileStore";

describe("Motion profiles", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMotionProfileStoreForTests();
  });

  it("ships the useful built-in baseline set", () => {
    expect(BUILTIN_MOTION_PRESETS.map((preset) => preset.name)).toEqual([
      "Current",
      "Crisp 250",
      "Soft",
      "Elastic",
      "Crossfade Baseline",
    ]);
  });

  it("bounds malformed values and resolves one speed-scaled profile", () => {
    const profile = validateMotionProfile({
      ...CURRENT_MOTION_PROFILE,
      speed: 0,
      page: {
        ...CURRENT_MOTION_PROFILE.page,
        translationPx: Number.POSITIVE_INFINITY,
        opacityFrom: -4,
        enter: {
          ...CURRENT_MOTION_PROFILE.page.enter,
          durationMs: 99_999,
          bounce: 9,
          ease: "not-an-ease",
        },
      },
    });
    expect(profile.speed).toBe(0.1);
    expect(profile.page.translationPx).toBe(
      CURRENT_MOTION_PROFILE.page.translationPx,
    );
    expect(profile.page.opacityFrom).toBe(0);
    expect(profile.page.enter).toMatchObject({
      durationMs: 4_000,
      bounce: 1,
      ease: CURRENT_MOTION_PROFILE.page.enter.ease,
    });

    const resolved = resolveMotionProfile({ ...profile, speed: 2 });
    expect(resolved.view.duration).toBe(2);
    expect(resolved.configuredDurationMs).toBe(2_007.5);
  });

  it("persists preset CRUD and safely imports or rejects JSON", () => {
    updateMotionProfile((profile) => ({ ...profile, speed: 0.5 }));
    const saved = saveMotionPreset("Inspection");
    expect(renameMotionPreset(saved.id, "Slow inspection")).toBe(true);
    const duplicate = duplicateMotionPreset(saved.id);
    expect(duplicate?.name).toContain("Copy");
    expect(
      getAllMotionPresets().filter((preset) => !preset.builtin),
    ).toHaveLength(2);
    expect(window.localStorage.getItem("coda.motion-lab.v1")).toContain(
      "Slow inspection",
    );

    expect(() => importMotionProfile("not json")).toThrow();
    expect(() => importMotionProfile("{}")).toThrow(
      "Invalid Coda Motion profile",
    );
    expect(importMotionProfile(exportMotionProfile()).speed).toBe(0.5);
  });

  it("keeps a transition snapshot immutable while the live profile changes", () => {
    selectMotionPreset("current");
    const active = snapshotMotionProfile();
    updateMotionProfile((profile) => ({
      ...profile,
      speed: 0.25,
      page: { ...profile.page, translationPx: 48 },
    }));

    expect(active.profile.speed).toBe(1);
    expect(active.profile.page.translationPx).toBe(10);
    expect(snapshotMotionProfile().profile).toMatchObject({
      speed: 0.25,
      page: { translationPx: 48 },
    });
    expect(getMotionProfileState().activePresetId).toBeNull();
  });

  it("rehydrates named built-ins from current definitions instead of stale serialized copies", () => {
    window.localStorage.setItem(
      "coda.motion-lab.v1",
      JSON.stringify({
        version: 1,
        activePresetId: "current",
        profile: { ...CURRENT_MOTION_PROFILE, speed: 0.2 },
        customPresets: [],
      }),
    );

    resetMotionProfileStoreForTests();

    expect(getMotionProfileState()).toMatchObject({
      activePresetId: "current",
      profile: { speed: CURRENT_MOTION_PROFILE.speed },
    });
  });
});
