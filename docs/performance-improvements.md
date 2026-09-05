# Library browsing performance

## Catalog summaries no longer run on every search or filter change

The library browse hook used one memo for both the current view and whole-library
counts/genre tabs. Every search, genre, sort, and artist selection change reran
`summarizeLibraryCatalog`, including artist normalization and genre normalization
for every album. These totals do not depend on the current view.

`useLibraryBrowseController` now memoizes the catalog summary using only the
immutable album-array reference. The view still derives immediately from the
current input, and replacing the albums array refreshes the summary. The memo is
component-local; it adds no persistent cache, retained historical catalogs, or
invalidation protocol. Normalizing the selected genre once per filter operation
also removes repeated identical work. Sorting uses the newly filtered array
without making another copy; source albums remain untouched.

The regression test covers a combined search/genre change, stable summary
references, and refreshed counts/genres after a new album arrives. Existing
coverage continues to check Recent ordering, artist grouping, and guest artists.

## Reproduce the measurement

```sh
node tools/benchmark-library-browse.mjs
```

The default baseline is commit `427900109b547ccc9ae04aac11468da9c4b72bab`.
An optional Git ref overrides it. The script bundles the baseline hook and working
hook separately with esbuild, using the shared current dependencies, and measures
actual React hook rerenders in jsdom. It does not modify the checkout. Fixtures
are synthetic: 500 or 5,000 albums, 200 artists, five genres, and mixed release
sizes. Each sample performs eight search changes or eight alternating genre
changes. It excludes initial mounting, runs five warmup samples and fifteen
measured samples, alternates implementation order, and reports the median time per
update. It checks that visible IDs, counts, and genre tabs agree after every sample.

Recorded on 2026-09-05, Apple M1 Max, macOS arm64, Node v26.5.0, after this
audit's heavy build and test jobs completed:

| Albums | Interaction  | Before ms/update | After ms/update | Reduction | Speedup |
| ------ | ------------ | ---------------: | --------------: | --------: | ------: |
| 500    | Search       |            0.492 |           0.153 |     68.9% |   3.21x |
| 500    | Genre filter |            0.590 |           0.092 |     84.4% |   6.43x |
| 5,000  | Search       |            6.766 |           1.085 |     84.0% |   6.23x |
| 5,000  | Genre filter |           10.959 |           0.874 |     92.0% |  12.54x |

These are local computation measurements with React/jsdom overhead, not native
frame times or end-to-end input latency. First load still computes the catalog
summary. This benchmark does not measure painting, network, startup, memory, or
WebKit; timings also vary with machine load. Run it when other builds/tests are
idle for a cleaner comparison. No claim of native playback or startup improvement
is implied.

An earlier run during concurrent builds/tests measured 40.718 → 4.463 ms for
5,000-album search and 58.189 → 12.931 ms for genre changes. The table supersedes
those preliminary timings; their variability illustrates why absolute timings
must be reported with workload context.

## Further opportunities to measure

- The genre filter still normalizes each album's genre on every change. If native
  profiling shows this remains significant, compute a normalized search/genre
  index once per album-array change. This trades additional retained strings for
  less per-keystroke work; measure memory as well as time before adding it.
- Recent currently sorts every matching release before taking twelve. A bounded
  top-twelve selection could avoid a full sort on large catalogs, but must preserve
  precise added-date ordering and deterministic ties. Measure it before adding a
  more complex selection algorithm.

Both opportunities are deferred and unmeasured.
