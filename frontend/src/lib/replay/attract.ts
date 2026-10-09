// The homepage's recording, and how fast it is played.
//
// Separate from `HomeScene` so a test can check it without pulling in
// `Board3D` and three.js. Only `HomeScene` imports it, so it ships in that one
// lazy chunk.
import type { ReplaySource } from "./types";
import frames from "./attract.frames.json";

/**
 * A whole game, from the first setup settlement to the winning move, with every
 * frame that is not a placement cut out: setup placements, then roads,
 * settlements, cities and the robber, back to back. `attract.test.ts` checks
 * this.
 *
 * About a fifth of a recorded game is placements, so the trimmed whole game is
 * a few dozen frames. Frames are whole boards rather than deltas (see
 * `replay.Frame`), so dropping one leaves every remaining still exactly as the
 * engine produced it.
 *
 * Regenerate with the search, then look at what it picked:
 *
 *     go run ./cmd/costan-attract-search -n 2000 -workers 10 \
 *         -players 3 -preset beginner -keep 10 -outdir /tmp/attract
 *     cp /tmp/attract/01-*.frames.json src/lib/replay/attract.frames.json
 *
 * The search plays whole games, trims them, scores for cities, spread across
 * seats and a close finish, and writes the best few. There is no seed to re-run:
 * the bots are paced by a real clock (`-bot-delay`), so the same seed plays
 * differently each time. The file is the artifact.
 */
export const ATTRACT = frames as unknown as ReplaySource;

/**
 * Half real time.
 *
 * `speed` divides each frame's hold (see `holdMs`): 2 is twice as fast, 0.5 is
 * half. With only placements left, real time adds a building every half second
 * and reads as a flipbook; half speed gives each placement roughly its original
 * screen time.
 */
export const ATTRACT_SPEED = 0.5;
