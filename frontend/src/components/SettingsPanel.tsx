import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { i18n } from "@lingui/core";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { setMuted, setVolume as setSoundVolume, setMusicEnabled } from "@/lib/sound";
import { applyTheme, getStoredPref, type ThemePref } from "@/lib/theme";
import {
  useCbMode,
  setCbMode as persistCbMode,
  CB_MODES,
  CB_MODE_LABELS,
  type CbMode,
} from "@/lib/colorblind";
import {
  useBoardPostFx,
  setBoardPostFx as persistBoardPostFx,
  BOARD_POSTFX_LABEL,
} from "@/lib/boardPostFx";
import {
  usePlacementMarks,
  setPlacementMarks as persistPlacementMarks,
  PLACEMENT_MARKS_LABEL,
} from "@/lib/placementMarks";

// The "Sound effects" gate persists across sessions. The sound manager defaults to
// muted, so we read the saved value (default ON) and push it into the gate on
// mount, keeping the toggle authoritative for whether sounds play.
const SOUNDS_KEY = "costan.sounds";
function readSounds(): boolean {
  try {
    return localStorage.getItem(SOUNDS_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeSounds(on: boolean) {
  try {
    localStorage.setItem(SOUNDS_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const VOLUME_KEY = "costan.volume";
const MUSIC_KEY = "costan.music";
function readVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 80; // never set → default
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? Math.min(100, v) : 80;
  } catch {
    return 80;
  }
}
function readMusic(): boolean {
  try {
    return localStorage.getItem(MUSIC_KEY) === "1";
  } catch {
    return false;
  }
}

// Uppercased by CSS so locales where that is wrong (CJK, where it mis-cases
// small kana) can turn it off. See the :lang() block in index.css.
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[12px] font-semibold text-muted">{children}</div>
);

// useAppSettings owns the persistent client-side settings (sound gate + display
// prefs). Call it from a component that mounts with the app shell (the header),
// so the sound gate is initialized at startup regardless of whether the settings
// UI is open; the panel itself only mounts when the user expands it.
export function useAppSettings() {
  const [volume, setVolumeState] = React.useState(readVolume);
  const [sounds, setSounds] = React.useState(readSounds);
  const [music, setMusicState] = React.useState(readMusic);
  // The colorblind mode is owned by lib/colorblind (localStorage plus
  // subscribers), so the board reacts when it changes.
  const cbMode = useCbMode();
  const setCbMode = React.useCallback((m: CbMode) => persistCbMode(m), []);
  // Likewise a module with subscribers. See lib/boardPostFx.
  const boardPostFx = useBoardPostFx();
  // Likewise; the game route turns it into `markerStyle`. See lib/placementMarks.
  const placementMarks = usePlacementMarks();
  // Each deficiency has its own palette; turning it on picks deutan, the most
  // common.
  const setColorblind = React.useCallback(
    (on: boolean) => persistCbMode(on ? "deutan" : "off"),
    [],
  );

  // Push persisted settings into the sound manager at app start and on change.
  React.useEffect(() => {
    setMuted(!sounds);
  }, [sounds]);
  React.useEffect(() => {
    setSoundVolume(volume / 100);
  }, [volume]);
  React.useEffect(() => {
    setMusicEnabled(music);
  }, [music]);

  const toggleSounds = React.useCallback((on: boolean) => {
    setSounds(on);
    writeSounds(on);
    setMuted(!on);
  }, []);
  const setVolume = React.useCallback((v: number) => {
    setVolumeState(v);
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      /* ignore */
    }
  }, []);
  const setMusic = React.useCallback((on: boolean) => {
    setMusicState(on);
    try {
      localStorage.setItem(MUSIC_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  return {
    volume,
    setVolume,
    sounds,
    toggleSounds,
    music,
    setMusic,
    colorblind: cbMode !== "off",
    setColorblind,
    cbMode,
    setCbMode,
    boardPostFx,
    setBoardPostFx: persistBoardPostFx,
    placementMarks,
    setPlacementMarks: persistPlacementMarks,
  };
}
export type AppSettings = ReturnType<typeof useAppSettings>;

// SettingsPanel renders the settings controls inline (no modal). State lives in
// useAppSettings so the caller can mount it with the app shell; the panel is a
// pure view over that state.
export function SettingsPanel({ settings }: { settings: AppSettings }) {
  const {
    volume,
    setVolume,
    sounds,
    toggleSounds,
    music,
    setMusic,
    colorblind,
    setColorblind,
    cbMode,
    setCbMode,
    boardPostFx,
    setBoardPostFx,
    placementMarks,
    setPlacementMarks,
  } = settings;
  const [theme, setTheme] = React.useState<ThemePref>(getStoredPref);
  const { t } = useLingui();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <SectionLabel>
          <Trans>Sound</Trans>
        </SectionLabel>
        <div className="flex items-center">
          <div className="text-[14px] font-medium">
            <Trans>Volume</Trans>
          </div>
          <Pill tone="count" className="ml-auto">
            {volume}%
          </Pill>
        </div>
        <Slider value={[volume]} onValueChange={(v) => setVolume(v[0])} max={100} step={1} />
        <label className="flex items-center gap-2.5 text-[14px] font-medium cursor-pointer">
          <Switch checked={sounds} onCheckedChange={toggleSounds} />
          <Trans>Sound effects</Trans>
        </label>
        <label className="flex items-center gap-2.5 text-[14px] font-medium cursor-pointer">
          <Switch checked={music} onCheckedChange={setMusic} />
          <Trans>Music</Trans>
        </label>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-line pt-4">
        <SectionLabel>
          <Trans>Display</Trans>
        </SectionLabel>
        {/* The language picker is in components/LanguagePicker (site header
            and lobby), where signed-out visitors can reach it. */}
        <div className="text-[14px] font-medium">
          <Trans>Theme</Trans>
        </div>
        {/* The track look every toggle group shares. */}
        <Segmented
          variant="joined"
          className="self-start"
          options={[
            { label: t`Light`, value: "light" },
            { label: t`Dark`, value: "dark" },
            { label: t`System`, value: "system" },
          ]}
          value={theme}
          onChange={(v) => {
            setTheme(v);
            applyTheme(v);
          }}
        />
        {/* Grading and glow for the 3D board: local to the viewer, with no
            gameplay effect. Off by default because it is expensive on weaker
            GPUs. See lib/boardPostFx. */}
        <label className="flex items-center gap-2.5 text-[14px] font-medium cursor-pointer">
          <Switch checked={boardPostFx} onCheckedChange={setBoardPostFx} />
          {i18n._(BOARD_POSTFX_LABEL.name)}
        </label>
        <div className="text-[12px] text-muted leading-snug -mt-1.5 pl-12">
          {i18n._(BOARD_POSTFX_LABEL.hint)}
        </div>
        {/* The resting marks on legal spots while placing. Local to the viewer;
            hovering still previews either way. See lib/placementMarks. */}
        <label className="flex items-center gap-2.5 text-[14px] font-medium cursor-pointer">
          <Switch checked={placementMarks} onCheckedChange={setPlacementMarks} />
          {i18n._(PLACEMENT_MARKS_LABEL.name)}
        </label>
        <div className="text-[12px] text-muted leading-snug -mt-1.5 pl-12">
          {i18n._(PLACEMENT_MARKS_LABEL.hint)}
        </div>
        <label className="flex items-center gap-2.5 text-[14px] font-medium cursor-pointer">
          <Switch checked={colorblind} onCheckedChange={setColorblind} />
          <Trans>Colorblind-friendly board</Trans>
        </label>
        {/* Which deficiency: one palette for all three runs out of
            distinguishable colors at five or six seats. See lib/colorblind. */}
        {colorblind && (
          <div className="flex flex-col gap-1.5 pl-1">
            <Segmented
              variant="joined"
              options={CB_MODES.map((m) => ({
                label: i18n._(CB_MODE_LABELS[m].label),
                value: m,
                title: i18n._(CB_MODE_LABELS[m].hint),
              }))}
              value={cbMode === "off" ? "deutan" : cbMode}
              onChange={setCbMode}
            />
            <div className="text-[12px] text-muted leading-snug">
              <Trans>
                Pick whichever makes the player pieces easiest to tell apart. Buildings are also
                numbered by seat.
              </Trans>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
