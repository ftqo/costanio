import type { LogLine } from "./eventlog";

/**
 * Reading a chat line as cards: "2 sheep for 3 wood" drawn the way the log
 * draws a trade.
 *
 * Trade talk is mostly a quantity and a resource, twice. This emits the log's
 * own `LogToken`s so chat and log render trades the same way. Pure, with no
 * React import (like `eventlog.ts`), so it is tested as data.
 *
 * ## Resource words
 *
 * The usual player vocabulary (wood/lumber/tree/timber, sheep/wool,
 * wheat/grain, ore/stone/rock) plus `clay` for brick. Matching is by whole
 * words: substring matching turns *more*, *before* and *score* into ore,
 * *street* into a tree, and "rock paper scissors" into three cards.
 */

/** Resource words, keyed by Hand index (1..5 = wood/brick/sheep/wheat/ore). */
const RESOURCE_WORDS: Record<number, string[]> = {
  1: ["wood", "woods", "lumber", "timber", "tree", "trees", "log", "logs"],
  2: ["brick", "bricks", "clay", "clays", "mud"],
  3: ["sheep", "sheeps", "wool", "lamb", "lambs", "mutton"],
  4: ["wheat", "grain", "grains", "corn"],
  5: ["ore", "ores", "rock", "rocks", "stone", "stones", "iron", "metal"],
};

/** Commodity words, indexed as the Knights commodities array is (0=cloth). */
const COMMODITY_WORDS: Record<number, string[]> = {
  0: ["cloth", "cloths"],
  1: ["paper", "papers"],
  2: ["coin", "coins"],
};

/**
 * Short forms, accepted only with a number glued to the front ("2s for 3o").
 * The digit makes it safe: a bare `s` is a letter and `or` a conjunction.
 *
 * No `w`: it could be wood, wheat or wool, and guessing wrong on the commonest
 * shorthand is worse than leaving it as text.
 */
const SHORT_FORMS: Record<string, number> = {
  l: 1,
  lum: 1,
  wd: 1,
  wo: 1,
  b: 2,
  br: 2,
  cl: 2,
  s: 3,
  sh: 3,
  g: 4,
  gr: 4,
  wh: 4,
  o: 5,
  or: 5,
};

/** Spelled-out quantities. `a`/`an` are the ones people actually type most. */
const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * The largest number read as a quantity. Two digits, so a year, port code or
 * game id stays text.
 */
const MAX_QTY = 99;

const RESOURCE_LOOKUP = buildLookup(RESOURCE_WORDS);
const COMMODITY_LOOKUP = buildLookup(COMMODITY_WORDS);

function buildLookup(words: Record<number, string[]>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [idx, list] of Object.entries(words)) {
    for (const w of list) m.set(w, Number(idx));
  }
  return m;
}

/** A word or a run of digits, with the offset we need to rebuild the gaps. */
type Atom = { text: string; start: number; end: number };

const ATOM_RE = /\p{L}+|\d+/gu;

/**
 * Spans the parser must not touch: URLs, and anything the sender escaped with
 * a leading backslash (`\wood`).
 */
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const ESCAPE_RE = /\\(\p{L}+|\d+)/gu;

export type ChatParseOptions = {
  /**
   * Whether commodity words draw cards. Off by default since cloth, paper and
   * coin are ordinary words; the caller turns them on for Knights games.
   */
  commodities?: boolean;
};

/**
 * Parse one chat message into log tokens. Anything not recognised comes back
 * as `t` tokens with the sender's original text, spacing and casing.
 */
export function parseChatLine(msg: string, opts: ChatParseOptions = {}): LogLine {
  const protectedSpans = collectProtected(msg);
  const atoms = collectAtoms(msg);

  const out: LogLine = [];
  // Start of the current untouched text run. Flushed lazily so a message with
  // no resources stays one token.
  let textFrom = 0;
  const flush = (upTo: number) => {
    if (upTo > textFrom) {
      const s = unescape(msg.slice(textFrom, upTo));
      if (s) out.push({ k: "t", s });
    }
  };

  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    if (isProtected(atom, protectedSpans)) continue;

    const word = atom.text.toLowerCase();
    const prev = i > 0 ? atoms[i - 1] : null;
    // "Glued" means the number touches the word (`2s`, not `2 s`); only that
    // unlocks the short vocabulary.
    const glued = !!prev && prev.end === atom.start && /^\d+$/.test(prev.text);

    let idx = RESOURCE_LOOKUP.get(word);
    let kind: "res" | "com" = "res";
    if (idx === undefined && opts.commodities) {
      const com = COMMODITY_LOOKUP.get(word);
      if (com !== undefined) {
        idx = com;
        kind = "com";
      }
    }
    if (idx === undefined && glued) idx = SHORT_FORMS[word];
    if (idx === undefined) continue;

    // The quantity in front, if any. A word quantity must be separated by
    // whitespace only ("3, wood" is a list); a glued digit always counts.
    let qty = 1;
    let from = atom.start;
    if (prev && !isProtected(prev, protectedSpans)) {
      const gap = msg.slice(prev.end, atom.start);
      if ((glued || /^ ?$/.test(gap)) && !inRatio(msg, prev)) {
        const n = quantityOf(prev.text);
        if (n !== null) {
          qty = n;
          from = prev.start;
        }
      }
    }

    flush(from);
    out.push({ k: kind, idx, n: qty });
    textFrom = atom.end;
  }

  flush(msg.length);
  return out;
}

/**
 * Whether a number is the tail of a trade ratio, and so not a quantity. In
 * "i have 2:1 ore" the `1` belongs to the ratio, not to ore.
 */
function inRatio(msg: string, atom: Atom): boolean {
  return /^\d+$/.test(atom.text) && /[:/]/.test(msg[atom.start - 1] ?? "");
}

function quantityOf(text: string): number | null {
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return n >= 1 && n <= MAX_QTY ? n : null;
  }
  return NUMBER_WORDS[text.toLowerCase()] ?? null;
}

function collectAtoms(msg: string): Atom[] {
  const atoms: Atom[] = [];
  for (const m of msg.matchAll(ATOM_RE)) {
    atoms.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return atoms;
}

function collectProtected(msg: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of msg.matchAll(URL_RE)) spans.push([m.index, m.index + m[0].length]);
  for (const m of msg.matchAll(ESCAPE_RE)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

function isProtected(atom: Atom, spans: [number, number][]): boolean {
  return spans.some(([s, e]) => atom.start >= s && atom.end <= e);
}

/** Drop the backslash from escaped words, now that they have survived parsing. */
function unescape(s: string): string {
  return s.replace(ESCAPE_RE, "$1");
}

/**
 * Whether a parse produced any cards. A message without them stays a plain
 * string in the DOM rather than a one-token flex row.
 */
export function hasCards(line: LogLine): boolean {
  return line.some((tok) => tok.k === "res" || tok.k === "com");
}
