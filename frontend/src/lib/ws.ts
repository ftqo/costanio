import * as React from "react";
import type {
  FullView,
  Summary,
  Postgame,
  ServerFrame,
  ClientFrame,
  SpectatorInfo,
  SupporterView,
} from "./types";
import { getBearer } from "./session";
import {
  appendCapped,
  capTail,
  hasGap,
  mergeEvents,
  nextNeededSeq,
  RateGate,
  CHAT_CAP,
  CHAT_RATE_MS,
  type GameEvent,
  type ChatMsg,
} from "./gamestate";
import { foldEvent } from "./foldEvent";
import { applyPatch } from "./viewPatch";

export type { GameEvent, ChatMsg } from "./gamestate";

export interface SockError {
  code: string;
  /** Named values for the copy in lib/errorCopy; never a pre-formatted sentence. */
  params?: Record<string, unknown>;
  ref: string;
}

export type Status = "connecting" | "open" | "closed";

export interface State {
  status: Status;
  // The session is meant to be live; false after disconnect() (logout). Tells
  // a transient drop (reconnecting) from an intentional close (silent).
  wantOpen: boolean;
  // This socket has been open at least once since the session began.
  //
  // Set in the store on the transition rather than observed from a render: a
  // render only sees the state left at a frame boundary, so a socket that
  // opens and closes within one frame (a backend dying mid-handshake) would
  // never show as open, and the connection pill would say "Connecting" during
  // a reconnect.
  everOpen: boolean;
  // The server says this session is no longer valid (AUTH_REQUIRED /
  // INVALID_SESSION). Retrying cannot fix that, so the reconnect loop stops and
  // the app sends the visitor back through auth. Every other drop reconnects
  // on its own, indefinitely.
  sessionGone: boolean;
  gameId: string | null;
  full: FullView | null;
  summary: Summary | null;
  started: boolean;
  closed: boolean; // host left / table abandoned; the waiting room should bounce out
  next: string | null; // host reset the game: id of the fresh lobby to redirect into
  nextInvite: string | null; // invite for the rematch lobby (private games), so spectators can follow
  winner: number | null; // set when a game_finished event / finished summary arrives
  postgame: Postgame | null; // scoreboard + rematch tally for a finished game
  spectators: SpectatorInfo[]; // non-seated watchers currently following this game
  // The most recent roll and the seq of the event that produced it. Persists
  // across turns so the dock dice keep showing it. `seeded` marks a roll read
  // from a history backfill: shown, but not animated.
  lastRoll?: { d1: number; d2: number; seq: number; seeded?: boolean };
  lastEventDie?: string; // Knights event die face (ship|trade|politics|science) for the most recent roll; persists with lastRoll
  events: GameEvent[]; // the whole redacted log for the game being followed, oldest first, never a window
  chat: ChatMsg[];
  lastSeq: number | null; // highest applied event seq; baseline for gap detection
  reconcile: number; // bumped to ask the screen to refetch getGame and reseed
  // Following a game, but no state/lobby/postgame/err frame arrived within
  // STALL_MS; the UI offers a way out.
  stalled: boolean;
  error: SockError | null;
  errorSeq: number; // bumped on every err frame so a screen effect can toast each one (even identical repeats)
  // How far `full` has been advanced by folded events beyond its own `seq`.
  // `full.seq` does not move when an event is folded (see the `ev` case), so
  // any "is this incoming view newer?" guard needs this instead. Null when
  // nothing has been folded since the last snapshot.
  foldedThrough: number | null;
  matchGame?: string; // ranked: id of a just-found match to navigate into
}

const EMPTY: State = {
  status: "closed",
  wantOpen: false,
  everOpen: false,
  sessionGone: false,
  gameId: null,
  full: null,
  summary: null,
  started: false,
  closed: false,
  next: null,
  nextInvite: null,
  winner: null,
  postgame: null,
  spectators: [],
  events: [],
  chat: [],
  lastSeq: null,
  reconcile: 0,
  stalled: false,
  error: null,
  errorSeq: 0,
  foldedThrough: null,
  matchGame: undefined,
};

// How long to wait for the first server frame after following a game before
// declaring the connection wedged. A healthy lobby or game answers a sub almost
// at once, so only an unreachable game (server down, actor failed to load, sub
// dropped) stays silent this long. The screen shows an error instead of an
// indefinite "Connecting to game...".
const STALL_MS = 12_000;

/**
 * The ceiling on every backoff in this file.
 *
 * The retry loop never gives up (no attempt count, no terminal state): a
 * backend down for an hour is met by a client still trying an hour later.
 *
 * So the cap and jitter matter: every client drops at once when the backend
 * restarts, and unjittered retries would hit the new process in lockstep. Full
 * jitter (a uniform draw from [0, backoff]) spreads them; the cap keeps a long
 * outage to about one attempt per client per ~7.5s, while a brief blip still
 * reconnects within a few hundred milliseconds.
 */
const MAX_BACKOFF_MS = 15_000;

/** The first reconnect delay, and the value the backoff resets to on a good open. */
const BASE_BACKOFF_MS = 500;

/**
 * The heartbeat's timing.
 *
 * A half-open socket is invisible: with the network gone, `readyState` stays
 * OPEN, `send` accepts frames and no error is raised. The server hangs up, but
 * its close frame cannot arrive, and the browser answers protocol-level pings
 * itself without telling script.
 *
 * So after IDLE_PROBE_MS of silence the client sends a `ping`, and if no frame
 * of any kind arrives within PONG_TIMEOUT_MS it redials. The tick wakes that
 * check. Worst case is IDLE_PROBE_MS + PONG_TIMEOUT_MS + a tick, about half a
 * minute. Quiet but healthy connections are common (spectating, a lobby
 * waiting on its host), so probing must be cheap: three tiny frames a minute
 * per idle client, under the normal rate limit.
 *
 * An active player does not wait for this: an expired command with no reply
 * is the same evidence, and the game screen calls `reconnectNow()`. See
 * lib/link.
 */
const HEARTBEAT_TICK_MS = 5_000;
const IDLE_PROBE_MS = 20_000;
const PONG_TIMEOUT_MS = 10_000;

// One frame's worth of grace. The server sends one `ev` frame per engine event,
// so one command (a roll, a bot's whole turn) arrives as a burst of separate
// websocket messages, each its own macrotask, which a microtask or zero-delay
// timeout would not coalesce. Bursts run 8-14 frames with a median 12ms gap,
// so one frame's wait folds the burst into one render.
const FRAME_MS = 16;

/** Run `fn` at the next frame boundary; returns a canceller. Prefers
 * requestAnimationFrame (aligned with paint) but races it against a timer,
 * because rAF never fires in a backgrounded tab and is absent under jsdom, and
 * updates arriving while hidden (a found ranked match, the game starting) must
 * still reach the app. Whichever fires first wins. */
export type Schedule = (fn: () => void) => () => void;

const frameSchedule: Schedule = (fn) => {
  let done = false;
  let raf: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    done = true;
    if (raf !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    if (timer !== null) clearTimeout(timer);
    raf = null;
    timer = null;
  };
  const run = () => {
    if (done) return;
    cancel();
    fn();
  };
  if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(run);
  timer = setTimeout(run, FRAME_MS);
  return cancel;
};

// The slice of WebSocket the socket uses, so tests can inject a fake.
interface IWS {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((this: unknown, ev: unknown) => unknown) | null;
  onmessage: ((this: unknown, ev: { data: string }) => unknown) | null;
  onclose: ((this: unknown, ev: unknown) => unknown) | null;
  onerror: ((this: unknown, ev: unknown) => unknown) | null;
}

// Single session-scoped socket for the whole app. It's opened once the visitor
// has a session (see Root) and kept alive across all navigation; closing it
// means the site was actually shut, which is what lets the server hold a lobby
// seat through refreshes/blips and only drop it after a real disconnect. The
// backend tracks one active game subscription per connection; follow/unfollow
// swap it without touching the connection.
/**
 * The event-burst refresh: how long one is coalesced for, and how many times a
 * fresh event may push that deadline back before it stands (see
 * `scheduleRefresh`). Three windows is at most a quarter second.
 */
const REFRESH_MS = 80;
const REFRESH_MAX_PUSHES = 2;

export class GameSocket {
  private ws: IWS | null = null;
  private state: State = EMPTY;
  private listeners = new Set<() => void>();
  private invite?: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** How many times the pending refresh has been pushed back; see scheduleRefresh. */
  private refreshPushes = 0;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private awaitingFirstFrame = false; // following a game, still waiting for its first server frame
  private stallAttempt = 0; // how many times the wedged subscription has been re-asked
  private backoff = BASE_BACKOFF_MS;
  private wantOpen = false;
  private sessionGone = false; // mirrors State.sessionGone for the reconnect loop, which runs outside React
  private lastRecvAt = 0; // when any frame last arrived on the live socket
  private pingSentAt = 0; // when the outstanding liveness probe went out; 0 when none is
  private everConnected = false; // distinguishes the first connect from a reconnect
  private wsFactory: (url: string) => IWS;
  private now: () => number;
  private random: () => number;
  private schedule: Schedule;
  private cancelNotify: (() => void) | null = null; // non-null while a notification is queued for the next frame
  private chatGate: RateGate;
  // Supporter status lives in the auth layer, not this game-scoped socket. The
  // auth provider registers a handler so a pushed status change updates the
  // badge and unlocks cosmetics live, across all the user's tabs and the
  // Activity.
  private onSupporter?: (v: SupporterView) => void;

  constructor(
    deps: {
      wsFactory?: (url: string) => IWS;
      now?: () => number;
      random?: () => number;
      schedule?: Schedule;
    } = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? (() => Math.random());
    this.wsFactory = deps.wsFactory ?? ((url) => new WebSocket(url) as unknown as IWS);
    this.schedule = deps.schedule ?? frameSchedule;
    this.chatGate = new RateGate(CHAT_RATE_MS, this.now);
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = () => this.state;

  /** Register the handler invoked when the server pushes a supporter_updated
   * frame (the auth provider applies it to `me` and refreshes cosmetics). */
  setSupporterHandler(fn: (v: SupporterView) => void) {
    this.onSupporter = fn;
  }

  /** Apply a patch and ask React to look, at most once per frame.
   *
   * The patch lands on `this.state` immediately and in order, so `getSnapshot`
   * and every read-modify-write in `ingest` see the current state. Only the
   * notification is coalesced: a burst of frames becomes one wake-up, and
   * useSyncExternalStore re-reads the merged snapshot. Nothing is dropped except
   * intermediate renders. */
  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    if (this.cancelNotify) return; // already queued; it will pick this patch up too
    this.cancelNotify = this.schedule(() => {
      this.cancelNotify = null;
      this.emit();
    });
  }

  /** Apply a patch and notify now, absorbing any queued notification. For
   * updates whose value is a nonce rather than a state: coalescing two would
   * swallow one. */
  private setSync(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.dropQueuedNotify();
    this.emit();
  }

  private dropQueuedNotify() {
    if (this.cancelNotify) {
      this.cancelNotify();
      this.cancelNotify = null;
    }
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  // Game-subscription fields cleared whenever we stop following a game (the
  // session-level connection itself is untouched).
  private readonly clearedSub: Partial<State> = {
    full: null,
    summary: null,
    started: false,
    closed: false,
    next: null,
    winner: null,
    postgame: null,
    lastRoll: undefined,
    lastEventDie: undefined,
    events: [],
    chat: [],
    lastSeq: null,
    stalled: false,
    error: null,
    foldedThrough: null,
    // The watcher list belongs to the followed game, and the server only pushes
    // `presence` when a spectator arrives or leaves, so it must not carry over
    // to the next lobby.
    spectators: [],
  };

  /**
   * Arm the stall watchdog for the game being followed.
   *
   * It is also the retry loop: when the wait expires it re-asks the server and
   * arms a longer wait, indefinitely, so a subscription the server never
   * answered (actor still loading, frame dropped on a busy connection, backend
   * restarting) heals on its own.
   *
   * `stalled` survives the re-asks (`resume`), so the screen does not flicker
   * between "connecting" and "trouble". Only a real server frame, or following
   * a different game, clears it.
   */
  private armStall(resume = false) {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.awaitingFirstFrame = true;
    if (!resume) {
      this.stallAttempt = 0;
      if (this.state.stalled) this.set({ stalled: false });
    }
    // Backoff like the socket's: a wedged game usually means a wedged or
    // restarting backend with every watching client on this timer. Half jitter
    // rather than full, because a re-subscribe costs the server a full view, so
    // the low end must stay well above zero.
    const wait = resume
      ? (0.5 + this.random() / 2) * Math.min(STALL_MS * 2 ** this.stallAttempt, MAX_BACKOFF_MS)
      : STALL_MS;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (!this.awaitingFirstFrame) return;
      if (!this.state.stalled) this.set({ stalled: true });
      this.stallAttempt++;
      // Re-ask. `ensureOpen` reopens a socket that dropped; `resync`
      // re-subscribes when it is already open (and is a no-op otherwise, since
      // onopen subscribes on its own).
      this.ensureOpen();
      this.resync();
      this.armStall(true);
    }, wait);
  }

  // A server frame for the followed game arrived: the connection is alive, so
  // disarm the watchdog and clear any stall already raised.
  private gotFrame() {
    if (!this.awaitingFirstFrame && !this.state.stalled) return;
    this.awaitingFirstFrame = false;
    this.stallAttempt = 0;
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
    if (this.state.stalled) this.set({ stalled: false });
  }

  // Stop the watchdog entirely (no longer following a game).
  private cancelStall() {
    this.awaitingFirstFrame = false;
    this.stallAttempt = 0;
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  /** Open the session socket (idempotent) and keep it alive for the whole visit.
   * Safe to call on every render/navigation. */
  ensureOpen() {
    this.wantOpen = true;
    if (!this.state.wantOpen) this.set({ wantOpen: true });
    // A session the server has disowned cannot be fixed by redialling, and
    // retrying /ws with a dead cookie would loop forever. Root clears it by
    // sending the visitor back through auth.
    if (this.sessionGone) return;
    if (!this.ws || this.ws.readyState > WebSocket.OPEN) this.open();
  }

  /** Follow a game's live stream (lobby or in-play). Swaps the current
   * subscription without reopening the connection. */
  follow(gameId: string, invite?: string) {
    this.invite = invite;
    this.ensureOpen();
    if (this.state.gameId !== gameId) {
      this.set({ gameId, ...this.clearedSub });
      this.armStall();
    }
    if (this.ws?.readyState === WebSocket.OPEN) this.sendSub(gameId, this.state.full?.seq);
  }

  /**
   * Throw this socket away and dial a fresh one.
   *
   * For a dead link the browser still reports as OPEN: `onclose` never fires
   * and `ensureOpen` sees nothing to do.
   *
   * Called by the heartbeat when a probe goes unanswered, and by the game
   * screen when a command expires with no reply (see lib/link.isAckLost).
   *
   * The backoff resets first: this redial is evidence-based, not the next step
   * of a failing retry sequence, so it goes out at once (jitter still spreads
   * clients that noticed together).
   */
  reconnectNow() {
    if (!this.wantOpen || this.sessionGone) return;
    this.backoff = BASE_BACKOFF_MS;
    this.dropSocket();
    this.scheduleReconnect();
  }

  /** Re-subscribe to the game currently being followed, pulling a fresh
   * authoritative response without reopening the connection. The server answers
   * a sub to an active game with `started:true` + a full `state` frame, so this
   * recovers a start broadcast that the hub dropped to a busy connection (see
   * trySend), keeping the waiting room from stranding a player. Idempotent and
   * cheap; a no-op if not following or the socket isn't open (onopen
   * re-subscribes on its own). */
  resync() {
    if (this.state.gameId && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSub(this.state.gameId, this.state.full?.seq);
    }
  }

  /** Stop streaming the current game (e.g. left the table page) but keep the
   * session socket open. Seat membership is server-side and unaffected. */
  unfollow() {
    if (!this.state.gameId) return;
    this.send({ t: "unsub" });
    this.invite = undefined;
    this.cancelStall();
    this.set({ gameId: null, ...this.clearedSub });
  }

  /** Fully tear down the session socket (logout). */
  disconnect() {
    this.wantOpen = false;
    this.sessionGone = false; // a fresh login gets a clean slate
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    // Nulled as well as cleared: `scheduleRefresh` treats a non-null handle as
    // "already armed", so a stale one would silence every later refresh.
    this.refreshTimer = null;
    this.cancelStall();
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.everConnected = false;
    // Synchronous, swallowing anything queued: after a teardown no pending
    // frame callback may wake a logged-out app.
    this.setSync({ ...EMPTY });
  }

  private open() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = this.wsFactory(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.set({ status: "connecting" });
    ws.onopen = () => {
      if (this.ws !== ws) {
        ws.close();
        return;
      }
      this.backoff = BASE_BACKOFF_MS;
      // `everOpen` is set here, on the transition, never read from a render
      // (see the field's note in State).
      this.set({ status: "open", everOpen: true });
      this.startHeartbeat();
      // In the Discord Activity the upgrade carries no cookie, so authenticate
      // with a first frame before subscribing. The web app (cookie-authed)
      // skips this.
      const tok = getBearer();
      if (tok) ws.send(JSON.stringify({ t: "auth", token: tok }));
      if (this.state.gameId) this.sendSub(this.state.gameId, this.state.full?.seq);
      // A reconnect (not the first connect) may have missed events while down;
      // the board catches up via the sub above, but chat/log history and any gap
      // only recover by refetching getGame.
      if (this.everConnected && this.state.gameId) this.requestReconcile();
      this.everConnected = true;
    };
    ws.onmessage = (e) => {
      // Any frame at all is proof of life, whatever it says. Stamped before the
      // ingest so a handler that throws cannot cost us the liveness signal.
      this.lastRecvAt = this.now();
      this.pingSentAt = 0;
      this.ingest(JSON.parse(e.data) as ServerFrame);
    };
    ws.onclose = () => {
      // Ignore the close of a socket we've already replaced. React StrictMode
      // (and any rapid connect/disconnect) runs mount, cleanup, mount, so an
      // older socket can close after a newer one is live; without this guard its
      // close would schedule a reconnect that replaces the working socket.
      if (this.ws !== ws) return;
      this.stopHeartbeat();
      this.set({ status: "closed" });
      // No attempt limit: there is no manual restart, so giving up would strand
      // the player. See MAX_BACKOFF_MS for why this is safe for the server.
      if (this.wantOpen && !this.sessionGone) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  /** Wait out the backoff, then dial again, and lengthen the backoff for next
   * time. Full jitter (a random slice of [0, backoff]) spreads clients that
   * all dropped together when the backend restarted, while a quick blip still
   * reconnects in about backoff/2. */
  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.random() * this.backoff;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  /** Detach and close the current socket without letting its `onclose` schedule
   * anything: the caller decides what happens next. Nulling `this.ws` first does
   * that, via the identity guard in `onclose`. */
  private dropSocket() {
    const ws = this.ws;
    this.ws = null;
    this.stopHeartbeat();
    ws?.close();
    if (this.state.status !== "closed") this.set({ status: "closed" });
  }

  /** Watch a socket that claims to be open for signs that it isn't. See the
   * heartbeat constants. */
  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastRecvAt = this.now();
    this.pingSentAt = 0;
    this.heartbeatTimer = setInterval(() => this.probe(), HEARTBEAT_TICK_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.pingSentAt = 0;
  }

  private probe() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const t = this.now();
    if (this.pingSentAt) {
      // A probe is outstanding. Any frame counts as the answer, not just the
      // pong: `onmessage` clears `pingSentAt` whatever lands.
      if (t - this.pingSentAt >= PONG_TIMEOUT_MS) this.reconnectNow();
      return;
    }
    if (t - this.lastRecvAt < IDLE_PROBE_MS) return;
    this.pingSentAt = t;
    // Straight to `send`: a probe that cannot be written proves nothing (the
    // socket is not OPEN, which `onclose` handles).
    if (!this.send({ t: "ping" })) this.pingSentAt = 0;
  }

  /**
   * Put a frame on the wire, reporting whether it actually left.
   *
   * A frame handed to a socket that is not OPEN is dropped: there is no
   * outbound queue or retry, because a command replayed after a reconnect
   * would act on a board that has moved on. The caller uses the result to
   * avoid staging optimistic effects for a command the server never sees.
   */
  private send(frame: ClientFrame): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }
  private sendSub(game: string, since?: number) {
    this.send({ t: "sub", game, since, invite: this.invite });
  }

  /**
   * Coalesce an event burst into one re-subscribe, which the server answers
   * with a fresh authoritative full `state` frame (it always sends full state
   * on subscribe). Distinct from reconcile, the heavier getGame HTTP refetch
   * used on reconnect / seq-gap / resync.
   *
   * Coalesced but bounded: an unbounded debounce would starve the snapshot for
   * as long as events kept arriving (e.g. a timed-out setup turn followed by
   * bots). The snapshot is the only thing that moves the phase flags (events
   * are folded for geometry only; see `lib/foldEvent`), so a starved client
   * keeps a board armed for a move already taken.
   *
   * So the deadline may be pushed back a bounded number of times and then
   * stands: a short burst still gives one refresh, a long one a refresh every
   * few hundred milliseconds. Counted rather than timed, since a count needs no
   * clock (this class's clock is injectable and frozen in tests).
   */
  private scheduleRefresh() {
    if (this.refreshTimer) {
      // The window has been pushed as far as it goes; let it fire.
      if (this.refreshPushes >= REFRESH_MAX_PUSHES) return;
      this.refreshPushes++;
      clearTimeout(this.refreshTimer);
    } else {
      this.refreshPushes = 0;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (this.state.gameId) this.sendSub(this.state.gameId);
    }, REFRESH_MS);
  }

  ingest(f: ServerFrame) {
    // Any of these frames is the server answering our sub: the connection is
    // alive, so disarm the stall watchdog (see armStall/gotFrame).
    if (f.t === "state" || f.t === "ev" || f.t === "lobby" || f.t === "postgame" || f.t === "err") {
      this.gotFrame();
    }
    switch (f.t) {
      case "state":
        // seq-wins: never regress to an older full than one already applied.
        if (!this.state.full || f.seq >= this.state.full.seq) {
          // A snapshot ahead of the log is a gap too. The server resumes a
          // swapped subscription where the old one stopped and sends owed
          // events before the snapshot (server/ws.go, `release`), so normally
          // this never fires. It is the safety net for when the shared window
          // has already evicted those frames: advancing `lastSeq` below would
          // hide the hole from the `ev` gap check. Only when the client holds
          // a log; a cold load is backfilled by the screen's own fetch.
          const held = this.state.events;
          if (held.length && f.seq - 1 > held[held.length - 1].seq) this.requestReconcile();
          // A server FullView's seq is NextSeq, so the baseline for gap
          // detection is seq-1 (the next event is expected at seq).
          this.set({
            full: f.full,
            lastSeq: Math.max(this.state.lastSeq ?? -1, f.seq - 1),
            // An authoritative view supersedes every fold applied on top of the
            // previous one.
            foldedThrough: null,
            error: null,
          });
        }
        break;
      case "ev": {
        if (hasGap(this.state.lastSeq, f.ev.seq)) this.requestReconcile();
        // Take the winner straight off the event: the finished-game sub does
        // answer with a final state frame, but a round trip later.
        const winner =
          f.ev.type === "game_finished"
            ? ((f.ev.data as { winner?: number } | null)?.winner ?? this.state.winner)
            : this.state.winner;
        // The two die values of the most recent roll, for the dock dice. They
        // persist across turns, so the dice keep showing the last roll.
        //
        // The roll carries the seq of its event, and only a newer seq replaces
        // it. The screen uses that seq to decide whether it has already
        // answered a roll (chip flip, robber on a seven). Object identity would
        // treat a redelivered roll as new (redelivery is routine; see the merge
        // above), and the dice values would treat two sevens in a row as one.
        // The seq check also stops an out-of-order refetch from replacing the
        // roll with an older one.
        let lastRoll = this.state.lastRoll;
        let lastEventDie = this.state.lastEventDie;
        if (f.ev.type === "dice_rolled") {
          const d = f.ev.data as { d1?: number; d2?: number } | null;
          if (
            d &&
            typeof d.d1 === "number" &&
            typeof d.d2 === "number" &&
            f.ev.seq > (lastRoll?.seq ?? -1)
          )
            lastRoll = { d1: d.d1, d2: d.d2, seq: f.ev.seq };
        } else if (f.ev.type === "cak_event_die") {
          const d = f.ev.data as { face?: string } | null;
          if (d && typeof d.face === "string") lastEventDie = d.face;
        }
        // Fold the event's board change straight into the view.
        //
        // An `ev` frame is authoritative and already persisted, one round trip
        // old, while the snapshot is an 80ms debounce plus a second round trip
        // (`scheduleRefresh`, answered by a `state` frame). Folding shows every
        // viewer, spectators included, the board at 1 RTT instead of 2 RTT +
        // 80ms.
        //
        // Geometry only: lib/foldEvent decodes positions and declines the rest.
        // VP, longest road, hands and phase flags still come from the snapshot,
        // so the view is briefly inconsistent (the settlement is down, the VP
        // column has not moved).
        //
        // Gated on `f.ev.seq > lastSeq`, the store's own "new event" test, so a
        // redelivered event cannot apply twice.
        //
        // `full.seq` is not bumped: the optimistic spend overlay
        // (lib/optimistic) is seq-gated, and bumping it would expire the
        // overlay while the hand is still stale. The `state` case's
        // `f.seq >= full.seq` guard still lets the next snapshot supersede the
        // folded view.
        let full = this.state.full;
        let foldedThrough = this.state.foldedThrough;
        if (full && f.ev.seq > (this.state.lastSeq ?? -1)) {
          const patch = foldEvent({ seq: f.ev.seq, type: f.ev.type, data: f.ev.data }, full);
          if (patch) {
            full = applyPatch(full, patch);
            foldedThrough = Math.max(foldedThrough ?? -1, f.ev.seq);
          }
        }
        this.set({
          // Merged, not appended: a re-subscribe or a gap refetch can redeliver
          // an event this client already holds, and seq makes that a no-op.
          events: mergeEvents(this.state.events, [
            { seq: f.ev.seq, type: f.ev.type, data: f.ev.data },
          ]),
          lastSeq: Math.max(this.state.lastSeq ?? -1, f.ev.seq),
          full,
          foldedThrough,
          winner,
          lastRoll,
          lastEventDie,
        });
        this.scheduleRefresh();
        break;
      }
      case "lobby":
        this.set({
          summary: f.summary ?? this.state.summary,
          started: f.started ? true : this.state.started,
          closed: f.closed ? true : this.state.closed,
          next: f.next ?? this.state.next,
          // A reset mints a new table with a new invite code, which a spectator
          // on the old one needs to subscribe to the new lobby (as for the
          // rematch frame below).
          nextInvite: f.next_invite ?? this.state.nextInvite,
          winner:
            f.summary?.game.status === "finished" && f.summary.game.winner != null
              ? f.summary.game.winner
              : this.state.winner,
        });
        break;
      case "postgame": {
        // Scoreboard / board / stats are sent once on subscribe; later frames
        // carry only the rematch tally, so keep the last values if omitted.
        const prev = this.state.postgame;
        this.set({
          postgame: {
            scoreboard: f.scoreboard ?? prev?.scoreboard,
            winner: f.winner ?? prev?.winner,
            rematch: f.rematch,
            rolls: f.rolls ?? prev?.rolls,
            turns: f.turns ?? prev?.turns,
            vp_track: f.vp_track ?? prev?.vp_track,
            board: f.board ?? prev?.board,
          },
          winner: f.winner ?? this.state.winner,
          // The rematch tally carries where the new lobby lives; a private
          // rematch also carries its invite so spectators can follow along.
          next: f.rematch?.next ?? this.state.next,
          nextInvite: f.rematch?.next_invite ?? this.state.nextInvite,
        });
        break;
      }
      case "presence":
        this.set({ spectators: f.spectators ?? [] });
        break;
      case "chat":
        this.set({
          chat: appendCapped(
            this.state.chat,
            { id: f.id, scope: f.scope, from: f.from, user_id: f.user_id, msg: f.msg },
            CHAT_CAP,
          ),
        });
        break;
      case "resync":
        this.requestReconcile();
        break;
      case "pong":
        // Nothing to do: its arrival is the message, and `onmessage` already
        // recorded that. Listed so the frame reads as expected, not ignored.
        break;
      case "err":
        // The two refusals that mean the session is gone, not the link.
        // Reconnecting cannot change the answer, so the otherwise endless
        // reconnect loop stops here. Root takes it from here.
        if (f.code === "AUTH_REQUIRED" || f.code === "INVALID_SESSION") this.markSessionGone();
        // Notified synchronously, one err frame at a time. `errorSeq` is a nonce
        // the screen watches to toast each rejection, including an identical
        // repeat, so two bumps must not merge into one wake-up. Errors are rare.
        this.setSync({
          // f.debug is not carried across: the server's English wording stops
          // at the socket boundary. Screens render from the code via
          // lib/errorCopy.
          error: { code: f.code, params: f.params, ref: f.ref },
          errorSeq: this.state.errorSeq + 1,
        });
        break;
      case "ranked_match_found":
        this.set({ matchGame: f.game });
        break;
      case "supporter_updated":
        // Self-only: the server pushes the caller's own updated status. The auth
        // provider applies it (badge) and refreshes the cosmetics drawer (unlocks).
        this.onSupporter?.(f.supporter);
        break;
    }
  }

  /** Stop trying: this session is not coming back by retrying.
   *
   * Not `disconnect()`, which is the logout path and clears `wantOpen` (how the
   * UI tells an intentional close from a drop). Here the visitor still wants a
   * connection and the credential expired, so `wantOpen` stays true and a
   * separate flag lets Root re-check the session and route to sign-in while
   * the connection pill stays quiet. */
  private markSessionGone() {
    if (this.sessionGone) return;
    this.sessionGone = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.cancelStall();
    this.dropSocket();
    this.set({ sessionGone: true });
  }

  /** Debounced bump of the reconcile nonce so a burst of gap events (or repeated
   * resync hints) coalesces into a single getGame refetch by the screen. */
  private requestReconcile() {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.set({ reconcile: this.state.reconcile + 1 });
    }, 80);
  }

  /** Apply an authoritative lobby summary straight from a REST mutation
   * response, so the actor sees their own change instantly instead of waiting
   * for the echoing websocket broadcast to round-trip. */
  applySummary(summary: Summary) {
    if (summary.game.id === this.state.gameId) this.set({ summary });
  }

  /** Seed the store from the enriched getGame response so the board, log, and
   * chat render immediately. seq-wins: the view is applied only if newer than a
   * live frame that already arrived, so the HTTP seed never clobbers fresher ws
   * state. Also reseeds on reconcile (reconnect / gap / resync). */
  seed(d: { view?: FullView | null; log?: GameEvent[]; chat?: ChatMsg[] }) {
    const patch: Partial<State> = {};
    // Compare against the fold frontier, not `full.seq`: a folded view shows
    // pieces from events past its own seq. Otherwise a reconcile captured at
    // server seq 102 would replace a board folded through 104, removing those
    // pieces, and `lastSeq` (already 104) would stop them being re-folded.
    const shown = Math.max(this.state.full?.seq ?? -1, (this.state.foldedThrough ?? -1) + 1);
    if (d.view && (!this.state.full || d.view.seq > shown)) {
      patch.full = d.view;
      patch.lastSeq = Math.max(this.state.lastSeq ?? -1, d.view.seq - 1);
      patch.foldedThrough = null;
    }
    // The log is merged into what this client holds rather than replaced. A
    // seed is a backfill (the whole game on a cold load, only the missing tail
    // on a reconnect; see logSince), and merging on seq means an overlapping
    // refetch neither duplicates nor drops a line.
    if (d.log) {
      patch.events = mergeEvents(this.state.events, d.log);
      // On a mid-game page load the dice would otherwise stay blank until the
      // next live roll, so the newest roll in the backfill stands in, marked
      // `seeded` so the board does not replay it.
      let roll = this.state.lastRoll;
      let eventDie = this.state.lastEventDie;
      let eventDieSeq = -1;
      for (const e of d.log) {
        const data = e.data as { d1?: number; d2?: number; face?: string } | null;
        if (
          e.type === "dice_rolled" &&
          typeof data?.d1 === "number" &&
          typeof data.d2 === "number" &&
          e.seq > (roll?.seq ?? -1)
        ) {
          roll = { d1: data.d1, d2: data.d2, seq: e.seq, seeded: true };
        } else if (
          e.type === "cak_event_die" &&
          typeof data?.face === "string" &&
          e.seq > eventDieSeq
        ) {
          eventDie = data.face;
          eventDieSeq = e.seq;
        }
      }
      if (roll !== this.state.lastRoll) {
        patch.lastRoll = roll;
        // Only alongside a roll the backfill supplied: the event die belongs to
        // the same roll, and a live one already held must not be overwritten.
        if (eventDieSeq >= 0) patch.lastEventDie = eventDie;
      }
    }
    if (d.chat) patch.chat = capTail(d.chat, CHAT_CAP);
    if (patch.full) this.gotFrame(); // the HTTP seed resolved a view: not stalled
    if (Object.keys(patch).length) this.set(patch);
  }

  /** The seq to ask `GET /api/games/{id}?since=` for: 0 when this client holds
   * no log for the game (a cold load wants all of it), otherwise the first seq
   * it is missing. Read at request time, so a reconcile after a drop fetches
   * only the gap instead of the whole game again. */
  logSince(): number {
    return nextNeededSeq(this.state.events);
  }

  /** Send a game command. Returns false when nothing left this client (no game
   * followed, or the socket is not open) so the caller can decline to stage the
   * optimistic effects of a command the server will never see. */
  cmd(type: string, data?: unknown, id?: string): boolean {
    if (!this.state.gameId) return false;
    return this.send({ t: "cmd", id, game: this.state.gameId, cmd: { type, data } });
  }
  /** Send a chat message. Returns false (without sending) when the 1/sec gate
   * trips or the socket is down, so the caller can keep the unsent text. The
   * backend remains the authority.
   *
   * The connection is checked before the gate, so a message that cannot go out
   * does not spend the sender's one-per-second token. */
  chat(scope: string, msg: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    if (!this.chatGate.try()) return false;
    return this.send({ t: "chat", scope, msg });
  }
  /** Report a chat message for moderation. Fire-and-forget; the backend may
   *  reject with an `err` frame (REPORT_REVOKED / RATE_LIMITED). */
  report(chatId: number) {
    this.send({ t: "report", chat_id: chatId });
  }
  /** Post-game: host triggers the rematch; everyone else toggles their vote. */
  requestRematch() {
    if (!this.state.gameId) return;
    this.send({ t: "rematch", game: this.state.gameId });
  }
  /** Ranked: consume-and-clear the matched game id so exactly one caller navigates into it. */
  consumeMatch(): string | undefined {
    const g = this.state.matchGame;
    if (g) this.set({ matchGame: undefined });
    return g;
  }
}

export const gameSocket = new GameSocket();

/** Field-by-field equality, the comparator to pass when a selector returns a
 * freshly built object of primitives (`{status, wantOpen}`); otherwise its new
 * identity on every read would defeat the selector. */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const ka = Object.keys(a) as (keyof T)[];
  const kb = Object.keys(b) as (keyof T)[];
  return ka.length === kb.length && ka.every((k) => Object.is(a[k], b[k]));
}

const wholeState = (s: State) => s;

/** Subscribe to the session socket.
 *
 * With no argument it returns the whole `State`, which gets a new identity on
 * every field change: fine for a screen that reads most of it, wasteful for
 * one that reads two fields, since a chat line would then wake the board. Pass
 * a selector to subscribe to a slice: the component re-renders only when that
 * slice changes, judged by `isEqual` (`Object.is` by default; pass
 * `shallowEqual` for a selector that builds an object). */
export function useGameSocket(): State;
export function useGameSocket<T>(sel: (s: State) => T, isEqual?: (a: T, b: T) => boolean): T;
export function useGameSocket<T>(
  sel: (s: State) => T = wholeState as unknown as (s: State) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  // useSyncExternalStore requires getSnapshot to return a stable value while
  // the store is unchanged, or it re-renders forever, and a selector building a
  // fresh object cannot promise that. So the last (state, selector) -> slice is
  // memoised: an unchanged store returns the same slice, and a changed store
  // keeps the previous slice's identity whenever `isEqual` says nothing
  // relevant moved, which lets React skip the render.
  const cache = React.useRef<{ state: State; sel: (s: State) => T; slice: T } | null>(null);

  const getSlice = React.useCallback(() => {
    const state = gameSocket.getSnapshot();
    const prev = cache.current;
    if (prev && prev.state === state && prev.sel === sel) return prev.slice;
    const next = sel(state);
    const slice = prev && isEqual(prev.slice, next) ? prev.slice : next;
    cache.current = { state, sel, slice };
    return slice;
  }, [sel, isEqual]);

  return React.useSyncExternalStore(gameSocket.subscribe, getSlice, getSlice);
}
