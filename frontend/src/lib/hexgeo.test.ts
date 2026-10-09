import { describe, it, expect } from "vitest";
import { vertexNeighbors, vertexKey } from "./hexgeo";

describe("vertexNeighbors", () => {
  const V = (q: number, r: number, side: 0 | 1) => ({ q, r, side });

  it("matches engine/board/coords.go's Vertex.Neighbors, side by side", () => {
    // The exact triples the Go table returns. A north vertex reaches three
    // souths and vice versa.
    expect(vertexNeighbors(V(0, 0, 0))).toEqual([V(1, -1, 1), V(0, -1, 1), V(1, -2, 1)]);
    expect(vertexNeighbors(V(0, 0, 1))).toEqual([V(0, 1, 0), V(-1, 1, 0), V(-1, 2, 0)]);
  });

  it("is symmetric: a neighbour of mine has me as a neighbour", () => {
    for (const v of [V(0, 0, 0), V(2, -1, 1), V(-3, 4, 0)])
      for (const n of vertexNeighbors(v))
        expect(vertexNeighbors(n).map(vertexKey)).toContain(vertexKey(v));
  });
});
