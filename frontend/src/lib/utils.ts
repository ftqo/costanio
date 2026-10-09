import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The theme defines custom box-shadow utilities (`shadow-shadow`,
// `shadow-hard-sm`, ...) that tailwind-merge does not know, so it would keep
// them beside `shadow-none` or an arbitrary `shadow-[...]` and let the cascade
// pick. Registering them as box-shadow makes a later override win.
//
// Same for the control radius (`rounded-control`, the `pill` button's radius),
// so a call site's `rounded-full` or `rounded-[11px]` replaces it.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      borderRadius: ["control", "base", "card", "card-lg"],
    },
    classGroups: {
      shadow: [{ shadow: ["shadow", "hard-sm", "hard", "hard-lg", "none"] }],
      // The display weight (index.css `--font-weight-heavy`). Unregistered,
      // `font-heavy` is filed as a font family and `font-semibold` beside it
      // survives the merge.
      "font-weight": [{ font: ["heavy"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
