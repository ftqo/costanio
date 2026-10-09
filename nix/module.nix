# NixOS module for the costan backend stack: the costan service, the
# cert-decrypt oneshot, and the nginx reverse proxy. Mirrors the apt deploy in
# DEPLOY.md, but declarative. Only used if the server runs NixOS.
#
#   imports = [ costan.nixosModules.costan ];
#   services.costan = {
#     enable = true;
#     environmentFile = "/etc/costan/costan.env"; # non-secret config (deploy/costan.env.example)
#     ageKeyFile      = "/etc/costan/age.key";     # the one at-rest secret
#     secretsFile     = "/etc/costan/secrets.enc.yaml";
#     originCertFile  = "/etc/costan/origin-cert.enc.yaml";
#     alert.channelId = "123...";                  # Discord channel for OnFailure alerts
#     backup.rcloneRemote = "<remote>:<bucket>";   # off-host copies (opt-in)
#     nginx.originHost = "api.example.com";        # required when nginx.enable
#     nginx.originPullCaFile = "/etc/nginx/certs/cloudflare-origin-pull-ca.pem";
#   };
#
# It ships what the apt deploy does: the service, the OnFailure Discord alert,
# and the 6-hourly verified backup timer. Nothing tests this module against
# deploy/*.service, so change both together.
{ config, lib, pkgs, ... }:

let
  cfg = config.services.costan;
  sops = lib.getExe pkgs.sops;

  # Decrypt the three app secrets into the unit's tmpfs RuntimeDirectory.
  secretsDecrypt = pkgs.writeShellScript "costan-secrets-decrypt" ''
    set -euo pipefail
    export SOPS_AGE_KEY_FILE=${lib.escapeShellArg cfg.ageKeyFile}
    for name in discord_client_secret google_client_secret discord_bot_token; do
      ${sops} -d --extract "[\"$name\"]" ${lib.escapeShellArg cfg.secretsFile} > "$RUNTIME_DIRECTORY/$name"
      chown ${cfg.user}:${cfg.group} "$RUNTIME_DIRECTORY/$name"
      chmod 0400 "$RUNTIME_DIRECTORY/$name"
    done
  '';

  # The two deploy/ scripts, run from the store with their dependencies on PATH.
  # They are the same files the apt deploy runs (deploy/alert.sh,
  # deploy/backup.sh), so there is one copy of the alerting path; only the
  # paths differ on NixOS, passed in as environment.
  alertScript = pkgs.writeShellScript "costan-alert" ''
    export PATH=${lib.makeBinPath (with pkgs; [
      bash coreutils gnugrep curl python3 sops sqlite systemd nettools
    ])}:$PATH
    export SOPS_AGE_KEY_FILE=${lib.escapeShellArg cfg.ageKeyFile}
    export COSTAN_SECRETS_FILE=${lib.escapeShellArg cfg.secretsFile}
    export COSTAN_DB=/var/lib/costan/costan.db
    exec ${pkgs.bash}/bin/bash ${../deploy/alert.sh} "$@"
  '';

  backupScript = pkgs.writeShellScript "costan-backup" ''
    export PATH=${lib.makeBinPath (with pkgs; [
      bash coreutils findutils gnugrep gzip sqlite rclone
    ])}:$PATH
    exec ${pkgs.bash}/bin/bash ${../deploy/backup.sh} "$@"
  '';

  # Decrypt the TLS origin cert into tmpfs for nginx.
  certDecrypt = pkgs.writeShellScript "costan-cert-decrypt" ''
    set -euo pipefail
    export SOPS_AGE_KEY_FILE=${lib.escapeShellArg cfg.ageKeyFile}
    ${sops} -d --extract '["origin_pem"]' ${lib.escapeShellArg cfg.originCertFile} > "$RUNTIME_DIRECTORY/origin.pem"
    ${sops} -d --extract '["origin_key"]' ${lib.escapeShellArg cfg.originCertFile} > "$RUNTIME_DIRECTORY/origin.key"
    chmod 0644 "$RUNTIME_DIRECTORY/origin.pem"
    chmod 0600 "$RUNTIME_DIRECTORY/origin.key"
  '';
in
{
  options.services.costan = {
    enable = lib.mkEnableOption "the costan.io game backend";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ./package.nix { };
      defaultText = lib.literalExpression "pkgs.callPackage ./package.nix { }";
      description = "The costan backend package to run.";
    };

    user = lib.mkOption { type = lib.types.str; default = "costan"; description = "Service user."; };
    group = lib.mkOption { type = lib.types.str; default = "costan"; description = "Service group."; };

    environmentFile = lib.mkOption {
      type = lib.types.path;
      description = "Non-secret config (filled-in deploy/costan.env.example): COSTAN_BASE_URL, client ids, etc.";
    };
    ageKeyFile = lib.mkOption {
      type = lib.types.path;
      default = "/etc/costan/age.key";
      description = "age private key used to decrypt the SOPS files (root-only).";
    };
    secretsFile = lib.mkOption {
      type = lib.types.path;
      description = "Path to secrets.enc.yaml (SOPS).";
    };

    # The OnFailure= handler. It is the only alerting path in this deployment
    # (no Prometheus, no Sentry). Same unit and script as deploy/.
    alert = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Post to the Discord mod channel when costan or the backup fails.";
      };
      channelId = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = ''
          Discord channel id for alerts. Null falls back to mod_config.report_channel
          in the database, which cannot work when the DATABASE is what failed --
          one of the two things this exists to report. Set it.
        '';
      };
    };

    # The 6-hourly verified backup (deploy/costan-backup.{service,timer}).
    backup = {
      enable = lib.mkOption { type = lib.types.bool; default = true; description = "Enable the 6-hourly verified SQLite backup."; };
      dir = lib.mkOption { type = lib.types.str; default = "/var/backups/costan"; description = "Where the .db.gz copies land."; };
      keepDays = lib.mkOption { type = lib.types.int; default = 30; description = "Prune copies older than this, by age (see deploy/backup.sh)."; };
      rcloneRemote = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "<remote>:<bucket>";
        description = ''
          Optional off-host copy, an rclone "<remote>:<bucket>". Null means the
          copies live on the same instance as the original, so losing the
          instance loses the backups too.
        '';
      };
    };

    nginx = {
      enable = lib.mkOption { type = lib.types.bool; default = true; description = "Configure nginx as the TLS reverse proxy."; };
      originHost = lib.mkOption { type = lib.types.str; example = "api.example.com"; description = "server_name for the origin vhost (your API hostname). Required."; };
      originPullCaFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        example = "/etc/nginx/certs/cloudflare-origin-pull-ca.pem";
        description = ''
          Cloudflare's Authenticated Origin Pulls CA. When set, nginx refuses any
          TLS client that does not present Cloudflare's origin-pull certificate
          (ssl_verify_client on). Strongly recommended; see DEPLOY.md.
        '';
      };
    };
    originCertFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Path to origin-cert.enc.yaml (SOPS). Required when nginx.enable is true.";
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    {
      users.users.${cfg.user} = lib.mkIf (cfg.user == "costan") {
        isSystemUser = true;
        group = cfg.group;
        description = "costan backend";
      };
      users.groups.${cfg.group} = lib.mkIf (cfg.group == "costan") { };

      systemd.services.costan = {
        description = "costan game backend";
        wantedBy = [ "multi-user.target" ];
        after = [ "network-online.target" ];
        wants = [ "network-online.target" ];
        unitConfig = lib.mkIf cfg.alert.enable {
          OnFailure = "costan-alert@%n.service";
        };
        serviceConfig = {
          Type = "exec";
          User = cfg.user;
          Group = cfg.group;
          ExecStartPre = "+${secretsDecrypt}"; # '+' = run as root (reads age key, chowns)
          ExecStart = "${lib.getExe cfg.package}";
          Restart = "on-failure";
          RestartSec = 2;
          # 90, matching deploy/costan.service (see the comment on its
          # TimeoutStopSec). Shutdown is a chain of bounded stages named in the
          # Go source: httpShutdownTimeout (10s) + sweepJoinTimeout (15s) +
          # server.connJoinTimeout (15s) + game.stopAllTimeout twice (15s + 15s)
          # = 70s, plus an unbounded store.Close tail. A shorter value SIGKILLs
          # mid-drain and loses queued appends. A normal restart takes well
          # under a second.
          TimeoutStopSec = 90;
          StateDirectory = "costan";
          RuntimeDirectory = "costan";
          EnvironmentFile = cfg.environmentFile;
          Environment = [
            "COSTAN_ADDR=127.0.0.1:4757"
            "COSTAN_DB=/var/lib/costan/costan.db"
            "COSTAN_SECURE_COOKIES=1"
            "COSTAN_REAL_IP_HEADER=CF-Connecting-IP"
            "DISCORD_CLIENT_SECRET_FILE=/run/costan/discord_client_secret"
            "GOOGLE_CLIENT_SECRET_FILE=/run/costan/google_client_secret"
            "DISCORD_BOT_TOKEN_FILE=/run/costan/discord_bot_token"
          ];
          # Hardening (a static binary needs almost nothing).
          NoNewPrivileges = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          PrivateTmp = true;
          PrivateDevices = true;
          ProtectKernelTunables = true;
          ProtectKernelModules = true;
          ProtectControlGroups = true;
          RestrictAddressFamilies = [ "AF_INET" "AF_INET6" ];
          RestrictNamespaces = true;
          LockPersonality = true;
          MemoryDenyWriteExecute = true;
        };
      };
    }

    # ── alerting ────────────────────────────────────────────────────────────
    (lib.mkIf cfg.alert.enable {
      # Templated, so %i is the unit that failed and one handler covers both.
      systemd.services."costan-alert@" = {
        description = "Alert to Discord that %i failed";
        # COSTAN_ALERT_CHANNEL_ID, when the operator named one. Nothing secret
        # goes here: the bot token is decrypted inside the script.
        environment = lib.optionalAttrs (cfg.alert.channelId != null) {
          COSTAN_ALERT_CHANNEL_ID = cfg.alert.channelId;
        };
        serviceConfig = {
          Type = "oneshot";
          # Root: it reads the age key to decrypt the bot token and reads the
          # failed unit's journal.
          ExecStart = "${alertScript} %I";
          # An alert that hangs must not pile up; an alert that fails must not
          # loop. alert.sh exits 0 whatever happens for the same reason.
          TimeoutStartSec = 30;
        };
      };

      warnings = lib.optional (cfg.alert.channelId == null)
        ("services.costan.alert.channelId is unset, so alerts fall back to "
         + "mod_config.report_channel in the database -- which cannot be read "
         + "when the database is what failed. Set it.");
    })

    # ── backups ─────────────────────────────────────────────────────────────
    (lib.mkIf cfg.backup.enable {
      systemd.services.costan-backup = {
        description = "costan database backup (VACUUM INTO, verified)";
        # Not a dependency: the backup is correct against a stopped server too.
        # After= only keeps boot-time catch-up ordering sane.
        after = [ "costan.service" ];
        unitConfig = lib.mkIf cfg.alert.enable {
          # Without this a failing backup timer is silent.
          OnFailure = "costan-alert@%n.service";
        };
        environment = {
          COSTAN_DB = "/var/lib/costan/costan.db";
          BACKUP_DIR = cfg.backup.dir;
          BACKUP_KEEP_DAYS = toString cfg.backup.keepDays;
          BACKUP_USER = cfg.user;
        } // lib.optionalAttrs (cfg.backup.rcloneRemote != null) {
          BACKUP_RCLONE_REMOTE = cfg.backup.rcloneRemote;
          RCLONE_CONFIG = "/etc/costan/rclone.conf";
          XDG_CACHE_HOME = "/tmp";
          HOME = "/tmp";
        };
        serviceConfig = {
          Type = "oneshot";
          User = cfg.user;
          Group = cfg.group;
          ExecStart = backupScript;
          # A backup must never win a fight with a live game for disk or CPU.
          Nice = 10;
          IOSchedulingClass = "idle";
          # VACUUM INTO on a large database is not instant. A ceiling, not a budget.
          TimeoutStartSec = "30min";
          StateDirectory = "costan";
          # Hardening mirrors the main unit, minus MemoryDenyWriteExecute: this
          # one runs third-party binaries (sqlite3, gzip, maybe rclone).
          NoNewPrivileges = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          PrivateTmp = true;
          PrivateDevices = true;
          ProtectKernelTunables = true;
          ProtectKernelModules = true;
          ProtectControlGroups = true;
          RestrictNamespaces = true;
          LockPersonality = true;
          # ProtectSystem=strict is read-only everywhere; name the two paths that
          # must not be. sqlite3 opens the source read-write (a WAL reader maps
          # the -shm), so the database directory is one of them.
          ReadWritePaths = [ "/var/lib/costan" cfg.backup.dir ];
          RestrictAddressFamilies = [ "AF_UNIX" "AF_INET" "AF_INET6" ];
        };
      };

      systemd.timers.costan-backup = {
        description = "Run the costan database backup every 6h";
        wantedBy = [ "timers.target" ];
        timerConfig = {
          # Offset off the hour, when log rotation, nix GC and most cron-style
          # jobs fire.
          OnCalendar = "*-*-* 01,07,13,19:23:00";
          # A missed run (host down, deploy in progress) is taken when the machine
          # is back rather than skipped. Windows are what the age prune counts.
          Persistent = true;
          RandomizedDelaySec = "10min";
          AccuracySec = "1min";
          Unit = "costan-backup.service";
        };
      };

      systemd.tmpfiles.rules = [
        "d ${cfg.backup.dir} 0750 ${cfg.user} ${cfg.group} -"
      ];
    })

    (lib.mkIf cfg.nginx.enable {
      assertions = [{
        assertion = cfg.originCertFile != null;
        message = "services.costan.originCertFile must be set when services.costan.nginx.enable is true.";
      }];

      # Oneshot that decrypts the TLS cert into tmpfs before nginx starts.
      systemd.services.costan-certs = {
        description = "Decrypt the costan origin TLS cert into tmpfs for nginx";
        before = [ "nginx.service" ];
        requiredBy = [ "nginx.service" ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          RuntimeDirectory = "costan-certs";
          RuntimeDirectoryPreserve = true; # keep across nginx reloads
          ExecStart = certDecrypt;
        };
      };

      services.nginx = {
        enable = true;
        # Trust CF-Connecting-IP only from Cloudflare's published ranges
        # (https://www.cloudflare.com/ips-v4, /ips-v6), so $remote_addr is the
        # real client behind Cloudflare and the connecting address otherwise.
        commonHttpConfig = ''
          set_real_ip_from 173.245.48.0/20;
          set_real_ip_from 103.21.244.0/22;
          set_real_ip_from 103.22.200.0/22;
          set_real_ip_from 103.31.4.0/22;
          set_real_ip_from 141.101.64.0/18;
          set_real_ip_from 108.162.192.0/18;
          set_real_ip_from 190.93.240.0/20;
          set_real_ip_from 188.114.96.0/20;
          set_real_ip_from 197.234.240.0/22;
          set_real_ip_from 198.41.128.0/17;
          set_real_ip_from 162.158.0.0/15;
          set_real_ip_from 104.16.0.0/13;
          set_real_ip_from 104.24.0.0/14;
          set_real_ip_from 172.64.0.0/13;
          set_real_ip_from 131.0.72.0/22;
          set_real_ip_from 2400:cb00::/32;
          set_real_ip_from 2606:4700::/32;
          set_real_ip_from 2803:f800::/32;
          set_real_ip_from 2405:b500::/32;
          set_real_ip_from 2405:8100::/32;
          set_real_ip_from 2a06:98c0::/29;
          set_real_ip_from 2c0f:f248::/32;
          real_ip_header CF-Connecting-IP;
        '';
        recommendedProxySettings = true;
        recommendedTlsSettings = true;
        virtualHosts.${cfg.nginx.originHost} = {
          addSSL = true;
          sslCertificate = "/run/costan-certs/origin.pem";
          sslCertificateKey = "/run/costan-certs/origin.key";
          extraConfig = lib.optionalString (cfg.nginx.originPullCaFile != null) ''
            ssl_client_certificate ${cfg.nginx.originPullCaFile};
            ssl_verify_client on;
          '';
          locations."~ ^/(api|auth|ws|discord)(/|$)" = {
            proxyPass = "http://127.0.0.1:4757";
            proxyWebsockets = true;
            extraConfig = ''
              # Overwrite, never forward: the backend trusts this header
              # (COSTAN_REAL_IP_HEADER), so a client must not be able to set it.
              proxy_set_header CF-Connecting-IP $remote_addr;
              proxy_read_timeout 3600s;
              proxy_send_timeout 3600s;
              proxy_buffering off;
            '';
          };
          locations."= /healthz" = {
            proxyPass = "http://127.0.0.1:4757";
            extraConfig = "access_log off;";
          };
          locations."/".return = "404";
        };
      };
    })
  ]);
}
