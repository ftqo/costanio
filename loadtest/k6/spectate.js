// Wire/connection capacity test: open many WebSocket connections that spectate
// server-side bot games and consume broadcasts. Bots play the games (their
// bot-delay sets the broadcast rate); these clients only subscribe and measure.
//
// Run after generating targets.json with cmd/costan-loadgen, e.g.:
//   go run ./cmd/costan-loadgen -base-url http://localhost:6769 -games 20 -sessions 10
//   k6 run -e WS_URL=ws://localhost:6769/ws -e CONNS=200 -e HOLD=60 loadtest/k6/spectate.js
//
// Imports use the stable modules (k6 >= v1.6). For older k6, change the import
// to 'k6/experimental/websockets'. The API is identical.
import { WebSocket } from 'k6/websockets';
import { setTimeout } from 'k6/timers';
import { Counter, Trend, Rate } from 'k6/metrics';

const TARGETS = JSON.parse(open(__ENV.TARGETS || '../targets.json'));
const WS_URL = __ENV.WS_URL || 'ws://localhost:6769/ws';
const CONNS = parseInt(__ENV.CONNS || '100', 10); // concurrent connections
const HOLD = parseInt(__ENV.HOLD || '60', 10);    // seconds each VU holds open

const connectSuccess = new Rate('ws_connect_success');
const initialStateMs = new Trend('initial_state_ms', true);
const resyncTotal = new Counter('resync_total');
const rateLimited = new Counter('rate_limited_total');
const framesReceived = new Counter('frames_received');

export const options = {
  scenarios: {
    spectators: {
      executor: 'shared-iterations',
      vus: CONNS,
      iterations: CONNS, // one long-lived connection per VU
      maxDuration: `${HOLD + 30}s`,
    },
  },
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function () {
  const token = pick(TARGETS.tokens);
  let game = pick(TARGETS.games);
  const ws = new WebSocket(WS_URL);
  const start = Date.now();
  let gotInitial = false;

  ws.onopen = () => {
    connectSuccess.add(true);
    ws.send(JSON.stringify({ t: 'auth', token: token }));
    // Games are private; a guest spectates by passing the game's invite code.
    ws.send(JSON.stringify({ t: 'sub', game: game.id, invite: game.invite }));
    // Hold the connection open for HOLD seconds, then close. Scheduling the
    // close here (after open) keeps the event loop alive for the duration.
    setTimeout(() => ws.close(), HOLD * 1000);
  };

  ws.onmessage = (e) => {
    framesReceived.add(1);
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    switch (msg.t) {
      case 'state':
        if (!gotInitial) {
          gotInitial = true;
          initialStateMs.add(Date.now() - start);
        }
        break;
      case 'resync':
        resyncTotal.add(1); // server dropped this slow consumer's backlog
        break;
      case 'err':
        if (msg.code === 'RATE_LIMITED') rateLimited.add(1);
        break;
      case 'postgame':
      case 'lobby':
        // Game over (postgame) or closed; re-subscribe to another live game.
        if (msg.closed || msg.t === 'postgame') {
          game = pick(TARGETS.games);
          ws.send(JSON.stringify({ t: 'sub', game: game.id, invite: game.invite }));
        }
        break;
    }
  };

  ws.onerror = () => { connectSuccess.add(false); };
}
