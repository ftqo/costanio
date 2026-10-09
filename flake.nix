{
  description = "costan development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    (flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ] (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        # Reproducible build of the backend binary: `nix build .#costan`.
        # The derivation also carries the two operator tools (nix/package.nix
        # subPackages), so `result/bin/` holds costan, costan-recover and
        # costan-backfill.
        packages.costan = pkgs.callPackage ./nix/package.nix { };
        packages.default = self.packages.${system}.costan;

        # `nix run .#costan-recover` and friends. They point into the costan
        # derivation rather than building their own.
        apps = {
          costan = {
            type = "app";
            program = "${self.packages.${system}.costan}/bin/costan";
          };
          costan-recover = {
            type = "app";
            program = "${self.packages.${system}.costan}/bin/costan-recover";
          };
          costan-backfill = {
            type = "app";
            program = "${self.packages.${system}.costan}/bin/costan-backfill";
          };
          default = self.apps.${system}.costan;
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Go development
            go_1_26
            golangci-lint
            gotestsum
            gotools # includes goimports
            air # live-reload for the dev server (see dev.sh)

            # Node development
            nodejs_24
            # No wrangler: nixpkgs' build fails from source on darwin. It is
            # deploy-only; use `npx wrangler` from frontend/.

            # Deploy / secrets (see DEPLOY.md): encrypt secrets.enc.yaml +
            # origin-cert.enc.yaml, generate the age key, run deploy/cert-encrypt.sh.
            sops
            age

            # Utilities
            sqlite # inspecting costan.db by hand
            jq
            git
            # art/costanio.blend and the .glb exports live in Git LFS; without
            # this a clone gets pointer text files where the geometry should be.
            git-lfs
            k6 # load testing the wire path (see loadtest/)
          ];

          shellHook = ''
            export GOPATH="$HOME/go"
            export PATH="$PATH:$GOPATH/bin"

            # Board art lives in Git LFS. Register the filters for this clone
            # (without them the art arrives as pointer text), then materialize
            # any pointers. Idempotent, repo-local and never fatal. Gated on the
            # blend existing in the enclosing checkout, so `nix develop` from an
            # unrelated directory does not configure some other repo.
            _costan_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
            if [ -n "$_costan_root" ] && [ -e "$_costan_root/art/costanio.blend" ]; then
              if ! git -C "$_costan_root" config --local --get filter.lfs.smudge >/dev/null 2>&1; then
                git -C "$_costan_root" lfs install --local >/dev/null 2>&1 || true
              fi
              if head -c 40 "$_costan_root/art/costanio.blend" 2>/dev/null \
                   | grep -q '^version https://git-lfs'; then
                echo "costan: board art is LFS pointers, fetching it once..."
                git -C "$_costan_root" lfs pull || true
              fi
            fi

            # Install the lint hooks (pre-commit, pre-merge-commit), gated and
            # never fatal like the LFS setup. Linked worktrees share them (the
            # installer uses `git rev-parse --git-path`).
            if [ -n "$_costan_root" ] && [ -x "$_costan_root/scripts/install-hooks.sh" ]; then
              "$_costan_root/scripts/install-hooks.sh" || true
            fi
            unset _costan_root
          '';
        };
      })) // {
      # System-independent: a NixOS module for the whole backend stack (costan +
      # costan-certs + nginx). Only for a NixOS server; the apt deploy in
      # DEPLOY.md does not use it. Enable with services.costan.enable.
      nixosModules.costan = import ./nix/module.nix;
      nixosModules.default = self.nixosModules.costan;
    };
}
