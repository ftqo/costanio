package discord

import "context"

// activityCommandNames are the CHAT_INPUT slash commands that open the Activity.
// Both do the same thing (the handler replies with a LAUNCH_ACTIVITY interaction
// callback); two names give players either entry point.
var activityCommandNames = []string{"play", "costanio"}

// RegisterActivityCommands upserts the global /play and /costanio commands. Each is
// a CHAT_INPUT command installable to guilds + users and usable everywhere
// (integration_types [0,1], contexts [0,1,2]), the same reach as the /launch entry
// point. POST-upsert per command leaves the entry-point command intact. Requires the
// bot token + app id; the app must have Activities enabled for the launch to work.
func (c Client) RegisterActivityCommands(ctx context.Context, appID string) error {
	for _, name := range activityCommandNames {
		if err := c.postGlobalCommand(ctx, appID, map[string]any{
			"name":              name,
			"description":       "Launch the game",
			"integration_types": []int{0, 1},
			"contexts":          []int{0, 1, 2},
		}); err != nil {
			return err
		}
	}
	return nil
}
