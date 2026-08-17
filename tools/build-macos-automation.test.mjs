import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertNoAutomationBuildArguments,
  assertSafeAutomationConfig,
  AUTOMATION_APP_IDENTIFIER,
  AUTOMATION_APP_NAME,
  createAutomationBuildEnvironment,
  expectedDesignatedRequirement,
  parseCodeSigningIdentities,
  redactCertificateHash,
  selectCodeSigningIdentity,
} from "./build-macos-automation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIRST_CERTIFICATE = "A".repeat(40);
const SECOND_CERTIFICATE = "B".repeat(40);

test("selects an exact, unique automation signing identity", () => {
  const output = [
    `  1) ${FIRST_CERTIFICATE} "Coda Local Development"`,
    `  2) ${SECOND_CERTIFICATE} "Another Identity"`,
    "     2 valid identities found",
  ].join("\n");

  assert.deepEqual(parseCodeSigningIdentities(output), [
    {
      certificateHash: FIRST_CERTIFICATE,
      name: "Coda Local Development",
    },
    { certificateHash: SECOND_CERTIFICATE, name: "Another Identity" },
  ]);
  assert.deepEqual(
    selectCodeSigningIdentity(output, "Coda Local Development"),
    {
      certificateHash: FIRST_CERTIFICATE,
      name: "Coda Local Development",
    },
  );
});

test("fails clearly when the requested signing identity is missing", () => {
  assert.throws(
    () => selectCodeSigningIdentity("0 valid identities found", "Missing Identity"),
    /could not find the requested macOS code-signing identity "Missing Identity"/u,
  );
});

test("rejects ambiguous and invalid signing identity selections", () => {
  const duplicateOutput = [
    `  1) ${FIRST_CERTIFICATE} "Duplicate Identity"`,
    `  2) ${SECOND_CERTIFICATE} "Duplicate Identity"`,
  ].join("\n");
  assert.throws(
    () => selectCodeSigningIdentity(duplicateOutput, "Duplicate Identity"),
    /more than one macOS code-signing identity/u,
  );
  assert.throws(
    () => selectCodeSigningIdentity(duplicateOutput, ""),
    /must name one macOS code-signing identity/u,
  );
});

test("constructs a stable requirement from the dev identifier and certificate", () => {
  const first = expectedDesignatedRequirement(
    AUTOMATION_APP_IDENTIFIER,
    FIRST_CERTIFICATE,
  );
  const second = expectedDesignatedRequirement(
    AUTOMATION_APP_IDENTIFIER,
    FIRST_CERTIFICATE,
  );
  assert.equal(first, second);
  assert.match(first, /identifier "com\.coda\.bandcamp\.dev"/u);
  assert.throws(
    () => expectedDesignatedRequirement("com.coda.bandcamp", FIRST_CERTIFICATE),
    /cannot construct a safe automation signing requirement/u,
  );
});

test("redacts the exact certificate hash from build output", () => {
  assert.equal(
    redactCertificateHash(
      `Signing with identity "${FIRST_CERTIFICATE}"`,
      FIRST_CERTIFICATE,
    ),
    'Signing with identity "[selected certificate]"',
  );
});

test("keeps automation builds on the isolated non-updating app profile", () => {
  const config = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "src-tauri/tauri.dev.conf.json"),
      "utf8",
    ),
  );
  const devCapability = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "src-tauri/capabilities/dev.json"),
      "utf8",
    ),
  );
  assert.doesNotThrow(() =>
    assertSafeAutomationConfig(config, devCapability),
  );
  assert.equal(config.productName, AUTOMATION_APP_NAME);
  assert.equal(config.identifier, AUTOMATION_APP_IDENTIFIER);
  assert.equal(config.plugins.updater, null);
  assert.deepEqual(config.app.security.capabilities, ["dev"]);
  assert.equal(
    devCapability.permissions.some(
      (permission) =>
        String(permission?.identifier ?? permission).startsWith("updater:"),
    ),
    false,
  );

  const updaterConfigured = structuredClone(config);
  updaterConfigured.plugins.updater = { endpoints: ["https://example.com"] };
  assert.throws(
    () => assertSafeAutomationConfig(updaterConfigured, devCapability),
    /without updater configuration, permissions, or artifacts/u,
  );

  const updaterPermitted = structuredClone(devCapability);
  updaterPermitted.permissions.push("updater:default");
  assert.throws(
    () => assertSafeAutomationConfig(config, updaterPermitted),
    /without updater configuration, permissions, or artifacts/u,
  );
});

test("strips release updater credentials and disables renderer updates", () => {
  const environment = createAutomationBuildEnvironment(
    {
      APPLE_CERTIFICATE: "release-certificate",
      APPLE_CERTIFICATE_PASSWORD: "release-certificate-password",
      APPLE_ID: "release-account",
      APPLE_PROVIDER_SHORT_NAME: "release-provider",
      APPLE_SIGNING_IDENTITY: "release-identity",
      CARGO_BUILD_TARGET: "custom-target",
      CARGO_BUILD_TARGET_DIR: "/custom/build-target",
      CARGO_TARGET_DIR: "/custom/target",
      TAURI_CONFIG: JSON.stringify({ identifier: "com.example.override" }),
      TAURI_KEY_PASSWORD: "legacy-key-password",
      TAURI_PRIVATE_KEY: "legacy-private-key",
      TAURI_PRIVATE_KEY_PASSWORD: "legacy-private-key-password",
      TAURI_PRIVATE_KEY_PATH: "/release/legacy-private-key",
      TAURI_SIGNING_PRIVATE_KEY: "private-updater-key",
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "private-updater-password",
      TAURI_SIGNING_PRIVATE_KEY_PATH: "/release/private-key",
      UNRELATED: "preserved",
      VITE_CODA_UPDATER_ENABLED: "1",
    },
    FIRST_CERTIFICATE,
  );

  assert.equal(environment.APPLE_SIGNING_IDENTITY, FIRST_CERTIFICATE);
  assert.equal(environment.VITE_CODA_UPDATER_ENABLED, "0");
  assert.equal(environment.UNRELATED, "preserved");
  for (const key of Object.keys(environment)) {
    if (key === "APPLE_SIGNING_IDENTITY") continue;
    assert.equal(key.startsWith("APPLE_"), false);
    assert.equal(key.startsWith("TAURI_"), false);
  }
  assert.equal("CARGO_BUILD_TARGET" in environment, false);
  assert.equal("CARGO_BUILD_TARGET_DIR" in environment, false);
  assert.equal("CARGO_TARGET_DIR" in environment, false);
});

test("rejects unsupported automation build and target arguments", () => {
  assert.doesNotThrow(() => assertNoAutomationBuildArguments([]));
  assert.throws(
    () => assertNoAutomationBuildArguments(["--target", "aarch64-apple-darwin"]),
    /does not accept extra arguments or target overrides/u,
  );
});

test("preserves the production updater profile", () => {
  const config = JSON.parse(
    readFileSync(resolve(repositoryRoot, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const defaultCapability = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "src-tauri/capabilities/default.json"),
      "utf8",
    ),
  );

  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.deepEqual(config.app.security.capabilities, ["default"]);
  assert.deepEqual(config.plugins.updater.endpoints, [
    "https://github.com/iheanyi/coda-bandcamp/releases/latest/download/latest.json",
  ]);
  assert.equal(defaultCapability.permissions.includes("updater:default"), true);
});
