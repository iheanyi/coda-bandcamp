import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const assetNames = await readdir(assetsDirectory);

const assets = await Promise.all(
  assetNames.map(async (name) => {
    const contents = await readFile(new URL(name, assetsDirectory));
    return {
      name,
      extension: extname(name),
      rawBytes: contents.byteLength,
      gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    };
  }),
);

const javascript = assets.filter((asset) => asset.extension === ".js");
const stylesheets = assets.filter((asset) => asset.extension === ".css");
const entry = javascript
  .filter((asset) => asset.name.startsWith("index-"))
  .sort((left, right) => right.rawBytes - left.rawBytes)[0];

if (!entry) {
  throw new Error("Could not identify Coda's generated JavaScript entry chunk.");
}

const sum = (items, key) =>
  items.reduce((total, item) => total + item[key], 0);
const kibibytes = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const measurements = {
  entryJavaScriptRaw: entry.rawBytes,
  entryJavaScriptGzip: entry.gzipBytes,
  totalJavaScriptRaw: sum(javascript, "rawBytes"),
  totalJavaScriptGzip: sum(javascript, "gzipBytes"),
  totalCssRaw: sum(stylesheets, "rawBytes"),
  totalCssGzip: sum(stylesheets, "gzipBytes"),
};

const budgets = {
  entryJavaScriptRaw: 360 * 1024,
  entryJavaScriptGzip: 112 * 1024,
  // Complete radio-series browsing is lazy-loaded, so keep its cost out of the
  // startup ceiling while allowing a narrow budget for the on-demand archive UI.
  totalJavaScriptRaw: 455 * 1024,
  totalJavaScriptGzip: 140 * 1024,
  // Tailwind expands @apply utilities with compatibility custom properties.
  // Keep the transfer ceiling tight while allowing that parse-time overhead.
  totalCssRaw: 100 * 1024,
  totalCssGzip: 18 * 1024,
};

let failed = false;
for (const [name, budget] of Object.entries(budgets)) {
  const actual = measurements[name];
  const withinBudget = actual <= budget;
  failed ||= !withinBudget;
  console.log(
    `${withinBudget ? "PASS" : "FAIL"} ${name}: ${kibibytes(actual)} / ${kibibytes(budget)}`,
  );
}

if (failed) {
  process.exitCode = 1;
}
