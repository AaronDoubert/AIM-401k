# Teaser: "LOCK-ON"

An 8-second teaser for AIM-401k, in three formats:

| File | Size | For |
|---|---|---|
| `renders/aim401k-teaser-9x16.mp4` | 1080×1920 | Reels, TikTok, Shorts, Stories |
| `renders/aim401k-teaser-1x1.mp4` | 1080×1080 | X, LinkedIn, Instagram feed |
| `renders/aim401k-teaser-16x9.mp4` | 1920×1080 | Website, YouTube, README |

Each format also has three stills (`-fill`, `-hold`, `-end`) that work as posters or thumbnails.

## What happens

1. **0–3.3 s, fill.** A job application on a generic careers portal. Reticles lock onto each field and it fills from the profile. The pace speeds up across three form pages, from a full résumé upload to an AI-drafted answer (dashed amber), until the fields blur. The `FIELDS` counter climbs.
2. **3.3–5.3 s, hold.** One question can't be answered for you. Its field locks red, the page dims around it, the master caution lights and chimes, and the on-page box arrives with the question.
3. **5.3–8.3 s, end card.** Hard cut to black. The banner's crosshair lines converge on the 0 of the wordmark, the 0 snaps in, the check draws, then the full mark appears. The tagline types out, followed by "Fills the applications. Calls you when it counts."

The last frame cuts cleanly back to the first, so it loops.

## How it's built

- `teaser.html` draws every frame as a pure function of time (`TEASER.seek(t)`). There are no CSS animations, so a render is exact and repeatable.
- The job portal is a generic applicant-tracking page for a fictional company, Initech, with no real vendor's name or logo. The applicant, employer and school are fictional too.
- Everything AIM-401k is real:
  - the mark and wordmark are loaded from `brand/`, never redrawn;
  - the reticle colours match `src/content/index.ts`;
  - the on-page box copies the layout and wording of `src/content/overlay.ts`;
  - the master caution flash matches the War Room;
  - the sounds re-create `src/ui/warroom/sound.ts`.
- `render.mjs` steps through the page in headless Chromium, pipes PNG frames into ffmpeg, and synthesizes the soundtrack from the page's cue list (`TEASER.timeline()`).

## Re-rendering

Needs `pnpm install` (for the fonts), ffmpeg, and Playwright (a global install, as for `scripts/e2e.mjs`).

```bash
pnpm teaser                                        # all three formats, 60 fps
node promo/teaser/render.mjs --only 916            # one format: 916 | 11 | 169
node promo/teaser/render.mjs --stills --at 1,3.5   # PNG frames at those times
node promo/teaser/render.mjs --serve               # live preview with a scrubber
```

Timing lives in the `T` block of `teaser.html`. Field order and content live in `PAGES`.
