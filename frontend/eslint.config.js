import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { plugin as shadcn } from "@shadcn/lint";

// Every class category @shadcn/lint knows, plus the theme's radius names
// (rounded-control, -base, -card, -card-lg), which no-restyle reads as
// "unclassified". They go in as `rounded-*` because naming each one prints a
// warning on every run. A contract allowing all of these hands the component's
// whole look to the call site. A contract replaces the keys it writes and
// inherits the rest, so `deny: []` alone would still inherit
// `allow: ["layout"]`.
const THEME_RADII = ["rounded-*"];
const ANY_LOOK = [
  "layout",
  "color",
  "typography",
  "spacing",
  "shape",
  "effects",
  "motion",
  ...THEME_RADII,
];

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        // Use the TS project service so the flat config picks up the
        // tsconfig project references (app + node) automatically.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // The react-hooks v6 "recommended" set ships the React Compiler rules as
      // errors. They flag advisory patterns (setState in effects, ref access in
      // render, impure reads during render) whose fixes are component
      // refactors, not lint cleanups, so they are off rather than left as
      // permanent warnings. To work one down, flip it to "warn", or for one run:
      // `npx eslint . --rule '{"react-hooks/refs":"warn"}'`.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",

      // Fast-refresh ergonomics, not correctness. Many `routes/` and `lib/`
      // files export a component alongside helpers; the cost is a route reload
      // instead of a hot swap.
      "react-refresh/only-export-components": "off",

      // The phosphor barrel, banned everywhere but src/lib/icons.ts. Vite's dev
      // server pre-bundles all ~1500 icons into a 6 MB chunk every page waits
      // on. Production tree-shakes it, so only dev would notice.
      //
      // Type imports are erased, so `import type { Icon }` is allowed (see
      // components/game/hudIcons).
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@phosphor-icons/react",
              message:
                "Import icons from @/lib/icons instead: the barrel pulls ~1500 icons (6MB) into the dev server's module graph. Add the icon there if it is missing.",
              allowTypeImports: true,
            },
          ],
        },
      ],

      // `exhaustive-deps` stays an error: a missing dep is a stale-closure bug.
      // Each intentional omission carries an eslint-disable-next-line saying
      // which value is left out and why.
      "react-hooks/exhaustive-deps": "error",

      // Matches tsconfig's `noUnusedLocals`/`noUnusedParameters`, which ignore
      // a leading underscore.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
    // A stale eslint-disable fails rather than warns.
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  // Tests trade type-strictness for expressiveness: they cast fixtures, stub
  // globals, and fire-and-forget promises freely. Relax the type-aware rules
  // there so the signal stays in application code.
  {
    files: ["**/*.test.{ts,tsx}", "**/*.bootstrap.test.{ts,tsx}", "src/test/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      // Browser API stubs (AudioContext's createBufferSource and friends) need
      // the outer stub's `this` inside returned objects.
      "@typescript-eslint/no-this-alias": "off",
    },
  },
  // The design-system lint (@shadcn/lint): six rules that read class strings,
  // style props and SVG colour attributes against the Tailwind v4 theme in
  // src/index.css and the primitives in src/components/ui. All are errors.
  // Findings that existed at adoption are budgeted per file per rule in
  // `eslint-suppressions.json`; a count above or below the budget fails until
  // pruned (`npx eslint --prune-suppressions`), so the budget only goes down.
  //
  // There is no components.json, so `ui` names the primitives by import prefix,
  // and the theme is "the stylesheet that imports tailwindcss" (src/index.css).
  // That picks up the @theme tokens, the @custom-variants (lg, max-lg, squat),
  // the @utility declarations and every plain class selector (hud-*, site
  // surfaces, seat and card classes).
  //
  // To take one exception, say why on the line:
  //   // eslint-disable-next-line shadcn/<rule> -- <reason>
  // `reportUnusedDisableDirectives` above makes a stale one fail.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { shadcn },
    settings: {
      shadcn: {
        ui: "@/components/ui",
        note: "Exception: // eslint-disable-next-line shadcn/<rule> -- <reason>. Budgeted findings live in frontend/eslint-suppressions.json and may only go down (CONTRIBUTING.md, the lint gate).",
      },
    },
    rules: {
      // A primitive owns its look; a caller owns only layout (margin, width,
      // position, flex/grid placement). The contracts below are containers,
      // where padding and gap belong to the caller's content.
      "shadcn/no-restyle": [
        "error",
        {
          allow: ["layout"],
          contracts: [
            // A surface: fill, rim, radius and lift are variants; padding and
            // gap belong to its content.
            { pattern: "^Card$", allow: ["layout", "spacing"] },
            { pattern: "^DialogContent$", allow: ["layout", "spacing"] },
            // A scroll container: `className` styles the inner scroller, which
            // is the caller's list. `no-scrollbar` is our @utility.
            { pattern: "^ScrollFade$", allow: ["layout", "spacing", "no-scrollbar"] },
            // A placeholder takes the shape of the thing it stands in for.
            { pattern: "^Skeleton$", allow: ["layout", "shape", ...THEME_RADII] },
            // Menu is behaviour (anchoring, focus, arrow keys); its
            // `triggerClassName` is the trigger's whole look, usually from
            // buttonVariants/iconButtonVariants.
            { pattern: "^Menu$", allow: ANY_LOOK },
            // Likewise Radix's Close and Trigger, re-exported bare by
            // dialog.tsx.
            { pattern: "^Dialog(Close|Trigger)$", allow: ANY_LOOK },
          ],
        },
      ],
      // Clean at adoption. Colour comes from theme tokens; a brand mark that
      // must stay its owner's exact colour takes a disable with the reason.
      "shadcn/no-raw-colors": "error",
      // Budgeted. Most of what is left is the px type scale (text-[13px] and
      // friends). The linter's suggestion text-[12px] -> text-xs is not
      // pixel-identical: text-xs also sets a line-height.
      "shadcn/no-arbitrary-values": "error",
      // Budgeted. A value computed at runtime (a seat colour, a board
      // coordinate) goes through a custom property and a class that reads it:
      //   style={{ "--swatch": hex } as React.CSSProperties} className="bg-(--swatch)"
      // The key must be a literal: `["--x" as string]` is unreadable to the rule.
      "shadcn/no-inline-styles": "error",
      // The allow list is CSS loaded outside the theme's import graph, plus DOM
      // hooks with no CSS.
      "shadcn/no-unknown-classes": [
        "error",
        {
          allow: [
            // animate.css, imported by main.tsx (the End-turn wobble).
            "animate__*",
            // A test and query hook on the turn timer (TurnTimerEdge), no CSS.
            "seat-timer",
          ],
        },
      ],
      // Budgeted. A class the linter cannot read is a class none of the rules
      // above checked.
      "shadcn/require-static-classes": "error",
    },
  },
  // The primitives define the look, so restyling and dynamic classes (cva,
  // conditional tones) are allowed. Colour, arbitrary values and inline styles
  // stay checked.
  {
    files: ["src/components/ui/**"],
    rules: {
      "shadcn/no-restyle": "off",
      "shadcn/require-static-classes": "off",
    },
  },
  // The dev gallery (dev builds only, never routed in production) renders the
  // real components as fixtures: fixed-width frames that mimic a viewport,
  // per-state overrides passed straight to a primitive, and inline swatches.
  // That is the harness's job, not a style the app ships, so the design-system
  // rules would only fill the suppressions file with noise.
  {
    files: ["src/dev-gallery/**"],
    rules: {
      "shadcn/no-restyle": "off",
      "shadcn/no-raw-colors": "off",
      "shadcn/no-arbitrary-values": "off",
      "shadcn/no-inline-styles": "off",
      "shadcn/no-unknown-classes": "off",
      "shadcn/require-static-classes": "off",
    },
  },
  // The error boundary may render with no stylesheet, so its layout is inline.
  {
    files: ["src/lib/ErrorBoundary.tsx"],
    rules: { "shadcn/no-inline-styles": "off" },
  },
  // Tests assert on class strings (cn merging, variant output) as data.
  {
    files: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    rules: {
      "shadcn/no-restyle": "off",
      "shadcn/no-raw-colors": "off",
      "shadcn/no-arbitrary-values": "off",
      "shadcn/no-inline-styles": "off",
      "shadcn/no-unknown-classes": "off",
      "shadcn/require-static-classes": "off",
    },
  },
  {
    // The one module allowed the deep icon paths; it curates them.
    files: ["src/lib/icons.ts"],
    rules: { "@typescript-eslint/no-restricted-imports": "off" },
  },
  // Config and tooling files run in Node and are not part of the app program.
  {
    files: ["*.{js,ts}", "vite.config.ts"],
    languageOptions: { globals: globals.node },
    extends: [tseslint.configs.disableTypeChecked],
  },
  // The dev harnesses in dev/ are outside tsconfig.app.json, so they are
  // linted without type information.
  {
    files: ["dev/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    extends: [tseslint.configs.disableTypeChecked],
  },
  // eslint-config-prettier last: turn off rules that conflict with Prettier
  // so ESLint owns correctness and Prettier owns formatting.
  prettier,
);
