# Tarot Reader

Draw tarot cards and get a reading grounded in four tarot books. Runs as an
installable web app you add to your iPhone home screen; readings are written by
`gemma4:31b-cloud` through your local Ollama, or composed straight from the
books when no model is available.

## Running it

```sh
npm start                 # http://localhost:8000
npm start -- --port 8123  # any other port
```

The server prints two URLs — a local one and one for your phone:

```
  local     http://localhost:8123
  on phone  http://192.168.1.37:8123
```

### On the iPhone

1. Make sure the phone is on the same Wi-Fi as this Mac.
2. Open the `on phone` URL in Safari.
3. Share → **Add to Home Screen**.

It then launches full-screen with its own icon, like any other app.

The Mac needs to be awake and running `npm start` for the phone to reach it.
That is also what keeps your Ollama credential off the phone — see below.

## Why there is a server

Two things make a plain static page insufficient:

- **CORS.** `ollama.com` sends no `Access-Control-Allow-Origin` header, so a
  browser page cannot call it directly.
- **Credentials.** Routing through the Ollama daemon on this Mac means the
  cloud credential never leaves the machine, and the phone never holds a key.

`server.js` therefore serves the app *and* proxies `/api/chat` and
`/api/models` to `http://127.0.0.1:11434`. That is one origin, so there is no
CORS problem, and the daemon needs no reconfiguring.

If Ollama is unreachable the app says so and falls back to composing readings
from the books directly — it never fails to give you a reading.

## The books

The corpus is built from the markdown in `tarot book resources/`:

| Book | Author | Year | Rights |
|---|---|---|---|
| The Pictorial Key to the Tarot | A. E. Waite | 1910 | public domain |
| The Illustrated Key to the Tarot | L. W. De Laurence | 1918 | public domain |
| General Book of the Tarot | A. E. Thierens | 1930 | public domain |
| The Tarot of the Bohemians | Papus | 1889 | public domain |

All four cover all 78 cards, and all are public domain — this build is safe to
share or host publicly.

The corpus can also be built with a fifth, commercial guidebook (Dark Forest)
for personal use — its markdown is still in `tarot book resources/`, just no
longer in `FILES` in `tools/build_corpus.py`. Add its entry back and rebuild
(`npm run corpus`) to restore it locally; never redistribute a build that
includes it.

## Deploying it as a static site

The compose-only reading path (`composeOffline`) needs no server, no Ollama,
and no API key — it's plain data and JS, so `app/` is a complete static site
on its own. Point any static host at the `app/` directory:

```sh
# from the project root
npx serve app              # quick local check of the static build
```

GitHub Pages, Netlify, Vercel, or Cloudflare Pages all work the same way:
deploy the contents of `app/`, nothing else. `useModel` defaults to `false`,
so visitors get a composed reading immediately; if a visitor turns "Use AI
model" on anyway, the app tries `/api/chat`, finds no server there, and falls
back to the same composed reading with a note explaining why — it never
breaks, it just quietly can't reach a model that was never part of this
deploy. `server.js` and the Ollama proxy remain for running it locally with
your own model; a static deploy doesn't need or include them.

### Rebuilding the corpus

```sh
npm run corpus     # tools/build_corpus.py -> app/corpus.json
```

It prints per-book coverage and warns about any card a book fails to yield:

```
source coverage: darkforest=78/78, waite=78/78, delaurence=78/78,
                 thierens=78/78, papus=78/78
all 78 cards complete across all five books
```

## How a reading is made

Both paths use the same passages, so a reading is always anchored to the books:

- **Composed** (`composeOffline`) — the guidebook's prose for the card in that
  orientation, one corroborating quote from an older book, the keywords, then
  computed notes on how the cards relate, and a closing action.
- **Generated** (`buildMessages` → Ollama) — the same passages are packed into
  the prompt as the *only* permitted source of meaning, along with the position
  prompts and the computed patterns. The model weaves them into one narrative
  and cites the books inline.

The pattern notes cover major-arcana density, a dominant suit, the share of
reversals, repeated numbers and court cards.

## Layout

```
app/                 the web app (this is what gets served)
  index.html         shell and sheets
  styles.css         dark-forest theme, system fonts only
  corpus.json        generated — all 78 cards, all five books
  cards/             generated — the 78 RWS scans as WebP
  js/art.js          the scan layer plus the drawn fallback faces
  js/deck.js         shuffle and draw
  js/reading.js      offline composer + grounded prompt builder
  js/ollama.js       streaming client for the proxy
  js/store.js        settings and journal (localStorage)
  js/ui.js           DOM helpers, safe Markdown renderer
  js/app.js          controller
  sw.js              offline cache
server.js            static server + Ollama proxy
tools/               corpus parsers, card fetcher, icon generator, tests
```

Each book gets its own parser (`tools/parse_*.py`) because each was converted
from a different source: the Dark Forest guidebook came from a PDF and needs
paragraph reflow and page-furniture stripping, while the Global Grey and
Gutenberg epubs are clean but use escaped markdown and older card names
(*The Juggler*, *The Pope*, *The Foolish Man*). `tools/cards.py` holds the
canonical 78 cards and resolves all of those names — including the two books
that use the Marseille ordering, where VIII is Justice and XI is Strength.

## Tests

```sh
npm test           # 32 checks: art, scans, deck, excerpting, readings, prompts, markdown
npm run test:e2e   # real draw -> prompt -> Ollama -> reading (needs the server up)
```

## Card art

The deck is the **1909 Rider-Waite-Smith** — William Rider & Son's first
edition, drawn by Pamela Colman Smith. It is public domain (published 1909;
Smith died in 1951), and it is the imagery every one of these books is
describing, so the pictures and the text finally agree with each other.

```sh
npm run cards      # tools/fetch_cards.mjs -> app/cards/*.webp
```

That pulls the 78 scans from the Wikimedia Commons category
[Rider-Waite tarot deck (Roses & Lilies)][cat] and re-encodes them to WebP.
Filenames in that category are perfectly regular (`RWS1909 - 00 Fool.jpeg`,
`RWS1909 - Cups 01.jpeg`), so the script maps them onto corpus card ids with no
hand-written table, and fails loudly if any of the 78 goes unmatched.

Originals are cached in `.cards-src/`, so re-running is free and re-tuning the
output costs nothing:

```sh
node tools/fetch_cards.mjs --width 720 --quality 88   # re-encode, no downloads
node tools/fetch_cards.mjs --force                     # refetch from Commons
```

Wikimedia rate-limits a burst from one address hard (429 with a ten-minute
`retry-after`), so the script paces itself and waits out any limit it hits. A
run that is interrupted resumes where it stopped.

Two things to know about the licensing:

- Take the **1909** scans, not the 1971 US Games recolouring, which is
  separately copyrighted. US Games also holds the *Rider-Waite* trademark, so
  credit the art as "Rider-Waite-Smith, 1909" or to Pamela Colman Smith.
- Convenience mirrors of this deck exist on GitHub, but some license the
  *repository* under terms stricter than the public-domain images inside it.
  Pulling from Commons keeps the provenance clean.

The drawn faces in `app/js/art.js` have not gone away — `cardArt()` layers the
scan *over* the drawn card rather than replacing it, so a scan that is missing,
still downloading, or blocked falls back to the drawn face with no JavaScript
and no empty rectangle. `npm test` fails if any of the 78 scans is absent.

[cat]: https://commons.wikimedia.org/wiki/Category:Rider-Waite_tarot_deck_(Roses_%26_Lilies)

## Cards you dealt yourself

If you own a physical deck, shuffle and deal it on the table, then tap
**I dealt the cards myself** under the deck. You get one row per position in
the chosen spread; each opens a searchable picker — type `moon`, `7 cups`,
`king wands` — and has its own **Reversed** toggle, since orientation is
something you can see on the table rather than something to simulate. A card
already placed in the spread cannot be placed twice.

From there it is the same reading path as a drawn spread, and the journal marks
those entries **by hand** so you can tell them apart later.

## Notes

- Everything is stored on the device in `localStorage`; nothing is uploaded.
- The service worker only registers over https or on localhost, so the phone
  (reached over plain http by LAN IP) runs without the offline cache.
- Reversals are per-card, the way cards fall when a shuffled deck is dealt.

## If you want a native iPhone app later

`app/corpus.json` is the reusable part — it is plain data with no web
dependencies. A SwiftUI app would bundle it as a resource and reimplement only
the view layer; `reading.js` maps directly onto a Swift reading engine. That
route needs Xcode installed (it is not on this Mac right now) and gets you App
Store distribution and true offline use.
