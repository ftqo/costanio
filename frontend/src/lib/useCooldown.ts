import * as React from "react";

// useCooldown is a one-shot timer flag: `start()` begins a `ms` window during
// which `active` is true, then it clears. Used to disable chat Send briefly so
// the next message waits out the rate limit. start() again restarts the window.
export function useCooldown(ms: number): [boolean, () => void] {
  const [active, setActive] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const start = React.useCallback(() => {
    setActive(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setActive(false), ms);
  }, [ms]);
  return [active, start];
}
