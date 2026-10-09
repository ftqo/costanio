# The costan backend binary, built reproducibly. Used by `packages.default` and by
# the NixOS module (nix/module.nix). Pure-Go (CGO-free) sqlite, so no system deps.
{ lib, buildGoModule }:

buildGoModule {
  pname = "costan";
  version = "0.1.0";

  # The Go tree only: exclude frontend/ (node_modules/dist would bloat the store
  # and Go doesn't need it). cleanSource also drops .git etc.
  src = lib.cleanSourceWith {
    src = lib.cleanSource ../.;
    filter = path: _type: !lib.hasInfix "/frontend" (toString path);
  };

  vendorHash = "sha256-tu+TE8HVgfr9WmsOICcL0urKEZ1Es31tp26T8Jit0og=";

  # The server plus the operator tools runbooks use during an incident.
  # costan-recover is the way out of a `paused-error` game (docs/game-actor.md)
  # and the only caller of game.Manager's PausedGames / ForceFinishPaused /
  # AbandonPaused.
  subPackages = [ "cmd/costan" "cmd/costan-recover" "cmd/costan-backfill" ];
  env.CGO_ENABLED = "0";
  ldflags = [ "-s" "-w" ];
  doCheck = false; # tests run in the dev shell, not the package build

  meta = {
    description = "costan.io game backend";
    mainProgram = "costan";
  };
}
