# Coda One-Click Release Design

## Goal

Turn Coda's existing tag-triggered release pipeline into a stable, one-click
GitHub Actions workflow. A maintainer chooses `patch`, `minor`, or `major` from
the **Run workflow** form. The workflow calculates and synchronizes the version,
commits it to `main`, creates the matching tag, builds every supported platform,
verifies the updater artifacts, and publishes the GitHub Release.

Maintainers must not edit version files, create tags, or assemble releases
locally. Existing exact `vX.Y.Z` tag pushes remain supported as an emergency
fallback.

## Manual release contract

The `Release` workflow gains a `workflow_dispatch` trigger with one required
choice input:

- `release_type`: `patch`, `minor`, or `major`, defaulting to `patch`.

Only stable SemVer releases are supported. The workflow does not expose custom
version text, prerelease identifiers, or build metadata.

Manual releases must be dispatched from the repository's default `main`
branch. A dispatch from another branch fails before changing repository state.
The existing release concurrency group serializes attempts so two maintainers
cannot calculate the same next version.

When the repository has no release tags, the first manual run releases the
version already declared in the manifests, currently `0.1.0`. Afterward, the
selected release type increments the most recent exact stable release version:

- `patch`: `0.1.0` to `0.1.1`
- `minor`: `0.1.1` to `0.2.0`
- `major`: `0.2.0` to `1.0.0`

## Version preparation

A focused Node utility owns release-version calculation and synchronization. It
uses strict stable SemVer parsing and updates only:

- `package.json`
- the root and `packages[""]` versions in `package-lock.json`
- `src-tauri/tauri.conf.json`
- the `[package]` version in `src-tauri/Cargo.toml`
- the `coda` package entry in `src-tauri/Cargo.lock`

The utility preserves unrelated formatting and dependency data, rejects missing
or malformed expected structures, and never invokes package managers or
rewrites dependency versions.

For a manual release, the preparation job:

1. Checks out the exact `main` commit selected by the dispatch and fetches its
   full history and tags. If `main` advances before the atomic push, the push
   fails instead of releasing a different commit.
2. Runs the frontend tests before creating release state.
3. Calculates and applies the release version.
4. Runs the existing release-version validator.
5. Commits changed manifests as `github-actions[bot]` with
   `Release vX.Y.Z`.
6. Creates an annotated `vX.Y.Z` tag containing the GitHub run ID.
7. Atomically pushes the version commit and tag.
8. Exposes the tag, version, and exact commit SHA to downstream jobs.

The first release may not require a version commit when the manifests already
contain the selected version. In that case, the workflow tags the tested
`main` commit directly.

The workflow uses its scoped `GITHUB_TOKEN`; no personal access token or GitHub
App credential is introduced. GitHub suppresses recursive workflow events from
that token, so the same manual workflow run continues into the platform builds
instead of relying on the pushed tag to start a second workflow.

## Existing tag fallback

For an exact stable `vX.Y.Z` tag-push event, the preparation job does not modify
the repository. It validates that every manifest matches the tag and exposes
the existing tag and commit SHA to the same build and publication jobs.

Malformed tags, superseded tags, tags outside `main`, or tags whose version
differs from any manifest fail before release creation.

## Build and publication flow

All release jobs consume normalized preparation outputs instead of directly
reading `github.ref_name` or `github.sha`. A single preparation job creates the
draft release with generated notes and an ownership marker containing the run
ID and prepared commit. Reruns must match that marker, and every platform
receives the verified numeric release ID instead of finding an arbitrary draft
by tag.

Each platform job checks out the exact prepared commit and builds:

- Linux x64
- Windows x64
- macOS arm64
- macOS Intel

The jobs retain the protected `release` environment and its Last.fm and Tauri
updater-signing secrets. `tauri-action` creates or reuses a draft release,
generates release notes for the normalized tag and commit, uploads platform
artifacts and updater signatures, and contributes to `latest.json`.

The final publication job checks out the same prepared commit, downloads the
draft metadata, verifies every expected platform, release asset, URL, and
updater signature, then marks the release published and latest. Existing Coda
installations see the release only after this final verification succeeds.

## Failure and rerun behavior

No release or repository state is created when tests, version calculation, or
manifest validation fails.

After the version commit and tag are pushed:

- A failed platform or publication job is recovered with GitHub's
  **Re-run failed jobs** action. Successful preparation outputs are reused and
  no new version is calculated.
- A full workflow rerun finds the annotated tag whose message contains the same
  GitHub run ID, verifies its manifests, and reuses its commit and version.
- A rerun fails closed if a newer stable tag now exists, and the publication
  job rechecks this immediately before marking a release latest.
- A new manual dispatch always represents a new release attempt and calculates
  the next version from the latest stable tag.
- Existing tag or draft-release conflicts fail closed unless they belong to the
  same GitHub run ID and exact commit.

The workflow never moves or overwrites an existing tag. If a tagged release
requires source changes, the maintainer fixes `main` and starts a new patch
release.

## Security

- The preparation job receives `contents: write` only for its atomic version
  commit and tag push. Checkout credentials are not persisted while tests run;
  a manual `main` run enables the push credential only after trigger
  validation and tests.
- Build and publication jobs retain only the permissions they require.
- Secret-bearing jobs remain restricted to exact tags and trusted manual
  dispatches; pull requests never receive release credentials.
- The workflow does not print credential values or persist them in generated
  version commits.
- Existing Tauri updater signing remains separate from Git tags and GitHub
  release metadata.

## Verification

The version utility receives process-level tests with temporary repositories
covering:

- first release without tags;
- patch, minor, and major increments;
- synchronization of all five version locations;
- rejection of prerelease, malformed, and mismatched versions;
- preservation of unrelated manifest and lockfile content;
- idempotent reuse of the same run's annotated tag;
- rejection of an existing conflicting tag.

Workflow verification covers manual and tag event normalization, normalized
tag/commit usage by every downstream job, restricted permissions, YAML syntax,
and the existing release-asset validator.

Final local verification runs the focused utility tests, the current-checkout
frontend suite, the frontend production build, `git diff --check`, and a
read-only review of the final workflow permissions and secret boundaries.
