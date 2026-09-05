import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function bundlerCacheRevision(lockfile) {
  const version = lockfile.packages?.["node_modules/@tauri-apps/cli"]?.version;
  if (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate the parsed lockfile field before constructing a workflow output.
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(version)
  ) {
    throw new Error("Missing or invalid locked Tauri CLI version");
  }
  // Bump v1 if the bundled tool layout or our installation policy changes.
  return `v1-cli-${version}`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const revision = bundlerCacheRevision(
    JSON.parse(readFileSync("package-lock.json", "utf8")),
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `revision=${revision}\n`);
}
