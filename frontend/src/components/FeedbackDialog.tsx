import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { X } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/iconButton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/errorCopy";

/** The server's limit (maxFeedbackLen in server/feedback.go), in characters. */
export const FEEDBACK_MAX = 2000;

/**
 * The feedback form, opened from the profile menu. The server stores the
 * message and posts it to the team's feedback channel; the page the player was
 * on goes with it (path only, no query string), so "this screen" can be read.
 *
 * Mounted only while open, so every open starts from an empty form.
 */
export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <FeedbackForm />}
    </Dialog>
  );
}

function FeedbackForm() {
  const { t } = useLingui();
  const [text, setText] = React.useState("");
  const [state, setState] = React.useState<"editing" | "sending" | "sent">("editing");
  const [error, setError] = React.useState<string | null>(null);
  const blank = text.trim() === "";

  const send = async () => {
    if (blank || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      await api.feedback(text, window.location.pathname);
      setState("sent");
    } catch (err) {
      setError(apiErrorText(err, t`Could not send your feedback. Try again in a moment.`));
      setState("editing");
    }
  };

  return (
    <DialogContent className="w-110 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <DialogTitle size="lg">
          <Trans>Send feedback</Trans>
        </DialogTitle>
        <DialogClose asChild>
          <IconButton aria-label={t`Close`} title={t`Close`} className="ml-auto">
            <X weight="bold" size={16} />
          </IconButton>
        </DialogClose>
      </div>
      {state === "sent" ? (
        <>
          <DialogDescription size="prose">
            <Trans>Thanks. Your feedback was sent.</Trans>
          </DialogDescription>
          <div className="flex justify-end">
            <DialogClose asChild>
              <Button size="sm" variant="secondary">
                <Trans>Close</Trans>
              </Button>
            </DialogClose>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <DialogDescription size="prose">
            <Trans>
              Found a bug, or have an idea? Tell us what happened or what you would change.
            </Trans>
          </DialogDescription>
          <Textarea
            autoFocus
            rows={6}
            maxLength={FEEDBACK_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter sends, as in most feedback boxes; a bare Enter
              // is a new line.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            aria-label={t`Your feedback`}
            aria-invalid={error ? true : undefined}
            placeholder={t`What happened, or what would you change?`}
            disabled={state === "sending"}
          />
          {error && (
            <p role="alert" className="text-sm font-semibold text-red-ink">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" size="sm" variant="secondary">
                <Trans>Cancel</Trans>
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={blank || state === "sending"}>
              {state === "sending" ? <Trans>Sending…</Trans> : <Trans>Send</Trans>}
            </Button>
          </div>
        </form>
      )}
    </DialogContent>
  );
}
