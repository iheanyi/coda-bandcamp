import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const workflowsDirectory = join(process.cwd(), ".github", "workflows");
const crossPlatformWorkflow = readFileSync(
  join(workflowsDirectory, "cross-platform.yml"),
  "utf8",
);
const releaseWorkflow = readFileSync(
  join(workflowsDirectory, "release.yml"),
  "utf8",
);

function jobBlock(workflow, jobName) {
  const normalizedWorkflow = workflow.replaceAll("\r\n", "\n");
  const marker = `  ${jobName}:\n`;
  const start = normalizedWorkflow.indexOf(marker);
  if (start < 0) {
    throw new Error(`Workflow is missing job ${jobName}`);
  }

  const afterStart = normalizedWorkflow.slice(start + marker.length);
  const nextJob = afterStart.search(/^  [a-zA-Z0-9_-]+:\n/m);
  return nextJob < 0
    ? normalizedWorkflow.slice(start)
    : normalizedWorkflow.slice(start, start + marker.length + nextJob);
}

test("shares target-specific Rust caches between CI and release builds", () => {
  const sharedKey = "shared-key: coda-${{ matrix.target }}";
  const mainOnlySave =
    "save-if: ${{ github.ref == 'refs/heads/main' }}";

  expect(crossPlatformWorkflow).toContain(sharedKey);
  expect(crossPlatformWorkflow).toContain(mainOnlySave);
  expect(crossPlatformWorkflow).toContain(
    "args: --config src-tauri/tauri.ci.conf.json --target ${{ matrix.target }}",
  );
  for (const target of [
    "aarch64-apple-darwin",
    "x86_64-pc-windows-msvc",
    "x86_64-unknown-linux-gnu",
  ]) {
    expect(crossPlatformWorkflow).toContain(`target: ${target}`);
  }

  const releaseBuild = jobBlock(releaseWorkflow, "build-release");
  expect(releaseBuild).toContain(sharedKey);
  expect(releaseBuild).toContain(mainOnlySave);
});

test("requires one release approval before building but not before publishing", () => {
  const releaseBuild = jobBlock(releaseWorkflow, "build-release");
  const publishRelease = jobBlock(releaseWorkflow, "publish-release");

  expect(releaseBuild).toMatch(/^    environment: release$/m);
  expect(publishRelease).not.toMatch(/^    environment: release$/m);
});

test("cryptographically verifies every signed updater artifact before publishing", () => {
  const publishRelease = jobBlock(releaseWorkflow, "publish-release");
  const signatureVerification = publishRelease.indexOf(
    "- name: Cryptographically verify updater signatures",
  );
  const publication = publishRelease.indexOf("- name: Publish GitHub release");

  expect(signatureVerification).toBeGreaterThan(-1);
  expect(publication).toBeGreaterThan(signatureVerification);
  expect(publishRelease).toContain(
    "sudo apt-get install --yes --no-install-recommends minisign",
  );
  expect(publishRelease).toContain(
    'Buffer.from(config.plugins.updater.pubkey, "base64")',
  );
  expect(publishRelease).toContain('for encoded_signature in "$SIGNED_ASSET_DIR"/*.sig');
  expect(publishRelease).toContain(
    'minisign -Vm "$artifact" -x "$decoded_signature" -p "$UPDATER_PUBLIC_KEY_PATH"',
  );
});

test("parses workflow jobs after a Windows CRLF checkout", () => {
  const windowsWorkflow = releaseWorkflow.replaceAll("\n", "\r\n");

  expect(jobBlock(windowsWorkflow, "publish-release")).toContain(
    "Cryptographically verify updater signatures",
  );
});
