/**
 * Join short phrases into one accessible name, a sentence each, so a screen
 * reader pauses between them. Parts that already end in a full stop
 * ("Science: level 2 of 5. Upgrade.") lose it before the join, so the result
 * never reads "Upgrade.. Needs 3 paper"; the last part gets its stop back only
 * if it had one.
 */
export function sentences(parts: readonly (string | null | undefined | false)[]): string {
  const kept = parts.filter((p): p is string => typeof p === "string" && p.trim() !== "");
  if (kept.length === 0) return "";
  const lastStops = /[.!?]\s*$/.test(kept[kept.length - 1]);
  const body = kept.map((p) => p.trim().replace(/\.+$/, "")).join(". ");
  return lastStops && !/[!?]$/.test(body) ? `${body}.` : body;
}
