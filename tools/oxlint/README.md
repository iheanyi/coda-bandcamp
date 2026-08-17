# Anti-slop lint policy

`anti-slop/` vendors the complete anti-slop Oxlint plugin from the
`install-anti-slop` skill. All fifteen default rules are registered in
`anti-slop/index.ts` and enabled at `"error"` in the repository
`.oxlintrc.json`:

- `no-chained-type-assertions`
- `no-conditional-empty-object-spread`
- `no-known-value-widening`
- `no-module-mocking`
- `no-object-parameters`
- `no-reflect-apply`
- `no-reflect-get`
- `no-runtime-typeof`
- `no-shape-in-symbol-names`
- `no-unknown-parameters`
- `no-unknown-returns`
- `no-unknown-type-aliases`
- `no-unsafe-dictionary-type`
- `no-widen-then-assert`
- `require-safety-comment-for-type-assertion`

**This rule set is binding. Never remove a rule, lower a severity, add a
disable comment, or widen ignore patterns to silence a finding in owned
source. Fix the code instead.** Plugin source and the test harness obey the
same fifteen rules. The only exemption is the generated bundle directory
`anti-slop/.generated/**`. Rule-test files may contain violating snippets as
string fixtures; those strings are not linted as code. When updating from the
skill, keep rule behavior aligned with the bundle and re-apply local
conformance rather than restoring a source ignore. Keep project-specific rules
in a separate plugin.

## Configured rule options

- `no-runtime-typeof` is configured with `{ "allowInTypeGuards": true }`, an
  option the rule itself exposes. Rationale: decoders must keep validation at
  full strictness — own-data-property reads, prototype checks, spoofed
  `Symbol.toStringTag` rejection — and `typeof` is the only callability and
  primitive check that cannot be spoofed and does not misclassify async,
  generator, or proxied functions (`Object.prototype.toString` tags fail on
  all of those and can be forged; `instanceof` accepts non-callable
  `Function.prototype` inheritors). The option confines every runtime `typeof`
  to named type-guard predicates (`value is T`), so raw narrowing cannot leak
  into ad-hoc control flow. No other rule option is configured.

## Fixing findings

Use the sanctioned idioms rather than suppression:

- Parse external input at its I/O boundary into named domain types.
  `src/ownData.ts` owns the wire-value union (`OwnDataValue`,
  `OwnDataRecord`) and the generic structural guards;
  `src/data-bridge/native.ts` owns the Tauri IPC decode layer
  (`NativeValue`, `decodeNative*`).
- Type guards take a generic lexical parameter, never `unknown`:
  `function isFoo<Value>(value: Value): value is Value & Foo`. Where a
  function must inspect a wide wire value, give it a named public contract
  and, if overloads are required, keep the implementation signature on that
  named type rather than `unknown`.
- Prefer inference, `as const`, `satisfies`, and named owner contracts over
  assertions. Any unavoidable assertion needs a one-line `// SAFETY:` comment
  stating the invariant; chained assertions are always banned.
- Tests replace dependencies through real seams (see
  `src/test/miniPlayerTauriHarness.ts`), never `vi.mock`/`jest.mock`.
- The only `unknown` allowed in signatures is a parameter literally named
  `cause` for error enrichment; `const value: unknown = expression` bindings
  are fine when guards narrow them immediately.

## Build and test infrastructure

Oxlint loads the plugin from a bundled artifact because Node.js 20 cannot
load TypeScript plugin sources directly. `npm run build:anti-slop` uses the
installed esbuild to produce `anti-slop/.generated/index.mjs`
(target `node20.19`); both lint scripts run that build first. Builds write
uniquely named temporary files and atomically replace the shared bundle, so
concurrent local or CI lint runs never observe a partial plugin. The
generated directory is ignored by Git and by `.oxlintrc.json`.

Every registered rule has direct valid and invalid coverage in
`anti-slop/anti-slop.test.ts`, including the configured
`allowInTypeGuards` variant of `no-runtime-typeof`. The suite fails if the
registry gains a rule without a test run. Oxlint's in-process `RuleTester`
requires Node.js 22+, so the tests build the bundle and execute every case
through Oxlint's CLI, which keeps the suite green on Node 20.19 and current
Node. A missing build, plugin load failure, malformed result, or unexpected
rule/file count fails the suite.

`npm run lint` applies the fifteen anti-slop rules to owned source, including
the plugin and harness. `npm run lint:anti-slop` lints those same sources
with Oxlint's default rule set via `tools/oxlint/plugin-source.oxlintrc.json`.
`npm run typecheck:anti-slop` typechecks them strictly via
`tools/oxlint/tsconfig.json`. Branch CI on every platform job runs
`npm run lint` and `npm run lint:anti-slop` after `npm ci`.
