import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type FunctionLike = ESTree.Function | ESTree.ArrowFunctionExpression;

const functionKinds: ReadonlySet<string> = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
]);

function isFunctionLike(node: ESTree.Node): node is FunctionLike {
  return functionKinds.has(node.type);
}

/**
 * The name a function is bound to at its declaration site: its own `id` for a
 * `function foo() {}`, or the identifier it is assigned/declared into for a
 * `const foo = () => {}` / `foo = () => {}` / `{ foo: () => {} }`. `null` for a
 * genuinely anonymous function — an inline callback passed as an argument.
 */
function boundName(fn: FunctionLike): string | null {
  if (fn.id !== null) return fn.id.name;
  const parent = fn.parent;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  if (parent.type === "AssignmentExpression" && parent.left.type === "Identifier") {
    return parent.left.name;
  }
  if (parent.type === "Property" && !parent.computed && parent.key.type === "Identifier") {
    return parent.key.name;
  }
  return null;
}

/**
 * The name of the nearest enclosing NAMED function, skipping over anonymous
 * callbacks (`.filter(...)`, `.map(...)`, a bare `if` block's arrow) so that a
 * read nested inside one is still judged by the named function it lives in.
 * `null` when the node sits at the top level, or every enclosing function is
 * itself anonymous.
 */
function enclosingNamedFunctionName(node: ESTree.Node): string | null {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (isFunctionLike(current)) {
      const name = boundName(current);
      if (name !== null) return name;
    }
    current = current.parent;
  }
  return null;
}

/** Deliberately non-subscribing reads live only in these two function shapes. */
function isExemptFunctionName(name: string | null): boolean {
  return name !== null && (name.startsWith("peekCached") || name.startsWith("hasCached"));
}

/** Disallow a non-minting, non-subscribing cache read outside the two function
 *  shapes where it's deliberate. */
export const noNonSubscribingStoreReadRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `cache.get(id)?.accessor()` outside a peekCached*/hasCached* function in a `*-store.ts` organiser cache. Unlike `entryFor(id).accessor()`, this form does not mint the cache entry: when it is absent the optional chain short-circuits before the accessor runs, so a tracked read here registers zero dependencies and never re-runs once the entry is created.",
    },
    messages: {
      nonSubscribingStoreRead:
        "`cache.get({{id}})?.{{accessor}}()` doesn't subscribe: when the entry for {{id}} is absent, the optional chain short-circuits before `{{accessor}}` ever runs, so a tracked read here registers no dependency and never re-runs once the entry is created. Use `entryFor({{id}}).{{accessor}}()` — the subscribing form — instead. This non-minting read is only legitimate inside a `peekCached*`/`hasCached*` function.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        // Match `cache.get(<id>)?.<accessor>()`: an outer call whose callee is
        // an OPTIONAL, non-computed member access off the result of a plain
        // `cache.get(...)` call.
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed || !callee.optional) return;
        if (callee.property.type !== "Identifier") return;

        const getCall = callee.object;
        if (getCall.type !== "CallExpression") return;
        const getCallee = getCall.callee;
        if (getCallee.type !== "MemberExpression" || getCallee.computed) return;
        if (getCallee.object.type !== "Identifier" || getCallee.object.name !== "cache") return;
        if (getCallee.property.type !== "Identifier" || getCallee.property.name !== "get") return;

        const enclosingName = enclosingNamedFunctionName(node);
        if (isExemptFunctionName(enclosingName)) return;

        const accessor = callee.property.name;
        const idArg = getCall.arguments[0];
        const id = idArg === undefined ? "id" : context.sourceCode.getText(idArg);

        context.report({
          node,
          messageId: "nonSubscribingStoreRead",
          data: { id, accessor },
        });
      },
    };
  },
});
