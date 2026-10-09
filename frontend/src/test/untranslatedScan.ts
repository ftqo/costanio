/**
 * Finds user-facing English that never passes through Lingui.
 *
 * A literal that was never wrapped in `t`, `msg` or `<Trans>` is in no `.po`
 * file, so no translator sees it. This walks the TypeScript AST of every
 * non-test source file and reports the literals a person reads:
 *
 *  - `jsx-text`: text between JSX tags (`<p>Hello</p>`).
 *  - `jsx-attr`: a string literal on a prop a person reads (`title`,
 *    `aria-label`, `placeholder`, `alt`, `label`, and the rest of
 *    `READ_PROPS`).
 *  - `jsx-expr`: a string literal or template inside a JSX child expression
 *    (`{busy ? "Saving" : "Save"}`), or inside a readable prop's expression.
 *  - `prop`: a string literal as the value of an object property named like
 *    copy (`label: "Trade"`), which is how menus, tabs and headers are built.
 *  - `call`: a string literal handed to something that shows it: `toast.*`,
 *    `alert`, `confirm`, `document.title =`.
 *  - `return`: a phrase (words with a space between them) a function returns,
 *    directly or through a conditional, as lib/ helpers hand copy to
 *    components.
 *  - `join`: `.join(", ")`, `.join(" and ")` and kin. A hand-rolled list is
 *    English list grammar; `formatList` in lib/intl asks the locale instead.
 *  - `locale`: a hard-coded locale tag passed to `Intl.*` or `toLocale*`, or a
 *    bare `toLocaleString()` that follows the browser instead of the app.
 *
 * Anything lexically inside a Lingui macro (`t`, `msg`, `defineMessage`,
 * `plural`, `select`, `selectOrdinal`, `<Trans>`, `<Plural>`, `<Select>`) is
 * already translated and skipped, as is `console.*`.
 *
 * It is a heuristic. A "sentence-like" test (letters, and either a space or a
 * capital) decides what is copy, so single lowercase tokens never report.
 * Remaining literals that are not for translation (brand names, dev-only
 * pages, the wordmark) are listed with a reason in `untranslatedAllow.json`,
 * keyed by file and exact text, so a moved line keeps its entry and a changed
 * string does not.
 */
import ts from "typescript";

export type FindingKind =
  | "jsx-text"
  | "jsx-attr"
  | "jsx-expr"
  | "prop"
  | "call"
  | "return"
  | "join"
  | "locale";

export interface Finding {
  file: string; // relative to frontend/src, forward slashes
  line: number;
  kind: FindingKind;
  text: string;
}

/** Props whose string value is read by a person (or a screen reader). */
export const READ_PROPS = new Set([
  "title",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "aria-roledescription",
  "placeholder",
  "alt",
  "label",
  "hint",
  "tooltip",
  "description",
  "message",
  "heading",
  "caption",
  "subtitle",
  "text",
  "triggerLabel",
  "emptyText",
  "emptyLabel",
  "confirmLabel",
  "cancelLabel",
  "actionLabel",
  "prompt",
  "detail",
  "summary",
  "body",
  "lede",
  "blurb",
  "note",
  "eyebrow",
  "headline",
  "tip",
]);

/** Object keys whose string value is copy when it looks like a sentence. */
export const READ_KEYS = new Set([
  "label",
  "title",
  "description",
  "hint",
  "text",
  "message",
  "tooltip",
  "heading",
  "caption",
  "subtitle",
  "placeholder",
  "blurb",
  "summary",
  "body",
  "detail",
  "lede",
  "note",
  "prompt",
  "headline",
  "eyebrow",
  "shortLabel",
  "aria",
  "ariaLabel",
  "tip",
  "name",
]);

const MACRO_TAGS = new Set(["t", "msg", "defineMessage"]);
const MACRO_CALLS = new Set(["t", "msg", "defineMessage", "plural", "select", "selectOrdinal"]);
const MACRO_JSX = new Set(["Trans", "Plural", "Select", "SelectOrdinal"]);
const DISPLAY_CALLEES = new Set(["alert", "confirm", "prompt"]);

/** Does this look like words a person reads, rather than a token? */
export function sentenceLike(s: string): boolean {
  const v = s.trim();
  if (v.length < 2) return false;
  if (!/[A-Za-z]{2}/.test(v)) return false;
  // CSS/class strings, paths, URLs, identifiers, selectors, units.
  if (/^[a-z0-9_.:/#@-]+$/.test(v)) return false;
  if (/^(https?:|\/|\.\/|#|--|data:|mailto:)/.test(v)) return false;
  if (/^[A-Z0-9_]+$/.test(v)) return false; // CONSTANT_CASE codes
  if (/^[a-z][a-zA-Z0-9]*$/.test(v)) return false; // camelCase ids
  if (/^[a-z]+(\.[a-zA-Z0-9_-]+)+$/.test(v)) return false; // dotted ids
  // Tailwind-ish class lists: every token lowercase and punctuated.
  if (/^[a-z0-9:[\]()/.%#!&_,>=+*-]+(\s+[a-z0-9:[\]()/.%#!&_,>=+*-]+)+$/.test(v)) {
    // ...unless it is plainly prose: all tokens alphabetic words.
    if (!/^[a-z]+( [a-z]+)*[.!?]?$/.test(v) || v.split(/\s+/).length < 3) return false;
  }
  if (/^[\d\s.,:;%+×x·/()-]+$/i.test(v)) return false;
  // Code: GLSL, CSS, JS in a template. Prose opens a parenthesis after a
  // space, never straight after a word, and has no braces or assignments.
  if (/[{}=]|\w\(/.test(v)) return false;
  // snake_case identifiers and material names (`Mat_RobberSkin_Body`).
  if (/^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)+$/.test(v)) return false;
  return /\s/.test(v) || /^[A-Z]/.test(v);
}

function isMacroTag(tag: ts.Expression): boolean {
  if (ts.isIdentifier(tag)) return MACRO_TAGS.has(tag.text);
  // i18n._(msg`…`) is a call; `t(i18n)` tagged form: t(i18n)`…`
  if (ts.isCallExpression(tag) && ts.isIdentifier(tag.expression))
    return MACRO_TAGS.has(tag.expression.text);
  return false;
}

function calleeName(e: ts.Expression): string {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return `${calleeName(e.expression)}.${e.name.text}`;
  return "";
}

function jsxTagName(n: ts.JsxTagNameExpression): string {
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  return "";
}

function inMacro(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isTaggedTemplateExpression(p) && isMacroTag(p.tag)) return true;
    if (ts.isCallExpression(p)) {
      const name = calleeName(p.expression);
      if (MACRO_CALLS.has(name) || name.startsWith("console.")) return true;
      if (name === "i18n._" || name.endsWith(".i18n._")) return true;
    }
    if (ts.isJsxElement(p) && MACRO_JSX.has(jsxTagName(p.openingElement.tagName))) return true;
    if (ts.isJsxSelfClosingElement(p) && MACRO_JSX.has(jsxTagName(p.tagName))) return true;
  }
  return false;
}

/** The nearest enclosing JSX attribute, if the node sits in one's expression. */
function enclosingAttr(node: ts.Node): ts.JsxAttribute | undefined {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) return p;
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isFunctionLike(p))
      return undefined;
  }
  return undefined;
}

function attrName(a: ts.JsxAttribute): string {
  return ts.isIdentifier(a.name) ? a.name.text : `${a.name.namespace.text}:${a.name.name.text}`;
}

/**
 * A literal whose value is compared or used as a key rather than shown:
 * `x === "Foo"`, `case "Foo":`, `m.get("Foo")`, an index `a["Foo"]`.
 */
function usedAsValue(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    return (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken
    );
  }
  if (ts.isCaseClause(p)) return true;
  if (ts.isElementAccessExpression(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p))
    return true;
  return false;
}

/** Is this expression's value the thing rendered, within a JSX child/prop? */
function renderedInJsx(node: ts.Node): boolean {
  // Walk up through expressions that pass their operand through unchanged:
  // conditionals, ||/??/&&, parentheses, `as`, arrays of children.
  let cur: ts.Node = node;
  for (;;) {
    const p = cur.parent;
    if (!p) return false;
    if (ts.isJsxExpression(p)) return true;
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p)) {
      cur = p;
      continue;
    }
    if (ts.isConditionalExpression(p) && (p.whenTrue === cur || p.whenFalse === cur)) {
      cur = p;
      continue;
    }
    if (ts.isBinaryExpression(p)) {
      const op = p.operatorToken.kind;
      if (
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken ||
        (op === ts.SyntaxKind.AmpersandAmpersandToken && p.right === cur) ||
        op === ts.SyntaxKind.PlusToken
      ) {
        cur = p;
        continue;
      }
    }
    if (ts.isTemplateSpan(p)) {
      cur = p.parent;
      continue;
    }
    return false;
  }
}

/**
 * Walk up from a literal through the expressions that pass it on unchanged
 * (parentheses, `as`, the arms of `?:`, `||`, `??`) to the outermost one, so
 * `name: known ?? "Seat 1"` is judged by where the whole expression goes.
 */
function lift(node: ts.Node): ts.Node {
  let cur: ts.Node = node;
  for (;;) {
    const p = cur.parent;
    if (!p) return cur;
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p)) {
      cur = p;
      continue;
    }
    if (ts.isConditionalExpression(p) && (p.whenTrue === cur || p.whenFalse === cur)) {
      cur = p;
      continue;
    }
    if (
      ts.isBinaryExpression(p) &&
      (p.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      cur = p;
      continue;
    }
    return cur;
  }
}

/** Is this literal the value a function returns? */
function returned(node: ts.Node): boolean {
  const top = lift(node);
  const p = top.parent;
  return !!p && (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === top));
}

/** The object key this literal is the value of, if any. */
function propKey(node: ts.Node): string | undefined {
  const top = lift(node);
  const p = top.parent;
  if (!p || !ts.isPropertyAssignment(p) || p.initializer !== top) return undefined;
  return ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : undefined;
}

const LIST_JOINERS = new Set([", ", " and ", " or ", " & ", "، ", "、"]);

const LOCALE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function scanSource(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: Finding[] = [];
  const add = (node: ts.Node, kind: FindingKind, text: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({ file, line: line + 1, kind, text: text.replace(/\s+/g, " ").trim() });
  };

  const literalText = (n: ts.Node): string | undefined => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) {
      return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join("${}");
    }
    return undefined;
  };

  const visit = (node: ts.Node) => {
    // Hard-coded locales and browser-locale formatting.
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = calleeName(node.expression);
      const args = node.arguments ?? ts.factory.createNodeArray();
      const isIntl = /^Intl\.\w+$/.test(name) && ts.isNewExpression(node);
      const isToLocale = /\.toLocale(String|DateString|TimeString|UpperCase|LowerCase)$/.test(name);
      if (isIntl || isToLocale) {
        const first = args[0];
        if (
          first &&
          (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) &&
          LOCALE_TAG.test(first.text)
        ) {
          add(first, "locale", `${name}(${JSON.stringify(first.text)})`);
        } else if (!first && isToLocale && !/(Upper|Lower)Case$/.test(name)) {
          add(node, "locale", `${name}()`);
        } else if (!first && isIntl && name !== "Intl.Collator") {
          add(node, "locale", `new ${name}()`);
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "join" &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      LIST_JOINERS.has(node.arguments[0].text) &&
      !inMacro(node)
    ) {
      add(node, "join", `.join(${JSON.stringify(node.arguments[0].text)})`);
    }

    if (ts.isJsxText(node)) {
      // An entity alone (`&times;`, `&nbsp;`) is a symbol, not a word.
      const text = node.text.replace(/&[a-zA-Z]+;|&#\d+;/g, " ");
      if (/[A-Za-z]/.test(text) && !inMacro(node)) add(node, "jsx-text", node.text);
      return;
    }

    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      if (READ_PROPS.has(attrName(node)) && sentenceLike(node.initializer.text) && !inMacro(node)) {
        add(node.initializer, "jsx-attr", node.initializer.text);
      }
      return;
    }

    const lit = literalText(node);
    if (lit !== undefined) {
      if (!inMacro(node) && !usedAsValue(node)) {
        const shown = lit.replace(/\$\{\}/g, " ");
        const p = node.parent;
        if (ts.isTaggedTemplateExpression(p)) {
          // someone`…` that is not a macro: not our concern
        } else if (renderedInJsx(node) && sentenceLike(shown)) {
          const attr = enclosingAttr(node);
          if (!attr || READ_PROPS.has(attrName(attr))) add(node, "jsx-expr", lit);
        } else if (READ_KEYS.has(propKey(node) ?? "") && sentenceLike(shown)) {
          add(node, "prop", lit);
        } else if (
          (ts.isCallExpression(p) &&
            p.arguments[0] === node &&
            (/^toast(\.\w+)?$/.test(calleeName(p.expression)) ||
              DISPLAY_CALLEES.has(calleeName(p.expression)) ||
              calleeName(p.expression) === "window.alert" ||
              calleeName(p.expression) === "window.confirm")) ||
          (ts.isBinaryExpression(p) &&
            p.right === node &&
            p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            calleeName(p.left) === "document.title")
        ) {
          if (sentenceLike(shown)) add(node, "call", lit);
        } else if (returned(node) && /\s/.test(shown.trim()) && sentenceLike(shown)) {
          add(node, "return", lit);
        }
      }
      // Template spans still need their expressions visited.
      if (!ts.isTemplateExpression(node)) return;
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export interface AllowEntry {
  file: string;
  /** Exact normalised text, or omitted to allow every finding in the file. */
  text?: string;
  kind?: FindingKind;
  reason: string;
}

export function isAllowed(f: Finding, allow: readonly AllowEntry[]): boolean {
  return allow.some(
    (a) =>
      (a.file === f.file || (a.file.endsWith("/**") && f.file.startsWith(a.file.slice(0, -2)))) &&
      (a.text === undefined || a.text === f.text) &&
      (a.kind === undefined || a.kind === f.kind),
  );
}
