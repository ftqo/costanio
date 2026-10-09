// Persistent cache for rendered piece shots.
//
// A shot needs a WebGL context, a shadow pass and a PNG encode on the main
// thread as the game screen mounts; a ten-player Knights table wants ninety-odd.
// The output depends only on the colour, so it is kept in IndexedDB.
//
// Rendered and cached client-side rather than shipped as PNGs, which would
// bloat the bundle and still miss supporter colours. Only free seat colours are
// stored (see freeColors.ts); supporter colours stay in the caller's memory
// cache for the tab.

/** One shot set's renders: slot id -> PNG blob. */
export type ShotBlobs = Record<string, Blob>;

/**
 * Bump whenever a render would come out different: new models, framing, fill,
 * exposure, or a shot added to a set. This is the only invalidation. It is part
 * of every key, so a bump abandons old entries and `sweep` collects them on the
 * next successful open.
 */
export const SHOT_BAKE_VERSION = 4;
// 3: shop set gained the two higher knight tiers, the raised gold sword and the
//    robber.
// 2: shop set gained the three city-improvement tiles. An entry holds a whole
//    set under one key, so an old entry would satisfy the cache with missing
//    slots.

const DB_NAME = "costan-shots";
const DB_VERSION = 1;
const STORE = "shots";

/** The key a set/colour pair is filed under. */
export function shotKey(set: string, color: string, version = SHOT_BAKE_VERSION): string {
  return `${version}|${set}|${color.toLowerCase()}`;
}

/**
 * The IndexedDB handle, opened once and shared.
 *
 * Null when the browser has no IndexedDB, when opening is refused (Firefox
 * private browsing throws), or when the open never settles (seen in Safari on a
 * fresh profile), hence the timeout. Callers treat null as a miss.
 */
let dbPromise: Promise<IDBDatabase | null> | null = null;

const OPEN_TIMEOUT_MS = 3000;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const done = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    let req: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === "undefined") return done(null);
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return done(null); // private mode, or a sandboxed frame with storage denied
    }
    const timer = setTimeout(() => done(null), OPEN_TIMEOUT_MS);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      done(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    req.onblocked = () => {
      clearTimeout(timer);
      done(null);
    };
  });
  return dbPromise;
}

/** Reset the shared handle. Tests only. */
export function __resetShotStore(): void {
  dbPromise = null;
}

/**
 * The stored renders for this set/colour, or null. Never rejects, so callers
 * handle a broken cache and an empty one the same way.
 */
export async function readShots(set: string, color: string): Promise<ShotBlobs | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise<ShotBlobs | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(shotKey(set, color));
      req.onsuccess = () => {
        const v = req.result as ShotBlobs | undefined;
        // An entry from another build, or a partial one, reads as a miss.
        resolve(v && typeof v === "object" && Object.keys(v).length > 0 ? v : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Keep these renders for next time. Never rejects: a full disk must not break
 * a game that has already rendered its art.
 */
export async function writeShots(set: string, color: string, blobs: ShotBlobs): Promise<void> {
  if (!Object.keys(blobs).length) return;
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blobs, shotKey(set, color));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve(); // QuotaExceededError lands here
    } catch {
      resolve();
    }
  });
}

/**
 * Drop entries from earlier bake versions. Run after a successful open rather
 * than on a schema upgrade, since only the render version changed, not the
 * stored shape.
 */
export async function sweepStaleShots(): Promise<number> {
  const db = await openDB();
  if (!db) return 0;
  const prefix = `${SHOT_BAKE_VERSION}|`;
  return new Promise<number>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.getAllKeys();
      let dropped = 0;
      req.onsuccess = () => {
        for (const k of req.result) {
          if (typeof k === "string" && !k.startsWith(prefix)) {
            store.delete(k);
            dropped++;
          }
        }
      };
      tx.oncomplete = () => resolve(dropped);
      tx.onerror = () => resolve(0);
      tx.onabort = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

/**
 * Blobs as object URLs, for an <img src>.
 *
 * Not revoked: they live in module-level caches for the tab's lifetime, and
 * revoking one still referenced by a log line blanks the icon. The set is
 * bounded by shot sets times colours seen.
 */
export function shotsToURLs(blobs: ShotBlobs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slot, blob] of Object.entries(blobs)) out[slot] = URL.createObjectURL(blob);
  return out;
}
