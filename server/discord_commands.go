package server

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ftqo/costan.io/discord"
	"github.com/ftqo/costan.io/ranked"
	"github.com/ftqo/costan.io/store"
)

// Embed accent colors. embedColor (blurple) is the neutral default; the per-game
// accents mirror the site's mode colors so a player's card is tinted by the
// ruleset they're strongest in; gold/red are used for the leaderboard and the
// destructive reset confirm.
const (
	embedColor  = 0x5865F2 // Discord blurple (neutral default)
	colorBase   = 0x57F287 // green
	colorIsles  = 0x3BA9EE // blue
	colorKnight = 0x9B59B6 // purple
	colorTab    = 0x1ABC9C // teal (fishermen/caravans)
	colorGold   = 0xF0B232 // leaderboard
	colorDanger = 0xED4245 // reset confirm
)

// resetConfirmPrefix is the custom_id prefix of the /reset-user confirm button;
// the target's Discord id follows the colon.
const resetConfirmPrefix = "reset-user:"

// moduleLabels maps a ruleset module key to its display name. Keys absent here
// fall back to their raw key with the first letter capitalized.
var moduleLabels = map[string]string{
	"islands":   "Islands",
	"cak":       "Knights",
	"fishermen": "Fishermen",
	"caravans":  "Caravans",
	"raiders":   "Raiders",
	"wagons":    "Wagons",
}

// rulesetModules splits a ruleset key into its non-base module keys
// ("base+islands+cak" → ["islands", "cak"]). Base alone yields nothing.
func rulesetModules(rs string) []string {
	if rs == "" {
		rs = "base"
	}
	var mods []string
	for p := range strings.SplitSeq(rs, "+") {
		if p != "" && p != "base" {
			mods = append(mods, p)
		}
	}
	return mods
}

// rulesetLabel prettifies a ruleset key for display ("base+islands" -> "Islands",
// "base+islands+cak" -> "Islands and Knights").
//
// The ", " / " and " join and the strings.ToUpper(m[:1]) fallback are English
// (the latter is wrong for Turkish "i"). Localizing this needs a catalog
// message with named arguments, not translated fragments.
func rulesetLabel(rs string) string {
	mods := rulesetModules(rs)
	if len(mods) == 0 {
		return "Base"
	}
	names := make([]string, len(mods))
	for i, m := range mods {
		if label, ok := moduleLabels[m]; ok {
			names[i] = label
		} else {
			names[i] = strings.ToUpper(m[:1]) + m[1:]
		}
	}
	if len(names) == 1 {
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

// moduleAccent maps a ruleset to its embed accent color. Combined rulesets are
// tinted by their first module, so a mixed game still reads as an expansion game
// rather than falling back to the neutral default.
func moduleAccent(rs string) int {
	mods := rulesetModules(rs)
	if len(mods) == 0 {
		return colorBase
	}
	switch mods[0] {
	case "islands":
		return colorIsles
	case "cak":
		return colorKnight
	case "fishermen", "caravans", "raiders":
		return colorTab
	default:
		return embedColor
	}
}

// webURL builds an absolute URL into the web app from a site-relative path.
func (s *Server) webURL(path string) string {
	return strings.TrimSuffix(s.auth.Config.BaseURL, "/") + path
}

// cmdStats renders a user's per-ruleset record. With no user argument it shows
// the caller's own stats; a user argument is admin-only (enforced via the admin
// flag) so members can't snoop on each other.
func (s *Server) cmdStats(w http.ResponseWriter, targetDiscordID, callerDiscordID string, admin bool) {
	discordID := callerDiscordID
	if targetDiscordID != "" {
		if !admin {
			replyEmbed(w, discord.Embed{Description: "You can only view your own stats."}, true)
			return
		}
		discordID = targetDiscordID
	}
	if discordID == "" {
		replyEmbed(w, discord.Embed{Description: "Link your Discord to a costan account first."}, true)
		return
	}

	u, err := s.store.UserByDiscordID(discordID)
	if errors.Is(err, store.ErrNotFound) {
		replyEmbed(w, discord.Embed{Description: "No costan account is linked to that Discord user."}, true)
		return
	}
	if err != nil {
		replyEmbed(w, discord.Embed{Description: "Sorry, could not read stats."}, true)
		return
	}

	rows, err := s.store.StatsFor(u.ID)
	if err != nil {
		replyEmbed(w, discord.Embed{Description: "Sorry, could not read stats."}, true)
		return
	}
	replyEmbedWithButtons(w, s.statsEmbed(u, rows), []discord.ActionRow{s.leaderboardButtonRow()}, true)
}

// statsEmbed builds the rich card shared by /stats: avatar author + top-right
// thumbnail, an accent tinted by the player's best ruleset, a one-line summary,
// and one inline field per ruleset.
func (s *Server) statsEmbed(u *store.User, rows []store.UserStats) discord.Embed {
	e := discord.Embed{
		Title:      discord.EscapeMarkdown(u.Name) + "'s stats",
		Author:     discord.EmbedAuthor{Name: u.Name, IconURL: u.Avatar},
		Thumbnail:  u.Avatar,
		Color:      embedColor,
		Footer:     "costan",
		FooterIcon: s.webURL("/favicon.png"),
	}
	if len(rows) == 0 {
		e.Description = "No ranked games played yet."
		return e
	}
	totalWins, totalGames, bestElo := 0, 0, -1
	var bestRuleset string
	for _, r := range rows {
		totalWins += r.Wins
		totalGames += r.Games
		if int(r.Elo) > bestElo {
			bestElo, bestRuleset = int(r.Elo), r.Ruleset
		}
		rating := fmt.Sprintf("**%d**", int(r.Elo))
		if r.Provisional {
			rating += " *(provisional)*"
		}
		e.Fields = append(e.Fields, discord.EmbedField{
			Name:   rulesetLabel(r.Ruleset),
			Value:  fmt.Sprintf("%s · %d/%d wins", rating, r.Wins, r.Games),
			Inline: true,
		})
	}
	e.Color = moduleAccent(bestRuleset)
	e.Description = fmt.Sprintf("%d wins across %d games · best in **%s**", totalWins, totalGames, rulesetLabel(bestRuleset))
	return e
}

// leaderboardButtonRow is a link button to the web leaderboard.
func (s *Server) leaderboardButtonRow() discord.ActionRow {
	return discord.ActionRow{Buttons: []discord.Button{
		{Label: "Leaderboard", URL: s.webURL("/leaderboard"), Style: discord.ButtonLink},
	}}
}

// cmdSpectate returns a watch link for the game the target Discord user is in.
// Public games answer anyone. A private game answers only a Manage-Server admin,
// with the invite code in the link (as the game feed does). To everyone else a
// private game reads as no game, so the refusal doesn't reveal one is running.
func (s *Server) cmdSpectate(w http.ResponseWriter, targetDiscordID string, admin bool) {
	notPlaying := discord.Embed{Description: "That player isn't in a public game right now."}
	if targetDiscordID == "" {
		replyEmbed(w, notPlaying, true)
		return
	}
	u, err := s.store.UserByDiscordID(targetDiscordID)
	if err != nil {
		replyEmbed(w, notPlaying, true)
		return
	}
	gameID, err := s.store.ActiveGameForUser(u.ID)
	if err != nil || gameID == "" {
		replyEmbed(w, notPlaying, true)
		return
	}
	g, err := s.store.GameByID(gameID)
	if err != nil {
		replyEmbed(w, notPlaying, true)
		return
	}
	private := !g.Public
	if private && !admin {
		replyEmbed(w, notPlaying, true)
		return
	}
	visibility := "public"
	if private {
		visibility = "private"
	}
	e := discord.Embed{
		Title:       discord.EscapeMarkdown(u.Name) + " is playing",
		Author:      discord.EmbedAuthor{Name: u.Name, IconURL: u.Avatar},
		Thumbnail:   u.Avatar,
		Description: fmt.Sprintf("A %s **%s** game is in progress.", visibility, rulesetLabel(g.Ruleset)),
		Color:       moduleAccent(g.Ruleset),
		Footer:      "costan",
		FooterIcon:  s.webURL("/favicon.png"),
	}
	row := discord.ActionRow{Buttons: []discord.Button{
		{Label: "Watch game", URL: s.inviteSpectateLink(g), Style: discord.ButtonLink},
	}}
	replyEmbedWithButtons(w, e, []discord.ActionRow{row}, true)
}

// cmdLeaderboard lists the top players for a ruleset (default base).
func (s *Server) cmdLeaderboard(w http.ResponseWriter, ruleset string) {
	if ruleset == "" {
		ruleset = "base"
	}
	// Only the ranked rulesets have standings (see handleLeaderboard). The slash
	// command's choices are already limited to these, so this catches a stale
	// registration or a hand-crafted interaction.
	if !ranked.IsRuleset(ruleset) {
		replyEmbed(w, discord.Embed{Description: "That mode has no leaderboard."}, true)
		return
	}
	entries, err := s.store.LeaderboardSnapshot(ruleset, 10)
	if err != nil {
		replyEmbed(w, discord.Embed{Description: "Sorry, could not read the leaderboard."}, true)
		return
	}
	e := discord.Embed{
		Title:      "🏆 Leaderboard · " + rulesetLabel(ruleset),
		Color:      colorGold,
		Footer:     "costan",
		FooterIcon: s.webURL("/favicon.png"),
	}
	if len(entries) == 0 {
		e.Description = "No ranked players yet."
		replyEmbed(w, e, true)
		return
	}
	// The #1 player's avatar rides along as the top-right thumbnail (Discord
	// embeds can't show a picture per row, only one thumbnail).
	if entries[0].Avatar != "" {
		e.Thumbnail = entries[0].Avatar
	}
	var b strings.Builder
	for i, en := range entries {
		fmt.Fprintf(&b, "%s **%s**: `%d`\n", rankBadge(i), discord.EscapeMarkdown(en.Name), int(en.Elo))
	}
	e.Description = strings.TrimRight(b.String(), "\n")
	replyEmbedWithButtons(w, e, []discord.ActionRow{s.leaderboardButtonRow()}, true)
}

// rankBadge returns a medal for the top three places and a padded number after.
func rankBadge(i int) string {
	switch i {
	case 0:
		return "🥇"
	case 1:
		return "🥈"
	case 2:
		return "🥉"
	default:
		return fmt.Sprintf("`%2d.`", i+1)
	}
}

// cmdLink shows whether the caller's Discord is linked to a costan account.
func (s *Server) cmdLink(w http.ResponseWriter, callerDiscordID string) {
	playRow := discord.ActionRow{Buttons: []discord.Button{
		{Label: "Play costan", URL: s.webURL("/"), Style: discord.ButtonLink},
	}}
	if callerDiscordID != "" {
		if u, err := s.store.UserByDiscordID(callerDiscordID); err == nil {
			replyEmbedWithButtons(w, discord.Embed{
				Title:       "Linked ✓",
				Author:      discord.EmbedAuthor{Name: u.Name, IconURL: u.Avatar},
				Thumbnail:   u.Avatar,
				Description: fmt.Sprintf("Your Discord is linked to **%s**.", discord.EscapeMarkdown(u.Name)),
				Color:       colorBase,
				Footer:      "costan",
				FooterIcon:  s.webURL("/favicon.png"),
			}, []discord.ActionRow{playRow}, true)
			return
		}
	}
	replyEmbedWithButtons(w, discord.Embed{
		Title:       "Not linked yet",
		Description: "Open costan and choose **Sign in with Discord** to link your account.",
		Color:       embedColor,
		Footer:      "costan",
		FooterIcon:  s.webURL("/favicon.png"),
	}, []discord.ActionRow{playRow}, true)
}

// cmdWhois renders an admin diagnostic for a target Discord user.
func (s *Server) cmdWhois(w http.ResponseWriter, targetDiscordID string) {
	u, err := s.store.UserByDiscordID(targetDiscordID)
	if errors.Is(err, store.ErrNotFound) {
		replyEmbed(w, discord.Embed{Description: "No costan account is linked to that Discord user."}, true)
		return
	}
	if err != nil {
		replyEmbed(w, discord.Embed{Description: "Sorry, lookup failed."}, true)
		return
	}

	e := discord.Embed{
		Title:      "whois · " + discord.EscapeMarkdown(u.Name),
		Author:     discord.EmbedAuthor{Name: u.Name, IconURL: u.Avatar},
		Thumbnail:  u.Avatar,
		Color:      embedColor,
		Footer:     "costan",
		FooterIcon: s.webURL("/favicon.png"),
	}
	e.Fields = append(e.Fields, discord.EmbedField{Name: "Account", Value: fmt.Sprintf("#%d%s", u.ID, guestTag(u.IsGuest)), Inline: true})

	if bal, err := s.store.Balance(u.ID); err == nil {
		e.Fields = append(e.Fields, discord.EmbedField{Name: "Wallet", Value: strconv.Itoa(bal), Inline: true})
	}
	if sup, err := s.store.Supporter(u.ID); err == nil {
		e.Fields = append(e.Fields, discord.EmbedField{Name: "Supporter", Value: supporterLabel(sup), Inline: true})
	}
	if ids, err := s.store.IdentitiesForUser(u.ID); err == nil {
		providers := make([]string, 0, len(ids))
		for _, id := range ids {
			providers = append(providers, id.Provider)
		}
		if len(providers) > 0 {
			e.Fields = append(e.Fields, discord.EmbedField{Name: "Logins", Value: strings.Join(providers, ", ")})
		}
	}
	if sg, err := s.store.SeatedGameForUser(u.ID); err == nil && sg.ID != "" {
		e.Fields = append(e.Fields, discord.EmbedField{Name: "Current game", Value: fmt.Sprintf("%s (%s)", sg.ID, sg.Status)})
	}
	replyEmbed(w, e, true)
}

// cmdResetUserPrompt shows the confirmation card for /reset-user. The actual
// reset happens only when the returned button is pressed (handleComponent).
func (s *Server) cmdResetUserPrompt(w http.ResponseWriter, targetDiscordID string) {
	u, err := s.store.UserByDiscordID(targetDiscordID)
	if err != nil {
		replyEmbed(w, discord.Embed{Description: "No costan account is linked to that Discord user."}, true)
		return
	}
	e := discord.Embed{
		Title:     "Reset " + discord.EscapeMarkdown(u.Name) + "?",
		Author:    discord.EmbedAuthor{Name: u.Name, IconURL: u.Avatar},
		Thumbnail: u.Avatar,
		Description: "This clears ratings, win/loss stats, ranked penalties and forfeits.\n" +
			"Wallet, cosmetics, maps, friends and login are kept.",
		Color: colorDanger,
	}
	row := discord.ActionRow{Buttons: []discord.Button{
		{Label: "Confirm reset", CustomID: resetConfirmPrefix + targetDiscordID, Style: discord.ButtonDanger},
	}}
	replyEmbedWithButtons(w, e, []discord.ActionRow{row}, true)
}

// handleComponent routes message-component (button) presses. Admin-gated.
func (s *Server) handleComponent(w http.ResponseWriter, customID string, values []string, callerDiscordID string, admin bool) {
	if !admin {
		reply(w, "You need the Manage Server permission to use this.")
		return
	}
	if strings.HasPrefix(customID, "config:") {
		s.handleConfigComponent(w, customID, values)
		return
	}
	if strings.HasPrefix(customID, "mod:report:") {
		s.handleReportButton(w, customID, callerDiscordID)
		return
	}
	if !strings.HasPrefix(customID, resetConfirmPrefix) {
		reply(w, "Unknown action.")
		return
	}
	targetDiscordID := strings.TrimPrefix(customID, resetConfirmPrefix)
	u, err := s.store.UserByDiscordID(targetDiscordID)
	if err != nil {
		replyEmbed(w, discord.Embed{Description: "That account no longer exists."}, true)
		return
	}
	if err := s.store.SoftResetUser(u.ID); err != nil {
		if errors.Is(err, store.ErrUserInActiveGame) {
			replyEmbed(w, discord.Embed{Description: "They're in a game right now. Try again once it finishes."}, true)
			return
		}
		replyEmbed(w, discord.Embed{Description: "Sorry, the reset failed."}, true)
		return
	}
	slog.Info("discord reset-user", "event", "reset-user", "target_user_id", u.ID, "target_discord_id", targetDiscordID)
	replyEmbed(w, discord.Embed{
		Description: fmt.Sprintf("✅ Reset **%s**: competitive record cleared.", discord.EscapeMarkdown(u.Name)),
		Color:       colorBase,
	}, true)
}

// spectateLink builds the public watch URL for a game id from the server's
// configured base URL (empty base yields a site-relative path).
func (s *Server) spectateLink(gameID string) string {
	base := strings.TrimSuffix(s.auth.Config.BaseURL, "/")
	return base + "/game?g=" + gameID
}

// inviteSpectateLink is spectateLink with the game's invite code as `inv`, which
// the websocket gate (handleSub) and the client route both read. Anyone who
// receives it can watch, so it is only posted where that is intended: the
// public feed for public tables, and /spectate for admins on private ones.
//
// It takes the game rather than the code so the caller can't get that wrong;
// since 0029 privacy can't be read off the code.
func (s *Server) inviteSpectateLink(g *store.Game) string {
	if g.InviteCode == "" {
		return s.spectateLink(g.ID)
	}
	return s.spectateLink(g.ID) + "&inv=" + url.QueryEscape(g.InviteCode)
}

func guestTag(guest bool) string {
	if guest {
		return " (guest)"
	}
	return ""
}

func supporterLabel(sup store.Supporter) string {
	if !sup.Active {
		return "no"
	}
	tags := []string{}
	if sup.Boosting {
		tags = append(tags, "boosting")
	}
	if sup.Kofi {
		tags = append(tags, "ko-fi")
	}
	if sup.Staff {
		tags = append(tags, "staff")
	}
	if sup.Gift {
		tags = append(tags, "gift")
	}
	if len(tags) == 0 {
		return "yes"
	}
	return "yes (" + strings.Join(tags, ", ") + ")"
}

// cmdUnbanChat lifts a chat ban on the given Discord user.
func (s *Server) cmdUnbanChat(w http.ResponseWriter, discordID string) {
	u, err := s.store.UserByDiscordID(discordID)
	if err != nil {
		reply(w, "No such player.")
		return
	}
	if err := s.store.UnbanChat(u.ID); err != nil {
		reply(w, "Sorry, could not lift the ban.")
		return
	}
	reply(w, fmt.Sprintf("✅ Lifted **%s**'s chat ban.", discord.EscapeMarkdown(u.Name)))
}

// cmdUnlockName lifts a name lock on the given Discord user, letting them change
// their display name again. Mirrors cmdUnbanChat.
func (s *Server) cmdUnlockName(w http.ResponseWriter, discordID string) {
	u, err := s.store.UserByDiscordID(discordID)
	if err != nil {
		reply(w, "No such player.")
		return
	}
	if err := s.store.UnlockName(u.ID); err != nil {
		reply(w, "Sorry, could not lift the name lock.")
		return
	}
	reply(w, fmt.Sprintf("✅ Lifted **%s**'s name lock.", discord.EscapeMarkdown(u.Name)))
}

// cmdReportStrikes shows a player's moderation summary: total warnings, recent
// report denials (7-day window), and whether they are currently chat-banned.
func (s *Server) cmdReportStrikes(w http.ResponseWriter, discordID string) {
	u, err := s.store.UserByDiscordID(discordID)
	if err != nil {
		reply(w, "No such player.")
		return
	}
	warns, _ := s.store.WarnCount(u.ID)
	denials, _ := s.store.DenialCountSince(u.ID, time.Now().Unix()-7*24*3600)
	banned, _ := s.store.IsChatBanned(u.ID)
	reply(w, fmt.Sprintf("**%s** · warnings: %d · denials (7d): %d · chat-banned: %v", discord.EscapeMarkdown(u.Name), warns, denials, banned))
}

// cmdReports answers /reports with the open queue, so reports can be read even
// if the bot token is revoked and embeds stop posting.
func (s *Server) cmdReports(w http.ResponseWriter) {
	open, err := s.store.OpenReports(10)
	if err != nil {
		reply(w, "Could not read the report queue.")
		return
	}
	total, _, err := s.store.OpenReportBacklog()
	if err != nil {
		total = len(open)
	}
	sums := make([]discord.ReportSummary, 0, len(open))
	for _, r := range open {
		sums = append(sums, discord.ReportSummary{
			ID:       r.ID,
			Accused:  s.reportName(r.AccusedID),
			Reporter: s.reportName(r.ReporterID),
			Scope:    r.Scope,
			Msg:      r.Msg,
			Count:    r.ReportCount,
			// A real report cannot name its filer as its subject: handleReport
			// refuses a self-report, so the filter marks its reports that way.
			Automated: r.ReporterID == r.AccusedID,
			Age:       time.Since(time.Unix(r.CreatedAt, 0)),
		})
	}
	replyEmbed(w, discord.ReportQueueEmbed(sums, total), true)
}

// reportName is the display name for a report embed, escaped and beside the
// player's mention (discord.ReportSummary asks for NameMention), and never an
// error: one merged-away account must not stop the queue rendering.
func (s *Server) reportName(userID int64) string {
	u, err := s.store.UserByID(userID)
	if err != nil || u == nil {
		return "(unknown)"
	}
	return discord.NameMention(u.Name, u.DiscordID)
}

// cmdUndoReport reopens a resolved report and undoes the strike or ban it
// wrote. The denial strike on an honest reporter is not undone here; it
// expires on its own.
func (s *Server) cmdUndoReport(w http.ResponseWriter, idText string) {
	id, err := strconv.ParseInt(strings.TrimSpace(idText), 10, 64)
	if err != nil {
		reply(w, "That is not a report id.")
		return
	}
	out, err := s.store.ReopenReport(id)
	switch {
	case errors.Is(err, store.ErrReportSuperseded):
		reply(w, "A newer open report already covers that message.")
		return
	case err != nil:
		reply(w, "Could not reopen that report.")
		return
	case !out.Reopened:
		reply(w, fmt.Sprintf("Report %d was not resolved, so there was nothing to undo.", id))
		return
	}
	msg := fmt.Sprintf("Report %d is open again (undid: %s).", id, out.Was)
	if out.StrikeGone {
		msg += " The strike it wrote is gone."
	}
	if out.BanLifted {
		msg += " The chat ban it applied is lifted."
	}
	reply(w, msg)
}
