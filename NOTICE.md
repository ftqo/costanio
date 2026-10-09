# Licensing notice

This repository contains material under several licences. This file maps each part
of the tree to its licence. When a path is not listed here, it is source code under
the MIT License.

## Source code: MIT

Everything that is software is licensed under the [MIT License](LICENSE),
Copyright (c) 2026 ftqo. That includes the Go backend, the React frontend's
source, tests, scripts, build and deployment configuration, the tooling under
`tools/`, the Blender scripts under `art/` (`*.py`), and the documentation under
`docs/`.

## Art, models, sounds and translations: CC BY-NC-SA 4.0

The following are licensed under the
[Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](LICENSE-ASSETS)
licence (CC BY-NC-SA 4.0), Copyright (c) 2026 ftqo:

| Path | What it is |
|---|---|
| `art/` (except `*.py` scripts and `art/cards/tools/fonts/`) | Blender sources (`*.blend`), card art masters, concept and prototype renders, recipes |
| `frontend/public/models/` | The 3D board pieces and tiles (`*.glb`) |
| `frontend/public/assets/` | Card art, resource icons and sound effects |
| `frontend/public/favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `og-image.png`, `og-image.gif` | Site icons and link-preview images |
| `frontend/src/locales/<language>/` (every language other than `en`) | The translated message catalogues |

Attribution: "costan, by ftqo (https://github.com/ftqo/costan.io)", with a link
to the licence and an indication of any changes. Non-commercial use only, and
adaptations must be shared under the same licence.

## Fonts: SIL Open Font License 1.1

Each font is under the SIL Open Font License, Version 1.1. The licence text,
with each font's copyright notice, ships next to the font files.

| Font | Files | Licence file |
|---|---|---|
| Baloo 2 | `frontend/public/fonts/baloo2-*.woff2` | `frontend/public/fonts/OFL-Baloo2.txt` |
| Nunito | `frontend/public/fonts/nunito-*.woff2` | `frontend/public/fonts/OFL-Nunito.txt` |
| Vollkorn SC | `frontend/public/fonts/vollkornsc-*.woff2` | `frontend/public/fonts/OFL-VollkornSC.txt` |
| Noto Serif JP | `frontend/public/fonts/notoserifjp-titles.woff2` | `frontend/public/fonts/OFL-NotoSerifJP.txt` |
| Noto Serif SC | `frontend/public/fonts/notoserifsc-titles.woff2` | `frontend/public/fonts/OFL-NotoSerifSC.txt` |
| Noto Serif Devanagari | `frontend/public/fonts/notoserifdevanagari-titles.woff2` | `frontend/public/fonts/OFL-NotoSerifDevanagari.txt` |
| Gelasio | `art/cards/tools/fonts/Gelasio-Bold.ttf` | `art/cards/tools/fonts/OFL.txt` |

The `.woff2` files are subsets of the original fonts.

## Third-party dependencies

Go modules (`go.mod`) and npm packages (`frontend/package.json`) are not vendored
in this repository. Each is under its own licence, as published by its authors.

## Trademarks and affiliation

costan is an independent project. It is not affiliated with, endorsed by, or
sponsored by the publishers or rights holders of any commercial board game. Game
mechanics are not subject to copyright; all names, text, art, models and sounds
in this repository are original to this project or used under the licences
listed above.
