import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDevEnvironment,
  buildTauriOverride,
  parsePort,
  resolveDevIdentity,
} from "./dev-instance.mjs";

const baseConfig = {
  productName: "Coda",
  identifier: "com.coda.bandcamp",
  build: {
    beforeDevCommand: "npm run web:dev",
    devUrl: "http://127.0.0.1:1420",
  },
  app: {
    windows: [
      {
        label: "main",
        title: "Coda",
        minWidth: 760,
        visible: true,
      },
      {
        label: "mini-player",
        title: "Coda Mini Player",
        alwaysOnTop: true,
        visible: false,
      },
    ],
  },
};

test("builds an isolated Tauri identity without dropping window settings", () => {
  const identity = resolveDevIdentity({
    branch: "codex/shadcn-tailwind",
    portValue: "3421",
    worktreeName: "shadcn-tailwind",
  });
  const override = buildTauriOverride(baseConfig, identity);

  assert.deepEqual(identity, {
    displayName: "Coda Shadcn Tailwind",
    port: 3421,
    slug: "shadcn-tailwind",
  });
  assert.equal(
    override.identifier,
    "com.coda.bandcamp.dev.shadcn-tailwind",
  );
  assert.equal(override.build.devUrl, "http://127.0.0.1:3421");
  assert.equal(override.app.windows[0].title, "Coda Shadcn Tailwind");
  assert.equal(override.app.windows[0].minWidth, 760);
  assert.equal(
    override.app.windows[1].title,
    "Coda Shadcn Tailwind Mini Player",
  );
  assert.equal(override.app.windows[1].alwaysOnTop, true);
});

test("uses an explicit instance name and validates Grove's port", () => {
  assert.deepEqual(
    resolveDevIdentity({
      branch: "main",
      instanceOverride: "Chrome Review",
      portValue: "3381",
      worktreeName: "coda-bandcamp",
    }),
    {
      displayName: "Coda Chrome Review",
      port: 3381,
      slug: "chrome-review",
    },
  );
  assert.throws(() => parsePort(undefined), /grove start/i);
  assert.throws(() => parsePort("0"), /between 1 and 65535/);
  assert.throws(() => parsePort("65536"), /between 1 and 65535/);
  assert.throws(() => parsePort("abc"), /integer/);
});

test("builds the environment consumed by Vite and the macOS runner", () => {
  const environment = buildDevEnvironment(
    { EXISTING_VALUE: "kept" },
    {
      displayName: "Coda Main",
      port: 3381,
      slug: "main",
    },
  );

  assert.equal(environment.EXISTING_VALUE, "kept");
  assert.equal(environment.PORT, "3381");
  assert.equal(environment.VITE_CODA_APP_NAME, "Coda Main");
  assert.equal(environment.CODA_DEV_INSTANCE_SLUG, "main");
});

test("keeps credentials shared while giving macOS instances distinct processes", async () => {
  const rust = await readFile(
    new URL("../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  const runner = await readFile(
    new URL("../src-tauri/coda-dev-runner.sh", import.meta.url),
    "utf8",
  );

  assert.match(rust, /SERVICE_NAME: &str = "com\.coda\.bandcamp"/);
  assert.match(rust, /LASTFM_SERVICE_NAME: &str = "com\.coda\.lastfm"/);
  assert.match(runner, /--identifier com\.coda\.bandcamp\.dev/);
  assert.match(runner, /CODA_DEV_INSTANCE_SLUG/);
  assert.match(runner, /instance_executable/);
});
