// Run: node tools/benchmark-library-browse.mjs [baseline-git-ref]
// Uses synthetic metadata only. Includes React rerender overhead, excludes painting.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { platform, arch, cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = process.argv[2] ?? "427900109b547ccc9ae04aac11468da9c4b72bab";
const source = "src/features/library/useLibraryBrowseController.ts";
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const { renderHook, cleanup } = await import("@testing-library/react");
const temporary = await mkdtemp(`${root}tools/.browse-benchmark-`);
const outputs = [];
try {
  const hooks = {};
  for (const version of ["before", "after"]) {
    const outfile = `${temporary}/${version}.mjs`;
    const built = await build({
      ...(version === "before"
        ? {
            stdin: {
              contents: execFileSync("git", ["show", `${baseline}:${source}`], {
                cwd: root,
                encoding: "utf8",
              }),
              resolveDir: `${root}src/features/library`,
              loader: "ts",
            },
          }
        : { entryPoints: [`${root}${source}`] }),
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      tsconfig: `${root}tsconfig.json`,
      write: false,
    });
    await writeFile(outfile, built.outputFiles[0].text);
    outputs.push(outfile);
    hooks[version] = (
      await import(pathToFileURL(outfile).href)
    ).useLibraryBrowseController;
  }
  console.log(
    JSON.stringify({
      node: process.version,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0].model,
      baseline,
      samples: 15,
      warmups: 5,
    }),
  );
  for (const size of [500, 5000]) {
    const albums = Array.from({ length: size }, (_, index) => ({
      id: String(index),
      title: `Release ${index}`,
      artist: `Artist ${index % 200}`,
      genre: ["Ambient", "Hip-Hop/Rap", "Jazz", "Electronic", "Rock"][
        index % 5
      ],
      songCount: index % 5 === 0 ? 1 : 8,
      duration: 1200,
      palette: ["#777", "#222"],
    }));
    const input = {
      albums,
      browseMode: "releases",
      deferredQuery: "",
      fallbackAlbumCandidateTracks: [],
      genre: "All",
      ignoreDeferredArtistQuery: false,
      sort: "title",
      view: "library",
    };
    for (const scenario of ["search", "genre"]) {
      const times = { before: [], after: [] };
      const signatures = {};
      for (let sample = -5; sample < 15; sample++) {
        for (const version of sample % 2
          ? ["before", "after"]
          : ["after", "before"]) {
          const hook = renderHook(hooks[version], { initialProps: input });
          const start = performance.now();
          for (let step = 0; step < 8; step++) {
            hook.rerender({
              ...input,
              ...(scenario === "search"
                ? { deferredQuery: `release ${step}` }
                : { genre: step % 2 ? "Jazz" : "Ambient" }),
            });
          }
          const elapsed = (performance.now() - start) / 8;
          signatures[version] = {
            ids: hook.result.current.visibleAlbums.map(({ id }) => id),
            counts: hook.result.current.counts,
            genres: hook.result.current.orderedGenreTabs,
          };
          hook.unmount();
          if (sample >= 0) times[version].push(elapsed);
        }
        assert.deepEqual(signatures.before, signatures.after);
      }
      const median = (values) =>
        values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const before = median(times.before);
      const after = median(times.after);
      console.log(
        JSON.stringify({
          size,
          scenario,
          beforeMs: +before.toFixed(3),
          afterMs: +after.toFixed(3),
          speedup: +(before / after).toFixed(2),
          reductionPercent: +((1 - after / before) * 100).toFixed(1),
        }),
      );
    }
  }
} finally {
  cleanup();
  dom.window.close();
  for (const output of outputs) await unlink(output);
  await rmdir(temporary);
}
