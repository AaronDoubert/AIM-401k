# AIM-401k brand kit

Everything here is final artwork. Use these files as they are; don't redraw, recolor or retype them.

<p>
  <img src="aim401k-x-banner-1500x500.png" alt="AIM-401k banner: the wordmark with crosshair lines locked onto the 0, and the tagline TALENT ACQUISITION, KINETICALLY." width="100%" />
</p>

## Files

| File | What it's for |
|---|---|
| `aim401k-wordmark-offwhite.svg` | The full logo, for dark backgrounds. The extension UI uses this one. |
| `aim401k-wordmark-black.svg` | The full logo, for light backgrounds. |
| `aim401k-mark-dark.svg` | The mark on a near-black square. The source of the extension icons. |
| `aim401k-mark-light.svg` | The mark on an off-white square. |
| `aim401k-mark-offwhite-transparent.svg` | The mark alone, for dark photos or pages. The on-page helper box uses it. |
| `aim401k-mark-black-transparent.svg` | The mark alone, for light photos or pages. |
| `aim401k-pfp-dark-400.png`, `-1200.png` | Profile picture, dark. |
| `aim401k-pfp-light-400.png`, `-1200.png` | Profile picture, light. |
| `aim401k-x-banner-1500x500.png` | X (Twitter) header. The crosshair lines lock onto the 0, and the tagline is set in Geist Mono. |

**On X:** use `aim401k-pfp-dark-1200.png` as the profile picture and `aim401k-x-banner-1500x500.png` as the header.

## Rules

**Logo.** The logo is always the supplied artwork, never typed out. In running text, the name is written `AIM-401k`.

**Type.**

- Headlines and body text are **Geist**.
- Labels, stats and captions are **Geist Mono**, in caps, with wide letter spacing (about 0.14em; 0.22em for taglines).

Both are free under the SIL Open Font License, including for commercial use and on the web. Get them from [Google Fonts](https://fonts.google.com/specimen/Geist) or [Vercel](https://vercel.com/font). The extension bundles them from the `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` packages, so nothing loads from a CDN.

**Color.**

| | Hex | Use |
|---|---|---|
| Near-black | `#0C0C0B` | Backgrounds |
| Off-white | `#F1EDE4` | Text, logo, primary buttons |
| Grey | `#A19D94` | Secondary text |

The extension also uses three muted signal colors, only to show status and never as decoration: green `#86C095` (done), amber `#DCAE5E` (waiting on you) and red `#EC5F48` (needs you now, errors).

## In the code

- `static/styles.css` holds the tokens (`--ink`, `--paper`, `--grey` and the derived surfaces) and the type rules for every extension page.
- `scripts/build.mjs` copies the wordmark and mark from this folder into the build.
- `static/icons/icon-*.png` are rendered from `aim401k-mark-dark.svg`.
- `src/shared/brand.ts` inlines `aim401k-mark-offwhite-transparent.svg` for the on-page helper box. `test/brand.test.ts` fails if it drifts from the file here.
