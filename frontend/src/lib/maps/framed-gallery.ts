import * as React from "react";
import { api } from "@/lib/api";
import type { Board } from "@/lib/types";
import { GALLERY, type GalleryMap } from "./gallery";

// Gallery maps author land only (see gallery.ts); the ocean is computed by the
// Go `Frame` transform. For previews each gallery board is framed once on load
// via POST /api/maps/frame and cached, keeping previews in sync with Go without
// duplicating coastline data.
//
// Display only: game creation sends the land-only board (the backend frames it
// at start), so nothing blocks or fails on this.

let cache: Promise<GalleryMap[]> | null = null;

// Frame one gallery map's board; on error fall back to its land-only board,
// which still renders, just without the ocean ring.
async function frameOne(m: GalleryMap): Promise<GalleryMap> {
  try {
    const board = await api.frameMap(m.board);
    return { ...m, board };
  } catch (e) {
    console.warn(`framed-gallery: failed to frame map "${m.id}", using unframed board`, e);
    return m;
  }
}

// Frame every gallery map once, memoized for the session. Resolves to gallery
// maps with framed boards (or the unframed board for any that failed).
export function loadFramedGallery(): Promise<GalleryMap[]> {
  if (!cache) cache = Promise.all(GALLERY.map(frameOne));
  return cache;
}

// Reset the memoized cache. Test-only.
export function __resetFramedGalleryCache() {
  cache = null;
}

// Frame a board for export/encode. Falls back to the raw board on error (the
// backend re-frames at game start, so an unframed share code still heals).
export async function frameForExport(board: Board): Promise<Board> {
  try {
    return await api.frameMap(board);
  } catch (e) {
    console.warn("frameForExport: framing failed, encoding raw board", e);
    return board;
  }
}

// Gallery maps for display: the land-only GALLERY immediately, then the framed
// maps once they resolve. Game creation should use the land-only GALLERY board
// directly and never wait on framing.
export function useFramedGallery(): GalleryMap[] {
  const [maps, setMaps] = React.useState<GalleryMap[]>(GALLERY);
  React.useEffect(() => {
    let alive = true;
    void loadFramedGallery().then((framed) => {
      if (alive) setMaps(framed);
    });
    return () => {
      alive = false;
    };
  }, []);
  return maps;
}
