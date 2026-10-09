import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  BETA_EXPANSIONS,
  groupedExpansions,
  EXPANSION_MODULE,
  type Expansions,
  type ExpansionGroup,
} from "@/lib/format";
import {
  EXPANSION_CONFLICTS,
  EXPANSION_WARNINGS,
  selectionWarnings,
  compatModules,
  toggleCompat,
  type CompatPair,
} from "@/lib/expansionCompat";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";

// Copy for the expansion switches at the top of the settings panel.
// Descriptors, not strings: evaluated once at import, a string would freeze
// the language then. `i18n._(...)` at the render site follows the player.
const EXPANSION_BLURBS: Record<keyof Expansions, MessageDescriptor> = {
  // Each blurb names what its module removes as well as what it adds, since
  // that is what a host can't guess (e.g. Knights: no development deck, play
  // to 13; Fishermen: the lake, the fish ladder, the boot's +1; Caravans: the
  // vote and the scoring).
  knights: msg`City improvements, knights, and barbarian invasions. No development deck, and you play to 13. Longer, heavier games.`,
  islands: msg`Ships, sea routes, and bonus points for settling new islands. Needs a map with sea.`,
  fishermen: msg`Fishing grounds on the coast and a lake where the desert was, paying fish you spend on a ladder of favours. The robber starts off the board, and whoever lands the old boot needs one more point to win.`,
  caravans: msg`Neutral caravans grow out of an oasis, and the table bids for where each camel goes. Buildings between two camels score.`,
  harbormaster: msg`A 2 point card for whoever builds most on the harbours, and one more point to win.`,
  rivers: msg`Rivers only a bridge may cross, and coins for building along the water.`,
  raiders: msg`Raiders land on the coast every time anybody builds. No robber, and no development deck: you answer with riders, and defending is a joint effort.`,
  wagons: msg`Haul cargo between three trade hexes. No robber, no longest road.`,
  explorers: msg`A whole game of its own: a home island, two thirds of the map face down, cargo ships, and three missions to sail for. Plays alone or with Knights.`,
};

/** Shelf headings. Plain nouns; the cards under each heading explain the
 *  difference. */
const GROUP_LABELS: Record<ExpansionGroup, MessageDescriptor> = {
  core: msg`Expansions`,
  scenario: msg`Scenarios`,
};

/**
 * One expansion on the picker shelf: name, what it does, and its switch.
 *
 * The description is visible text, not a `title` tooltip, so it shows on touch
 * devices; this is where a player decides whether they want a whole rules
 * module.
 *
 * Every row is the same flat print row whatever its state, so on and off rows
 * line up; the switch carries the state.
 *
 * `moduleKey` is the wire name (knights is `cak`), not the picker key or the
 * label: the compatibility tables are keyed by it, and tests and styles can
 * address it independent of language.
 *
 * `blockedReason` is rendered too, not hovered (there is no hover on a phone),
 * and also goes on `title` for a pointer user reaching for the switch.
 *
 * `lockedReason` is the same in a calmer voice: the switch is held by something
 * outside the picker (the map builder's shape decides Islands), a fact rather
 * than a fault, so it uses the blurb's muted ink and the card keeps full
 * opacity.
 */
export const ExpansionCard = ({
  moduleKey,
  name,
  blurb,
  beta,
  on,
  disabled,
  blockedReason,
  lockedReason,
  onToggle,
}: {
  moduleKey: string;
  name: string;
  blurb: string;
  beta: boolean;
  on: boolean;
  disabled: boolean;
  blockedReason?: string;
  lockedReason?: string;
  onToggle: () => void;
}) => (
  <div
    data-expansion={moduleKey}
    data-on={on ? "true" : "false"}
    // Every row is the same flat print row; the switch alone says on or off.
    // A row the host cannot change (locked, blocked, or not the host) mutes
    // its name, and the switch goes grey, whether it is on or off.
    className="flex items-start gap-3 rounded-base border border-transparent bg-elev2 px-3 py-2.5"
  >
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "text-[14px] font-semibold",
            disabled || blockedReason || lockedReason ? "text-muted" : "text-foreground",
          )}
        >
          {name}
        </span>
        {beta && (
          <Badge data-beta-badge="" tone="beta">
            <Trans>Beta</Trans>
          </Badge>
        )}
      </div>
      <div className="mt-0.5 text-[12px] leading-[1.4] text-muted">{blurb}</div>
      {blockedReason && (
        <div className="mt-1 text-[12px] font-medium leading-[1.4] text-red-ink">
          {blockedReason}
        </div>
      )}
      {!blockedReason && lockedReason && (
        <div data-locked className="mt-1 text-[12px] font-medium leading-[1.4] text-muted">
          {lockedReason}
        </div>
      )}
    </div>
    <div className="shrink-0 pt-0.5" title={blockedReason ?? lockedReason}>
      <Switch
        aria-label={name}
        checked={on}
        disabled={disabled || !!blockedReason || !!lockedReason}
        onCheckedChange={onToggle}
      />
    </div>
  </div>
);

/**
 * The whole expansion picker: every shelf, every switch, and the compatibility
 * state around them. Two rules:
 *
 *  - A conflict disables the switch that would create it and says why on the
 *    card. Only an off switch can be blocked; the one already on is how the
 *    host gets unstuck.
 *  - A warning disables nothing: it is a note under the shelves naming a pair
 *    that plays fine but loses something.
 *
 * `conflicts` and `warnings` default to the real tables and are props so tests
 * can drive both paths.
 */
export function ExpansionShelf({
  exp,
  disabled,
  onToggle,
  conflicts = EXPANSION_CONFLICTS,
  warnings = EXPANSION_WARNINGS,
  only,
  locked,
  coreHeading = true,
  allowScenarios = true,
}: {
  exp: Expansions;
  disabled: boolean;
  onToggle: (key: keyof Expansions, on: boolean) => void;
  conflicts?: readonly CompatPair[];
  warnings?: readonly CompatPair[];
  /**
   * Show only these expansions, keeping the shelves and their order. Absent
   * means all of them (the lobby).
   */
  only?: ReadonlySet<keyof Expansions>;
  /**
   * Switches held in place from outside, each with the sentence saying why. The
   * map builder derives Islands from the shape (separate landmasses need ships;
   * one solid landmass has no sea), so that switch is shown set and explained.
   */
  locked?: Partial<Record<keyof Expansions, string>>;
  /** Draw the "Expansions" heading over the core shelf. Off when the shelf
   *  sits inside a panel that already carries that heading (the map builder). */
  coreHeading?: boolean;
  /** Offer the scenario shelf. On everywhere; false hides it, keeping only
   *  scenarios a table already has. */
  allowScenarios?: boolean;
}) {
  const selected = (Object.keys(EXPANSION_MODULE) as (keyof Expansions)[])
    .filter((k) => exp[k])
    .map((k) => EXPANSION_MODULE[k]);
  const notes = selectionWarnings(selected, warnings);

  // The scenarios shelf is a dropdown, closed by default (most tables want the
  // four core switches, and scenarios are beta). It opens itself when a
  // scenario is already on, so a host never has a switch on they can't see.
  const scenarioKeys = groupedExpansions().find(([g]) => g === "scenario")?.[1] ?? [];
  const [scenariosOpen, setScenariosOpen] = useState(() => scenarioKeys.some(([k]) => exp[k]));

  return (
    <>
      {groupedExpansions()
        .map(
          ([group, entries]) =>
            [
              group,
              entries.filter(
                ([k]) =>
                  (!only || only.has(k)) && (allowScenarios || group !== "scenario" || exp[k]),
              ),
            ] as const,
        )
        .map(([group, entries]) => {
          if (entries.length === 0) return null;
          const collapsible = group === "scenario";
          const open = !collapsible || scenariosOpen;
          const heading = (
            <span className="flex items-center gap-1.5">
              {/* The label's type styles on the label alone, so the badge
                  beside it doesn't inherit the tracking and capitals. */}
              <span className="ui-label">{i18n._(GROUP_LABELS[group])}</span>
              {collapsible && (
                <Badge data-beta-badge="" tone="beta">
                  <Trans>Beta</Trans>
                </Badge>
              )}
            </span>
          );
          return (
            <div key={group} className="flex flex-col gap-1.5">
              {!collapsible && !coreHeading ? null : collapsible ? (
                <button
                  type="button"
                  aria-expanded={open}
                  data-scenarios-toggle
                  onClick={() => setScenariosOpen((v) => !v)}
                  className="flex items-center gap-1.5 self-start rounded-md px-0.5 -mx-0.5 cursor-pointer hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {heading}
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block text-[12px] text-muted transition-transform",
                      open ? "rotate-180" : "rotate-0",
                    )}
                  >
                    {"\u25BE"}
                  </span>
                </button>
              ) : (
                heading
              )}
              {open &&
                entries.map(([key, label]) => {
                  const on = exp[key];
                  const { blockedBy } = toggleCompat(
                    selected,
                    EXPANSION_MODULE[key],
                    on,
                    conflicts,
                  );
                  return (
                    <ExpansionCard
                      key={key}
                      moduleKey={EXPANSION_MODULE[key]}
                      name={i18n._(label)}
                      blurb={i18n._(EXPANSION_BLURBS[key])}
                      // The scenarios heading already says Beta; the badge stays
                      // for a beta module on the core shelf.
                      beta={!collapsible && BETA_EXPANSIONS.has(key)}
                      on={on}
                      disabled={disabled}
                      blockedReason={blockedBy ? i18n._(blockedBy.reason) : undefined}
                      lockedReason={locked?.[key]}
                      onToggle={() => onToggle(key, on)}
                    />
                  );
                })}
            </div>
          );
        })}
      {notes.map((n) => (
        <div
          key={compatModules(n).join("+")}
          data-compat-warning={compatModules(n).join("+")}
          className="text-[12px] rounded-base px-3 py-2 text-muted bg-elev"
        >
          {i18n._(n.reason)}
        </div>
      ))}
    </>
  );
}
