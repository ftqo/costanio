import { test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { activityModules, navigationEscapes, sourceFile } from "@/test/activityNavigationAudit";

/**
 * Two rules about the Discord Activity that concern the shape of the tree, so
 * no single render test can hold them. Both are source scans: a component can
 * be right in its original parent and wrong in a later one.
 */

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(SRC).map((p) => ({ path: relative(SRC, p), src: readFileSync(p, "utf8") }));

/**
 * Rule 1: one import path for the predicate.
 *
 * `inActivityMode` is defined in lib/session (which imports nothing, so
 * lib/preconnect can use it without the Discord SDK) and re-exported from
 * lib/activity. Suppression tests mock `@/lib/activity`, which does nothing to
 * a component that imports from `@/lib/session`, so such a test would pass
 * vacuously.
 *
 * Only files that no suppression test will mock belong in this list.
 */
const SESSION_PATH_ALLOWED = new Set([
  // preconnect runs at import time and must not pull in the SDK.
  "lib/preconnect.ts",
  // The re-export itself.
  "lib/activity.ts",
]);

test("inActivityMode is imported from lib/activity", () => {
  const offenders = files
    .filter(({ path, src }) => {
      if (SESSION_PATH_ALLOWED.has(path)) return false;
      // An import statement that names inActivityMode and resolves to session.
      return /import\s*\{[^}]*\binActivityMode\b[^}]*\}\s*from\s*["'](?:\.\/|@\/lib\/)session["']/.test(
        src,
      );
    })
    .map((f) => f.path);

  expect(offenders, "import inActivityMode from @/lib/activity, not lib/session").toEqual([]);
});

/** Check each navigation site, including nested/lazy components and shared hooks.
 * A predicate elsewhere in the same file is not evidence that a link is safe. */
test("Activity module graph has no unguarded navigation", () => {
  const modules = activityModules(SRC, [
    "routes/Lobby.tsx",
    "routes/Game.tsx",
    "components/Root.tsx",
  ]);
  for (const path of [
    "components/StoreShelves.tsx",
    "components/LanguagePicker.tsx",
    "components/SiteHeader.tsx",
    "lib/auth.tsx",
  ]) {
    expect(modules.has(join(SRC, path)), path).toBe(true);
  }
  const offenders = [...modules].flatMap(([path, file]) =>
    navigationEscapes(file).map((site) => `${relative(SRC, path)}:${site}`),
  );
  expect(
    offenders,
    "Guard each site with inActivityMode or wrap its link in ActivitySafeLink. Unknown destinations fail closed.",
  ).toEqual([]);
});

test.each([
  ['<Link to="/verify" />'],
  ['<a href="https://example.com" />'],
  ['<form action="/auth/discord" />'],
  ['<button formAction="/auth/discord" />'],
  ['<Link to="/game" target="_blank" />'],
  ['navigate({ to: "/play" })'],
  ["router.navigate({ to: destination })"],
  ['window.open("https://example.com")'],
  ['window.location.href = "/play"'],
  ['location.assign("/login")'],
  ['window.history.pushState({}, "", "/play")'],
  ['redirect({ to: "/login" })'],
  ['anchor.href = "/support"'],
  ['anchor.setAttribute("href", "/support")'],
  ['sdk.commands.openExternalLink({ url: "https://example.com" })'],
])("flags an unguarded escape beside a guarded one: %s", (escape) => {
  const file = sourceFile(
    "fixture.tsx",
    `
    function Safe() { if (inActivityMode()) return null; return <Link to="/" />; }
    function Unsafe() { return ${escape}; }
  `,
  );
  expect(navigationEscapes(file)).toHaveLength(1);
});

test("accepts guards, safe links and table transitions", () => {
  const file = sourceFile(
    "fixture.tsx",
    `
    function Early() { if (inActivityMode()) return null; return <a href="/" />; }
    function Branch() { return inActivityMode() ? <span /> : <Link to="/profile" />; }
    function And() { return !inActivityMode() && <a href="/support" />; }
    function Or() { return inActivityMode() || <a href="/support" />; }
    function GuardedEffect() { if (failed && !inActivityMode()) navigate({ to: "/play" }); }
    function Disabled() { return <ActivitySafeLink><Link to="/verify" /></ActivitySafeLink>; }
    function Rematch() { navigate({ to: "/lobby", search: { g: next, inv } }); }
    function Start() { navigate({ to: "/game", search: { g } }); }
  `,
  );
  expect(navigationEscapes(file)).toEqual([]);
});

test("flags links behind partial or unrelated guards", () => {
  const file = sourceFile(
    "fixture.tsx",
    `
    function Partial() { if (inActivityMode() && loading) return null; return <Link to="/" />; }
    function Unrelated() { if (loading) return null; return <Link to="/" />; }
    function Opposite() { if (!inActivityMode()) return null; return <Link to="/" />; }
  `,
  );
  expect(navigationEscapes(file)).toHaveLength(3);
});

test("recognizes aliased router imports and navigation hooks", () => {
  const file = sourceFile(
    "fixture.tsx",
    `
    import { Link as RouteLink, useNavigate as useNav } from "@tanstack/react-router";
    function Escape() { const go = useNav(); go({ to: "/verify" }); return <RouteLink to="/replay" />; }
  `,
  );
  expect(navigationEscapes(file)).toHaveLength(2);
});

test.each(["routes/Lobby.tsx", "routes/Game.tsx"])(
  "flags %s without its ActivitySafeLink wrappers",
  (path) => {
    const source = readFileSync(join(SRC, path), "utf8");
    const unguarded = source
      .replaceAll("<ActivitySafeLink>", "<>")
      .replaceAll("</ActivitySafeLink>", "</>");
    const escapes = navigationEscapes(sourceFile(path, unguarded));
    expect(
      escapes.some((site) => site.includes(path.includes("Lobby") ? "/map-builder" : "/replay")),
    ).toBe(true);
    if (path.includes("Game")) expect(escapes.some((site) => site.includes("/verify"))).toBe(true);
  },
);

test("audits hoisted callbacks declared after a guard", () => {
  const file = sourceFile(
    "fixture.tsx",
    `
    function Screen() {
      escape();
      if (inActivityMode()) return null;
      function escape() { navigate({ to: "/play" }); }
      return null;
    }
  `,
  );
  expect(navigationEscapes(file)).toHaveLength(1);
});
