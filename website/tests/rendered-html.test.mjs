import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Coda landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>Coda — Your Bandcamp library, built for listening<\/title>/i,
  );
  assert.match(html, /Your Bandcamp library, built for listening/);
  assert.match(html, /Download Coda/);
  assert.match(
    html,
    /href="https:\/\/github\.com\/iheanyi\/coda-bandcamp\/releases\/latest"/,
  );
  assert.doesNotMatch(html, /Download Coda v\d+\.\d+\.\d+/);
  assert.match(html, /Your Bandcamp collection in a real desktop player\./);
  assert.match(html, /Made for music collectors, not engagement metrics/);
  assert.match(html, /Independent of Bandcamp and Last\.fm\./);
  assert.match(html, /\/coda-demo\.gif/);
  assert.doesNotMatch(html, /href="#security"|security model/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
