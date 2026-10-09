// The icons this app uses, each imported from its own file.
//
// `@phosphor-icons/react`'s entry is a barrel re-exporting ~1,500 icons. Vite's
// dev server pre-bundles it into one ~6 MB dependency chunk that the browser
// must fetch and evaluate before the app starts. Production tree-shakes it
// (`sideEffects: false`), so only development pays.
//
// The rest of the app imports icons from this module. The paths are the
// package's published subpaths (`exports` maps `./dist/icons/*`), not internals.
//
// The `Icon` type is still imported from the barrel (`components/game/hudIcons`):
// with `verbatimModuleSyntax`, `import type` is erased and costs nothing.
//
// To add one, find it at phosphoricons.com and add a line below in
// alphabetical order. The lint rule in `eslint.config.js` refuses the barrel
// anywhere else.
export { ArrowCounterClockwise } from "@phosphor-icons/react/dist/icons/ArrowCounterClockwise";
export { ArrowFatUp } from "@phosphor-icons/react/dist/icons/ArrowFatUp";
export { ArrowLeft } from "@phosphor-icons/react/dist/icons/ArrowLeft";
export { ArrowsLeftRight } from "@phosphor-icons/react/dist/icons/ArrowsLeftRight";
export { Bank } from "@phosphor-icons/react/dist/icons/Bank";
export { Boat } from "@phosphor-icons/react/dist/icons/Boat";
export { Boot } from "@phosphor-icons/react/dist/icons/Boot";
export { Bridge } from "@phosphor-icons/react/dist/icons/Bridge";
export { Buildings } from "@phosphor-icons/react/dist/icons/Buildings";
export { CaretDown } from "@phosphor-icons/react/dist/icons/CaretDown";
export { CaretLeft } from "@phosphor-icons/react/dist/icons/CaretLeft";
export { CaretRight } from "@phosphor-icons/react/dist/icons/CaretRight";
export { Certificate } from "@phosphor-icons/react/dist/icons/Certificate";
export { ChatCircle } from "@phosphor-icons/react/dist/icons/ChatCircle";
export { ChatText } from "@phosphor-icons/react/dist/icons/ChatText";
export { Check } from "@phosphor-icons/react/dist/icons/Check";
export { CircleNotch } from "@phosphor-icons/react/dist/icons/CircleNotch";
export { Coins } from "@phosphor-icons/react/dist/icons/Coins";
export { Compass } from "@phosphor-icons/react/dist/icons/Compass";
export { Cube } from "@phosphor-icons/react/dist/icons/Cube";
export { CrownSimple } from "@phosphor-icons/react/dist/icons/CrownSimple";
export { DiceFive } from "@phosphor-icons/react/dist/icons/DiceFive";
export { DotsThreeVertical } from "@phosphor-icons/react/dist/icons/DotsThreeVertical";
export { DownloadSimple } from "@phosphor-icons/react/dist/icons/DownloadSimple";
export { Eye } from "@phosphor-icons/react/dist/icons/Eye";
export { FilmStrip } from "@phosphor-icons/react/dist/icons/FilmStrip";
export { Fish } from "@phosphor-icons/react/dist/icons/Fish";
export { Flag } from "@phosphor-icons/react/dist/icons/Flag";
export { Funnel } from "@phosphor-icons/react/dist/icons/Funnel";
export { GearSix } from "@phosphor-icons/react/dist/icons/GearSix";
export { Globe } from "@phosphor-icons/react/dist/icons/Globe";
export { HandDeposit } from "@phosphor-icons/react/dist/icons/HandDeposit";
export { Handshake } from "@phosphor-icons/react/dist/icons/Handshake";
export { Heart } from "@phosphor-icons/react/dist/icons/Heart";
export { House } from "@phosphor-icons/react/dist/icons/House";
export { Info } from "@phosphor-icons/react/dist/icons/Info";
export { Lightning } from "@phosphor-icons/react/dist/icons/Lightning";
export { List } from "@phosphor-icons/react/dist/icons/List";
export { LockSimple } from "@phosphor-icons/react/dist/icons/LockSimple";
export { Minus } from "@phosphor-icons/react/dist/icons/Minus";
export { Moon } from "@phosphor-icons/react/dist/icons/Moon";
export { Path } from "@phosphor-icons/react/dist/icons/Path";
export { PencilSimple } from "@phosphor-icons/react/dist/icons/PencilSimple";
export { Pause } from "@phosphor-icons/react/dist/icons/Pause";
export { Play } from "@phosphor-icons/react/dist/icons/Play";
export { Plus } from "@phosphor-icons/react/dist/icons/Plus";
export { Question } from "@phosphor-icons/react/dist/icons/Question";
export { Robot } from "@phosphor-icons/react/dist/icons/Robot";
export { Scroll } from "@phosphor-icons/react/dist/icons/Scroll";
export { ShieldCheck } from "@phosphor-icons/react/dist/icons/ShieldCheck";
export { ShieldWarning } from "@phosphor-icons/react/dist/icons/ShieldWarning";
export { SignOut } from "@phosphor-icons/react/dist/icons/SignOut";
export { Skull } from "@phosphor-icons/react/dist/icons/Skull";
export { Sparkle } from "@phosphor-icons/react/dist/icons/Sparkle";
export { SpeakerHigh } from "@phosphor-icons/react/dist/icons/SpeakerHigh";
export { SpeakerSlash } from "@phosphor-icons/react/dist/icons/SpeakerSlash";
export { Stack } from "@phosphor-icons/react/dist/icons/Stack";
export { Storefront } from "@phosphor-icons/react/dist/icons/Storefront";
export { Sun } from "@phosphor-icons/react/dist/icons/Sun";
export { Sword } from "@phosphor-icons/react/dist/icons/Sword";
export { Translate } from "@phosphor-icons/react/dist/icons/Translate";
export { UploadSimple } from "@phosphor-icons/react/dist/icons/UploadSimple";
export { Trophy } from "@phosphor-icons/react/dist/icons/Trophy";
export { User } from "@phosphor-icons/react/dist/icons/User";
export { UsersThree } from "@phosphor-icons/react/dist/icons/UsersThree";
export { Wall } from "@phosphor-icons/react/dist/icons/Wall";
export { Warning } from "@phosphor-icons/react/dist/icons/Warning";
export { X } from "@phosphor-icons/react/dist/icons/X";
