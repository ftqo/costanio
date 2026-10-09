import { describe, it, expect } from "vitest";
import { replayFilename } from "@/lib/matches";

describe("replayFilename", () => {
  it("names the file after the game id", () => {
    // The id is the handle the server, a bug report and costan-sim share.
    expect(replayFilename("g-42")).toBe("costan-replay-g-42.json");
  });

  it("keeps the characters a real id is made of", () => {
    expect(replayFilename("aB9_x-1.2")).toBe("costan-replay-aB9_x-1.2.json");
  });

  // Ids are server-generated, but a slash would retarget the download.
  it("neutralises anything that would escape the filename", () => {
    expect(replayFilename("../../etc/passwd")).toBe("costan-replay-.._.._etc_passwd.json");
    expect(replayFilename("a b")).toBe("costan-replay-a_b.json");
  });
});
