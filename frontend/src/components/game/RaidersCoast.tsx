import { Plural, Trans } from "@lingui/react/macro";
import type { Board } from "@/lib/types";
import { hexKey } from "@/lib/hexgeo";
import { hexLabel } from "@/lib/boardInfo";
import { RAIDERS_TO_CONQUER, type CoastThreat } from "@/lib/raiders";
import { Glyph, MChip, MHead } from "./moduleUi";

/** At most this many hexes are listed; the rest are counted. */
const ROWS = 4;

/**
 * The coastal raider threat: which hexes are filling up, how many have fallen,
 * how many raiders are left to land. This is the scenario's clock: three
 * raiders conquer a coastal hex, and when the supply runs dry building stops
 * drawing landings. Every number is off the wire (see `coastThreat`); this
 * orders them fullest first and marks a hex one raider from falling.
 */
export function RaidersCoast({ board, threat }: { board: Board; threat: CoastThreat }) {
  const shown = threat.hexes.slice(0, ROWS);
  const more = threat.hexes.length - shown.length;
  return (
    <div className="flex flex-col gap-1.5" data-raiders-coast>
      <MHead label={<Trans id="raiders.coast.title">Coast</Trans>}>
        {threat.conquered > 0 && (
          <MChip tone="bad" icon={<Glyph name="castle" size={12} />} data-raiders-conquered>
            <Plural
              id="raiders.coast.conqueredN"
              value={threat.conquered}
              one="# conquered"
              other="# conquered"
            />
          </MChip>
        )}
        {threat.supply !== null && (
          <MChip icon={<Glyph name="raider" size={12} />} data-raiders-supply={threat.supply}>
            <Plural
              id="raiders.coast.supplyN"
              value={threat.supply}
              one="# to land"
              other="# to land"
            />
          </MChip>
        )}
      </MHead>
      {shown.length === 0 ? (
        <span className="modp-small">
          <Trans id="raiders.coast.clear">No raiders stand on the coast yet.</Trans>
        </span>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map(({ hex, count }) => {
            const tile = board.tiles.find((x) => hexKey(x.hex) === hexKey(hex));
            const brink = count >= RAIDERS_TO_CONQUER - 1;
            return (
              <li
                key={hexKey(hex)}
                className="modp-row"
                style={{ flexWrap: "nowrap" }}
                data-raiders-coast-hex={count}
              >
                <Glyph name="raider" size={13} className="text-(--hud-muted)" />
                <span className="modp-grow truncate">{hexLabel(tile)}</span>
                <span className="modp-cells" aria-hidden>
                  {Array.from({ length: RAIDERS_TO_CONQUER }, (_, i) => (
                    <i
                      key={i}
                      data-on={i < count ? "" : undefined}
                      style={{ ["--tc" as string]: brink ? "var(--hud-bad)" : "var(--hud-muted)" }}
                    />
                  ))}
                </span>
                <span className={brink ? "modp-small text-(--hud-bad)" : "modp-small"}>
                  {brink ? (
                    <Trans id="raiders.coast.brink">one more takes it</Trans>
                  ) : (
                    <Trans id="raiders.coast.count">
                      {count} of {RAIDERS_TO_CONQUER}
                    </Trans>
                  )}
                </span>
              </li>
            );
          })}
          {more > 0 && (
            <li className="modp-small">
              <Plural
                id="raiders.coast.moreN"
                value={more}
                one="and # more hex with raiders"
                other="and # more hexes with raiders"
              />
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
