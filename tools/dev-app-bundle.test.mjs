import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("uses an isolated Tauri identity for the bundled development app", async () => {
  const productionConfig = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "src-tauri", "tauri.conf.json"),
      "utf8",
    ),
  );
  const developmentConfig = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "src-tauri", "tauri.dev.conf.json"),
      "utf8",
    ),
  );

  expect(developmentConfig.productName).toBe("Coda Dev");
  expect(developmentConfig.identifier).toBe("com.coda.bandcamp.dev");
  expect(developmentConfig.identifier).not.toBe(productionConfig.identifier);
  expect(developmentConfig.bundle).toMatchObject({
    targets: ["app"],
    createUpdaterArtifacts: false,
  });
});

test("routes the default desktop dev command through the development flavor", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  expect(packageJson.scripts.dev).toBe(
    "tauri dev --config src-tauri/tauri.dev.conf.json",
  );
  expect(packageJson.scripts["desktop:dev"]).toBe(packageJson.scripts.dev);
});

test("bundles and signs the macOS development app before launching it", async () => {
  const runner = await readFile(
    path.join(repositoryRoot, "src-tauri", "coda-dev-runner.sh"),
    "utf8",
  );

  expect(runner).toContain('signing_identifier="com.coda.bandcamp.dev"');
  expect(runner).toContain(
    'set -- bundle --debug --bundles app --config "$dev_configuration" --no-sign',
  );
  expect(runner).toContain(
    'app_bundle="$executable_directory/bundle/macos/Coda Dev.app"',
  );
  expect(runner).toContain('exec "$bundled_executable" "$@"');
});
