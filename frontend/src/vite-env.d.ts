/// <reference types="vite/client" />

// Gettext catalogues are imported as modules and compiled by
// @lingui/vite-plugin, which hands back the runtime message map.
declare module "*.po" {
  import type { Messages } from "@lingui/core";
  export const messages: Messages;
}
