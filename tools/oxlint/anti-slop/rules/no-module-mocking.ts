import { defineRule } from "@oxlint/plugins";

import type { Definition, ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);
const frameworkModuleSources = new Set(["@jest/globals", "jest", "vitest"]);
const frameworkObjectNames = new Set(["jest", "vi"]);

function unwrapParenthesizedExpression(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function importSource(definition: Definition): string | null {
  if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
    return null;
  }
  return definition.parent.source.value;
}

function isNamedFrameworkImport(definition: Definition): boolean {
  const source = importSource(definition);
  const name = importedName(definition.node);
  return (
    (source === "vitest" && name === "vi") ||
    ((source === "@jest/globals" || source === "jest") && name === "jest")
  );
}

function isFrameworkModuleImport(definition: Definition): boolean {
  const source = importSource(definition);
  if (source === null || !frameworkModuleSources.has(source)) return false;
  return (
    definition.node.type === "ImportDefaultSpecifier" ||
    definition.node.type === "ImportNamespaceSpecifier"
  );
}

function identifierIsFrameworkObject(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): boolean {
  if (
    (identifier.name === "vi" || identifier.name === "jest") &&
    sourceCode.isGlobalReference(identifier)
  ) {
    return true;
  }

  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || variable.defs.length === 0) {
    return identifier.name === "vi" || identifier.name === "jest";
  }
  return variable.defs.some(
    (definition) => isNamedFrameworkImport(definition) || isFrameworkModuleImport(definition),
  );
}

function identifierIsFrameworkModule(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): boolean {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null) return false;
  return variable.defs.some((definition) => isFrameworkModuleImport(definition));
}

function memberPropertyName(expression: ESTree.MemberExpression): string | null {
  if (expression.computed) {
    const { property } = expression;
    return property.type === "Literal" &&
      (property.value === "doMock" ||
        property.value === "jest" ||
        property.value === "mock" ||
        property.value === "unstable_mockModule" ||
        property.value === "vi")
      ? property.value
      : null;
  }
  return expression.property.type === "Identifier" ? expression.property.name : null;
}

function isTestFrameworkObject(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
): boolean {
  const unwrapped = unwrapParenthesizedExpression(expression);
  if (unwrapped.type === "Identifier") {
    return identifierIsFrameworkObject(sourceCode, unwrapped);
  }
  if (!("property" in unwrapped) || !("object" in unwrapped) || !("computed" in unwrapped)) {
    return false;
  }
  const propertyName = memberPropertyName(unwrapped);
  if (propertyName === null || !frameworkObjectNames.has(propertyName)) return false;
  const object = unwrapParenthesizedExpression(unwrapped.object);
  return object.type === "Identifier" && identifierIsFrameworkModule(sourceCode, object);
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  const unwrapped = unwrapParenthesizedExpression(callee);
  if (!("property" in unwrapped) || !("object" in unwrapped) || !("computed" in unwrapped)) {
    return false;
  }
  if (!isTestFrameworkObject(sourceCode, unwrapped.object)) return false;
  const method = memberPropertyName(unwrapped);
  return method !== null && moduleMockMethods.has(method);
}

/** Ban test framework module mocking in favor of real dependency seams. */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.",
    },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (moduleMockCall(context.sourceCode, node.callee)) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
    };
  },
});
