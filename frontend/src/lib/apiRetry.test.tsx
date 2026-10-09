import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ApiErr, isFatalApiError, retryUnlessFatal, retryBackoffMs } from "./api";

// The server meters the event log, so a client can get a 429 mid-game. The
// Game and Lobby screens navigate away on a terminal error, so a 429 must not
// count as one.

describe("isFatalApiError", () => {
  it("treats 401, 403 and 404 as fatal", () => {
    expect(isFatalApiError(new ApiErr(404, "NOT_FOUND"))).toBe(true);
    expect(isFatalApiError(new ApiErr(403, "FORBIDDEN"))).toBe(true);
    expect(isFatalApiError(new ApiErr(401, "UNAUTHENTICATED"))).toBe(true);
  });

  it("does not treat 429 as fatal", () => {
    expect(isFatalApiError(new ApiErr(429, "RATE_LIMITED"))).toBe(false);
  });

  it("does not treat server or network errors as fatal", () => {
    expect(isFatalApiError(new ApiErr(500, "INTERNAL"))).toBe(false);
    expect(isFatalApiError(new ApiErr(503, "INTERNAL"))).toBe(false);
    expect(isFatalApiError(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("retryUnlessFatal", () => {
  it("retries a 429 and not a 404", () => {
    expect(retryUnlessFatal(0, new ApiErr(429, "RATE_LIMITED"))).toBe(true);
    expect(retryUnlessFatal(2, new ApiErr(429, "RATE_LIMITED"))).toBe(true);
    expect(retryUnlessFatal(0, new ApiErr(404, "NOT_FOUND"))).toBe(false);
  });

  it("stops retrying a 429 after the limit", () => {
    expect(retryUnlessFatal(4, new ApiErr(429, "RATE_LIMITED"))).toBe(false);
  });

  it("backs off exponentially, capped", () => {
    const delays = [0, 1, 2, 3, 20].map(retryBackoffMs);
    for (let i = 1; i < 4; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    expect(delays[4]).toBeLessThanOrEqual(15_000);
  });
});

/** Mount a query using the exact options the game/lobby screens pass. */
function mountQuery(queryFn: () => Promise<string>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const result = { data: undefined as string | undefined, isError: false, fatal: false };
  function Harness() {
    const q = useQuery({
      queryKey: ["game", "g1"],
      queryFn,
      retry: retryUnlessFatal,
      retryDelay: retryBackoffMs,
    });
    result.data = q.data;
    result.isError = q.isError;
    // The redirect condition both screens use.
    result.fatal = q.isError && isFatalApiError(q.error);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  return { result, root, client };
}

describe("the ['game', id] query under a rate limit", () => {
  it("retries through a 429 to the result", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls <= 2) throw new ApiErr(429, "RATE_LIMITED");
      return "detail";
    });
    const { result, root } = mountQuery(fn);

    // Drain the retry backoff: advance past each delay and let the refetch settle.
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
    }
    expect(result.data).toBe("detail");
    expect(result.isError).toBe(false);
    expect(result.fatal).toBe(false);
    expect(calls).toBe(3);
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("never surfaces a 429 as a fatal error", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new ApiErr(429, "RATE_LIMITED");
    });
    const { result, root } = mountQuery(fn);
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
    }
    expect(result.isError).toBe(true);
    // isError, but not the kind of error that sends the player to /play.
    expect(result.fatal).toBe(false);
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("fails a 404 without retrying", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new ApiErr(404, "NOT_FOUND");
    });
    const { result, root } = mountQuery(fn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.isError).toBe(true);
    expect(result.fatal).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    vi.useRealTimers();
  });
});
