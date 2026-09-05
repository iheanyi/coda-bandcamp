// Synthetic projection benchmark; excludes React, DOM painting, persistence, and IPC.
// Run: node tools/benchmark-public-queue.mjs
import assert from "node:assert/strict";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { build } from "esbuild";

const built = await build({
  entryPoints: ["src/features/playback-runtime/publicQueue.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const moduleSource = Buffer.from(built.outputFiles[0].text).toString("base64");
const { publicPlaybackQueueTrack, createPublicPlaybackQueueProjector } =
  await import(`data:text/javascript;base64,${moduleSource}`);
const median = (samples) =>
  samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
console.log(
  JSON.stringify({
    node: process.version,
    cpu: cpus()[0].model,
    samples: 21,
    warmups: 5,
  }),
);

for (const size of [500, 5_000, 25_000]) {
  const queue = Array.from({ length: size }, (_, index) => ({
    id: `track-${index}`,
    title: `Track ${index}`,
    artist: "Synthetic artist",
    album: `Album ${Math.floor(index / 10)}`,
    albumId: `album-${Math.floor(index / 10)}`,
    duration: 180,
    track: (index % 10) + 1,
    palette: ["#111111", "#222222"],
    streamUrl: "https://t4.bcbits.com/example?token=fixture",
  }));
  for (const scenario of ["cold", "reorder", "replace-one"]) {
    const durations = { before: [], after: [] };
    let reused = 0;
    for (let sample = -5; sample < 21; sample++) {
      // Construct/warm outside the timed region: these scenarios model a live queue.
      const project = createPublicPlaybackQueueProjector();
      const original = scenario === "cold" ? undefined : queue.map(project);
      const updated =
        scenario === "reorder"
          ? [...queue].reverse()
          : scenario === "replace-one"
            ? [{ ...queue[0], title: "Replacement" }, ...queue.slice(1)]
            : queue;
      const results = {};
      // Alternate order to reduce systematic warmup/GC ordering bias.
      const order = sample % 2 ? ["after", "before"] : ["before", "after"];
      for (const version of order) {
        const start = performance.now();
        results[version] = updated.map(
          version === "before" ? publicPlaybackQueueTrack : project,
        );
        const elapsed = performance.now() - start;
        if (sample >= 0) durations[version].push(elapsed);
      }
      assert.deepEqual(results.after, results.before);
      assert.equal(
        results.after.some((track) => "streamUrl" in track),
        false,
      );
      const originalSet = new Set(original);
      reused = results.after.filter((track) => originalSet.has(track)).length;
    }
    const beforeMs = median(durations.before);
    const afterMs = median(durations.after);
    console.log(
      JSON.stringify({
        size,
        scenario,
        beforeMs: +beforeMs.toFixed(3),
        afterMs: +afterMs.toFixed(3),
        speedup: +(beforeMs / afterMs).toFixed(2),
        newlyProjected: size - reused,
      }),
    );
  }
}
