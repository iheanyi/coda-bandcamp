import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Rule } from "@oxlint/plugins";

import antiSlopPlugin from "./index.ts";
import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "./rules/no-module-mocking.ts";
import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.ts";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.ts";
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.ts";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts";

type ExpectedRuleError = {
	readonly messageId: string;
	readonly data?: Readonly<Record<string, string>>;
};

type RuleTestCases = {
	readonly valid: readonly string[];
	readonly invalid: readonly {
		readonly code: string;
		readonly errors: readonly ExpectedRuleError[];
	}[];
};

type RuleSetting = "error" | readonly ["error", Readonly<Record<string, boolean>>];

type RuleRunVariant = {
	readonly slug: string;
	readonly setting: RuleSetting;
};

type RuleRun = {
	readonly slug: string;
	readonly ruleName: string;
	readonly setting: RuleSetting;
};

type OxlintDiagnostic = {
	readonly code: string;
	readonly message: string;
};

type OxlintOutput = {
	readonly diagnostics: readonly OxlintDiagnostic[];
	readonly numberOfFiles: number;
	readonly numberOfRules: number;
};

type OxlintJsonValue =
	| string
	| number
	| boolean
	| null
	| readonly OxlintJsonValue[]
	| OxlintJsonRecord;

type OxlintJsonRecord = { readonly [key: string]: OxlintJsonValue };

type TestEnvironment = {
	readonly directory: string;
};

const testedRuleNames = [
	"no-chained-type-assertions",
	"no-conditional-empty-object-spread",
	"no-known-value-widening",
	"no-module-mocking",
	"no-object-parameters",
	"no-reflect-apply",
	"no-reflect-get",
	"no-runtime-typeof",
	"no-shape-in-symbol-names",
	"no-unknown-parameters",
	"no-unknown-returns",
	"no-unknown-type-aliases",
	"no-unsafe-dictionary-type",
	"no-widen-then-assert",
	"require-safety-comment-for-type-assertion",
] as const;

const antiSlopDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(antiSlopDirectory, "../../..");
const buildPluginPath = join(antiSlopDirectory, "build-plugin.mjs");
const generatedDirectory = join(antiSlopDirectory, ".generated");
const generatedPluginPath = join(generatedDirectory, "index.mjs");
const oxlintCliPath = join(repositoryRoot, "node_modules/oxlint/bin/oxlint");
const ruleRuns: RuleRun[] = [];
let testEnvironment: TestEnvironment | null = null;
let fixtureIndex = 0;

function isStringValue<Value>(value: Value): value is Value & string {
	return typeof value === "string";
}

function isNumberValue<Value>(value: Value): value is Value & number {
	return typeof value === "number";
}

function isOxlintJsonRecord<Value>(value: Value): value is Value & OxlintJsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oxlintJsonField<Value>(value: Value, key: string): OxlintJsonValue | undefined {
	if (!isOxlintJsonRecord(value)) return undefined;
	return Object.hasOwn(value, key) ? value[key] : undefined;
}

function parseDiagnostic(value: OxlintJsonValue, index: number): OxlintDiagnostic {
	const code = oxlintJsonField(value, "code");
	const message = oxlintJsonField(value, "message");
	if (!isStringValue(code) || !isStringValue(message)) {
		throw new Error(`Oxlint returned an invalid diagnostic at index ${index}.`);
	}
	return { code, message };
}

function parseOxlintOutput(stdout: string): OxlintOutput {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch (cause) {
		throw new Error("Oxlint did not return JSON output.", { cause });
	}

	const diagnostics = oxlintJsonField(parsed, "diagnostics");
	const numberOfFiles = oxlintJsonField(parsed, "number_of_files");
	const numberOfRules = oxlintJsonField(parsed, "number_of_rules");
	if (
		!Array.isArray(diagnostics) ||
		!isNumberValue(numberOfFiles) ||
		!isNumberValue(numberOfRules)
	) {
		throw new Error("Oxlint returned an invalid result envelope.");
	}
	return {
		diagnostics: diagnostics.map(parseDiagnostic),
		numberOfFiles,
		numberOfRules,
	};
}

function requireTestEnvironment(): TestEnvironment {
	if (testEnvironment === null) {
		throw new Error("The anti-slop test environment was not initialized.");
	}
	return testEnvironment;
}

function writeRuleRunConfig(directory: string, run: RuleRun): void {
	writeFileSync(
		join(directory, `${run.slug}.json`),
		`${JSON.stringify(
			{
				categories: { correctness: "off" },
				jsPlugins: [{ name: "anti-slop", specifier: generatedPluginPath }],
				rules: { [`anti-slop/${run.ruleName}`]: run.setting },
			},
			null,
			2,
		)}\n`,
	);
}

// RuleTester needs Node 22's larger ArrayBuffers. The CLI supports Node 20, so
// build the same ESM artifact used by repository lint and exercise each rule there.
beforeAll(() => {
	const bundleResult = spawnSync(process.execPath, [buildPluginPath], {
		cwd: repositoryRoot,
		encoding: "utf8",
	});
	if (bundleResult.error !== undefined) {
		throw new Error("The anti-slop plugin build could not start.", {
			cause: bundleResult.error,
		});
	}
	if (bundleResult.status !== 0) {
		throw new Error(
			`The anti-slop plugin build failed: ${bundleResult.stderr.trim() || "no stderr"}`,
		);
	}

	const directory = mkdtempSync(join(tmpdir(), "coda-anti-slop-"));
	try {
		for (const run of ruleRuns) writeRuleRunConfig(directory, run);
		testEnvironment = { directory };
	} catch (cause) {
		rmSync(directory, { force: true, recursive: true });
		throw cause;
	}
});

afterAll(() => {
	if (testEnvironment === null) return;
	rmSync(testEnvironment.directory, { force: true, recursive: true });
	testEnvironment = null;
});

function executeRule(slug: string, code: string): readonly OxlintDiagnostic[] {
	const { directory } = requireTestEnvironment();
	const fixturePath = join(directory, `${slug}-${fixtureIndex}.ts`);
	fixtureIndex += 1;
	writeFileSync(fixturePath, code);

	const result = spawnSync(
		process.execPath,
		[
			oxlintCliPath,
			"--config",
			join(directory, `${slug}.json`),
			"--format=json",
			"--threads=1",
			"--no-ignore",
			"--disable-nested-config",
			fixturePath,
		],
		{
			cwd: repositoryRoot,
			encoding: "utf8",
			env: { ...process.env, NO_COLOR: "1" },
		},
	);
	if (result.error !== undefined) {
		throw new Error(`Oxlint could not execute rule run ${slug}.`, { cause: result.error });
	}
	if (result.status !== 0 && result.status !== 1) {
		throw new Error(
			`Oxlint exited abnormally while testing ${slug} (status ${String(result.status)}, signal ${String(result.signal)}): ${result.stderr.trim()}`,
		);
	}

	let output: OxlintOutput;
	try {
		output = parseOxlintOutput(result.stdout);
	} catch (cause) {
		throw new Error(
			`Oxlint could not execute rule run ${slug}: ${result.stderr.trim() || "no stderr"}`,
			{ cause },
		);
	}
	if (output.numberOfFiles !== 1 || output.numberOfRules !== 1) {
		throw new Error(
			`Oxlint did not execute exactly one rule against one file for ${slug}.`,
		);
	}
	return output.diagnostics;
}

function expectedMessage(rule: Rule, error: ExpectedRuleError): string {
	const template = rule.meta?.messages?.[error.messageId];
	if (template === undefined) {
		throw new Error(`Rule metadata does not define message ${error.messageId}.`);
	}
	return template.replace(/\{\{\s*([^}]+?)\s*\}\}/gu, (_placeholder, rawName: string) => {
		const name = rawName.trim();
		const value = error.data?.[name];
		if (value === undefined) {
			throw new Error(`Expected data does not define message placeholder ${name}.`);
		}
		return value;
	});
}

function runRule(
	name: string,
	rule: Rule,
	tests: RuleTestCases,
	variant?: RuleRunVariant,
): void {
	const slug = variant?.slug ?? name;
	ruleRuns.push({ slug, ruleName: name, setting: variant?.setting ?? "error" });

	describe(slug, () => {
		describe("valid", () => {
			for (const code of tests.valid) {
				it(code, () => {
					expect(executeRule(slug, code)).toEqual([]);
				});
			}
		});

		describe("invalid", () => {
			for (const test of tests.invalid) {
				it(test.code, () => {
					expect(executeRule(slug, test.code)).toEqual(
						test.errors.map((error) => ({
							code: `anti-slop(${name})`,
							message: expectedMessage(rule, error),
						})),
					);
				});
			}
		});
	});
}

describe("anti-slop plugin registry", () => {
	it("contains only directly tested rules", () => {
		expect(Object.keys(antiSlopPlugin.rules).sort()).toEqual(testedRuleNames.toSorted());
	});

	it("has a rule run for every registered rule", () => {
		const coveredRuleNames = [...new Set(ruleRuns.map((run) => run.ruleName))].sort();
		expect(coveredRuleNames).toEqual(testedRuleNames.toSorted());
	});
});

runRule("no-chained-type-assertions", noChainedTypeAssertionsRule, {
	valid: [
		"const item = value as Item;",
		"const item = { id: '1' } as const;",
		"const item = ({ id: '1' } as const);",
	],
	invalid: [
		{
			code: "const item = value as unknown as Item;",
			errors: [{ messageId: "chained" }],
		},
		{
			code: "const item = (<unknown>value) as Item;",
			errors: [{ messageId: "chained" }],
		},
	],
});

runRule(
	"no-conditional-empty-object-spread",
	noConditionalEmptyObjectSpreadRule,
	{
		valid: [
			"const result = { ...extra };",
			"const result = { ...(enabled ? { enabled: true } : { enabled: false }) };",
		],
		invalid: [
			{
				code: "const result = { ...(enabled ? { enabled: true } : {}) };",
				errors: [{ messageId: "avoid" }],
			},
			{
				code: "const result = { ...((enabled ? {} : { enabled: false })) };",
				errors: [{ messageId: "avoid" }],
			},
		],
	},
);

runRule("no-known-value-widening", noKnownValueWideningRule, {
	valid: [
		"type Config = { enabled: boolean }; const config: Config = { enabled: true };",
		"type Item = { id: string }; const byId: Record<string, Item> = {};",
		"const parsed: unknown = JSON.parse(serialized);",
	],
	invalid: [
		{
			code: "const config: unknown = { enabled: true };",
			errors: [
				{
					messageId: "widening",
					data: { subject: "binding `config`", target: "unknown" },
				},
			],
		},
		{
			code: "const config: { enabled: boolean } = { enabled: true };",
			errors: [
				{
					messageId: "widening",
					data: { subject: "binding `config`", target: "anonymous object" },
				},
			],
		},
		{
			code: "const config: Record<string, boolean> = { enabled: true };",
			errors: [
				{
					messageId: "widening",
					data: { subject: "binding `config`", target: "open dictionary" },
				},
			],
		},
		{
			code: "type Kind = 'album' | 'artist'; type Coordinators = Record<Kind, { ready: boolean }>; function create(): Coordinators { return { album: { ready: true }, artist: { ready: true } }; }",
			errors: [
				{
					messageId: "widening",
					data: { subject: "return value of `create`", target: "open dictionary" },
				},
			],
		},
	],
});

runRule("no-module-mocking", noModuleMockingRule, {
	valid: [
		"import { vi } from 'vitest'; vi.spyOn(console, 'log');",
		"const vi = { mock(path: string) { return path; } }; vi.mock('./thing');",
	],
	invalid: [
		{
			code: "import { vi } from 'vitest'; vi.mock('./lib');",
			errors: [{ messageId: "moduleMock" }],
		},
		{
			code: "jest.doMock('./lib');",
			errors: [{ messageId: "moduleMock" }],
		},
		{
			code: "import { vi } from 'vitest'; vi['mock']('./lib');",
			errors: [{ messageId: "moduleMock" }],
		},
	],
});

runRule("no-object-parameters", noObjectParametersRule, {
	valid: [
		"function parse(value: unknown): void {}",
		"function visit<Value extends object>(value: Value): void {}",
		"type Broad = object; function visit<Broad>(value: Broad): void {}",
	],
	invalid: [
		{
			code: "function visit(value: object): void {}",
			errors: [
				{
					messageId: "objectParameter",
					data: { parameter: "value" },
				},
			],
		},
		{
			code: "type Broad = object; function visit(value: Broad): void {}",
			errors: [
				{
					messageId: "objectParameter",
					data: { parameter: "value" },
				},
			],
		},
	],
});

runRule("no-reflect-apply", noReflectApplyRule, {
	valid: [
		"handler.apply(receiver, args);",
		"const Reflect = { apply() {} }; Reflect.apply(handler, receiver, args);",
	],
	invalid: [
		{
			code: "Reflect.apply(handler, receiver, args);",
			errors: [{ messageId: "reflectApply" }],
		},
		{
			code: "Reflect['apply'](handler, receiver, args);",
			errors: [{ messageId: "reflectApply" }],
		},
	],
});

runRule("no-reflect-get", noReflectGetRule, {
	valid: [
		"target[key];",
		"const Reflect = { get() {} }; Reflect.get(target, key);",
	],
	invalid: [
		{
			code: "Reflect.get(target, key);",
			errors: [{ messageId: "reflectGet" }],
		},
		{
			code: "Reflect['get'](target, key);",
			errors: [{ messageId: "reflectGet" }],
		},
	],
});

runRule("no-runtime-typeof", noRuntimeTypeofRule, {
	valid: [
		"const width = 10; type Width = typeof width; export const label: Width = width;",
		"function parse(value: string): number { return value.length; }",
	],
	invalid: [
		{
			code: "function widen(value: string | number): string { if (typeof value === 'string') return value; return String(value); }",
			errors: [{ messageId: "runtimeTypeof" }],
		},
		{
			code: "function isText<Value>(value: Value): value is Value & string { return typeof value === 'string'; }",
			errors: [{ messageId: "runtimeTypeof" }],
		},
	],
});

runRule(
	"no-runtime-typeof",
	noRuntimeTypeofRule,
	{
		valid: [
			"function isText<Value>(value: Value): value is Value & string { return typeof value === 'string'; }",
			"const values: readonly (string | number)[] = ['a', 1]; export const strings = values.filter((value): value is string => typeof value === 'string');",
		],
		invalid: [
			{
				code: "function widen(value: string | number): string { if (typeof value === 'string') return value; return String(value); }",
				errors: [{ messageId: "runtimeTypeof" }],
			},
			{
				code: "function isList<Value>(value: Value): value is Value & readonly string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }",
				errors: [{ messageId: "runtimeTypeof" }],
			},
		],
	},
	{
		slug: "no-runtime-typeof-allow-in-type-guards",
		setting: ["error", { allowInTypeGuards: true }],
	},
);

runRule("no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
	valid: [
		"const albumLayout = { rows: 2 };",
		"function normalizeStructure(): void {}",
	],
	invalid: [
		{
			code: "const albumShape = 1;",
			errors: [
				{
					messageId: "forbiddenSymbolName",
					data: { name: "albumShape" },
				},
			],
		},
		{
			code: "function reshapeQueue(): void {}",
			errors: [
				{
					messageId: "forbiddenSymbolName",
					data: { name: "reshapeQueue" },
				},
			],
		},
	],
});

runRule("no-unknown-parameters", noUnknownParametersRule, {
	valid: [
		"function parse(payload: string): number { return payload.length; }",
		"function pick<Value>(value: Value): Value { return value; }",
		"function enrich(cause: unknown): Error { return new Error('wrapped', { cause }); }",
	],
	invalid: [
		{
			code: "function parse(value: unknown): void { void value; }",
			errors: [
				{
					messageId: "unknownParameter",
					data: { parameter: "value" },
				},
			],
		},
		{
			code: "type Decoder = (input: unknown) => string;",
			errors: [
				{
					messageId: "unknownParameter",
					data: { parameter: "input" },
				},
			],
		},
		{
			code: "interface Codec { decode(raw: unknown): string; }",
			errors: [
				{
					messageId: "unknownParameter",
					data: { parameter: "raw" },
				},
			],
		},
	],
});

runRule("no-unknown-returns", noUnknownReturnsRule, {
	valid: [
		"function identity<Value>(value: Value): Value { return value; }",
		"async function load(): Promise<string> { return 'ready'; }",
	],
	invalid: [
		{
			code: "function read(): unknown { return null; }",
			errors: [{ messageId: "unknownReturn" }],
		},
		{
			code: "async function fetchValue(): Promise<unknown> { return null; }",
			errors: [{ messageId: "unknownReturn" }],
		},
		{
			code: "type Opaque = unknown; function reveal(): Opaque { return null; }",
			errors: [{ messageId: "unknownReturn" }],
		},
	],
});

runRule("no-unknown-type-aliases", noUnknownTypeAliasesRule, {
	valid: [
		"type Payload = string | number;",
		"type Boxed<Value> = Value;",
		"type WithCause = { cause: unknown };",
	],
	invalid: [
		{
			code: "type Hidden = unknown;",
			errors: [
				{
					messageId: "unknownAlias",
					data: { alias: "Hidden" },
				},
			],
		},
		{
			code: "type Inner = unknown; type Outer = Inner;",
			errors: [
				{
					messageId: "unknownAlias",
					data: { alias: "Inner" },
				},
				{
					messageId: "unknownAlias",
					data: { alias: "Outer" },
				},
			],
		},
	],
});

runRule("no-unsafe-dictionary-type", noUnsafeDictionaryTypeRule, {
	valid: [
		"type Item = { id: string }; type Items = Record<string, Item>;",
		"type Wire = string | number | boolean | null | undefined | readonly Wire[] | WireRecord; type WireRecord = { readonly [key: string]: Wire };",
	],
	invalid: [
		{
			code: "type Payload = Record<string, unknown>;",
			errors: [
				{
					messageId: "unsafeDictionary",
					data: { value: "unknown" },
				},
			],
		},
		{
			code: "type Payload = Readonly<Record<string, unknown>>;",
			errors: [
				{
					messageId: "unsafeDictionary",
					data: { value: "unknown" },
				},
			],
		},
		{
			code: "type Payload = Record<string, any>;",
			errors: [
				{
					messageId: "unsafeDictionary",
					data: { value: "any" },
				},
			],
		},
		{
			code: "type Payload = { [key: string]: object };",
			errors: [
				{
					messageId: "unsafeDictionary",
					data: { value: "object" },
				},
			],
		},
		{
			code: "type Payload = Record<string, {}>;",
			errors: [
				{
					messageId: "unsafeDictionary",
					data: { value: "empty-object" },
				},
			],
		},
	],
});

runRule("no-widen-then-assert", noWidenThenAssertRule, {
	valid: [
		"interface Item { id: string } function parse(value: unknown): Item { return value as Item; }",
		"interface Item { id: string } const item: Item = makeItem(); const same = item as Item;",
	],
	invalid: [
		{
			code: "interface Item { id: string } const erased: unknown = { id: '1' }; const item = erased as Item;",
			errors: [
				{
					messageId: "widenThenAssert",
					data: { name: "erased" },
				},
			],
		},
		{
			code: "const erased: object = { id: '1' }; const item = erased as { id: string };",
			errors: [
				{
					messageId: "widenThenAssert",
					data: { name: "erased" },
				},
			],
		},
	],
});

runRule(
	"require-safety-comment-for-type-assertion",
	requireSafetyCommentForTypeAssertionRule,
	{
		valid: [
			"const item = { id: '1' } as const;",
			"// SAFETY: the schema validated every Item field.\nconst item = value as Item;",
		],
		invalid: [
			{
				code: "const item = value as Item;",
				errors: [{ messageId: "missingSafetyComment" }],
			},
			{
				code: "const item = <Item>value;",
				errors: [{ messageId: "missingSafetyComment" }],
			},
		],
	},
);
