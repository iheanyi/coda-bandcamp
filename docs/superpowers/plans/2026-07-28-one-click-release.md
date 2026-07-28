# Coda One-Click Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a maintainer select patch, minor, or major in GitHub's **Run workflow** form and have one workflow synchronize versions, commit and tag `main`, build all platforms, verify updater assets, and publish the stable release.

**Architecture:** A tested Node CLI owns strict stable-SemVer calculation, five-file version synchronization, annotated-run tag reuse, and atomic Git pushes. The existing release workflow normalizes manual and tag events through that CLI, then passes the resulting tag and commit SHA to the unchanged platform matrix and verified draft-publication stages.

**Tech Stack:** Node.js 22, Git, Vitest, GitHub Actions, Tauri Action v1, Tauri 2.

## Global Constraints

- Manual inputs are exactly `patch`, `minor`, and `major`; `patch` is the default.
- The first release uses the manifest version when no exact stable release tag exists.
- Manual releases run only from `main` and commit synchronized versions back to `main`.
- Stable exact `vX.Y.Z` tag pushes remain supported.
- Existing tags are never moved, overwritten, or silently reused across different workflow run IDs.
- A draft becomes public only after all four platform updater artifacts pass the existing validator.
- Release credentials remain confined to the protected `release` environment.
- Preserve all pre-existing worktree changes and do not stage, commit, push, tag, or publish from the local checkout.

---

### Task 1: Tested release-preparation CLI

**Files:**
- Create: `tools/prepare-release.mjs`
- Create: `tools/prepare-release.test.mjs`

**Interfaces:**
- Consumes: CLI options `--event`, `--release-type`, `--tag`, `--run-id`, `--branch`, `--repository-root`, and optional `--github-output`.
- Produces: `tag`, `version`, and `commit_sha` as JSON on stdout and as GitHub output records when `--github-output` is provided.

- [ ] **Step 1: Write failing integration tests**

Create temporary Git repositories with a bare `origin` and complete minimal Coda manifests. Execute the absent CLI as a child process and assert literal outcomes for:

```js
expect(firstRelease).toMatchObject({
  version: "0.1.0",
  tag: "v0.1.0",
});
expect(patchRelease.version).toBe("0.1.1");
expect(minorRelease.version).toBe("0.2.0");
expect(majorRelease.version).toBe("1.0.0");
```

Also assert that every manifest contains the new literal version, unrelated
lockfile content survives, a repeated `run-id` returns the same tag and SHA,
and malformed or conflicting tags exit nonzero without moving refs.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```sh
npx vitest run tools/prepare-release.test.mjs
```

Expected: failure because `tools/prepare-release.mjs` does not exist.

- [ ] **Step 3: Implement the minimal CLI**

Implement strict `/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/`
parsing, literal bump behavior, narrow JSON/TOML edits, exact-version
validation, real Git commands through `spawnSync`, annotated tags containing
`coda-release-run:<run-id>`, and:

```sh
git push --atomic origin HEAD:main refs/tags/vX.Y.Z
```

For `push`, validate the supplied exact tag without changing refs. For
`workflow_dispatch`, reuse a tag annotated with the same run ID before
calculating a new version.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```sh
npx vitest run tools/prepare-release.test.mjs
```

Expected: all preparation, synchronization, failure, and rerun cases pass.

---

### Task 2: Normalize and execute releases in one workflow

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `workflow_dispatch.inputs.release_type` or an exact pushed tag.
- Produces: `needs.prepare-release.outputs.tag`, `.version`, and `.commit_sha` for every build and publication job.

- [ ] **Step 1: Add the manual trigger and preparation job**

Add:

```yaml
workflow_dispatch:
  inputs:
    release_type:
      description: Version increment
      required: true
      default: patch
      type: choice
      options:
        - patch
        - minor
        - major
```

Give only `prepare-release` `contents: write`. Check out with full history,
reject a manual non-`main` ref, run `npm ci` and `npm test`, configure the
GitHub Actions bot author, then execute `tools/prepare-release.mjs` with the
event, input, tag, run ID, branch, workspace, and `$GITHUB_OUTPUT`.

- [ ] **Step 2: Route downstream jobs through normalized outputs**

Make `build-release` depend on `prepare-release`, check out
`${{ needs.prepare-release.outputs.commit_sha }}`, and replace every direct
release use of `github.ref_name` and `github.sha` with the normalized tag and
commit SHA. Keep the four-platform matrix, protected environment, Last.fm
credentials, updater signing, generated notes, draft release, and updater
uploads intact.

Make `publish-release` depend on `build-release`, inherit the normalized
outputs through `needs.prepare-release`, verify the normalized tag, and publish
that draft as latest.

Create the draft in one dedicated job before the matrix. Mark it with the
workflow run ID and prepared commit, pass its verified numeric release ID to
every Tauri build, and reject unrelated pre-existing drafts. Recheck that the
tag is still the newest stable tag immediately before publication.

- [ ] **Step 3: Validate workflow syntax and contracts**

Parse the YAML locally, inspect the resolved job dependency graph, and verify
that only the preparation, build, and publication jobs receive their required
permissions. Confirm no secret-bearing job runs for pull-request events.

---

### Task 3: Documentation and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-28-one-click-release-design.md` only if implementation reveals a required clarification.

**Interfaces:**
- Produces: maintainer instructions consisting only of opening Actions,
  choosing **Release**, selecting patch/minor/major, and clicking
  **Run workflow**.

- [ ] **Step 1: Replace manual release instructions**

Document the one-click flow, stable-only bump choices, first-release behavior,
automatic commit/tag/release notes, draft verification, and **Re-run failed
jobs** recovery. Do not instruct maintainers to edit manifests or push tags for
normal releases.

- [ ] **Step 2: Run focused and repository verification**

Run:

```sh
npx vitest run tools/prepare-release.test.mjs tools/check-release-version.test.mjs tools/verify-release-assets.test.mjs
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --exclude '.worktrees/**'
npm run build
node tools/check-release-version.mjs v0.1.0
git diff --check
```

Expected: all tests and builds pass, the current checkout remains consistently
versioned at `0.1.0`, `.env.local` stays ignored, and no credential value
appears in tracked changes.

- [ ] **Step 3: Review the final diff**

Confirm the workflow never publishes before verification, never overwrites a
tag, uses the normalized commit for every platform, grants `contents: write`
only where needed, and preserves unrelated local changes.
