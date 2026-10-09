import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth";

// A visitor with no session is not an error. Browsers log every 4xx to the
// console, so the page-load probe must not expect a 401.

let root: Root | null = null;
let calls: string[] = [];
let snapshot: { me: unknown; loading: boolean } | null = null;

function Probe() {
  const { me, loading } = useAuth();
  React.useEffect(() => {
    snapshot = { me, loading };
  });
  return null;
}

function stubFetch(answers: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      calls.push(path);
      const a = answers[path];
      if (a) return a();
      return new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 });
    }),
  );
}

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  const client = new QueryClient();
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  // Let the probe's promise settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  calls = [];
  snapshot = null;
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

test("a visitor with no session is probed without a 401", async () => {
  stubFetch({ "/api/session": () => new Response(null, { status: 204 }) });
  await mount();
  expect(calls).toContain("/api/session");
  // The strict endpoint answers a visitor with a 401.
  expect(calls).not.toContain("/api/users/me");
  expect(snapshot).toEqual({ me: null, loading: false });
});

test("a signed-in visitor gets their profile off the same probe", async () => {
  const me = { id: 7, name: "me", guest: false };
  stubFetch({ "/api/session": () => new Response(JSON.stringify(me), { status: 200 }) });
  await mount();
  expect(snapshot?.me).toEqual(me);
  expect(snapshot?.loading).toBe(false);
});

test("a cached identity the server no longer knows is dropped", async () => {
  localStorage.setItem("costan.me", JSON.stringify({ id: 1, name: "stale", guest: true }));
  stubFetch({ "/api/session": () => new Response(null, { status: 204 }) });
  await mount();
  expect(snapshot?.me).toBeNull();
});
