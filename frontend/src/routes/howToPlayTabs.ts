// The How-to-play tab keys, split from `HowToPlay.tsx` so the router can
// validate `?tab=` without importing that large page into the initial graph.
// Keys are a URL contract (they appear in links and bookmarks); labels and
// chapters belong to the page. `HowToPlay` builds its tabs against these, so
// a tab without a key here fails the build.
export const HOW_TO_PLAY_TABS = [
  "base",
  "islands",
  "knights",
  "scenarios",
  "online",
  "raiders",
] as const;

export type HowToPlayTab = (typeof HOW_TO_PLAY_TABS)[number];
