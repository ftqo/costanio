/**
 * What the `<Trans>` and `useLingui` macros compile down to.
 *
 * Lingui's runtime throws in development without an `<I18nProvider>` above.
 * The app always has one (LocaleProvider at the root), but component tests
 * mount components in isolation. Pointing the macros here (lingui.config.ts
 * `runtimeConfigModule`) keeps that working.
 *
 * With a provider this is a pass-through costing one `useContext`. Without one
 * it uses the global i18n instance and subscribes so a locale change still
 * re-renders.
 */
import * as React from "react";
import { i18n as globalI18n } from "@lingui/core";
import { LinguiContext, Trans as LinguiTrans } from "@lingui/react";

type LinguiCtx = React.ContextType<typeof LinguiContext>;

function ambient(): NonNullable<LinguiCtx> {
  return {
    i18n: globalI18n,
    defaultComponent: undefined,
    _: globalI18n.t.bind(globalI18n),
  };
}

export function useLingui(): NonNullable<LinguiCtx> {
  const ctx = React.useContext(LinguiContext);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  // Only without a provider, which already re-renders its subtree on a locale
  // change.
  React.useEffect(() => (ctx ? undefined : globalI18n.on("change", bump)), [ctx]);
  return ctx ?? ambient();
}

export function Trans(props: React.ComponentProps<typeof LinguiTrans>) {
  const ctx = React.useContext(LinguiContext);
  if (ctx) return <LinguiTrans {...props} />;
  return (
    <LinguiContext.Provider value={ambient()}>
      <LinguiTrans {...props} />
    </LinguiContext.Provider>
  );
}
