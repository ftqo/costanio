import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Conservative source audit, not a JS interpreter. Unknown conditions are
// reachable. Website-only actions must have a local guard or ActivitySafeLink;
// a guard at one caller must not make a shared component appear safe everywhere.
const TABLE_ROUTES = new Set(["/lobby", "/game"]);

export function sourceFile(path: string, source: string) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** Follow static imports, re-exports and literal lazy imports, excluding types/assets. */
export function activityModules(src: string, roots: string[]): Map<string, ts.SourceFile> {
  const found = new Map<string, ts.SourceFile>();
  function visit(path: string) {
    if (found.has(path)) return;
    const file = sourceFile(path, readFileSync(path, "utf8"));
    found.set(path, file);
    function dependency(specifier: ts.Expression | undefined) {
      if (!specifier || !ts.isStringLiteral(specifier)) return;
      const name = specifier.text;
      if (!name.startsWith(".") && !name.startsWith("@/")) return;
      const base = name.startsWith("@/")
        ? resolve(src, name.slice(2))
        : resolve(dirname(path), name);
      const target = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ].find((p) => /\.tsx?$/.test(p) && existsSync(p));
      if (target) visit(target);
    }
    function walk(node: ts.Node) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        if (
          !(
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((e) => e.isTypeOnly) &&
            !node.importClause?.name
          )
        ) {
          dependency(node.moduleSpecifier);
        }
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly) dependency(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        dependency(node.arguments[0]);
      }
      ts.forEachChild(node, walk);
    }
    walk(file);
  }
  roots.forEach((path) => visit(resolve(src, path)));
  return found;
}

export function navigationEscapes(file: ts.SourceFile): string[] {
  const escapes: string[] = [];
  const activityNames = new Set(["inActivityMode"]);
  const linkNames = new Set(["Link"]);
  const navigateNames = new Set(["navigate"]);
  const hookNames = new Set(["useNavigate"]);
  const safeLinkNames = new Set(["ActivitySafeLink"]);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const imported = (binding.propertyName ?? binding.name).text;
      const names = {
        inActivityMode: activityNames,
        Link: linkNames,
        useNavigate: hookNames,
        ActivitySafeLink: safeLinkNames,
      }[imported];
      names?.add(binding.name.text);
    }
  }
  function collect(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      hookNames.has(node.initializer.expression.getText(file))
    ) {
      navigateNames.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  }
  collect(file);

  function value(node: ts.Expression): boolean | undefined {
    if (ts.isParenthesizedExpression(node)) return value(node.expression);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isCallExpression(node) && activityNames.has(node.expression.getText(file))) return true;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const operand = value(node.operand);
      return operand === undefined ? undefined : !operand;
    }
    if (ts.isBinaryExpression(node)) {
      const left = value(node.left),
        right = value(node.right);
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        if (left === false || right === false) return false;
        if (left === true && right === true) return true;
      }
      if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        if (left === true || right === true) return true;
        if (left === false && right === false) return false;
      }
    }
    return undefined;
  }
  function exits(node: ts.Node): boolean {
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true;
    if (ts.isBlock(node)) return node.statements.some(exits);
    if (ts.isIfStatement(node)) {
      const condition = value(node.expression);
      if (condition === true) return exits(node.thenStatement);
      if (condition === false) return !!node.elseStatement && exits(node.elseStatement);
      return exits(node.thenStatement) && !!node.elseStatement && exits(node.elseStatement);
    }
    return false;
  }
  function tableDestination(node: ts.Expression | undefined): boolean {
    if (!node) return false;
    if (ts.isStringLiteral(node)) return TABLE_ROUTES.has(node.text);
    // activityRoute is covered by its own tests.
    return ts.isCallExpression(node) && node.expression.getText(file) === "activityRoute";
  }
  function report(node: ts.Node) {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    escapes.push(`${line + 1}: ${node.getText(file).replace(/\s+/g, " ").slice(0, 180)}`);
  }
  function walk(node: ts.Node) {
    if (ts.isBlock(node)) {
      // Function declarations are hoisted, so a callback declared after an
      // early return may still be called before that return.
      node.statements.filter(ts.isFunctionDeclaration).forEach(walk);
      for (const statement of node.statements) {
        if (!ts.isFunctionDeclaration(statement)) walk(statement);
        if (exits(statement)) break;
      }
      return;
    }
    if (ts.isIfStatement(node)) {
      walk(node.expression);
      const condition = value(node.expression);
      if (condition !== false) walk(node.thenStatement);
      if (condition !== true && node.elseStatement) walk(node.elseStatement);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      walk(node.condition);
      const condition = value(node.condition);
      if (condition !== false) walk(node.whenTrue);
      if (condition !== true) walk(node.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      walk(node.left);
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken && value(node.left) === false) return;
      if (operator === ts.SyntaxKind.BarBarToken && value(node.left) === true) return;
      if (
        operator === ts.SyntaxKind.EqualsToken &&
        /^(?:(?:window|document|globalThis|top|parent)\.)?location$|\.href$/.test(
          node.left.getText(file),
        )
      )
        report(node);
      walk(node.right);
      return;
    }
    if (ts.isJsxElement(node) && safeLinkNames.has(node.openingElement.tagName.getText(file)))
      return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const intrinsic = /^[a-z]/.test(tag);
      const destination = attributes.find(
        (a) =>
          ["href", "to"].includes(a.name.getText(file)) ||
          (intrinsic && ["action", "formAction"].includes(a.name.getText(file))),
      );
      const initializer = destination?.initializer;
      const expression =
        initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
      const newWindow = attributes.some((a) => a.name.getText(file) === "target");
      if (
        (destination || linkNames.has(tag) || tag === "a") &&
        (!tableDestination(expression) || newWindow)
      )
        report(node);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(file);
      if (navigateNames.has(callee) || callee === "redirect" || /\.navigate$/.test(callee)) {
        const options = node.arguments[0];
        const to =
          options && ts.isObjectLiteralExpression(options)
            ? options.properties.find(
                (p): p is ts.PropertyAssignment =>
                  ts.isPropertyAssignment(p) && p.name.getText(file) === "to",
              )?.initializer
            : options;
        if (!tableDestination(to)) report(node);
      } else if (
        /^(?:(?:window|globalThis|top|parent)\.)?open$|(?:^|\.)location\.(?:assign|replace)$|(?:^|\.)history\.(?:pushState|replaceState|go|back|forward)$|\.openExternalLink$/.test(
          callee,
        )
      ) {
        report(node);
      } else if (
        /\.setAttribute$/.test(callee) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        ["href", "action", "formaction"].includes(node.arguments[0].text)
      ) {
        report(node);
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(file);
  return escapes;
}
