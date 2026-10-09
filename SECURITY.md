# Security policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**, and do not post them
anywhere public (including in a pull request) before a fix has shipped.

- **Preferred:** use GitHub's private vulnerability reporting on this repository
  (the "Security" tab, then "Report a vulnerability").
- **Or email:** brian@ftqo.dev.

Please include what you found, how to reproduce it, and what an attacker could do
with it. You will get an acknowledgement within a few days, and we will keep you
informed while a fix is prepared. We are happy to credit you once it ships, if you
would like that.

## Scope

In scope: the code in this repository (the Go backend, the frontend, the
deployment configuration under `deploy/` and `nix/`) and the hosted game it
runs.

Especially interesting:

- authentication and session handling (`auth/`, `server/`);
- hidden-information leaks: any way for a client to learn another player's hand,
  face-down cards or fogged tiles (redaction lives in `game/`);
- anything that lets a client corrupt game state, the event log or another
  player's account;
- the fairness audit (`verify/`) disagreeing with the engine about a real game.

Out of scope: denial of service by volume, reports from automated scanners
without a demonstrated impact, and social engineering.

Please do not test against other players' accounts or games, and do not degrade
the hosted service. A local instance (`./dev.sh`, see `README.md`) is the right
place to experiment.
