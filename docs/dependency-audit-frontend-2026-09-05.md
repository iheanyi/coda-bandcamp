# Frontend dependency audit — 2026-09-05

## Decisions

Keep React, TanStack Query/Router/Virtual, Tauri's renderer APIs, Base UI, Lucide,
Motion, and the current Tailwind/Vite/TypeScript toolchain. They have concrete
roles in application state, navigation, bounded rendering, accessible controls,
native integration, and production compilation. The audit found no measured
benefit that justifies migrating these foundations. "Latest" alone is not a
reason to replace a working library.

`class-variance-authority`, `clsx`, and `tailwind-merge` are used by the shared UI
components/utilities. `tw-animate-css` and `shadcn/tailwind.css` are imported by
the stylesheet, so deleting shadcn as "just an unused generator" would break the
build. The TanStack Vite/router plugins are active in `vite.config.ts`; the
developer inspectors are intentionally development-only. Vitest/jsdom/testing
library and Oxlint's plugin tooling have active verification roles. These are
retained; no replacement is justified by package-count reduction alone.

The website has two supported build paths: Next static export for GitHub Pages,
and vinext/Cloudflare for the worker deployment. Both are exercised by its test
scripts. Next and vinext are not interchangeable duplicate packages that can
simply be deleted. Consolidating deployment targets should be a separate product
decision.

The strongest pruning candidate is the website's unused Drizzle/D1 scaffold:
`db/`, `drizzle.config.ts`, `drizzle/`, and `examples/d1/`. The active page/worker
does not import the database helper, but worker binding types and a database
generation script still exist. Remove these together only after confirming the
database scaffold is not intended for the hosting workflow. It is not part of
this TLS change.

## Compatible patches applied

- Desktop `fast-uri` override: 3.1.5 → 3.1.6. The old override prevented the
  compatible fix from being selected.
- Desktop transitive `qs`: updated within its existing dependency ranges.
- Website transitive `fast-uri`, `browserslist`, and `fflate`: updated within
  existing ranges, including Browserslist's required browser-data packages.
- No major upgrades, new runtime libraries, or automatic Drizzle downgrade.

Initial npm audit snapshots reported three desktop findings (two high, one
moderate), and seven website findings (two high, five moderate). Both initial
production-only audits reported zero findings. These are package advisory
results, not proof of application reachability or exhaustive security review.

The patches address the specific initial fast-uri, qs, Browserslist, and fflate
findings. The website's old esbuild chain through drizzle-kit remains. npm's
suggested fix was a Drizzle downgrade, which was deliberately not applied.

A fresh post-update npm audit was rejected by automatic approval review because
it would transmit dependency inventory to the npm registry without explicit
destination authorization. It was not retried through another mechanism. The
installed lockfile versions were checked locally against the initial findings;
there is no claim of a clean post-update audit scan.

## Verification and performance limits

Desktop automation tests and production build passed. Both website test scripts
passed: `npm run test:pages` and `npm test`, covering static export and the worker
build. The desktop build still reports a chunk over 500 kB; no bundle-size
improvement is attributed to these tooling patches. Dependency weight should be
measured in emitted chunks before replacing UI libraries or adding more lazy
boundaries.

Initial evidence: `/tmp/coda-dependency-audit-frontend.json`,
`/tmp/coda-dependency-audit-website.json`, and their `-production.json` companions.
Build logs: `/tmp/coda-dependency-build.log`, `/tmp/coda-website-pages.log`, and
`/tmp/coda-website-test.log`.

Advisory references:

- [fast-uri IDN handling](https://github.com/advisories/GHSA-5jgf-p345-68v8)
- [fast-uri IPv6 handling](https://github.com/advisories/GHSA-f65p-4m7j-42xc)
- [qs](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx)
- [Browserslist](https://github.com/advisories/GHSA-73wf-gq98-2v4g)
- [fflate](https://github.com/advisories/GHSA-px8p-9vwx-vf98)
