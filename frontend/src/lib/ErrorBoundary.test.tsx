import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./ErrorBoundary";

// Without a boundary a thrown render unmounts the whole tree and leaves an
// empty `<div id="root">`.

function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  // React logs the caught error itself; the suite does not need to read it.
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  act(() => root.render(node));
  errors.mockRestore();
  return {
    host,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function Boom(): React.ReactNode {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    const { host, unmount } = mount(
      <ErrorBoundary>
        <p>the app</p>
      </ErrorBoundary>,
    );
    expect(host.textContent).toBe("the app");
    unmount();
  });

  it("renders a fallback with a reload button on throw", () => {
    const { host, unmount } = mount(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    // The page must not be empty.
    expect(host.textContent).not.toBe("");
    expect(host.querySelector("[role=alert]")).toBeTruthy();
    // And a way out.
    expect(host.querySelector("button")?.textContent).toBe("Reload");
    unmount();
  });

  it("renders the fallback without lingui or classes", () => {
    // It is mounted outside LocaleProvider, so its copy is plain English and
    // its styles are inline.
    const src = ErrorBoundary.prototype.render.toString();
    for (const forbidden of ["useLingui", "Trans", "t`", "className"]) {
      expect(src, `fallback uses ${forbidden}`).not.toContain(forbidden);
    }
  });
});
