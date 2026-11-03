# OpenRelay site

The marketing page for OpenRelay, served at https://relay.openstuff.dev. Plain HTML on the OpenStuff
toolkit: it looks and behaves like every other OpenStuff project's page. No build step, no
trackers, no external requests.

```
index.html          the page: replace every [bracketed sentence] and "Replace:" comment
404.html            served by GitHub Pages for missing paths (root-absolute URLs)
favicon.svg         the project mark: the OpenStuff ring with this project's glyph
assets/site.css     this page's own styles, after the toolkit
assets/site.js      starts the toolkit's behaviour (glow, tap to play, copy buttons)
assets/logo.svg     the marks: OpenStuff, OpenStuff Design and OpenRelay
assets/og.svg       the source of assets/og.png (1200×630), the link preview
assets/os/          the toolkit copy (generated, don't edit)
openstuff-site.json what assets/os is generated from: the primary colour
```

Preview it with `python3 -m http.server` in this folder, then open http://localhost:8000.
(Opened from disk, browsers don't show the marks, because they block SVG `<use>` on `file://`.)

## Before you publish

1. Replace every `[bracketed sentence]` and `Replace:` comment in `index.html`, then search for
   `[` once more.
2. Delete the bento tiles you don't use, and keep 6 to 8.
3. Export `assets/og.svg` to `assets/og.png` at 1200×630, with any SVG-to-PNG tool or a browser
   screenshot. Check that the headline fits.
4. Check it at 360px wide, in light and dark, with the keyboard only, and with reduced motion on.

## Write the page

**The goal:** someone who lands on the page understands within 10 seconds what OpenRelay does,
sees that it's open source and self-hostable, believes it's better than what they do today, and
clicks **Try it free** or **Self-host it**.

- **Copy.** Short, plain sentences in the active voice, for a busy reader. Say what it does and
  what to do next. Concrete examples beat claims: `frontend/**`, "Amounts are integer øre, never
  floats", `acme/shop`. No buzzwords like "supercharge", "seamless" or "AI-powered".
- **The order of the page** is fixed, so every OpenStuff page reads the same: top bar, hero, the
  problem, the bento grid, how it works (three steps), why (a comparison), open source, teams and
  enterprises, FAQ, a final call to action, the footer. Leave a section out rather than add one.
- **Hero:** a short headline (the `<span class="os-soft">` line is its second half), one sentence,
  two buttons, a meta line, and a picture of the product at work: a terminal, an editor or a UI
  fragment with realistic data.
- **The problem:** show it, don't lecture. The three `.os-file` cards are copies of one file that
  drifted apart; use whatever shows today's pain best.
- **Bento grid:** tiles of mixed sizes (`data-span="2"`, `data-rows="2"`). Each has an
  illustration, a title and one sentence. The heart of the product gets the big tile
  (`data-size="lg"`).
- **The comparison** is honest: compare with how people work today, never name or criticise
  another product.

## Animate a tile

Tiles are still. A tile plays its illustration only while it is hovered, focused (give it
`tabindex="0"`) or tapped on a touch screen, then settles; on leave it eases back. Nothing else on
the page moves.

Mark what moves with `data-play`. The markup shows the **final** state; the toolkit holds each
element in its rest state until the tile plays, and with reduced motion people see the final
state straight away.

| `data-play` | Rest → final |
|---|---|
| `fade` | hidden → shown |
| `rise` | hidden, a little lower → in place |
| `slide` | hidden, a little to the left → in place |
| `pop` | hidden, small → full size |
| `grow` | collapsed → open (a new row joins a list) |
| `shrink` | open → collapsed (long text shortens) |
| `dim` | full → faded |
| `highlight` | plain → in the primary colour |
| `type` | empty → typed out; set `style="--chars: 20"` to the text's length |
| `fill` | a `.os-viz-meter` from `--rest` (0%) to `--value` |
| `pulse` | an SVG path in `.os-viz-wires`: a pulse runs along it |

Order things with `style="--d: 1"` (steps of 80ms) or `style="--os-play-delay: 600ms"`. Keep a
tile's whole animation under about a second, and make it show what the feature does.

The pieces to build with: `.os-viz` (with `data-layout="stack"` or `"split"`), `.os-viz-panel`,
`.os-viz-list` and `.os-viz-row`, `.os-viz-bubble`, `.os-viz-plates`, `.os-viz-tree`,
`.os-viz-flip`, `.os-viz-switch`, `.os-viz-wires`, `.os-viz-lines`, `.os-viz-meter`, `.os-term`,
and `.os-badge` from the toolkit. `index.html` has one tile for each pattern;
`@openstuff-dev/ui/marketing.css` documents them all.

When you need something the toolkit doesn't have, write it in `assets/site.css` with `--os-*`
tokens, and propose it for `@openstuff-dev/ui/marketing.css` in
[openstuff-dev/design](https://github.com/openstuff-dev/design) so the next page gets it too.

## The mark

Every OpenStuff mark is the same ring with a glyph inside it in the project's primary colour:
a dot for OpenStuff, a triangle for OpenPurpose, a rounded square for OpenStuff Design. This one
was generated with `--glyph`; make sure no other project uses the same shape. The wordmark is
"Open" plus the name in a heavier weight.

## Publish

`.github/workflows/pages.yml` publishes this folder on every push that changes it. Once:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. At the DNS provider for `openstuff.dev`, add a `CNAME` record for `relay.openstuff.dev` →
   `openstuff-dev.github.io`.
3. **Settings → Pages → Custom domain:** `relay.openstuff.dev`, then tick **Enforce HTTPS**. (Deploys
   through Actions ignore a `CNAME` file, so there isn't one.)

## Update the toolkit

`assets/os` is generated from `@openstuff-dev/ui` and the colour in `openstuff-site.json`. To pick
up a newer toolkit or a new colour:

```sh
npx nx g @openstuff-dev/nx:sync
```
