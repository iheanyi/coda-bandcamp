import type { ESTree } from "@oxlint/plugins";

function referencedAliasName(type: ESTree.TSType): string | null {
	if (type.type === "TSParenthesizedType") return referencedAliasName(type.typeAnnotation);
	if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return null;
	return type.typeArguments === null ||
		type.typeArguments === undefined ||
		type.typeArguments.params.length === 0
		? type.typeName.name
		: null;
}

/** True when a type is unknown, or a union/alias that TypeScript reduces to unknown. */
export function typeResolvesToUnknown(
	type: ESTree.TSType,
	aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>,
	shadowedAliases: ReadonlySet<string>,
	visited: ReadonlySet<string> = new Set(),
): boolean {
	if (type.type === "TSUnknownKeyword") return true;
	if (type.type === "TSParenthesizedType") {
		return typeResolvesToUnknown(type.typeAnnotation, aliases, shadowedAliases, visited);
	}
	if (type.type === "TSUnionType") {
		return type.types.some((member) =>
			typeResolvesToUnknown(member, aliases, shadowedAliases, visited),
		);
	}
	const name = referencedAliasName(type);
	if (name === null || visited.has(name) || shadowedAliases.has(name)) return false;
	const alias = aliases.get(name);
	if (
		alias === undefined ||
		(alias.typeParameters !== null && alias.typeParameters !== undefined)
	) {
		return false;
	}
	const nextVisited = new Set(visited);
	nextVisited.add(name);
	return typeResolvesToUnknown(alias.typeAnnotation, aliases, shadowedAliases, nextVisited);
}
