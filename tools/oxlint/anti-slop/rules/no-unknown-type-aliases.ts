import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { typeResolvesToUnknown } from "../shared/unknown-types.ts";

function aliasTypeParameterNames(alias: ESTree.TSTypeAliasDeclaration): ReadonlySet<string> {
	const names = new Set<string>();
	for (const parameter of alias.typeParameters?.params ?? []) {
		names.add(parameter.name.name);
	}
	return names;
}

/** Ban named aliases that merely conceal TypeScript's unknown top type. */
export const noUnknownTypeAliasesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow type aliases whose resolved type is unknown; unknown must remain visible at an allowed boundary.",
		},
		messages: {
			unknownAlias:
				"Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.",
		},
	},
	createOnce(context) {
		const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();

		return {
			Program(node) {
				aliases.clear();
				for (const statement of node.body) {
					const declaration =
						statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
					if (declaration?.type === "TSTypeAliasDeclaration") {
						aliases.set(declaration.id.name, declaration);
					}
				}
				for (const alias of aliases.values()) {
					if (
						!typeResolvesToUnknown(
							alias.typeAnnotation,
							aliases,
							aliasTypeParameterNames(alias),
							new Set([alias.id.name]),
						)
					) {
						continue;
					}
					context.report({
						node: alias.id,
						messageId: "unknownAlias",
						data: { alias: alias.id.name },
					});
				}
			},
		};
	},
});
