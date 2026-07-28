import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const stylesheetPath = "src/styles.css";
const stylesheet = readFileSync(stylesheetPath, "utf8");
const candidates = [...stylesheet.matchAll(/@apply\s+([^;]+);/g)].map(
  ([, utilities]) => utilities.replace(/\s+/g, " ").trim(),
);

if (candidates.length === 0) {
  console.error(`No @apply statements found in ${stylesheetPath}.`);
  process.exit(1);
}

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  executable,
  [
    "@tailwindcss/cli",
    "canonicalize",
    "--css",
    stylesheetPath,
    "--format",
    "jsonl",
  ],
  {
    encoding: "utf8",
    input: `${candidates.join("\n")}\n`,
    maxBuffer: 20 * 1024 * 1024,
  },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const changed = result.stdout
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((entry) => entry.changed);

if (changed.length > 0) {
  console.error(
    `${changed.length} @apply statement(s) are not canonically ordered:`,
  );
  for (const entry of changed) {
    console.error(`- ${entry.input}\n+ ${entry.output}`);
  }
  process.exit(1);
}

console.log(
  `Tailwind canonicalization: ${candidates.length} @apply statements unchanged`,
);
