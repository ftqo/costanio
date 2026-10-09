package discord

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// VerifyInteraction checks a Discord interaction request signature. Discord signs
// (timestamp + rawBody) with its Ed25519 key; the app verifies with the public
// key from its application settings. Returns true iff the signature is valid.
// Discord requires interaction webhooks to verify signatures.
//
// The signed timestamp must also be within interactionMaxSkew of now, so a
// captured request (a moderation action, say) cannot be replayed later.
func VerifyInteraction(publicKeyHex, signatureHex, timestamp string, body []byte) bool {
	return verifyInteractionAt(publicKeyHex, signatureHex, timestamp, body, time.Now())
}

// interactionMaxSkew bounds how far a signed interaction timestamp may be from
// the server clock, in either direction.
const interactionMaxSkew = 5 * time.Minute

func verifyInteractionAt(publicKeyHex, signatureHex, timestamp string, body []byte, now time.Time) bool {
	secs, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	if d := now.Sub(time.Unix(secs, 0)); d > interactionMaxSkew || d < -interactionMaxSkew {
		return false
	}
	pub, err := hex.DecodeString(publicKeyHex)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return false
	}
	sig, err := hex.DecodeString(signatureHex)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return false
	}
	if timestamp == "" {
		return false
	}
	msg := append([]byte(timestamp), body...)
	return ed25519.Verify(ed25519.PublicKey(pub), msg, sig)
}

// Discord interaction/option type numbers and response/permission constants.
const (
	OptString = 3 // STRING option
	OptUser   = 6 // USER option (value is a user snowflake string)
	OptRole   = 8 // ROLE option (value is a role snowflake string)

	manageGuild = 0x20 // permission bit required to run /setrole

	cmdPrimaryEntryPoint = 4 // PRIMARY_ENTRY_POINT application command type
	handlerDiscordLaunch = 2 // DISCORD_LAUNCH_ACTIVITY: Discord launches the Activity itself
)

// EnsureEntryPointCommand registers the global PRIMARY_ENTRY_POINT command that
// gives the app its "Launch" button for the Activity. Without this command the
// Activity has no launcher entry even when fully configured (the bare
// activities/<id> deep-link still works).
// POST upserts a global command by name, so this is idempotent and leaves any
// other global commands untouched. Requires the app to have the Activities
// (EMBEDDED) flag enabled; only needs the bot token + app id (no guild).
//
// integration_types [0,1] = guild-install + user-install, and contexts [0,1,2] =
// guild + bot-DM + group-DM, so any user can launch the Activity from anywhere in
// Discord (not just servers where the bot is installed). User-install must also be
// enabled in the app's Installation settings in the Developer Portal, or Discord
// rejects integration_types: [1].
func (c Client) EnsureEntryPointCommand(ctx context.Context, appID string) error {
	return c.postGlobalCommand(ctx, appID, map[string]any{
		"name":              "launch",
		"description":       "Launch the game",
		"type":              cmdPrimaryEntryPoint,
		"handler":           handlerDiscordLaunch,
		"integration_types": []int{0, 1},
		"contexts":          []int{0, 1, 2},
	})
}

// postGlobalCommand upserts a single global application command by name (POST),
// leaving other global commands intact (a bulk PUT would replace the whole
// set). Returns an error on any non-2xx response.
func (c Client) postGlobalCommand(ctx context.Context, appID string, cmd map[string]any) error {
	url := fmt.Sprintf("%s/applications/%s/commands", c.base(), appID)
	buf, _ := json.Marshal(cmd)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bot "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpc().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("discord: register global command %q: %s: %s", cmd["name"], resp.Status, strings.TrimSpace(string(b)))
	}
	return nil
}

// RegisterGuildCommands registers the entire guild command set in a single
// idempotent PUT (a PUT overwrites the guild's whole command set). This is the
// production entry point; RegisterOpsCommands exists for testing. Supporter-role
// mapping moved into the /config panel, so there is no separate perk command set.
func (c Client) RegisterGuildCommands(ctx context.Context, appID string, rulesets []string) error {
	return c.putGuildCommands(ctx, appID, opsCommandDefs(rulesets))
}

// RegisterOpsCommands registers only the community + admin bot commands. Prefer
// RegisterGuildCommands; this per-group method exists for testing (a standalone
// PUT here would clobber the perk commands). `rulesets` populate the optional
// /leaderboard choices.
func (c Client) RegisterOpsCommands(ctx context.Context, appID string, rulesets []string) error {
	return c.putGuildCommands(ctx, appID, opsCommandDefs(rulesets))
}

// opsCommandDefs builds the community/admin command definitions. Community
// commands (/stats, /spectate, /leaderboard, /link) carry no
// default_member_permissions and are visible to everyone; admin commands
// (/whois, /reset-user) set it to the Manage-Server bit so Discord hides them
// from non-admins (the handler re-checks as the real authorization gate).
func opsCommandDefs(rulesets []string) []map[string]any {
	manage := strconv.Itoa(manageGuild)
	userOpt := func(required bool) map[string]any {
		return map[string]any{"name": "user", "description": "the Discord user", "type": OptUser, "required": required}
	}
	rulesetChoices := make([]map[string]any, 0, len(rulesets))
	for _, r := range rulesets {
		rulesetChoices = append(rulesetChoices, map[string]any{"name": r, "value": r})
	}

	return []map[string]any{
		{
			"name":        "stats",
			"description": "Show your costan stats (or another player's, staff only)",
			"options":     []map[string]any{userOpt(false)},
		},
		{
			"name":        "spectate",
			"description": "Get a link to watch a player's game",
			"options":     []map[string]any{userOpt(true)},
		},
		{
			"name":        "leaderboard",
			"description": "Show the top-rated players",
			"options": []map[string]any{
				{"name": "ruleset", "description": "which ruleset", "type": OptString, "required": false, "choices": rulesetChoices},
			},
		},
		{
			"name":        "link",
			"description": "Show how your Discord links to a costan account",
		},
		{
			"name":                       "whois",
			"description":                "Admin: look up a player's account details",
			"default_member_permissions": manage,
			"options":                    []map[string]any{userOpt(true)},
		},
		{
			"name":                       "reset-user",
			"description":                "Admin: reset a player's competitive record",
			"default_member_permissions": manage,
			"options":                    []map[string]any{userOpt(true)},
		},
		{
			"name":                       "config",
			"description":                "Admin: configure the bot's channels (reports, game feed, feedback)",
			"default_member_permissions": manage,
		},
		{
			"name":                       "unban-chat",
			"description":                "Admin: lift a player's chat ban",
			"default_member_permissions": manage,
			"options":                    []map[string]any{userOpt(true)},
		},
		{
			"name":                       "unlock-name",
			"description":                "Admin: lift a player's name lock",
			"default_member_permissions": manage,
			"options":                    []map[string]any{userOpt(true)},
		},
		{
			// The read side of the report queue. Everything else about moderation
			// is pushed to a channel, so this is how a mod checks for reports
			// that failed to post.
			"name":                       "reports",
			"description":                "Admin: show the open chat report queue",
			"default_member_permissions": manage,
		},
		{
			"name":                       "undo-report",
			"description":                "Admin: reopen a resolved report and undo what it did",
			"default_member_permissions": manage,
			"options": []map[string]any{
				{"name": "id", "description": "the report id", "type": OptString, "required": true},
			},
		},
		{
			"name":                       "report-strikes",
			"description":                "Admin: show a player's warnings and recent denials",
			"default_member_permissions": manage,
			"options":                    []map[string]any{userOpt(true)},
		},
	}
}

// putGuildCommands PUTs a guild command set, overwriting it idempotently.
func (c Client) putGuildCommands(ctx context.Context, appID string, cmds []map[string]any) error {
	url := fmt.Sprintf("%s/applications/%s/guilds/%s/commands", c.base(), appID, c.GuildID)
	buf, _ := json.Marshal(cmds)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bot "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpc().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("discord: register commands: %s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	return nil
}

// HasManageGuild reports whether a Discord interaction member-permissions bitfield
// string (e.g. "2147483647") includes Manage Guild or Administrator.
func HasManageGuild(perms string) bool {
	var bits uint64
	if _, err := fmt.Sscanf(perms, "%d", &bits); err != nil {
		return false
	}
	const administrator = 0x8
	return bits&(manageGuild|administrator) != 0
}
