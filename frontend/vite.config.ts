import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { lingui } from "@lingui/vite-plugin";
import path from "node:path";
import { readFileSync } from "node:fs";

// Backend origin the dev proxy forwards to. Override with BACKEND_ORIGIN when
// the Go server runs elsewhere.
const BACKEND = process.env.BACKEND_ORIGIN ?? "http://localhost:4757";

// Forward API, auth and WebSocket to the Go backend so the browser only talks
// to the dev origin: same-origin, so the session cookie and the backend's
// strict WebSocket Origin check both work. changeOrigin stays false because
// the backend's dev checkOrigin compares Origin to its own Host. Shared by the
// dev server (HMR) and `vite preview` (the built bundle, used by dev.sh).
const proxy = {
  "/api": { target: BACKEND },
  "/auth": { target: BACKEND },
  "/ws": { target: BACKEND, ws: true },
};

/**
 * Serves the fairness verifier's single-file build at /verify.js, so the
 * /verify page can point people at a checker to run themselves. Serving it
 * from its one source, not a copy under public/, keeps the download identical
 * to the audited original. verify/dist/verify.js is generated
 * (scripts/bundle-verify.mjs) and a Go test fails when it is behind its
 * modules.
 */
const verifierDownload = (): Plugin => {
  const src = path.resolve(__dirname, "../verify/dist/verify.js");
  return {
    name: "costan-verifier-download",
    // Read at request time in dev, so an edit plus a rebuild shows up on reload.
    configureServer(server) {
      server.middlewares.use("/verify.js", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.end(readFileSync(src, "utf8"));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "verify.js", source: readFileSync(src, "utf8") });
    },
  };
};

/**
 * No `build.manualChunks`. Rollup warns that two chunks exceed 500 kB, but
 * splitting would not help either:
 *
 *  - The entry (594 kB, 188 kB gzipped) is react-dom, the @tanstack router and
 *    query, tailwind-merge, the Phosphor icons used, and the app's lib/ and
 *    components/. All of it is needed before the first route mounts, so a
 *    manual split only adds a round trip.
 *  - `loader-*.js` (667 kB, 173 kB gzipped) is three.js, GLTFLoader and the
 *    meshopt decoder, already its own chunk behind the React.lazy boundaries in
 *    routes/Landing, home/HomeScene and SiteHeader's store dialog.
 *
 * To shrink the entry, add a lazy boundary in the source. The warning limit is
 * left as is so it flags the next large dependency that lands in the entry.
 */

/**
 * Tells index.html where each locale's compiled catalogue landed.
 *
 * LocaleProvider holds the first paint until the resolved locale's catalogue
 * (a dynamic import) loads, and Vite emits no modulepreload for this app's
 * chunks, so without this the catalogue is a second serial round trip before
 * the first frame. index.html already resolves the locale inline to stamp
 * `<html lang>`; it lacks only the content-hashed URL. This substitutes the
 * map into that script, which appends one `<link rel="modulepreload">`.
 *
 * Substituted into the script rather than injected as a tag before it: a tag
 * would have to precede `<meta charset>` to be early enough, and eighteen
 * hashed filenames there push the charset past the 1024 bytes a UA sniffs.
 *
 * Build only; in dev the map is absent and the script does nothing. A
 * catalogue compiles to a bare `export const messages = ...` with no imports
 * (see @lingui/vite-plugin), so one link covers it.
 */
const CATALOG_MAP_IDENT = "window.__COSTAN_CATALOGS__";

const catalogPreload = (): Plugin => {
  let base = "/";
  return {
    name: "costan-catalog-preload",
    apply: "build",
    configResolved(resolved) {
      base = resolved.base;
    },
    transformIndexHtml: {
      // `post` puts this in generateBundle, the first point at which the
      // emitted filenames exist.
      order: "post",
      handler(html, ctx) {
        const urls: Record<string, string> = {};
        try {
          for (const output of Object.values(ctx.bundle ?? {})) {
            if (output.type !== "chunk") continue;
            for (const id of [output.facadeModuleId, ...output.moduleIds]) {
              // The module id is still the .po path: the Lingui plugin is a
              // `transform`, so it rewrites the contents and not the id.
              const m = /[\\/]locales[\\/]([^\\/]+)[\\/]messages\.po$/.exec(id ?? "");
              if (m) urls[m[1]] = base + output.fileName;
            }
          }
        } catch {
          // A preload is an optimisation and must never fail the build; an empty
          // map only means a slower first paint.
          return;
        }
        if (!Object.keys(urls).length) return;
        // The identifier is left in place in dev and in a build that matched
        // nothing, where it reads as undefined and the script does nothing.
        return html.replace(CATALOG_MAP_IDENT, JSON.stringify(urls));
      },
    },
  };
};

export default defineConfig({
  plugins: [
    verifierDownload(),
    catalogPreload(),
    // The Lingui macro rewrites t`...` and <Trans> into catalogue lookups at
    // build time, so the English source doubles as message id and fallback. It
    // must run inside the React plugin's Babel pass.
    react({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }),
    // Compiles src/locales/<locale>/messages.po on import, so the .po files are
    // the only catalogue artefact in the tree and each locale is its own chunk.
    lingui(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The fairness verifier lives at the repo root, outside this app. It is
      // a standalone auditor that users run themselves and that the Go tests
      // run against real games, so the page imports the originals rather than
      // a copy that could drift.
      "@verify": path.resolve(__dirname, "../verify"),
    },
  },
  server: {
    port: 4758,
    strictPort: true,
    proxy,
    // Vite serves nothing outside its root by default, so the aliased verifier
    // above would 403 in dev without this.
    fs: { allow: [path.resolve(__dirname), path.resolve(__dirname, "../verify")] },
  },
  preview: {
    port: 4758,
    strictPort: true,
    proxy,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Activates the English catalogue before any test runs; otherwise messages
    // render through the macro's fallback and bypass the catalogue.
    setupFiles: ["./src/testSetup.ts"],
    // Writes an uncompressed copy of every shipped .glb once, for the tests
    // that read the container by hand. See src/testGlbFixtures.ts.
    globalSetup: ["./src/testGlbFixtures.ts"],
  },
});
