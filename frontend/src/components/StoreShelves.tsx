// The store's shelves: what you can have, and what you are wearing.
//
// Shared by the /store route (routes/Store.tsx) and StoreDialog (bottom of
// this file), so both always show the same slots. It lives under components/
// because the route draws SiteHeader, which opens the dialog; this avoids an
// import cycle.
//
// Buying and equipping are the same action on the same card. Free identity
// (display name) lives on the profile page; colour is on both, with the
// profile page picking from what you own.
//
// Driven by the catalog: one section per slot with items, so a new slot is a
// row in cosmetics/catalog.go and needs no code here.
//
// No countdowns, "only N left", bundle pressure or other manufactured urgency
// (monetization.md §1).
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { PipIcon } from "@/components/PipIcon";
import { Check, Storefront, X } from "@/lib/icons";
import { DecoratedName } from "@/components/DecoratedName";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/iconButton";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/errorCopy";
import { useAuth } from "@/lib/auth";
import { CosmeticGallery, CosmeticSlot } from "@/components/CosmeticGallery";
import { STOCK_PIECES_ID, isDrawablePieceSet } from "@/lib/pieceSets";
import { seatColor } from "@/lib/hexgeo";
import { cn } from "@/lib/utils";
import {
  SWATCH_LOCKED_CHIP,
  SWATCH_LOCKED_WELL,
  SWATCH_PICKED,
  swatchEdge,
} from "@/components/swatchLook";
import { inActivityMode } from "@/lib/activity";
import { formatNumber } from "@/lib/intl";
import { cosmeticName } from "@/lib/cosmeticNames";
import type { ColorView, CosmeticItem } from "@/lib/types";

/**
 * The name of the stock card in every section (the pieces and robber you
 * already have).
 */
const STOCK_NAME = msg({
  message: "Default",
  context: "the piece set or robber you already have, before buying any",
});

/**
 * Said by a locked item's button and by a supporter-only swatch.
 */
const SUPPORT_TO_UNLOCK = msg`Support to unlock`;

/**
 * The monthly supporter stipend, in Pips. Mirrors econ.StipendPayout; no
 * endpoint reports it to a non-subscriber.
 */
const STIPEND_PIPS = 10_000;

/**
 * Whether an item goes on the Pips shelf.
 *
 * Price alone decides it, as on the server (`itemLocked` in
 * cosmetics/service.go): a role gate alongside a price means that role gets it
 * free and everyone else pays. `reserved` items (a price with no art) are
 * refused by Purchase and shown as Unavailable.
 * `cosmetics.TestPriceAloneDecidesPurchasability` holds the Go half.
 */
function onTheShelf(item: CosmeticItem): boolean {
  return item.price > 0 && !item.reserved;
}

/**
 * The two group headings, shared by the colour shelf and every item section.
 *
 * "For Pips" and "Not for Pips": the second group holds supporter, booster,
 * Ko-fi, staff and gift items alike, so its heading names only what they share.
 * Each card names its own route in.
 */
const GROUP_SHELF = msg({
  message: "For Pips",
  context: "store shelf: buyable with the in-game currency",
});
const GROUP_GATED = msg({
  message: "Not for Pips",
  context: "store shelf: unlocked by supporting, or handed out, never bought",
});

/**
 * The colour shelf's first group also holds the ten free presets, so it needs
 * its own heading.
 */
const GROUP_COLOR_SHELF = msg({
  message: "Free and for Pips",
  context: "store shelf: the colors any player can have",
});

/**
 * A section's card for what you have without buying anything: the pieces and
 * the robber every player starts with, standing in the grid beside the ones
 * for sale.
 *
 * Not a catalog row, since it is not sold, but a real choice to come back to.
 * Equipping it sends "" ("nothing equipped").
 */
interface StockCard {
  /** Client-side only: what the gallery previews, never sent to the API. */
  id: string;
  /** A descriptor, resolved at render: this table is a module constant. */
  name: MessageDescriptor;
}

/**
 * The slots the store shows, in the order it shows them, with the copy each
 * one needs.
 *
 * A slot absent here is not sold here: colour has ColorShelf, and the dice and
 * board slots hold only reserved ids.
 *
 * The copy is message descriptors, since a module constant would freeze the
 * import-time language.
 */
const SECTIONS: {
  slot: string;
  title: MessageDescriptor;
  blurb: MessageDescriptor;
  stock?: StockCard;
  /**
   * Which of the slot's catalog items this client can put on a shelf. Absent
   * means all of them.
   */
  shows?: (item: CosmeticItem) => boolean;
}[] = [
  {
    slot: "pieces",
    title: msg`Piece sets`,
    blurb: msg`The settlements and cities you build, in your own colour. A set replaces the ones you start with for the whole game.`,
    stock: { id: STOCK_PIECES_ID, name: STOCK_NAME },
    // The slot carries reserved ids with no art; a set appears once its model
    // exists.
    shows: (item) => isDrawablePieceSet(item.id),
  },
  {
    slot: "robber",
    title: msg`Robbers`,
    blurb: msg`The robber wears the model of whoever moved it last, so the table sees yours the moment you use it.`,
    // Unrecognised ids fall back to the stock robber inside pieces.glb
    // (robberAssetFile), so this previews without a table entry.
    stock: { id: "robber.stock", name: STOCK_NAME },
  },
  {
    slot: "decoration",
    title: msg`Name decorations`,
    blurb: msg`An effect behind your name, wherever it appears. The support badges are earned by supporting; a few are handed out; the rest are on the shelf.`,
  },
];

/**
 * What a locked item's button says.
 *
 * Several gates are alternatives (supporter, boost or Ko-fi), so a multi-gated
 * item says the general thing and /support lists the ways in. A single gate
 * names itself.
 */
function unlockLabel(item: CosmeticItem): MessageDescriptor {
  const gates = [item.supporter, item.booster, item.kofi].filter(Boolean).length;
  if (gates === 1 && item.booster) return msg`Boost to unlock`;
  if (gates === 1 && item.kofi) return msg`Ko-fi to unlock`;
  return SUPPORT_TO_UNLOCK;
}

/**
 * A locked thing's route in: the label from `unlockLabel`, as a link to
 * /support everywhere but the Discord Activity.
 *
 * Inside the Activity the label stays but the link goes, since the Activity has
 * no way back from /support.
 *
 * Shared by the item cards and the colour swatches.
 */
function UnlockRoute({ label, wrap = false }: { label: MessageDescriptor; wrap?: boolean }) {
  const { i18n } = useLingui();
  if (inActivityMode()) {
    return <div className="text-[12px] text-muted text-center py-1.5">{i18n._(label)}</div>;
  }
  return (
    <Button asChild size="sm" variant="secondary" wrap={wrap}>
      <a href="/support">{i18n._(label)}</a>
    </Button>
  );
}

/**
 * Pips, written the way the header writes them.
 *
 * --amber-ink only reads on light surfaces (1.9:1 on the accent button, 1.0:1
 * on the ocean), so elsewhere the mark inherits the surrounding text colour.
 */
function Pips({ n, tone = "ink" }: { n: number; tone?: "ink" | "inherit" }) {
  return (
    <span className="font-num tabular-nums">
      <PipIcon className={tone === "ink" ? "text-amber-ink" : undefined} /> {formatNumber(n)}
    </span>
  );
}

/**
 * What an equipped item says in place of an action: the selected yellow with
 * a check, never the grey of a button you cannot afford. A disabled button so
 * it still reads as the slot's (inert) control to assistive tech.
 */
function EquippedMark() {
  return (
    <button
      type="button"
      disabled
      data-equipped-mark=""
      className="inline-flex items-center justify-center gap-1.5 rounded-control px-4 py-1.5 text-[13px] font-extrabold bg-selected text-selected-ink"
    >
      <Check aria-hidden weight="bold" className="size-3.5" />
      <Trans context="this cosmetic is the one you are wearing">Equipped</Trans>
    </button>
  );
}

/**
 * What an item looks like in the grid, and the one action it offers.
 *
 * One action: the next step, never both "buy" and "equip".
 */
function ItemCard({
  item,
  balance,
  stock = false,
  unequippable = true,
  onBuy,
  onEquip,
}: {
  item: CosmeticItem;
  balance: number;
  /** This is the section's stock card, so equipping it clears the slot. */
  stock?: boolean;
  /**
   * Whether what is equipped here can be taken off.
   *
   * False in a section with a stock card, where unequipping is the same as
   * equipping the stock card. There the equipped card offers nothing.
   */
  unequippable?: boolean;
  onBuy: (id: string) => Promise<void>;
  onEquip: (slot: string, id: string) => Promise<void>;
}) {
  // Confirm on the card rather than in a modal, so a mis-click never spends.
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const short = item.price - balance;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div
      data-equipped-card={item.equipped ? "" : undefined}
      className="relative bg-elev rounded-card p-2.5 flex flex-col gap-2"
    >
      {item.equipped && (
        // The marker: a yellow check on the card's corner, so an equipped
        // card reads as chosen even where its action is Unequip.
        <span
          aria-hidden
          className="absolute top-1.5 right-1.5 z-10 grid place-items-center size-6 rounded-full bg-selected text-selected-ink"
        >
          <Check weight="bold" className="size-3.5" />
        </span>
      )}
      <Preview item={item} />
      <div className="text-[14px] font-semibold leading-tight px-0.5">
        {item.slot === "decoration" ? (
          <DecoratedName decoration={item.id}>{cosmeticName(item)}</DecoratedName>
        ) : (
          cosmeticName(item)
        )}
      </div>

      {item.equipped && !unequippable ? (
        <EquippedMark />
      ) : item.equipped ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => onEquip(item.slot, ""))}
        >
          <Trans>Unequip</Trans>
        </Button>
      ) : item.owned ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => onEquip(item.slot, stock ? "" : item.id))}
        >
          <Trans context="put this cosmetic on">Equip</Trans>
        </Button>
      ) : item.reserved || (item.locked && (item.staff || item.gift)) ? (
        // Handed out, not earned or sold, so no link. `reserved` ids land here
        // too: locked for everyone, and supporting will not unlock them.
        <div className="text-[12px] text-muted text-center py-1.5">
          <Trans context="this cosmetic cannot be bought or earned">Unavailable</Trans>
        </div>
      ) : item.locked ? (
        // Earned, not sold: link to the page that explains how. `wrap`, since
        // this label runs long in some languages and the card is ~180px.
        <UnlockRoute label={unlockLabel(item)} wrap />
      ) : item.price <= 0 ? (
        // Unpriced and not locked: already owned, or simply not for sale.
        <div className="text-[12px] text-muted text-center py-1.5">
          <Trans context="this cosmetic cannot be bought or earned">Unavailable</Trans>
        </div>
      ) : confirming ? (
        <div className="flex gap-1.5">
          <Button
            size="sm"
            tone="success"
            disabled={busy}
            onClick={() => void run(() => onBuy(item.id))}
          >
            <Trans context="go through with this purchase">Confirm</Trans>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            <Trans context="call off this purchase">Cancel</Trans>
          </Button>
        </div>
      ) : (
        <>
          {/* The affirmative action: the same green Buy as the colour shelf. */}
          <Button size="sm" tone="accent" disabled={short > 0} onClick={() => setConfirming(true)}>
            <Trans>
              Buy <Pips n={item.price} tone="inherit" />
            </Trans>
          </Button>
          {short > 0 && (
            <div className="text-[12px] text-muted px-0.5">
              <Trans>
                Need <Pips n={short} /> more
              </Trans>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The palette, as a shelf.
 *
 * A grid of swatches rather than cards; the one you point at is described
 * below the grid with its name, price and action.
 *
 * Every colour shows, including locked ones, which link to /support like the
 * locked name effects.
 */
function ColorShelf({
  groups,
  equipped,
  picked,
  balance,
  onPick,
  onBuy,
  onEquip,
}: {
  /** The palette, already split: each group is a labelled grid of its own. */
  groups: { key: string; label: MessageDescriptor; colors: ColorView[] }[];
  /** The loadout's colour id, or "" while the player is on the seat default. */
  equipped: string;
  /** The swatch being read right now: what the detail row and the previews use. */
  picked: ColorView | null;
  balance: number;
  onPick: (c: ColorView) => void;
  onBuy: (id: string) => Promise<void>;
  onEquip: (slot: string, id: string) => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // A pending confirm does not carry over to a new swatch.
  React.useEffect(() => setConfirming(false), [picked?.id]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const short = picked ? picked.price - balance : 0;
  const isEquipped = !!picked && picked.id === equipped;

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1.5">
          {/* Smaller than the section heading: two halves of one shelf. */}
          <div className="text-[12px] font-semibold text-muted">{i18n._(group.label)}</div>
          <div className="grid grid-cols-[repeat(8,minmax(0,1fr))] sm:grid-cols-[repeat(16,minmax(0,1fr))] gap-1.5">
            {group.colors.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c)}
                aria-pressed={c.id === picked?.id}
                // The catalog name is untranslated and passed in as a value.
                title={
                  c.available
                    ? c.name
                    : c.price > 0
                      ? t`${c.name} (${formatNumber(c.price)} Pips)`
                      : t`${c.name} (supporter color)`
                }
                data-swatch-edge={c.available ? swatchEdge(c.hex) : undefined}
                className={cn(
                  "relative aspect-square w-full min-w-0 grid place-items-center rounded-md hover:scale-110 transition-transform",
                  c.id === picked?.id && SWATCH_PICKED,
                  // Not yours yet: the shared locked well, the colour smaller
                  // inside it. Dimming would misrepresent the colour for sale.
                  c.available ? "bg-(--swatch)" : SWATCH_LOCKED_WELL,
                )}
                style={{ "--swatch": c.hex } as React.CSSProperties}
              >
                {!c.available && (
                  <span data-swatch-edge={swatchEdge(c.hex)} className={SWATCH_LOCKED_CHIP} />
                )}
                {c.id === equipped && (
                  // Equipped: the selected check, on a yellow disc so it reads
                  // on any colour.
                  <span className="absolute inset-0 grid place-items-center">
                    <span className="grid place-items-center size-4 rounded-full bg-selected text-selected-ink">
                      <Check weight="bold" className="size-2.5" />
                    </span>
                  </span>
                )}
                {!c.available && c.price > 0 && (
                  <span className="absolute -top-1 -right-1 text-amber-ink text-[9px] leading-none">
                    ◆
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}

      {picked && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-elev rounded-base px-3 py-2">
          <span
            data-swatch-edge={swatchEdge(picked.hex)}
            className="w-7 h-7 rounded-md shrink-0 bg-(--swatch)"
            style={{ "--swatch": picked.hex } as React.CSSProperties}
          />
          <span className="text-[14px] font-semibold">{picked.name}</span>

          <span className="flex items-center gap-1.5 ml-auto">
            {isEquipped ? (
              <EquippedMark />
            ) : picked.available ? (
              <Button
                size="sm"
                tone="accent"
                disabled={busy}
                onClick={() => void run(() => onEquip("color", picked.id))}
              >
                <Trans context="put this cosmetic on">Equip</Trans>
              </Button>
            ) : picked.price > 0 ? (
              confirming ? (
                <>
                  <Button
                    size="sm"
                    tone="success"
                    disabled={busy}
                    onClick={() => void run(() => onBuy(picked.id))}
                  >
                    <Trans context="go through with this purchase">Confirm</Trans>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    <Trans context="call off this purchase">Cancel</Trans>
                  </Button>
                </>
              ) : (
                <>
                  {short > 0 && (
                    // Inside the shelf's panel, so the card-surface muted works.
                    <span className="text-[12px] text-muted">
                      <Trans>
                        Need <Pips n={short} tone="inherit" /> more
                      </Trans>
                    </span>
                  )}
                  <Button
                    size="sm"
                    tone="accent"
                    disabled={short > 0}
                    onClick={() => setConfirming(true)}
                  >
                    <Trans>
                      Buy <Pips n={picked.price} tone="inherit" />
                    </Trans>
                  </Button>
                </>
              )
            ) : (
              // Supporter-only: the same route as the locked name effects.
              <UnlockRoute label={SUPPORT_TO_UNLOCK} />
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The picture on a card.
 *
 * A robber and a piece set get a rendered still that turns while pointed at
 * (see CosmeticGallery). Everything else is shown as its name.
 */
const MODELLED_SLOTS = new Set(["robber", "pieces"]);

function Preview({ item }: { item: CosmeticItem }) {
  if (!MODELLED_SLOTS.has(item.slot)) return null;
  return (
    <CosmeticSlot id={item.id} className="bg-secondary-background rounded-base aspect-[3/4]" />
  );
}

/**
 * The stock card as an item, so it renders through the same card as everything
 * else.
 *
 * Owned, unpriced, and equipped exactly when nothing else in the slot is.
 */
function stockItem(
  slot: string,
  card: StockCard,
  name: string,
  anyEquipped: boolean,
): CosmeticItem {
  return {
    id: card.id,
    slot,
    name,
    price: 0,
    supporter: false,
    booster: false,
    kofi: false,
    staff: false,
    gift: false,
    owned: true,
    equipped: !anyEquipped,
    locked: false,
  };
}

/**
 * What a subscription actually hands you, said on the page where the locked
 * things are.
 *
 * It states the price, what comes with it, and links to /support. No urgency,
 * no comparison table, no second button (monetization.md §1).
 *
 * A supporter instead sees a card confirming what they have.
 */
function SupporterPanel({ supporterColors }: { supporterColors: number }) {
  const { me } = useAuth();

  if (me?.supporter) {
    return (
      // Static: a flat print slab, not a piece (pb-site.css `data-pb-flat`).
      <Card data-pb-flat="" className="px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="text-[15px] font-semibold">
          <Trans>You are a supporter. Thank you.</Trans>
        </div>
        <div className="text-[13px] text-muted">
          <Trans>
            Every supporter cosmetic here is yours, and <Pips n={STIPEND_PIPS} /> land in your
            balance each month.
          </Trans>
        </div>
      </Card>
    );
  }

  return (
    <Card className="px-5 py-4.5 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="text-[17px] font-semibold">
          <Trans>Supporter, $4.99 a month</Trans>
        </div>
        <div className="text-[14px] text-muted">
          <Trans>
            The locked half of every shelf below, plus a monthly allowance to spend on the rest.
            Cosmetics only, never an advantage.
          </Trans>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
        <Perk
          title={
            // Two flat messages rather than an ICU plural: the catalogue test
            // requires blank translations to render the English exactly, and
            // zh-Hans has no "one" plural category.
            supporterColors === 1 ? (
              <Trans>One more seat color</Trans>
            ) : supporterColors > 1 ? (
              <Trans>{formatNumber(supporterColors)} more seat colors</Trans>
            ) : (
              <Trans>The rest of the palette</Trans>
            )
          }
          body={
            <Trans>
              The whole supporter half of the shelf above. A color you equip stays yours even if you
              stop.
            </Trans>
          }
        />
        <Perk
          title={
            <Trans>
              <Pips n={STIPEND_PIPS} /> every month
            </Trans>
          }
          body={<Trans>Added to your balance, and spendable on anything priced here.</Trans>}
        />
        <Perk
          title={<Trans>The supporter cosmetics</Trans>}
          body={
            <Trans>
              Every piece set, robber and name decoration below that supporting unlocks, while you
              subscribe.
            </Trans>
          }
        />
      </div>

      {/* In the Activity the button becomes a line saying supporting happens
          on the website (see UnlockRoute). */}
      {inActivityMode() ? (
        <span className="text-[12px] text-muted">
          {/* Two sentences so the second reuses an existing translated msgid. */}
          <Trans>Supporting is set up on the website.</Trans>{" "}
          <Trans>Bill it through Ko-fi or Discord. Cancel any time.</Trans>
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button asChild size="sm" tone="accent">
            {/* Marked so tests can tell it from the locked cards' links. */}
            <a href="/support" data-supporter-pitch="">
              <Trans context="link to the page explaining how to support">
                See how supporting works
              </Trans>
            </a>
          </Button>
          <span className="text-[12px] text-muted">
            <Trans>Bill it through Ko-fi or Discord. Cancel any time.</Trans>
          </span>
        </div>
      )}
    </Card>
  );
}

/** One line of the supporter panel: what it is, and what that means. */
function Perk({ title, body }: { title: React.ReactNode; body: React.ReactNode }) {
  return (
    <div className="rounded-base px-3.5 py-3 bg-elev">
      <div className="text-[14px] font-semibold mb-1">{title}</div>
      <div className="text-[12px] text-muted leading-snug">{body}</div>
    </div>
  );
}

/** A shelf's heading: its name and one line on what it is. Both sit on the
 * shelf's own panel, so the quiet line is the card-surface muted. */
function SectionHead({ title, blurb }: { title: React.ReactNode; blurb: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-display text-[17px] font-semibold leading-tight">{title}</h2>
      <div className="text-[14px] text-muted leading-relaxed">{blurb}</div>
    </div>
  );
}

export function StoreContent({
  children,
}: {
  children: (body: React.ReactNode, seatColor: string) => React.ReactNode;
}) {
  const { t, i18n } = useLingui();
  const { me, refresh } = useAuth();
  const toast = useToast();

  // All four 401 without a session, so skip them when signed out.
  const signedIn = !!me;
  const walletQ = useQuery({ queryKey: ["wallet"], queryFn: api.wallet, enabled: signedIn });
  const cosmeticsQ = useQuery({
    queryKey: ["cosmetics"],
    queryFn: api.cosmetics,
    enabled: signedIn,
  });
  const loadoutQ = useQuery({ queryKey: ["loadout"], queryFn: api.loadout, enabled: signedIn });
  const colorsQ = useQuery({
    queryKey: ["colors"],
    queryFn: api.colors,
    staleTime: 60_000,
    enabled: signedIn,
  });

  const balance = walletQ.data?.balance ?? 0;

  const colors = colorsQ.data?.colors ?? [];
  const equippedColor = loadoutQ.data?.loadout?.color ?? "";
  // Which swatch the shelf is reading. Null until the player touches one; it
  // survives equipping so the row can say "Equipped".
  const [pickedId, setPickedId] = React.useState<string | null>(null);
  const picked = colors.find((c) => c.id === pickedId) ?? null;
  // Two shelves: what a player can have and what supporting adds, each in
  // catalog order.
  const colorGroups = [
    {
      key: "shelf",
      label: GROUP_COLOR_SHELF,
      colors: colors.filter((c) => c.free || c.price > 0),
    },
    { key: "gated", label: GROUP_GATED, colors: colors.filter((c) => !c.free && c.price <= 0) },
  ].filter((g) => g.colors.length > 0);
  // Counted from the palette so the supporter panel cannot drift from it.
  const supporterColors = colors.filter((c) => !c.free && c.price <= 0).length;

  // The colour the piece cards are drawn in: the picked swatch (owned or not,
  // so players can preview it), else the equipped colour, else the first seat
  // colour.
  const myColor = picked?.hex ?? colors.find((c) => c.id === equippedColor)?.hex ?? seatColor(0);

  // Everything shows; a card offers a price, a route to earning it, or
  // "unavailable" for handed-out items (staff, the gift role's fires).
  const items = cosmeticsQ.data?.items ?? [];

  async function refetchAll() {
    // Colours too: buying one changes what the shelf offers for it.
    await Promise.all([
      walletQ.refetch(),
      cosmeticsQ.refetch(),
      loadoutQ.refetch(),
      colorsQ.refetch(),
    ]);
  }

  async function buy(id: string) {
    try {
      await api.purchase(id);
      await refetchAll();
      // The header's Pip chip reads from the session, not the wallet query.
      await refresh();
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not buy that`));
    }
  }

  async function equip(slot: string, id: string) {
    try {
      await api.setLoadout(slot, id); // "" unequips
      await refetchAll();
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not equip that`));
    }
  }

  return children(
    <>
      {/* The balance, and where it comes from. A counter, so a flat print
          slab rather than a piece. */}
      <Card data-pb-flat="" className="px-5 py-4 flex flex-wrap items-end gap-x-5 gap-y-1.5">
        <div className="flex flex-col gap-1.5">
          <div className="text-[12px] font-semibold text-muted">
            <Trans context="your Pips balance, a label above the number">Balance</Trans>
          </div>
          <div className="font-display text-[28px] font-heavy leading-none">
            <Pips n={balance} />
          </div>
        </div>
        <div className="text-[14px] text-muted pb-0.5">
          <Trans>Earned by playing. Finish a game with someone else at the table.</Trans>
        </div>
      </Card>

      {/* Directly under the balance. */}
      <SupporterPanel supporterColors={supporterColors} />

      {/* Colours first, because everything under them is drawn in one. */}
      {colors.length > 0 && (
        <Card className="px-5 py-4.5 flex flex-col gap-3">
          <SectionHead
            title={<Trans>Seat colors</Trans>}
            blurb={
              <Trans>
                The color your roads, settlements and cities are built in. Ten come with the game
                and a dozen more are on the shelf; the rest come with supporting. Choose one to see
                the sets below in it.
              </Trans>
            }
          />
          <ColorShelf
            groups={colorGroups}
            equipped={equippedColor}
            picked={picked}
            balance={balance}
            onPick={(c) => setPickedId(c.id === pickedId ? null : c.id)}
            onBuy={buy}
            onEquip={equip}
          />
        </Card>
      )}

      {SECTIONS.map((section) => {
        const owned = items
          .filter((i) => i.slot === section.slot)
          .filter((i) => section.shows?.(i) ?? true);
        // Skip empty sections; the stock card alone does not count.
        if (!owned.length) return null;
        const stock = section.stock
          ? stockItem(
              section.slot,
              section.stock,
              i18n._(section.stock.name),
              owned.some((i) => i.equipped),
            )
          : null;
        return (
          <Card key={section.slot} className="px-5 py-4.5 flex flex-col gap-3">
            <SectionHead title={i18n._(section.title)} blurb={i18n._(section.blurb)} />
            {/* Two grids: what Pips buy and what they do not. The stock card
                  leads the first. Empty groups are dropped. */}
            {[
              { key: "shelf", label: GROUP_SHELF, items: owned.filter(onTheShelf) },
              { key: "gated", label: GROUP_GATED, items: owned.filter((i) => !onTheShelf(i)) },
            ]
              .filter((group) => group.items.length > 0 || (group.key === "shelf" && stock))
              .map((group) => (
                <div key={group.key} className="flex flex-col gap-2">
                  <div className="text-[12px] font-semibold text-muted">{i18n._(group.label)}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                    {group.key === "shelf" && stock && (
                      <ItemCard
                        item={stock}
                        balance={balance}
                        stock
                        unequippable={false}
                        onBuy={buy}
                        onEquip={equip}
                      />
                    )}
                    {group.items.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        balance={balance}
                        unequippable={!section.stock}
                        onBuy={buy}
                        onEquip={equip}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </Card>
        );
      })}
    </>,
    myColor,
  );
}

/**
 * The store as a dialog, over whatever screen the player is already on.
 *
 * It is the only way to the store inside the Discord Activity, which has no
 * nav, and lets any player change cosmetics without leaving a table.
 *
 * The `open &&` guard is redundant today (Radix does not mount a closed
 * DialogContent) and untested. It guards against a future `forceMount`, which
 * would have a closed store render a WebGL still per card behind the board.
 */
export function StoreDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The shelves' `text-on-background-muted` labels are tuned for the
          ocean and vanish on the white dialog, so re-point the token for this
          subtree. It must be Tailwind's `--color-on-background-muted`: the
          source variable was already substituted at :root. */}
      <DialogContent
        className="w-215 flex flex-col gap-4"
        style={{ "--color-on-background-muted": "var(--muted)" } as React.CSSProperties}
      >
        {open && (
          <StoreContent>
            {(body, seatCol) => (
              <CosmeticGallery seatColor={seatCol}>
                {/* Title and a visible close button: on a phone the overlay
                    margins are thin, and the Activity has no Escape key. */}
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex flex-col gap-1">
                    <DialogTitle size="xl" className="flex items-center">
                      <Storefront weight="bold" size={22} className="text-blue mr-2" />
                      <Trans context="page title of the cosmetics shop">Store</Trans>
                    </DialogTitle>
                    <DialogDescription size="prose">
                      <Trans>Cosmetics only. Nothing here touches the game.</Trans>
                    </DialogDescription>
                  </div>
                  {/* The one dialog close: an IconButton piece, top right. */}
                  <DialogClose asChild>
                    <IconButton aria-label={t`Close`} title={t`Close`} className="ml-auto">
                      <X weight="bold" size={16} />
                    </IconButton>
                  </DialogClose>
                </div>
                {/* The same spacing as PageBody; the dialog owns the scrolling. */}
                <div className="flex flex-col gap-4">{body}</div>
              </CosmeticGallery>
            )}
          </StoreContent>
        )}
      </DialogContent>
    </Dialog>
  );
}
