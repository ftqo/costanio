package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ftqo/costan.io/discord"
	"github.com/ftqo/costan.io/store"
)

// reportColor tints the moderation embed (amber).
const reportColor = 0xE8A33D

func (c *Conn) handleReport(f clientFrame) {
	if f.ChatID <= 0 {
		c.sendErr(f.ID, "BAD_FRAME_MISSING_CHAT_ID", "Missing chat_id")
		return
	}
	if c.user == nil || c.user.DiscordID == "" {
		c.sendErr(f.ID, "REPORT_LINK_REQUIRED", "Link your Discord account to report")
		return
	}
	// A chat-banned user also may not file reports: each report posts an embed
	// with live Warn / Chat-ban buttons. Same gate and code as handleChat.
	if banned, err := c.srv.store.IsChatBanned(c.userID); err != nil {
		slog.Error("chat ban check", "user", c.userID, "err", err)
	} else if banned {
		c.sendErr(f.ID, "CHAT_BANNED", "Your chat privileges have been revoked")
		return
	}
	if ok, err := c.srv.store.CanReport(c.userID); err != nil {
		slog.Error("can-report check", "user", c.userID, "err", err)
		c.sendErr(f.ID, "INTERNAL", "Try again later")
		return
	} else if !ok {
		c.sendErr(f.ID, "REPORT_REVOKED", "Your reporting privileges are temporarily suspended")
		return
	}
	if !c.srv.reportLimit.allow(strconv.FormatInt(c.userID, 10)) {
		c.sendErr(f.ID, "REPORT_RATE_LIMITED", "One report at a time")
		return
	}

	msg, err := c.srv.store.ChatByID(f.ChatID)
	if err != nil {
		c.sendErr(f.ID, "CHAT_NOT_FOUND", "No such message")
		return
	}
	if msg.UserID == c.userID {
		c.sendErr(f.ID, "REPORT_SELF", "You can't report your own message")
		return
	}
	// You may only report a message you could have seen. chat.id is a sequential
	// INTEGER PRIMARY KEY, so without this anyone could walk the ids and report
	// strangers' messages, flooding the mod queue or getting an unrelated player
	// actioned.
	//
	// Lobby chat is global, so anyone may report it; game chat requires following
	// that game, the same test handleChat applies to sending.
	if !c.canSeeChatScope(msg.Scope) {
		c.sendErr(f.ID, "NOT_IN_THAT_GAME", "Not in that game")
		return
	}

	reportID, isNew, err := c.srv.store.CreateOrBumpReport(c.userID, msg.UserID, f.ChatID, msg.Scope)
	if err != nil {
		slog.Error("create report", "chat", f.ChatID, "err", err)
		c.sendErr(f.ID, "INTERNAL", "Could not file report")
		return
	}
	// Persist done; surfacing to Discord is best-effort and off the hot path.
	if isNew {
		c.srv.bg.Go(func() { c.srv.postReportEmbed(reportID) })
	}
	// Reporter gets no outcome (privacy); the client toasts optimistically.
}

// canSeeChatScope reports whether this connection is in a position to have seen
// a message in the given chat scope. "lobby" is public; "game:<id>" requires
// following that game. Anything else is a scope no client can be in.
func (c *Conn) canSeeChatScope(scope string) bool {
	if scope == "lobby" {
		return true
	}
	id, ok := strings.CutPrefix(scope, "game:")
	return ok && id != "" && c.following() == id
}

// postReportEmbed surfaces a newly-created report to the configured mod channel
// with Do-Nothing / Warn / Chat-Ban buttons. Best-effort: with no channel or bot
// client it logs and returns; the report is already stored.
func (s *Server) postReportEmbed(reportID int64) {
	if s.discordBot == nil {
		slog.Warn("report filed but no discord bot configured", "report", reportID)
		return
	}
	channel, err := s.store.ModChannel()
	if err != nil || channel == "" {
		slog.Warn("report filed but no mod channel set", "report", reportID, "err", err)
		return
	}
	r, err := s.store.ReportByID(reportID)
	if err != nil {
		slog.Error("load report for embed", "report", reportID, "err", err)
		return
	}
	accused, _ := s.store.UserByID(r.AccusedID)
	warns, _ := s.store.WarnCount(r.AccusedID)

	// A filter report records the accused as its own reporter (the marker
	// Report.Automated reads back), so render it differently from a human
	// report rather than as an apparent self-report.
	title, reporter := "Chat report", "Automated language filter"
	if r.Automated() {
		title = "Chat report (language filter)"
	} else {
		u, _ := s.store.UserByID(r.ReporterID)
		reporter = nameLine(u, r.ReporterID)
	}
	// Truncate the source before quoting: Quote escapes what it is given, so a
	// cut made afterwards could split an escape sequence. 1000 bytes quoted and
	// escaped stays well inside Discord's 4096 limit, so no later clip fires.
	embed := discord.Embed{
		Title:       title,
		Description: discord.Quote(truncate(r.Msg, 1000)),
		Color:       reportColor,
		Fields: []discord.EmbedField{
			{Name: "Accused", Value: nameLine(accused, r.AccusedID), Inline: true},
			{Name: "Reporter", Value: reporter, Inline: true},
			{Name: "Scope", Value: r.Scope, Inline: true},
			{Name: "Prior warnings", Value: strconv.Itoa(warns), Inline: true},
		},
	}
	if r.ReportCount > 1 {
		embed.Fields = append(embed.Fields, discord.EmbedField{
			Name: "Reports", Value: strconv.Itoa(r.ReportCount), Inline: true})
	}
	if ctx := s.reportContext(r.ChatID, embed); ctx != "" {
		embed.Fields = append(embed.Fields, discord.EmbedField{Name: "Context", Value: ctx})
	}
	rows := []discord.ActionRow{{Buttons: []discord.Button{
		{Label: "Do nothing", CustomID: fmt.Sprintf("mod:report:%d:none", r.ID), Style: discord.ButtonSecondary},
		{Label: "Warn", CustomID: fmt.Sprintf("mod:report:%d:warn", r.ID), Style: discord.ButtonPrimary},
		{Label: "Chat ban", CustomID: fmt.Sprintf("mod:report:%d:ban", r.ID), Style: discord.ButtonDanger},
	}}}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	msgID, err := s.discordBot.PostChannelMessage(ctx, channel, embed, rows)
	if err != nil {
		slog.Error("post report embed", "report", r.ID, "err", err)
		return
	}
	if err := s.store.SetReportMessageID(r.ID, msgID); err != nil {
		slog.Error("save report message id", "report", r.ID, "err", err)
	}
}

// reportContextLines is how many messages either side of a reported one its
// embed shows, from the same chat scope (the lobby, or that one game's table).
const reportContextLines = 3

// reportContextMsgBytes caps each context message before escaping. A chat
// message may be 500 bytes, so seven of them escaped would be several times a
// field's 1024; cut each one short and the window usually fits whole.
const reportContextMsgBytes = 150

// embedTotalLimit is Discord's cap on all of an embed's text together. Over it
// the post is refused and the report never reaches the channel.
const embedTotalLimit = 6000

// reportContext renders the chat around a reported message for its embed, or
// "" when there is none to show. It is fitted to what the embed has left, so
// the context is what gives way, never the report: lines drop from the far
// ends first and the reported line goes last.
//
// Everything in the window was shown to everyone in that scope; the store
// query never leaves the reported message's own scope.
func (s *Server) reportContext(chatID int64, embed discord.Embed) string {
	lines, err := s.store.ReportContext(chatID, reportContextLines)
	if err != nil {
		slog.Warn("load report context", "chat", chatID, "err", err)
		return ""
	}
	if len(lines) < 2 {
		return "" // the reported message alone repeats the description
	}
	ctx := make([]discord.ContextLine, len(lines))
	for i, l := range lines {
		ctx[i] = discord.ContextLine{From: l.From, Msg: truncate(l.Msg, reportContextMsgBytes), Reported: l.ID == chatID}
	}
	// Byte lengths overcount Discord's characters, so this budget is safe.
	used := len(embed.Title) + len(embed.Description) + len("Context")
	for _, f := range embed.Fields {
		used += len(f.Name) + len(f.Value)
	}
	return discord.FitContext(ctx, embedTotalLimit-used)
}

// handleReportButton resolves a moderation report from a mod-channel button
// press. customID is "mod:report:<id>:none|warn|ban". Atomic: ResolveReport
// guards against double-clicks, so side effects fire at most once.
func (s *Server) handleReportButton(w http.ResponseWriter, customID, callerDiscordID string) {
	parts := strings.Split(customID, ":") // ["mod","report","<id>","<action>"]
	if len(parts) != 4 {
		reply(w, "Malformed action.")
		return
	}
	reportID, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil {
		reply(w, "Malformed report id.")
		return
	}
	action := parts[3]

	r, err := s.store.ReportByID(reportID)
	if err != nil {
		updateMessage(w, discord.Embed{Description: "That report no longer exists.", Color: reportColor})
		return
	}
	if r.Status != "open" {
		updateMessage(w, discord.Embed{Description: "Already actioned.", Color: reportColor})
		return
	}

	var modID *int64
	if mu, err := s.store.UserByDiscordID(callerDiscordID); err == nil {
		modID = &mu.ID
	}

	// Decide + commit the resolution and its side effect in one transaction:
	// warn-escalation, the status flip, and the strike/ban are atomic, so
	// concurrent warns can't both stay "warn" and skip the ban, and a failed ban
	// rolls back instead of leaving a hollow resolved='ban'.
	res, err := s.store.ResolveReportAction(reportID, action, modID, "report resolution")
	if err != nil {
		slog.Error("resolve report", "report", reportID, "err", err)
		reply(w, "Sorry, that failed.")
		return
	}
	if !res.Resolved { // lost a double-click race
		updateMessage(w, discord.Embed{Description: "Already actioned.", Color: reportColor})
		return
	}

	var outcome string
	switch res.Effective {
	case "none":
		outcome = "Dismissed, no action. Reporter received a denial strike."
	case "warn":
		s.dmUser(r.AccusedID, "You've received a warning for a reported chat message. Continued violations may result in a chat ban.")
		outcome = "Warned."
	case "ban":
		if res.Escalated {
			s.dmUser(r.AccusedID, "You've been chat-banned after reaching the warning limit.")
			outcome = "Warning limit reached, chat ban applied."
		} else {
			s.dmUser(r.AccusedID, "You've been chat-banned for a reported chat message.")
			outcome = "Chat ban applied."
		}
	default:
		outcome = "Unknown action."
	}
	slog.Info("mod report resolved", "report", reportID, "resolution", res.Effective, "by", callerDiscordID)
	updateMessage(w, discord.Embed{
		Description: outcome + fmt.Sprintf("\nActioned by <@%s>.", callerDiscordID),
		Color:       reportColor,
	})
}

// postNameLockEmbed best-effort posts an audit embed to the mod channel when the
// name filter auto-locks a user. No buttons (reversal is /unlock-name); the
// lock is already in the DB, so a missing bot or channel just logs a warning.
//
// This is the only automatic punishment left. A chat filter hit opens a report
// for a moderator instead (docs/moderation.md); a name is not typed in passing,
// and is rejected before it exists.
func (s *Server) postNameLockEmbed(userID int64, attempted, word string) {
	if s.discordBot == nil {
		slog.Warn("name lock but no discord bot configured", "user", userID)
		return
	}
	channel, err := s.store.ModChannel()
	if err != nil || channel == "" {
		slog.Warn("name lock but no mod channel set", "user", userID, "err", err)
		return
	}
	u, _ := s.store.UserByID(userID)
	embed := discord.Embed{
		Title:       "Automatic name lock",
		Description: discord.Quote(truncate(attempted, 1000)),
		Color:       reportColor,
		Fields: []discord.EmbedField{
			{Name: "User", Value: nameLine(u, userID), Inline: true},
			{Name: "Matched term", Value: discord.EscapeMarkdown(word), Inline: true},
			{Name: "Action", Value: "Name locked (use /unlock-name to reverse)", Inline: false},
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := s.discordBot.PostChannelMessage(ctx, channel, embed, nil); err != nil {
		slog.Error("post name lock embed", "user", userID, "err", err)
	}
}

// dmUser best-effort DMs a user by internal id (looks up their Discord id).
// The DM renders in a Discord client, out of reach of the frontend's
// localization, so the copy is English like all bot-originated text.
func (s *Server) dmUser(userID int64, content string) {
	if s.discordBot == nil {
		return
	}
	u, err := s.store.UserByID(userID)
	if err != nil || u.DiscordID == "" {
		return
	}
	s.bg.Go(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := s.discordBot.SendDM(ctx, u.DiscordID, content); err != nil {
			slog.Warn("moderation DM failed", "user", userID, "err", err)
		}
	})
}

// nameLine is a player's display name for a moderation embed field, escaped,
// beside their Discord mention when they have one.
func nameLine(u *store.User, id int64) string {
	if u == nil {
		return fmt.Sprintf("user %d", id)
	}
	return discord.NameMention(u.Name, u.DiscordID)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	cut := n - 1
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}
