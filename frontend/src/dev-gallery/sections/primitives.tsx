// Gallery section: the primitives in components/ui, every variant in every
// state, rendered with the real components. See ../spec.tsx.
//
// Dialogs, confirms and toasts portal to <body> and position themselves with
// `position: fixed`, so they cannot sit in the page flow. Each one is rendered
// inside an iframe of this same gallery (`?section=primitives&iso=<name>`),
// where it opens for real, scrim included, against a small viewport of its
// own. The iframe mirrors the parent's theme class.
import * as React from "react";
import { Button, buttonLook } from "@/components/ui/button";
import { IconButton } from "@/components/ui/iconButton";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useConfirm, type ConfirmOptions } from "@/components/ui/confirm";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { Avatar } from "@/components/ui/avatar";
import { Swatch } from "@/components/ui/swatch";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ScrollFade } from "@/components/ui/scroll-fade";
import { Card } from "@/components/ui/card";
import { DiscordIcon, GoogleIcon } from "@/components/ProviderIcons";
import { SEAT_COLORS } from "@/lib/hexgeo";
import {
  CaretDown,
  DownloadSimple,
  Flag,
  GearSix,
  List,
  Plus,
  SignOut,
  Storefront,
  User,
  X,
} from "@/lib/icons";
import { Group, State, Break, type Surface } from "../spec";

export const title = "UI primitives";

// ---------------------------------------------------------------------------
// Shared helpers

type Force = "hover" | "active" | "focus-visible";

const INTERACTIVE_STATES: { label: string; force?: Force; disabled?: boolean }[] = [
  { label: "rest" },
  { label: "hover", force: "hover" },
  { label: "active", force: "active" },
  { label: "focus-visible", force: "focus-visible" },
  { label: "disabled", disabled: true },
];

const SEAT_NAMES = [
  "red",
  "blue",
  "amber",
  "purple",
  "green",
  "orange",
  "fishermen",
  "rose",
  "caravans",
  "slate",
];

const noop = () => {};

/** Group id and label prefix for a group repeated on several surfaces. */
function surfaceBits(base: string, surface: Surface) {
  return {
    id: surface === "panel" ? `primitives/${base}` : `primitives/${base}-${surface}`,
    suffix: surface === "panel" ? "" : ` (${surface})`,
    prefix: surface === "panel" ? "" : `${surface} · `,
  };
}

/**
 * Put `data-force` on the parent of a descendant the State cannot reach (an
 * inner button of a composite). The capture script forces the pseudo-class on
 * the first element child of a `[data-force]` element, so this only applies
 * when the target is its parent's first element child.
 */
function ForceOn({
  selector,
  force,
  children,
  className,
}: {
  selector: string;
  force: Force;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current?.querySelector(selector);
    const parent = el?.parentElement;
    if (el && parent && parent.firstElementChild === el) parent.setAttribute("data-force", force);
  });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button

type ButtonTone = "default" | "accent" | "danger" | "success" | "discord" | "google";
type ButtonVariant = "primary" | "secondary" | "quiet" | "ghost";
type ButtonSize = "sm" | "field" | "md" | "lg" | "icon";

const TONES: ButtonTone[] = ["default", "accent", "danger", "success", "discord", "google"];
const VARIANTS: ButtonVariant[] = ["primary", "secondary", "quiet", "ghost"];
const SIZES: ButtonSize[] = ["sm", "field", "md", "lg", "icon"];

const TONE_COPY: Record<ButtonTone, string> = {
  default: "Create table",
  accent: "Join table",
  danger: "Leave table",
  success: "Ready",
  discord: "Continue with Discord",
  google: "Continue with Google",
};
const VARIANT_COPY: Record<ButtonVariant, string> = {
  primary: "Create table",
  secondary: "Invite friends",
  quiet: "Show rules",
  ghost: "Leaderboard",
};

function toneIcon(tone: ButtonTone) {
  if (tone === "discord") return <DiscordIcon className="size-4" />;
  if (tone === "google") return <GoogleIcon className="size-4" />;
  return null;
}

function ButtonStates({ variant, tone }: { variant: ButtonVariant; tone: ButtonTone }) {
  const copy = variant === "primary" ? TONE_COPY[tone] : VARIANT_COPY[variant];
  return (
    <>
      {INTERACTIVE_STATES.map((s) => (
        <State key={s.label} label={`${variant} · ${tone} · md · ${s.label}`} force={s.force}>
          <Button variant={variant} tone={tone} disabled={s.disabled} onClick={noop}>
            {toneIcon(tone)}
            {copy}
          </Button>
        </State>
      ))}
    </>
  );
}

function PressedStates({ variant, prefix = "" }: { variant: ButtonVariant; prefix?: string }) {
  const copy = "Fair dice";
  return (
    <>
      <State label={`${prefix}${variant} · pressed=true · rest`}>
        <Button variant={variant} pressed onClick={noop}>
          {copy}
        </Button>
      </State>
      <State label={`${prefix}${variant} · pressed=true · hover`} force="hover">
        <Button variant={variant} pressed onClick={noop}>
          {copy}
        </Button>
      </State>
      <State label={`${prefix}${variant} · aria-pressed=true · rest`}>
        <Button variant={variant} aria-pressed onClick={noop}>
          {copy}
        </Button>
      </State>
      <State label={`${prefix}${variant} · pressed + aria-pressed · rest`}>
        <Button variant={variant} pressed aria-pressed onClick={noop}>
          {copy}
        </Button>
      </State>
      <State label={`${prefix}${variant} · aria-pressed=false · rest`}>
        <Button variant={variant} aria-pressed={false} onClick={noop}>
          {copy}
        </Button>
      </State>
    </>
  );
}

function LinkButton({
  look,
  children,
}: {
  look: Parameters<typeof buttonLook>[0];
  children: React.ReactNode;
}) {
  return (
    <a href="/how-to-play" target="_blank" rel="noreferrer" {...buttonLook(look)}>
      {children}
    </a>
  );
}

const GROUND_COPY: Record<ButtonVariant, string> = {
  ghost: "Leaderboard",
  primary: "Play now",
  secondary: "Sign in",
  quiet: "How to play",
};
const HUD_COPY: Record<ButtonVariant, string> = {
  primary: "End turn",
  secondary: "Trade",
  quiet: "Undo",
  ghost: "Skip",
};

function ButtonGroups() {
  return (
    <>
      <Group id="primitives/button-primary" title="Button · primary, every tone × state (md, pill)">
        {TONES.map((tone, i) => (
          <React.Fragment key={tone}>
            {i > 0 && <Break />}
            <ButtonStates variant="primary" tone={tone} />
          </React.Fragment>
        ))}
        <Break />
        <PressedStates variant="primary" />
      </Group>

      {(["secondary", "quiet", "ghost"] as const).map((variant) => (
        <Group
          key={variant}
          id={`primitives/button-${variant}`}
          title={`Button · ${variant}, states (md, pill)`}
        >
          <ButtonStates variant={variant} tone="default" />
          <Break />
          <PressedStates variant={variant} />
        </Group>
      ))}

      <Group id="primitives/button-variant-tone" title="Button · variant × tone at rest (md, pill)">
        {VARIANTS.map((variant, i) => (
          <React.Fragment key={variant}>
            {i > 0 && <Break />}
            {TONES.map((tone) => (
              <State key={tone} label={`${variant} · ${tone}`}>
                <Button variant={variant} tone={tone} onClick={noop}>
                  {toneIcon(tone)}
                  {variant === "primary" ? TONE_COPY[tone] : VARIANT_COPY[variant]}
                </Button>
              </State>
            ))}
          </React.Fragment>
        ))}
      </Group>

      <Group id="primitives/button-size" title="Button · every size × variant (pill)">
        {VARIANTS.map((variant, i) => (
          <React.Fragment key={variant}>
            {i > 0 && <Break />}
            {SIZES.map((size) => (
              <State key={size} label={`${variant} · ${size}`}>
                <Button
                  variant={variant}
                  size={size}
                  onClick={noop}
                  aria-label={size === "icon" ? "Add a bot" : undefined}
                >
                  {size === "icon" ? <Plus weight="bold" size={14} /> : VARIANT_COPY[variant]}
                </Button>
              </State>
            ))}
          </React.Fragment>
        ))}
      </Group>

      <Group id="primitives/button-pill" title="Button · pill=true vs pill=false">
        {VARIANTS.map((variant, i) => (
          <React.Fragment key={variant}>
            {i > 0 && <Break />}
            {(["sm", "md"] as const).map((size) => (
              <React.Fragment key={size}>
                <State label={`${variant} · ${size} · pill=true`}>
                  <Button variant={variant} size={size} pill onClick={noop}>
                    {VARIANT_COPY[variant]}
                  </Button>
                </State>
                <State label={`${variant} · ${size} · pill=false`}>
                  <Button variant={variant} size={size} pill={false} onClick={noop}>
                    {VARIANT_COPY[variant]}
                  </Button>
                </State>
              </React.Fragment>
            ))}
          </React.Fragment>
        ))}
      </Group>

      <Group id="primitives/button-wrap" title="Button · wrap, in a 170px cell">
        <State label="primary · md · wrap=false (overflows the cell)">
          <div className="w-[170px]">
            <Button onClick={noop}>Boost to unlock this decoration</Button>
          </div>
        </State>
        <State label="primary · md · wrap=true">
          <div className="w-[170px]">
            <Button wrap className="w-full" onClick={noop}>
              Boost to unlock this decoration
            </Button>
          </div>
        </State>
        <State label="secondary · sm · wrap=true">
          <div className="w-[170px]">
            <Button variant="secondary" size="sm" wrap className="w-full" onClick={noop}>
              Mejorar para desbloquear esta decoración
            </Button>
          </div>
        </State>
      </Group>

      <Group id="primitives/button-icon-label" title="Button · icon + label">
        <State label="primary · md · leading icon">
          <Button onClick={noop}>
            <Plus weight="bold" size={16} />
            Create table
          </Button>
        </State>
        <State label="secondary · sm · leading icon">
          <Button variant="secondary" size="sm" onClick={noop}>
            <DownloadSimple weight="bold" size={14} />
            Download replay
          </Button>
        </State>
        <State label="primary · danger · sm · leading icon">
          <Button tone="danger" size="sm" onClick={noop}>
            <Flag weight="bold" size={14} />
            Surrender
          </Button>
        </State>
        <State label="ghost · sm · trailing icon">
          <Button variant="ghost" size="sm" onClick={noop}>
            More options
            <CaretDown weight="bold" size={12} />
          </Button>
        </State>
      </Group>

      <Group id="primitives/button-fill" title="Button · fill with each seat colour (sm)">
        {SEAT_COLORS.map((c, i) => (
          <State key={c} label={`fill=${SEAT_NAMES[i]} · rest`}>
            <Button size="sm" fill={c} onClick={noop}>
              Take seat {i + 1}
            </Button>
          </State>
        ))}
        <Break />
        {INTERACTIVE_STATES.slice(1).map((s) => (
          <State key={s.label} label={`fill=blue · ${s.label}`} force={s.force}>
            <Button size="sm" fill={SEAT_COLORS[1]} disabled={s.disabled} onClick={noop}>
              Take seat 2
            </Button>
          </State>
        ))}
      </Group>

      <Group id="primitives/button-look-link" title="buttonLook on an <a> (new-tab link)">
        {VARIANTS.map((variant) => (
          <React.Fragment key={variant}>
            <State label={`<a> · ${variant} · sm · rest`}>
              <LinkButton look={{ variant, size: "sm" }}>Read the rules</LinkButton>
            </State>
            <State label={`<a> · ${variant} · sm · hover`} force="hover">
              <LinkButton look={{ variant, size: "sm" }}>Read the rules</LinkButton>
            </State>
          </React.Fragment>
        ))}
        <Break />
        <State label="<a> · primary · sm · active" force="active">
          <LinkButton look={{ variant: "primary", size: "sm" }}>Read the rules</LinkButton>
        </State>
        <State label="<a> · primary · sm · focus-visible" force="focus-visible">
          <LinkButton look={{ variant: "primary", size: "sm" }}>Read the rules</LinkButton>
        </State>
        <State label="<a> · primary · md · pill=false">
          <LinkButton look={{ variant: "primary", pill: false }}>Read the rules</LinkButton>
        </State>
        <State label="<a> · primary · accent · md">
          <LinkButton look={{ variant: "primary", tone: "accent" }}>
            <DownloadSimple weight="bold" size={16} />
            Download the event log
          </LinkButton>
        </State>
      </Group>

      <Group
        id="primitives/button-ground"
        title="Button · header style, on the page ground"
        surface="ground"
      >
        {(["ghost", "secondary", "primary", "quiet"] as const).map((variant, i) => (
          <React.Fragment key={variant}>
            {i > 0 && <Break />}
            {INTERACTIVE_STATES.map((s) => (
              <State key={s.label} label={`ground · ${variant} · sm · ${s.label}`} force={s.force}>
                <Button variant={variant} size="sm" disabled={s.disabled} onClick={noop}>
                  {GROUND_COPY[variant]}
                </Button>
              </State>
            ))}
          </React.Fragment>
        ))}
        <Break />
        <State label="ground · primary · discord · sm">
          <Button tone="discord" size="sm" onClick={noop}>
            <DiscordIcon className="size-4" />
            Sign in with Discord
          </Button>
        </State>
        <State label="ground · primary · google · sm">
          <Button tone="google" size="sm" onClick={noop}>
            <GoogleIcon className="size-4" />
            Sign in with Google
          </Button>
        </State>
        <State label="ground · ghost · sm · aria-pressed=true (current page)">
          <Button variant="ghost" size="sm" aria-pressed onClick={noop}>
            Leaderboard
          </Button>
        </State>
      </Group>

      <Group
        id="primitives/button-hud"
        title="Button · in the HUD, variant × tone (sm)"
        surface="hud"
      >
        {VARIANTS.map((variant, i) => (
          <React.Fragment key={variant}>
            {i > 0 && <Break />}
            {TONES.map((tone) => (
              <State key={tone} label={`hud · ${variant} · ${tone}`}>
                <Button variant={variant} tone={tone} size="sm" onClick={noop}>
                  {toneIcon(tone)}
                  {variant === "primary" ? TONE_COPY[tone] : HUD_COPY[variant]}
                </Button>
              </State>
            ))}
          </React.Fragment>
        ))}
      </Group>

      <Group
        id="primitives/button-hud-states"
        title="Button · in the HUD, states (sm)"
        surface="hud"
      >
        {VARIANTS.map((variant, i) => (
          <React.Fragment key={variant}>
            {i > 0 && <Break />}
            {INTERACTIVE_STATES.map((s) => (
              <State key={s.label} label={`hud · ${variant} · sm · ${s.label}`} force={s.force}>
                <Button variant={variant} size="sm" disabled={s.disabled} onClick={noop}>
                  {HUD_COPY[variant]}
                </Button>
              </State>
            ))}
          </React.Fragment>
        ))}
        <Break />
        <PressedStates variant="secondary" prefix="hud · " />
        <Break />
        <State label="hud · primary · md · pill=false">
          <Button pill={false} onClick={noop}>
            End turn
          </Button>
        </State>
        <State label="hud · primary · icon">
          <Button size="icon" aria-label="Add a bot" onClick={noop}>
            <Plus weight="bold" size={14} />
          </Button>
        </State>
        <State label="hud · fill=green · sm">
          <Button size="sm" fill={SEAT_COLORS[4]} onClick={noop}>
            Offer to Mira
          </Button>
        </State>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// IconButton

function IconButtonGroup({ surface }: { surface: Surface }) {
  const { id, suffix, prefix } = surfaceBits("icon-button", surface);
  return (
    <Group id={id} title={`IconButton · sizes × states${suffix}`} surface={surface}>
      {(["md", "sm"] as const).map((size, i) => (
        <React.Fragment key={size}>
          {i > 0 && <Break />}
          {INTERACTIVE_STATES.map((s) => (
            <State key={s.label} label={`${prefix}${size} · ${s.label}`} force={s.force}>
              <IconButton size={size} disabled={s.disabled} aria-label="Settings" onClick={noop}>
                <GearSix weight="bold" size={size === "md" ? 18 : 14} />
              </IconButton>
            </State>
          ))}
        </React.Fragment>
      ))}
      <Break />
      <State label={`${prefix}md · close glyph`}>
        <IconButton aria-label="Close" onClick={noop}>
          <X weight="bold" size={16} />
        </IconButton>
      </State>
      <State label={`${prefix}sm · close glyph`}>
        <IconButton size="sm" aria-label="Close" onClick={noop}>
          <X weight="bold" size={12} />
        </IconButton>
      </State>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Badge

const BADGE_TONES = [
  "none",
  "muted",
  "ready",
  "beta",
  "award",
  "resource",
  "rating",
  "ruleset",
] as const;
type BadgeTone = (typeof BADGE_TONES)[number];

const BADGE_COPY: Record<BadgeTone, string> = {
  none: "2 of 4 seats",
  muted: "Unrated",
  ready: "Ready",
  beta: "Beta",
  award: "Longest Road",
  resource: "Brick",
  rating: "1450",
  ruleset: "Islands",
};

function BadgeSpecimen({
  tone,
  type,
  size,
  dim,
}: {
  tone: BadgeTone;
  type?: "body" | "label";
  size?: "xs" | "sm" | "md" | "lg";
  dim?: boolean;
}) {
  return (
    <Badge
      tone={tone}
      type={type}
      size={size}
      dim={dim}
      // The ruleset tone reads its fill from --badge-fill (see rulesetTags).
      style={
        tone === "ruleset"
          ? ({ "--badge-fill": "var(--color-fishermen)" } as React.CSSProperties)
          : undefined
      }
    >
      {tone === "resource" && <img src="/assets/icon_brick.webp" alt="" width={14} height={14} />}
      {BADGE_COPY[tone]}
    </Badge>
  );
}

function BadgeGroups() {
  return (
    <>
      <Group id="primitives/badge" title="Badge · every tone × size (type=body)">
        {BADGE_TONES.map((tone, i) => (
          <React.Fragment key={tone}>
            {i > 0 && <Break />}
            {(["xs", "sm", "md", "lg"] as const).map((size) => (
              <State key={size} label={`${tone} · body · ${size}`}>
                <BadgeSpecimen tone={tone} size={size} />
              </State>
            ))}
          </React.Fragment>
        ))}
      </Group>
      <Group id="primitives/badge-type-dim" title="Badge · type=label, and dim (sm)">
        {BADGE_TONES.map((tone) => (
          <State key={tone} label={`${tone} · label · sm`}>
            <BadgeSpecimen tone={tone} type="label" />
          </State>
        ))}
        <Break />
        {BADGE_TONES.map((tone) => (
          <State key={tone} label={`${tone} · body · sm · dim`}>
            <BadgeSpecimen tone={tone} dim />
          </State>
        ))}
      </Group>
      <Group id="primitives/badge-hud" title="Badge · in the HUD (sm)" surface="hud">
        {BADGE_TONES.map((tone) => (
          <State key={tone} label={`hud · ${tone} · sm`}>
            <BadgeSpecimen tone={tone} />
          </State>
        ))}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pill

function PillGroups() {
  return (
    <>
      <Group id="primitives/pill" title="Pill · tone × size, caps, locked (static span)">
        {(["neutral", "active", "count"] as const).map((tone) =>
          (["sm", "md"] as const).map((size) => (
            <State key={`${tone}-${size}`} label={`${tone} · ${size}`}>
              <Pill tone={tone} size={size}>
                {tone === "count" ? "3 / 10" : "fair dice"}
              </Pill>
            </State>
          )),
        )}
        <Break />
        <State label="neutral · sm · caps=true">
          <Pill>fair dice</Pill>
        </State>
        <State label="neutral · sm · caps=false">
          <Pill caps={false}>Islands</Pill>
        </State>
        <State label="active · sm · caps=false">
          <Pill tone="active" caps={false}>
            Knights
          </Pill>
        </State>
        <State label="neutral · sm · locked">
          <Pill locked caps={false}>
            Gilded frame
          </Pill>
        </State>
        <State label="active · sm · locked">
          <Pill tone="active" locked caps={false}>
            Gilded frame
          </Pill>
        </State>
      </Group>
      <Group id="primitives/pill-interactive" title="Pill · interactive (button), states">
        {(["neutral", "active"] as const).map((tone, i) =>
          (["sm", "md"] as const).map((size, j) => (
            <React.Fragment key={`${tone}-${size}`}>
              {(i > 0 || j > 0) && <Break />}
              {INTERACTIVE_STATES.map((s) => (
                <State
                  key={s.label}
                  label={`interactive · ${tone} · ${size} · ${s.label}`}
                  force={s.force}
                >
                  <Pill
                    interactive
                    tone={tone}
                    size={size}
                    disabled={s.disabled}
                    aria-pressed={tone === "active"}
                    onClick={noop}
                  >
                    friendly robber
                  </Pill>
                </State>
              ))}
            </React.Fragment>
          )),
        )}
        <Break />
        <State label="interactive · neutral · sm · locked">
          <Pill interactive locked caps={false} onClick={noop}>
            Gilded frame
          </Pill>
        </State>
        <State label="interactive · neutral · sm · locked · hover" force="hover">
          <Pill interactive locked caps={false} onClick={noop}>
            Gilded frame
          </Pill>
        </State>
      </Group>
      <Group id="primitives/pill-hud" title="Pill · in the HUD" surface="hud">
        {(["neutral", "active", "count"] as const).map((tone) => (
          <State key={tone} label={`hud · ${tone} · sm`}>
            <Pill tone={tone}>{tone === "count" ? "7 cards" : "fair dice"}</Pill>
          </State>
        ))}
        <Break />
        {(["neutral", "active"] as const).map((tone) =>
          INTERACTIVE_STATES.map((s) => (
            <State
              key={`${tone}-${s.label}`}
              label={`hud · interactive · ${tone} · ${s.label}`}
              force={s.force}
            >
              <Pill
                interactive
                tone={tone}
                disabled={s.disabled}
                aria-pressed={tone === "active"}
                onClick={noop}
              >
                friendly robber
              </Pill>
            </State>
          )),
        )}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Segmented

const SEG_OPTIONS = {
  pills: [
    { label: "Small", value: "small" },
    { label: "Standard", value: "standard" },
    { label: "Large", value: "large" },
  ],
  joined: [
    { label: "Chat", value: "chat" },
    { label: "Log", value: "log" },
    { label: "Both", value: "both" },
  ],
};

function SegmentedGroup({ surface }: { surface: Surface }) {
  const { id, suffix, prefix } = surfaceBits("segmented", surface);
  return (
    <Group id={id} title={`Segmented · both variants${suffix}`} surface={surface}>
      {(["pills", "joined"] as const).map((variant, i) => {
        const options = SEG_OPTIONS[variant];
        return (
          <React.Fragment key={variant}>
            {i > 0 && <Break />}
            {(["first", "middle", "last"] as const).map((pos, k) => (
              <State key={pos} label={`${prefix}${variant} · ${pos} selected`}>
                <Segmented
                  variant={variant}
                  options={options}
                  value={options[k].value}
                  onChange={noop}
                />
              </State>
            ))}
            <State label={`${prefix}${variant} · disabled`}>
              <Segmented
                variant={variant}
                options={options}
                value={options[1].value}
                onChange={noop}
                disabled
              />
            </State>
            <State label={`${prefix}${variant} · nothing selected`}>
              <Segmented variant={variant} options={options} value="" onChange={noop} />
            </State>
            {variant === "pills" && (
              <>
                <State label={`${prefix}pills · hover on unselected (Small)`}>
                  <ForceOn selector="button" force="hover">
                    <Segmented
                      variant="pills"
                      options={options}
                      value={options[1].value}
                      onChange={noop}
                    />
                  </ForceOn>
                </State>
                <State label={`${prefix}pills · focus-visible on unselected (Small)`}>
                  <ForceOn selector="button" force="focus-visible">
                    <Segmented
                      variant="pills"
                      options={options}
                      value={options[1].value}
                      onChange={noop}
                    />
                  </ForceOn>
                </State>
              </>
            )}
          </React.Fragment>
        );
      })}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Switch, Slider, Input

function SwitchGroup({ surface }: { surface: Surface }) {
  const { id, suffix, prefix } = surfaceBits("switch", surface);
  return (
    <Group id={id} title={`Switch${suffix}`} surface={surface}>
      <State label={`${prefix}on`}>
        <Switch checked aria-label="Sound effects" />
      </State>
      <State label={`${prefix}off`}>
        <Switch checked={false} aria-label="Sound effects" />
      </State>
      <State label={`${prefix}on · disabled`}>
        <Switch checked disabled aria-label="Sound effects" />
      </State>
      <State label={`${prefix}off · disabled`}>
        <Switch checked={false} disabled aria-label="Sound effects" />
      </State>
      <State label={`${prefix}on · focus-visible`} force="focus-visible">
        <Switch checked aria-label="Sound effects" />
      </State>
      <State label={`${prefix}off · focus-visible`} force="focus-visible">
        <Switch checked={false} aria-label="Sound effects" />
      </State>
      <State label={`${prefix}on, beside its label`}>
        <label className="flex items-center gap-3 text-[14px] font-semibold">
          <Switch checked aria-label="Sound effects" />
          Sound effects
        </label>
      </State>
    </Group>
  );
}

function SliderGroup({ surface }: { surface: Surface }) {
  const { id, suffix, prefix } = surfaceBits("slider", surface);
  const one = (
    label: string,
    value: number,
    extra?: { disabled?: boolean; thumbSize?: number },
  ) => (
    <State label={`${prefix}${label}`}>
      <div className="w-48">
        <Slider
          value={[value]}
          max={100}
          step={1}
          onValueChange={noop}
          aria-label="Music volume"
          {...extra}
        />
      </div>
    </State>
  );
  return (
    <Group id={id} title={`Slider${suffix}`} surface={surface}>
      {one("min · 0", 0)}
      {one("mid · 50", 50)}
      {one("max · 100", 100)}
      {one("disabled · 40", 40, { disabled: true })}
      <State label={`${prefix}focus-visible on thumb · 60`}>
        <ForceOn selector='[role="slider"]' force="focus-visible" className="w-48">
          <Slider value={[60]} max={100} onValueChange={noop} aria-label="Music volume" />
        </ForceOn>
      </State>
      {one("thumbSize=16 · 30", 30, { thumbSize: 16 })}
    </Group>
  );
}

function InputGroup({ surface }: { surface: Surface }) {
  const { id, suffix, prefix } = surfaceBits("input", surface);
  return (
    <Group id={id} title={`Input${suffix}`} surface={surface}>
      <State label={`${prefix}empty · placeholder`} className="w-64">
        <Input placeholder="Table name" />
      </State>
      <State label={`${prefix}filled`} className="w-64">
        <Input defaultValue="Friday night table" />
      </State>
      <State label={`${prefix}focus-visible`} force="focus-visible" className="w-64">
        <Input defaultValue="Friday night table" />
      </State>
      <State label={`${prefix}disabled (no styling exists)`} className="w-64">
        <Input defaultValue="Friday night table" disabled />
      </State>
      <State label={`${prefix}aria-invalid (no styling exists)`} className="w-64">
        <Input defaultValue="ab" aria-invalid />
      </State>
      <State label={`${prefix}beside a field-size button`} className="w-80">
        <div className="flex items-center gap-2">
          <Input placeholder="Map code" defaultValue="K7Q-2MX" />
          <Button size="field" variant="secondary" onClick={noop}>
            Load
          </Button>
        </div>
      </State>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Menu

/** Opens its menu once on mount, by clicking the real trigger. */
function OpenMenu(props: React.ComponentProps<typeof Menu>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const done = React.useRef(false);
  React.useEffect(() => {
    if (done.current) return;
    done.current = true;
    const b = ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]");
    if (b && b.getAttribute("aria-expanded") !== "true") b.click();
  }, []);
  return (
    <div ref={ref}>
      <Menu {...props} />
    </div>
  );
}

// The two triggers the site header uses (SiteHeader.tsx), minus the
// coarse-pointer halo.
const AVATAR_TRIGGER_CLASS =
  "relative flex items-center gap-1.5 rounded-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring";
const HAMBURGER_TRIGGER_CLASS =
  "relative flex items-center justify-center w-9 h-9 rounded-control border border-border shadow-hard-sm bg-secondary-background cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0";

function avatarTrigger() {
  return (
    <>
      <Avatar color={SEAT_COLORS[1]} name="Mira" size={36} />
      <CaretDown weight="bold" size={11} />
    </>
  );
}

/**
 * The separator between groups of rows. Not a ui primitive: SiteHeader keeps a
 * private `MenuSep` with exactly this markup, and `data-ui-menu-sep` is what
 * index.css styles on the site and in the HUD.
 */
function MenuSeparator() {
  return <div data-ui-menu-sep="" className="border-t border-line -mx-1.5 my-1" />;
}

function menuRows(withHover: boolean) {
  const store = (
    <MenuItem onSelect={noop}>
      <Storefront weight="bold" size={15} />
      Store
    </MenuItem>
  );
  const logout = (
    <MenuItem tone="danger" onSelect={noop}>
      <SignOut weight="bold" size={15} />
      Log out
    </MenuItem>
  );
  return (
    <>
      <MenuItem onSelect={noop}>Account settings</MenuItem>
      <MenuItem onSelect={noop}>
        <User weight="bold" size={15} />
        View profile
      </MenuItem>
      {withHover ? <div data-force="hover">{store}</div> : store}
      <MenuItem onSelect={noop}>
        <GearSix weight="bold" size={15} />
        Settings
      </MenuItem>
      <MenuSeparator />
      {withHover ? <div data-force="hover">{logout}</div> : logout}
    </>
  );
}

function MenuGroup({ surface }: { surface: Surface }) {
  const { id, suffix, prefix } = surfaceBits("menu", surface);
  return (
    <Group id={id} title={`Menu${suffix}`} surface={surface}>
      <State label={`${prefix}avatar trigger · closed`}>
        <Menu
          align="start"
          trigger={avatarTrigger()}
          triggerClassName={AVATAR_TRIGGER_CLASS}
          triggerLabel="Account menu"
        >
          {menuRows(false)}
        </Menu>
      </State>
      <State label={`${prefix}avatar trigger · focus-visible`}>
        <ForceOn selector="button[aria-haspopup]" force="focus-visible">
          <Menu
            align="start"
            trigger={avatarTrigger()}
            triggerClassName={AVATAR_TRIGGER_CLASS}
            triggerLabel="Account menu"
          >
            {menuRows(false)}
          </Menu>
        </ForceOn>
      </State>
      <State label={`${prefix}icon trigger · closed`}>
        <Menu
          align="start"
          shadow={false}
          trigger={<List weight="bold" size={20} />}
          triggerClassName={HAMBURGER_TRIGGER_CLASS}
          triggerLabel="Menu"
        >
          {menuRows(false)}
        </Menu>
      </State>
      <Break />
      <State
        label={`${prefix}open · plain row, icon rows, separator, danger row`}
        className="h-80 w-60"
      >
        <OpenMenu
          align="start"
          trigger={avatarTrigger()}
          triggerClassName={AVATAR_TRIGGER_CLASS}
          triggerLabel="Account menu"
        >
          {menuRows(false)}
        </OpenMenu>
      </State>
      <State label={`${prefix}open · Store and Log out rows hovered`} className="h-80 w-60">
        <OpenMenu
          align="start"
          trigger={avatarTrigger()}
          triggerClassName={AVATAR_TRIGGER_CLASS}
          triggerLabel="Account menu"
        >
          {menuRows(true)}
        </OpenMenu>
      </State>
      <State label={`${prefix}open · shadow=false · hamburger trigger`} className="h-80 w-60">
        <OpenMenu
          align="start"
          shadow={false}
          trigger={<List weight="bold" size={20} />}
          triggerClassName={HAMBURGER_TRIGGER_CLASS}
          triggerLabel="Menu"
        >
          <MenuItem onSelect={noop}>Home</MenuItem>
          <MenuItem onSelect={noop}>Play</MenuItem>
          <MenuItem onSelect={noop}>How to play</MenuItem>
          <MenuItem onSelect={noop}>Leaderboard</MenuItem>
          <MenuItem onSelect={noop}>Store</MenuItem>
        </OpenMenu>
      </State>
      <Break />
      {(
        [
          ["row · rest", undefined, "default"],
          ["row · hover", "hover", "default"],
          ["row · focus-visible", "focus-visible", "default"],
          ["danger row · rest", undefined, "danger"],
          ["danger row · hover", "hover", "danger"],
          ["danger row · focus-visible", "focus-visible", "danger"],
        ] as const
      ).map(([label, force, tone]) => (
        // A row on its own, in a panel as it is inside the open menu; the
        // inner `data-force` reaches the row itself.
        <State key={label} label={`${prefix}${label}`}>
          <Card radius="card" className="w-56 p-1.5">
            <div data-force={force}>
              <MenuItem tone={tone} onSelect={noop}>
                {tone === "danger" ? (
                  <SignOut weight="bold" size={15} />
                ) : (
                  <User weight="bold" size={15} />
                )}
                {tone === "danger" ? "Log out" : "View profile"}
              </MenuItem>
            </div>
          </Card>
        </State>
      ))}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Avatar, Swatch, Skeleton, Spinner

// A stand-in picture served by the app itself (a player's Discord or Google
// picture in production).
const AVATAR_PICTURE = "/apple-touch-icon.png";
// Fails to decode without a network request, so the fallback disc shows.
const AVATAR_BROKEN = "data:image/png;base64,AAAA";

function AvatarGroup({ surface }: { surface: Surface }) {
  const { id, suffix, prefix } = surfaceBits("avatar", surface);
  return (
    <Group id={id} title={`Avatar${suffix}`} surface={surface}>
      {[20, 24, 28, 36, 40, 56, 80].map((size) => (
        <State key={size} label={`${prefix}picture · ${size}px`}>
          <Avatar color={SEAT_COLORS[1]} src={AVATAR_PICTURE} name="Mira" size={size} />
        </State>
      ))}
      <Break />
      <State label={`${prefix}no picture · colour disc · 36px`}>
        <Avatar color={SEAT_COLORS[0]} name="Ana" />
      </State>
      <State label={`${prefix}broken picture · disc fallback · 36px`}>
        <Avatar color={SEAT_COLORS[4]} src={AVATAR_BROKEN} name="Teo" />
      </State>
      <State label={`${prefix}ring=0 · 36px`}>
        <Avatar color={SEAT_COLORS[2]} src={AVATAR_PICTURE} name="Mira" ring={0} />
      </State>
      <State label={`${prefix}ring=2 · 36px`}>
        <Avatar color={SEAT_COLORS[2]} src={AVATAR_PICTURE} name="Mira" ring={2} />
      </State>
      <Break />
      {SEAT_COLORS.map((c, i) => (
        <State key={c} label={`${prefix}${SEAT_NAMES[i]}`}>
          <Avatar color={c} name={SEAT_NAMES[i]} size={36} />
        </State>
      ))}
    </Group>
  );
}

function SwatchGroup() {
  return (
    <Group id="primitives/swatch" title="Swatch">
      {SEAT_COLORS.map((c, i) => (
        <State key={c} label={`${SEAT_NAMES[i]}${i === 1 ? " · selected" : ""}`}>
          <Swatch color={c} selected={i === 1} aria-label={SEAT_NAMES[i]} />
        </State>
      ))}
      <Break />
      <State label="rest">
        <Swatch color={SEAT_COLORS[3]} aria-label="purple" />
      </State>
      <State label="selected">
        <Swatch color={SEAT_COLORS[3]} selected aria-label="purple" />
      </State>
      <State label="hover" force="hover">
        <Swatch color={SEAT_COLORS[3]} aria-label="purple" />
      </State>
      <State label="selected · hover" force="hover">
        <Swatch color={SEAT_COLORS[3]} selected aria-label="purple" />
      </State>
      <State label="focus-visible" force="focus-visible">
        <Swatch color={SEAT_COLORS[3]} aria-label="purple" />
      </State>
      <State label="disabled (no styling exists)">
        <Swatch color={SEAT_COLORS[3]} disabled aria-label="purple" />
      </State>
      <State label="size=20">
        <Swatch color={SEAT_COLORS[5]} size={20} aria-label="orange" />
      </State>
      <State label="size=36 · selected">
        <Swatch color={SEAT_COLORS[5]} size={36} selected aria-label="orange" />
      </State>
    </Group>
  );
}

function SkeletonSpinnerGroups() {
  return (
    <>
      <Group id="primitives/skeleton" title="Skeleton">
        <State label="text line">
          <Skeleton className="h-4 w-48" />
        </State>
        <State label="avatar disc">
          <Skeleton className="size-9 rounded-full" />
        </State>
        <State label="list row">
          <div className="flex items-center gap-3 w-72">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex flex-col gap-2 flex-1">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </State>
        <State label="card block">
          <Skeleton className="h-24 w-56 rounded-card" />
        </State>
      </Group>
      <Group id="primitives/spinner" title="Spinner">
        {[14, 20, 32].map((size) => (
          <State key={size} label={`decorative · ${size}px`}>
            <Spinner size={size} />
          </State>
        ))}
        <State label="with label (role=status) · 20px">
          <Spinner label="Loading tables" />
        </State>
        <State label="beside text">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
            <Spinner size={16} />
            Finding a table…
          </div>
        </State>
      </Group>
      <Group id="primitives/spinner-hud" title="Spinner (hud)" surface="hud">
        {[14, 20, 32].map((size) => (
          <State key={size} label={`hud · ${size}px`}>
            <Spinner size={size} />
          </State>
        ))}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// ScrollFade

const CHAT_LINES = [
  "Ana: anyone have brick?",
  "Teo: one brick for two wool",
  "Ana: deal",
  "Mira rolled 8",
  "Mira received 2 grain",
  "Teo built a road",
  "Ana played Year of Plenty",
  "Teo: nice",
  "Mira moved the robber",
  "Mira stole a card from Teo",
  "Teo rolled 6",
  "Ana received 1 ore",
  "Teo built a settlement",
  "Ana: good game so far",
];
const SHELF = [
  "Knight",
  "Road Building",
  "Year of Plenty",
  "Monopoly",
  "Victory Point",
  "Knight",
  "Knight",
  "Road Building",
];

type At = "start" | "middle" | "end";

function ScrolledFade({
  axis,
  at,
  arrows,
  vArrows,
}: {
  axis: "x" | "y";
  at: At;
  arrows?: boolean;
  vArrows?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (axis === "y") {
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = at === "start" ? 0 : at === "end" ? max : max / 2;
    } else {
      const max = el.scrollWidth - el.clientWidth;
      el.scrollLeft = at === "start" ? 0 : at === "end" ? max : max / 2;
    }
    el.dispatchEvent(new Event("scroll"));
  }, [axis, at]);
  if (axis === "y") {
    return (
      <ScrollFade
        scrollRef={ref}
        vArrows={vArrows}
        wrapperClassName="flex flex-col w-64"
        className="h-40 overflow-y-auto no-scrollbar px-3 py-2 flex flex-col gap-1.5 text-[13px]"
      >
        {CHAT_LINES.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </ScrollFade>
    );
  }
  return (
    <ScrollFade
      scrollRef={ref}
      arrows={arrows}
      wrapperClassName="flex flex-col w-80"
      className="flex gap-2 overflow-x-auto no-scrollbar py-2"
    >
      {SHELF.map((name, i) => (
        <Card
          key={i}
          radius="base"
          className="shrink-0 w-24 h-16 p-2 text-[12px] font-semibold flex items-end"
        >
          {name}
        </Card>
      ))}
    </ScrollFade>
  );
}

const EDGE_LABEL: Record<"x" | "y", Record<At, string>> = {
  y: { start: "bottom fade", middle: "top + bottom fades", end: "top fade" },
  x: { start: "right fade", middle: "left + right fades", end: "left fade" },
};

function ScrollFadeGroup() {
  const ats: At[] = ["start", "middle", "end"];
  return (
    <Group id="primitives/scroll-fade" title="ScrollFade · overflow on each edge">
      {ats.map((at) => (
        <State key={`y-${at}`} label={`vertical · scrolled to ${at} · ${EDGE_LABEL.y[at]}`}>
          <ScrolledFade axis="y" at={at} />
        </State>
      ))}
      <Break />
      {ats.map((at) => (
        <State key={`yv-${at}`} label={`vertical · vArrows · ${at} · ${EDGE_LABEL.y[at]} + nudges`}>
          <div className="py-4">
            <ScrolledFade axis="y" at={at} vArrows />
          </div>
        </State>
      ))}
      <Break />
      {ats.map((at) => (
        <State key={`x-${at}`} label={`horizontal · scrolled to ${at} · ${EDGE_LABEL.x[at]}`}>
          <ScrolledFade axis="x" at={at} />
        </State>
      ))}
      <Break />
      {ats.map((at) => (
        <State
          key={`xa-${at}`}
          label={`horizontal · arrows · ${at} · ${EDGE_LABEL.x[at]} + nudges`}
        >
          <ScrolledFade axis="x" at={at} arrows />
        </State>
      ))}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Card

function CardGroup({ surface }: { surface: Surface }) {
  const { id, suffix, prefix } = surfaceBits("card", surface);
  return (
    <Group id={id} title={`Card · shadow × radius${suffix}`} surface={surface}>
      {(["none", "hard", "lg"] as const).map((shadow, i) => (
        <React.Fragment key={shadow}>
          {i > 0 && <Break />}
          {(["base", "card", "lg"] as const).map((radius) => (
            <State key={radius} label={`${prefix}shadow=${shadow} · radius=${radius}`}>
              <Card shadow={shadow} radius={radius} className="w-56 p-4">
                <div className="text-[14px] font-bold">Friday night table</div>
                <div className="text-[12px] text-muted mt-1">3 of 4 seats taken · base game</div>
              </Card>
            </State>
          ))}
        </React.Fragment>
      ))}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Dialogs, confirms and toasts: isolated in iframes

const ISO_FRAMES = {
  dialog: [
    ["dialog-question", "title md · description md (a question)", 520, 300],
    ["dialog-panel", "title lg · description prose + note (a panel)", 560, 480],
    ["dialog-shelf", "title xl · description prose + note (store shelf)", 680, 440],
    ["dialog-overflow", "title lg · taller than 90vh (scrolls inside)", 520, 380],
  ],
  confirm: [
    ["confirm-default", "default · title + body", 520, 280],
    ["confirm-danger", "tone=danger · custom cancel copy", 520, 280],
    ["confirm-title-only", "title only · default button copy", 520, 240],
    ["confirm-suppress", "suppressKey · box unticked", 520, 300],
    ["confirm-suppress-ticked", "suppressKey · box ticked", 520, 300],
  ],
  toast: [
    ["toast-info", "info · close button", 440, 220],
    ["toast-error", "error · close button", 440, 220],
    ["toast-long", "error · long message wraps", 440, 260],
    ["toast-stack", "stack · info above error", 440, 320],
  ],
} as const;

function IsoFrame({ iso, label, w, h }: { iso: string; label: string; w: number; h: number }) {
  return (
    <State label={label}>
      <iframe
        title={label}
        src={`/dev/gallery?section=primitives&iso=${iso}`}
        width={w}
        height={h}
        className="block rounded-[10px] border-0"
      />
    </State>
  );
}

function IsolatedGroups() {
  return (
    <>
      <Group
        id="primitives/dialog"
        title="Dialog · open, with scrim (each in its own viewport)"
        wide
      >
        {ISO_FRAMES.dialog.map(([iso, label, w, h]) => (
          <IsoFrame key={iso} iso={iso} label={label} w={w} h={h} />
        ))}
      </Group>
      <Group id="primitives/confirm" title="Confirm (useConfirm) · open" wide>
        {ISO_FRAMES.confirm.map(([iso, label, w, h]) => (
          <IsoFrame key={iso} iso={iso} label={label} w={w} h={h} />
        ))}
      </Group>
      <Group id="primitives/toast" title="Toast (useToast) · bottom-right stack" wide>
        {ISO_FRAMES.toast.map(([iso, label, w, h]) => (
          <IsoFrame key={iso} iso={iso} label={label} w={w} h={h} />
        ))}
      </Group>
    </>
  );
}

/** Keep an iframe's theme in step with the gallery page around it. */
function useMirrorParentTheme() {
  React.useEffect(() => {
    if (window.parent === window) return;
    let parentRoot: HTMLElement;
    try {
      parentRoot = window.parent.document.documentElement;
    } catch {
      return;
    }
    const sync = () => {
      const dark = parentRoot.classList.contains("dark");
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(parentRoot, { attributes: true, attributeFilter: ["class", "style"] });
    return () => mo.disconnect();
  }, []);
}

/** What the scrim dims: a lobby card, so the overlay has something to cover. */
function Backdrop() {
  return (
    <Card shadow="hard" className="w-80 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Avatar color={SEAT_COLORS[1]} name="Mira" size={28} />
        <div className="text-[14px] font-bold">Friday night table</div>
        <Badge tone="ready">Ready</Badge>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={noop}>
          Start game
        </Button>
        <Button size="sm" variant="secondary" onClick={noop}>
          Leave table
        </Button>
      </div>
    </Card>
  );
}

const SETTINGS_ROWS = ["Sound effects", "Music", "Turn alerts", "Reduce motion"];
const LONG_SETTINGS_ROWS = [
  ...SETTINGS_ROWS,
  "Show pips on numbers",
  "Confirm before ending turn",
  "Colour-blind palette",
  "Show resource counts",
  "Auto-pass when unable to act",
  "Chat sounds",
  "Compact HUD",
  "Show coordinates",
];

function IsoDialog({ name }: { name: string }) {
  // Keep focus off the first button so the specimen shows the rest state.
  const keepFocus = (e: Event) => e.preventDefault();
  if (name === "dialog-question") {
    return (
      <Dialog open>
        <DialogContent className="w-100" onOpenAutoFocus={keepFocus}>
          <DialogTitle size="md">Leave this table?</DialogTitle>
          <DialogDescription size="md" className="mt-1.5">
            Your seat goes to a bot for the rest of the game.
          </DialogDescription>
          <div className="flex justify-end gap-2 mt-4">
            <Button size="sm" variant="secondary" onClick={noop}>
              Stay
            </Button>
            <Button size="sm" tone="danger" onClick={noop}>
              Leave table
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  if (name === "dialog-panel" || name === "dialog-overflow") {
    const rows = name === "dialog-overflow" ? LONG_SETTINGS_ROWS : SETTINGS_ROWS;
    return (
      <Dialog open>
        <DialogContent className="w-110" onOpenAutoFocus={keepFocus}>
          <DialogTitle size="lg">Settings</DialogTitle>
          <DialogDescription size="prose" className="mt-1">
            These apply on this device only.
          </DialogDescription>
          <div className="flex flex-col gap-3 mt-4">
            {rows.map((r, i) => (
              <label
                key={r}
                className="flex items-center justify-between text-[14px] font-semibold"
              >
                {r}
                <Switch checked={i % 3 !== 2} aria-label={r} />
              </label>
            ))}
          </div>
          <DialogDescription size="note" className="mt-4">
            Signed in as a guest. Sign in to keep your settings on every device.
          </DialogDescription>
          <div className="flex justify-end gap-2 mt-4">
            <Button size="sm" onClick={noop}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  if (name === "dialog-shelf") {
    return (
      <Dialog open>
        <DialogContent className="w-140" onOpenAutoFocus={keepFocus}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle size="xl">Store</DialogTitle>
              <DialogDescription size="prose" className="mt-1">
                Decorations for your name and pieces. Supporters unlock them all.
              </DialogDescription>
            </div>
            <IconButton size="sm" aria-label="Close" onClick={noop}>
              <X weight="bold" size={12} />
            </IconButton>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {["Gilded frame", "Ember name", "Harbour flag"].map((n) => (
              <Card key={n} radius="base" className="p-3 flex flex-col gap-2">
                <Skeleton className="h-14 w-full" />
                <div className="text-[13px] font-bold">{n}</div>
                <Button size="sm" variant="secondary" wrap onClick={noop}>
                  Boost to unlock
                </Button>
              </Card>
            ))}
          </div>
          <DialogDescription size="note" className="mt-4">
            Purchases support the servers. Nothing here affects play.
          </DialogDescription>
        </DialogContent>
      </Dialog>
    );
  }
  return null;
}

const SUPPRESS_CONFIRM: ConfirmOptions = {
  title: "Trade with the bank?",
  body: "You have a 2:1 harbour for wool, but you are offering 4:1.",
  confirmText: "Trade anyway",
  // Never stored: the specimen is never confirmed.
  suppressKey: "dev-gallery-never-stored",
};

const CONFIRMS: Record<string, ConfirmOptions> = {
  "confirm-default": {
    title: "Start the game?",
    body: "Two seats are still open. Bots will fill them.",
    confirmText: "Start game",
  },
  "confirm-danger": {
    title: "Leave table?",
    body: "Your seat goes to a bot for the rest of the game.",
    confirmText: "Leave table",
    cancelText: "Stay",
    tone: "danger",
  },
  "confirm-title-only": { title: "Reset the board to its default layout?" },
  "confirm-suppress": SUPPRESS_CONFIRM,
  "confirm-suppress-ticked": SUPPRESS_CONFIRM,
};

// Module-level so StrictMode's second effect run does not raise twice.
let isoFired = false;

function IsoConfirm({ name }: { name: string }) {
  const confirm = useConfirm();
  React.useEffect(() => {
    if (isoFired || !CONFIRMS[name]) return;
    isoFired = true;
    void confirm(CONFIRMS[name]);
    if (name === "confirm-suppress-ticked") {
      const tick = () => {
        const box = document.querySelector<HTMLInputElement>('[data-testid="confirm-dont-ask"]');
        if (!box) {
          window.setTimeout(tick, 30);
          return;
        }
        if (!box.checked) box.click();
      };
      window.setTimeout(tick, 30);
    }
  }, [confirm, name]);
  return null;
}

const TOASTS: Record<string, [string, "info" | "error"][]> = {
  "toast-info": [["Invite link copied", "info"]],
  "toast-error": [["Not your turn", "error"]],
  "toast-long": [
    [
      "That road is not connected to your network. Build from one of your settlements, cities or roads.",
      "error",
    ],
  ],
  "toast-stack": [
    ["You need 1 more brick", "error"],
    ["Report submitted", "info"],
    ["Mira joined the table", "info"],
  ],
};

function IsoToast({ name }: { name: string }) {
  const toast = useToast();
  React.useEffect(() => {
    if (isoFired) return;
    isoFired = true;
    // Toasts dismiss themselves after 4s. Keep these up by dropping that one
    // timer while they are raised.
    const orig = window.setTimeout;
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) =>
      ms === 4000 ? 0 : orig(fn, ms, ...rest)) as unknown as typeof window.setTimeout;
    try {
      for (const [m, v] of TOASTS[name] ?? []) toast.show(m, v);
    } finally {
      window.setTimeout = orig;
    }
  }, [toast, name]);
  return null;
}

function Isolated({ name }: { name: string }) {
  useMirrorParentTheme();
  return (
    <div data-iso={name}>
      <Backdrop />
      {name.startsWith("dialog-") && <IsoDialog name={name} />}
      {name.startsWith("confirm-") && <IsoConfirm name={name} />}
      {name.startsWith("toast-") && <IsoToast name={name} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Section() {
  const iso = new URLSearchParams(window.location.search).get("iso");
  if (iso) return <Isolated name={iso} />;
  return (
    <>
      <ButtonGroups />
      <IconButtonGroup surface="panel" />
      <IconButtonGroup surface="ground" />
      <IconButtonGroup surface="hud" />
      <BadgeGroups />
      <PillGroups />
      <SegmentedGroup surface="panel" />
      <SegmentedGroup surface="hud" />
      <SwitchGroup surface="panel" />
      <SwitchGroup surface="hud" />
      <SliderGroup surface="panel" />
      <SliderGroup surface="hud" />
      <InputGroup surface="panel" />
      <InputGroup surface="hud" />
      <MenuGroup surface="panel" />
      <MenuGroup surface="ground" />
      <MenuGroup surface="hud" />
      <AvatarGroup surface="panel" />
      <AvatarGroup surface="hud" />
      <SwatchGroup />
      <SkeletonSpinnerGroups />
      <ScrollFadeGroup />
      <CardGroup surface="panel" />
      <CardGroup surface="hud" />
      <IsolatedGroups />
    </>
  );
}
