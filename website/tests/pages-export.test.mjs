import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const exportedPage = new URL("../out/index.html", import.meta.url);

test("exports the Coda site for its GitHub Pages project path", async () => {
  const html = await readFile(exportedPage, "utf8");

  assert.match(
    html,
    /<title>Coda — Your Bandcamp library, built for listening<\/title>/i,
  );
  assert.match(html, /href="\/coda-bandcamp\/"/);
  assert.match(html, /Download Coda/);
  assert.match(
    html,
    /href="https:\/\/github\.com\/iheanyi\/coda-bandcamp\/releases\/latest"/,
  );
  assert.doesNotMatch(html, /Download Coda v\d+\.\d+\.\d+/);
  assert.match(html, /src="\/coda-bandcamp\/coda-demo\.gif"/);
  assert.match(html, /src="\/coda-bandcamp\/_next\/static\//);
  assert.match(
    html,
    /content="https:\/\/iheanyi\.github\.io\/coda-bandcamp\/og\.png"/,
  );
  assert.doesNotMatch(html, /(?:href|src)="\/_next\//);
  assert.doesNotMatch(html, /(?:href|src)="\/coda-(?:icon|demo)/);
  assert.doesNotMatch(html, /localhost/);
});
