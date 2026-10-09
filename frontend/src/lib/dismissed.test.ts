import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isDismissed, dismiss, undismiss } from "./dismissed";

describe("dismissed", () => {
  beforeEach(() => localStorage.clear());

  it("is false until dismissed, and true after", () => {
    expect(isDismissed("k")).toBe(false);
    dismiss("k");
    expect(isDismissed("k")).toBe(true);
  });

  it("undismiss puts it back", () => {
    dismiss("k");
    undismiss("k");
    expect(isDismissed("k")).toBe(false);
  });

  it("keys do not bleed into each other", () => {
    dismiss("a");
    expect(isDismissed("b")).toBe(false);
  });

  it("namespaces its storage keys", () => {
    dismiss("theme");
    expect(localStorage.getItem("theme"), "the bare key is untouched").toBeNull();
    expect(localStorage.getItem("dismissed:theme")).toBe("1");
  });

  // A browser that blocks site data throws on access; the dialog must still
  // open.
  describe("when storage throws", () => {
    beforeEach(() => {
      const boom = () => {
        throw new DOMException("denied", "SecurityError");
      };
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    });
    // restoreAllMocks restores the real Storage methods; reassigning them by
    // hand trips the linter's unbound-method rule.
    afterEach(() => vi.restoreAllMocks());

    it("reads as not dismissed rather than throwing", () => {
      expect(isDismissed("k")).toBe(false);
    });
    it("writes are a no-op rather than throwing", () => {
      expect(() => dismiss("k")).not.toThrow();
      expect(() => undismiss("k")).not.toThrow();
    });
  });
});
