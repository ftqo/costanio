import { useState } from "react";
import { cn } from "@/lib/utils";

// Discord avatar CDN URL: https://cdn.discordapp.com/avatars/<id>/<hash>.<ext>?size=128
const DISCORD_AVATAR_RE =
  /^https:\/\/cdn\.discordapp\.com\/avatars\/(\d+)\/([\w-]+\.\w+)(?:\?.*)?$/;

/**
 * Route Discord CDN avatars through our same-origin proxy (`/api/avatar/...`).
 * The Discord Activity webview blocks cross-origin loads from
 * cdn.discordapp.com. Other URLs (e.g. Google) and relative paths pass through.
 */
function proxiedSrc(src?: string): string | undefined {
  const m = src ? DISCORD_AVATAR_RE.exec(src) : null;
  return m ? `/api/avatar/${m[1]}/${m[2]}` : src;
}

/**
 * Disc avatar with a surface-coloured ring. Shows the picture at `src`, or a
 * solid `color` disc when there is none or it fails to load, so callers always
 * pass `color`.
 */
export function Avatar({
  color,
  src,
  name,
  size = 36,
  ring = 3,
  className,
  style,
}: {
  color: string;
  src?: string;
  name?: string;
  size?: number;
  ring?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [broken, setBroken] = useState(false);
  const imgSrc = proxiedSrc(src);
  // Reset the broken flag when the URL changes so a new picture gets a fresh try.
  const showImage = !!imgSrc && !broken;
  return (
    <div
      // The HUD keeps its rim-coloured ring and no lift (index.css, site-material block).
      data-ui-avatar=""
      // The ring is the panel's own colour, with a soft lift.
      className={cn(
        "rounded-full border-secondary-background shadow-hard-sm shrink-0 overflow-hidden",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: color,
        borderWidth: ring,
        borderStyle: "solid",
        ...style,
      }}
    >
      {showImage && (
        <img
          key={imgSrc}
          src={imgSrc}
          alt={name ?? ""}
          loading="lazy"
          // Discord/Google CDNs serve avatars cross-origin; don't leak the app
          // URL as a referrer (and sidestep referrer-based hotlink blocking).
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}
