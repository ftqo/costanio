package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/discord"
)

const (
	// maxFeedbackLen caps a feedback message, in characters. The form's
	// textarea carries the same limit.
	maxFeedbackLen = 2000
	// maxFeedbackPageLen caps the page path stored beside it.
	maxFeedbackPageLen = 200
	// feedbackColor tints the feedback embed (blurple, so it does not read as
	// a moderation report in a shared channel).
	feedbackColor = 0x5865F2
)

// handleFeedback stores a message from the profile menu's feedback form and
// posts it to the feedback channel. The row is the record: the post is
// best-effort and off the request path, the same split chat reports use.
func (s *Server) handleFeedback(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if !s.feedbackLimit.allow(strconv.FormatInt(u.ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "FEEDBACK_RATE_LIMITED", "Too much feedback at once")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Msg  string `json:"msg"`
		Page string `json:"page"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	msg := strings.TrimSpace(body.Msg)
	if msg == "" {
		writeErr(w, http.StatusBadRequest, "FEEDBACK_REQUIRED", "Feedback is empty")
		return
	}
	if utf8.RuneCountInString(msg) > maxFeedbackLen {
		writeErrParams(w, http.StatusBadRequest, "FEEDBACK_TOO_LONG", map[string]any{"max": maxFeedbackLen}, "Feedback too long")
		return
	}
	id, err := s.store.CreateFeedback(u.ID, msg, feedbackPage(body.Page))
	if err != nil {
		slog.Error("create feedback", "user", u.ID, "err", err)
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not save feedback")
		return
	}
	s.bg.Go(func() { s.postFeedbackEmbed(id) })
	w.WriteHeader(http.StatusNoContent)
}

// feedbackPage reduces the client-reported page to a bare in-app path: no
// query string or fragment (invite codes and the like travel there), no
// absolute URL, and no more than maxFeedbackPageLen bytes.
func feedbackPage(p string) string {
	p = strings.TrimSpace(p)
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") {
		return ""
	}
	return truncate(p, maxFeedbackPageLen)
}

// postFeedbackEmbed posts a stored feedback row to the configured feedback
// channel. Best-effort: with no bot or no channel it logs and returns, and the
// feedback stays in the table.
func (s *Server) postFeedbackEmbed(id int64) {
	if s.discordBot == nil {
		slog.Info("feedback stored; no discord bot configured", "feedback", id)
		return
	}
	channel, err := s.store.FeedbackChannel()
	if err != nil || channel == "" {
		slog.Info("feedback stored; no feedback channel set", "feedback", id, "err", err)
		return
	}
	f, err := s.store.FeedbackByID(id)
	if err != nil {
		slog.Error("load feedback for embed", "feedback", id, "err", err)
		return
	}
	from, _ := s.store.UserByID(f.UserID)
	name := nameLine(from, f.UserID)
	if from != nil && from.IsGuest {
		name += " · guest"
	}
	page := "*unknown*"
	if f.Page != "" {
		page = discord.EscapeMarkdown(f.Page)
	}
	embed := discord.Embed{
		Title:       "Feedback",
		Description: discord.Quote(f.Msg),
		Color:       feedbackColor,
		Fields: []discord.EmbedField{
			{Name: "From", Value: name, Inline: true},
			{Name: "Page", Value: page, Inline: true},
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	msgID, err := s.discordBot.PostChannelMessage(ctx, channel, embed, nil)
	if err != nil {
		slog.Error("post feedback embed", "feedback", id, "err", err)
		return
	}
	if err := s.store.SetFeedbackMessageID(id, msgID); err != nil {
		slog.Error("save feedback message id", "feedback", id, "err", err)
	}
}
