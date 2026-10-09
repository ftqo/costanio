/**
 * Vitest global setup. Tests assert on rendered English, so the English
 * catalogue is activated before the first render: `<Trans>Volume</Trans>`
 * renders "Volume".
 */
import { activateLocale } from "@/lib/i18n";

await activateLocale("en");
