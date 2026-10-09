// The landing hero's board: the real `Board3D` on the game's camera rig
// (scene.ts: CAMERA_TILT_DEG / CAMERA_FOV_DEG / openingPose), playing a
// recorded game. So every .glb the game needs is fetched while the visitor
// reads the headline, and entering a table only moves the camera.
//
// Default export: `Landing` is in the initial module graph (see router.tsx) and
// pulls this in through `React.lazy`, only where the board is the hero. Keep
// heavy imports (Board3D, three.js, the recording) in this module so they ride
// the lazy chunk and a phone that never draws the board never fetches them.
import * as React from "react";
import { Board3D } from "@/components/board/Board3D";
import { useReplay } from "@/lib/replay/useReplay";
import { ATTRACT, ATTRACT_SPEED } from "@/lib/replay/attract";
import type { HomeChrome } from "@/components/home/layout";

const noop = () => {};

/**
 * How long the board takes to fade in once it can be drawn, and how long the
 * page waits for that before showing whatever there is. The timeout covers
 * failure (no WebGL, a model 404): the cover must not sit there forever.
 */
const FADE_MS = 900;
const FADE_TIMEOUT_MS = 8000;

/**
 * The board fills its parent; the parent decides how much of the page that is.
 * `Landing` mounts it only where the board is the hero, so there is no
 * small-island variant.
 *
 * `chrome` comes from the page, since only the page knows what it drew around
 * the board. See `home/layout.ts` and `hudChrome.ts`.
 */
export default function HomeScene({ chrome }: { chrome: HomeChrome }) {
  // Ambient: autoplay, loop, no controls, at half replay speed (see
  // ATTRACT_SPEED), using the replay page's transport. Only `view` is read, and
  // frames are whole boards rather than deltas, so a trimmed recording is safe.
  const { frame } = useReplay(ATTRACT, { autoplay: true, loop: true, speed: ATTRACT_SPEED });

  /**
   * One colour until the board has drawn, then a cross-fade to it.
   *
   * An opaque cover over the canvas rather than anything inside the scene:
   * animating the scene's fog flickered (the renderer's own frame scheduling,
   * colour pipeline, and a first frame landing before the reveal was armed).
   *
   * `bg-background`, the page's own token, so there is no seam until the fade.
   */
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(() => setShown(true), FADE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="relative w-full h-full">
      <Board3D
        view={frame.view}
        mode="none"
        onVertex={noop}
        onEdge={noop}
        onHex={noop}
        onInspect={noop}
        className="w-full h-full"
        // Fired after a frame has actually rendered, not when models load:
        // three compiles shaders and uploads geometry on the first draw, so
        // that is the stall worth waiting out.
        onReady={() => setShown(true)}
        hudChrome={chrome}
      />
      <div
        aria-hidden
        // `visibility` follows on a delay so the faded cover is gone and can't
        // take pointer events meant for the board.
        className="absolute inset-0 pointer-events-none bg-background motion-reduce:transition-none"
        style={{
          opacity: shown ? 0 : 1,
          visibility: shown ? "hidden" : "visible",
          transitionProperty: "opacity, visibility",
          transitionDuration: `${FADE_MS}ms, 0ms`,
          transitionTimingFunction: "ease-out",
          transitionDelay: shown ? `0ms, ${FADE_MS}ms` : "0ms, 0ms",
        }}
      />
    </div>
  );
}
