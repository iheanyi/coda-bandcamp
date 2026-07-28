import { expect, test } from "vitest";

import {
  findMissingLocalBuildVariables,
  requiredLocalBuildVariables,
} from "./local-desktop-build.mjs";

test("accepts every credential required for a signed Last.fm-enabled build", () => {
  const environment = Object.fromEntries(
    requiredLocalBuildVariables.map((name) => [name, `fixture-${name}`]),
  );

  expect(findMissingLocalBuildVariables(environment)).toEqual([]);
});

test("reports missing or blank credentials by name without exposing values", () => {
  const environment = {
    CODA_LASTFM_API_KEY: "fixture-api-key",
    CODA_LASTFM_SHARED_SECRET: " ",
    TAURI_SIGNING_PRIVATE_KEY: "",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "fixture-private-password",
  };

  const missing = findMissingLocalBuildVariables(environment);

  expect(missing).toEqual([
    "CODA_LASTFM_SHARED_SECRET",
    "TAURI_SIGNING_PRIVATE_KEY",
  ]);
  expect(missing.join("\n")).not.toContain("fixture");
});
