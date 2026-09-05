#!/usr/bin/env python3
"""Build app/corpus.json from the markdown books in 'tarot book resources'.

Run from the project root:

    python3 tools/build_corpus.py

Every card ends up with a display layer (keywords, hook, upright/reversed
prose) drawn from the most readable source available, plus a `sources` map
holding each book's own words. The app shows the display layer; the reading
engine quotes from `sources`, which is also what gets sent to the model as
grounding so a generated reading stays anchored to the books.
"""

import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cards
import parse_darkforest
import parse_papus
import parse_thierens
import parse_waite_family
import textutil as T

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOKS = os.path.join(ROOT, "tarot book resources")

FILES = {
    "waite": "arthur-edward-waite_pictorial-key-to-the-tarot.md",
    "delaurence": "pg43548-images-3.md",
    "thierens": "a-e-thierens_general-book-of-the-tarot.md",
    "papus": "papus_absolute-key-to-occult-science-the-tarot-of-the-bohemians.md",
}

SPREADS = [
    {
        "id": "daily",
        "name": "Daily Draw",
        "count": 1,
        "blurb": "One card, one clear question. The most underrated reading there is.",
        "layout": "single",
        "positions": [
            {"name": "Today", "prompt": "What do I need to know today?"},
        ],
    },
    {
        "id": "past-present-future",
        "name": "Past · Present · Future",
        "count": 3,
        "blurb": "How you got here, where you are, where it's heading.",
        "layout": "row",
        "positions": [
            {"name": "Past", "prompt": "What brought this about."},
            {"name": "Present", "prompt": "Where the matter stands now."},
            {"name": "Future", "prompt": "Where it is heading if nothing changes."},
        ],
    },
    {
        "id": "situation-action-outcome",
        "name": "Situation · Action · Outcome",
        "count": 3,
        "blurb": "What's going on, what you can do, where that leads.",
        "layout": "row",
        "positions": [
            {"name": "Situation", "prompt": "What is actually going on."},
            {"name": "Action", "prompt": "What you can do about it."},
            {"name": "Outcome", "prompt": "Where that action leads."},
        ],
    },
    {
        "id": "mind-body-spirit",
        "name": "Mind · Body · Spirit",
        "count": 3,
        "blurb": "A gentle check-in across the three.",
        "layout": "row",
        "positions": [
            {"name": "Mind", "prompt": "What your thinking needs."},
            {"name": "Body", "prompt": "What your body is asking for."},
            {"name": "Spirit", "prompt": "What your spirit is reaching toward."},
        ],
    },
    {
        "id": "cross-five",
        "name": "The Simple Cross",
        "count": 5,
        "blurb": "The situation at the centre, what helps, what hinders, the root, the likely path.",
        "layout": "cross5",
        "positions": [
            {"name": "The Situation", "prompt": "The heart of the matter."},
            {"name": "What Helps", "prompt": "The support already available to you."},
            {"name": "What Hinders", "prompt": "What stands in the way."},
            {"name": "The Root", "prompt": "What this actually grew from."},
            {"name": "The Likely Path", "prompt": "Where this tends if it runs on."},
        ],
    },
    {
        "id": "celtic-cross",
        "name": "The Celtic Cross",
        "count": 10,
        "blurb": "Waite's ancient Celtic method, in his own ten positions.",
        "layout": "celtic",
        "positions": [
            {"name": "This covers you", "prompt": "The influence at work in the matter."},
            {"name": "This crosses you", "prompt": "The opposing force, for good or ill."},
            {"name": "This crowns you", "prompt": "What may yet come about, the ideal in the matter."},
            {"name": "This is beneath you", "prompt": "What you have made your own, the foundation."},
            {"name": "This is behind you", "prompt": "The influence that is now passing away."},
            {"name": "This is before you", "prompt": "The influence coming into action in the near future."},
            {"name": "Yourself", "prompt": "How you stand in the circumstances."},
            {"name": "Your house", "prompt": "Your environment, and the people around it."},
            {"name": "Your hopes and fears", "prompt": "What you long for, and what you dread."},
            {"name": "What will come", "prompt": "The culmination the other cards lead to."},
        ],
    },
]


def _load_all():
    df = (parse_darkforest.parse(os.path.join(BOOKS, FILES["darkforest"]))
          if "darkforest" in FILES else {})
    waite = parse_waite_family.parse(os.path.join(BOOKS, FILES["waite"]), "waite")
    dela = parse_waite_family.parse(os.path.join(BOOKS, FILES["delaurence"]), "delaurence")
    thier = parse_thierens.parse(os.path.join(BOOKS, FILES["thierens"]))
    papus = parse_papus.parse(os.path.join(BOOKS, FILES["papus"]))
    return {"darkforest": df, "waite": waite, "delaurence": dela,
            "thierens": thier, "papus": papus}


def _sources_meta():
    meta = {
        "waite": dict(parse_waite_family.SOURCES["waite"]),
        "delaurence": dict(parse_waite_family.SOURCES["delaurence"]),
        "thierens": dict(parse_thierens.SOURCE),
        "papus": dict(parse_papus.SOURCE),
    }
    if "darkforest" in FILES:
        meta["darkforest"] = dict(parse_darkforest.SOURCE)
    for key, value in meta.items():
        value["file"] = FILES[key]
    return meta

_ELEMENTS = ("Fire", "Water", "Air", "Earth")


def _element_from(correspondences):
    """Majors carry no suit, so take the element from the guidebook's
    correspondences line ("Fire · Mars · sixteen, sudden upheaval")."""
    if not correspondences:
        return ""
    head = correspondences.split("·")[0].strip()
    return head if head in _ELEMENTS else ""


def _first_nonempty(*values):
    for value in values:
        if value:
            return value
    return ""


def _build_card(card, parsed):
    df = parsed["darkforest"].get(card["id"], {})
    waite = parsed["waite"].get(card["id"], {})
    dela = parsed["delaurence"].get(card["id"], {})
    thier = parsed["thierens"].get(card["id"], {})
    papus = parsed["papus"].get(card["id"], {})

    entry = {
        "id": card["id"],
        "name": card["name"],
        "arcana": card["arcana"],
        "number": card["number"],
        "roman": card.get("roman"),
        "suit": card.get("suit"),
        "rank": card.get("rank"),
        "rankName": card.get("rank_name"),
        "court": bool(card.get("court")),
        "element": card.get("element") or _element_from(df.get("correspondences", "")),
        "correspondences": df.get("correspondences", ""),
        "attribution": thier.get("attribution", ""),
        "hook": df.get("hook", ""),
        "keywords": {
            "upright": df.get("keywords_upright", []),
            "reversed": df.get("keywords_reversed", []),
        },
        "upright": _first_nonempty(df.get("upright"), waite.get("upright"),
                                   dela.get("upright")),
        "reversed": _first_nonempty(df.get("reversed"), waite.get("reversed"),
                                    dela.get("reversed")),
        "picture": _first_nonempty(df.get("picture"), waite.get("description"),
                                   dela.get("description")),
        "inLife": df.get("in_life", {}),
        "reflection": df.get("reflection", ""),
        "affirmation": df.get("affirmation", ""),
        "advice": df.get("advice", ""),
        "asAPerson": df.get("as_a_person", ""),
        "timing": df.get("timing", ""),
        "leans": df.get("leans", ""),
        "sources": {},
    }

    if df:
        entry["sources"]["darkforest"] = {
            "picture": df.get("picture", ""),
            "upright": df.get("upright", ""),
            "reversed": df.get("reversed", ""),
            "advice": df.get("advice", ""),
            "inLife": df.get("in_life", {}),
        }
    for key, data in (("waite", waite), ("delaurence", dela)):
        if data:
            entry["sources"][key] = {
                "description": data.get("description", ""),
                "upright": data.get("upright", ""),
                "reversed": data.get("reversed", ""),
                "additional": data.get("additional", ""),
            }
    if thier:
        entry["sources"]["thierens"] = {
            "attribution": thier.get("attribution", ""),
            "tradition": thier.get("tradition", ""),
            "reversed": thier.get("reversed", ""),
            "theory": thier.get("theory", ""),
            "conclusion": thier.get("conclusion", ""),
            "commentary": thier.get("commentary", ""),
        }
    if papus:
        entry["sources"]["papus"] = {
            "divinatory": papus.get("divinatory", ""),
            "symbolism": papus.get("symbolism", ""),
        }

    # Drop empty strings so the JSON stays lean and the app can test truthiness.
    for source in entry["sources"].values():
        for key in [k for k, v in source.items() if not v]:
            del source[key]

    return entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=os.path.join(ROOT, "app", "corpus.json"))
    ap.add_argument("--indent", type=int, default=None,
                    help="pretty-print with this indent (default: compact)")
    args = ap.parse_args()

    parsed = _load_all()

    problems = []
    for key, entries in parsed.items():
        if key not in FILES:
            continue  # book deliberately excluded (see FILES), not a parsing gap
        missing = [c["id"] for c in cards.CARDS if c["id"] not in entries]
        if missing:
            problems.append(f"{key}: missing {len(missing)} cards -> {missing[:6]}")

    corpus = {
        "version": 1,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "sources": _sources_meta(),
        "spreads": SPREADS,
        "cards": [_build_card(card, parsed) for card in cards.CARDS],
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(corpus, fh, ensure_ascii=False, indent=args.indent)

    size = os.path.getsize(args.out)
    print(f"wrote {args.out}  ({size / 1024:.0f} KB, {len(corpus['cards'])} cards)")

    coverage = {key: sum(1 for c in corpus["cards"] if key in c["sources"])
                for key in FILES}
    print("source coverage: " + ", ".join(f"{k}={v}/78" for k, v in coverage.items()))

    # Keywords, hooks, and the other structured extras only ever come from
    # the Dark Forest guidebook, so they're expected to be empty when it's
    # excluded from FILES — that's not a parsing gap, just a leaner build.
    thin = [c["id"] for c in corpus["cards"] if not c["upright"] or not c["picture"]]
    if "darkforest" in FILES:
        thin += [c["id"] for c in corpus["cards"]
                 if c["id"] not in thin and not c["keywords"]["upright"]]
    if thin:
        problems.append(f"cards missing display text: {thin[:8]}")

    for problem in problems:
        print(f"WARNING: {problem}")
    if not problems:
        print(f"all 78 cards complete across all {len(FILES)} books")


if __name__ == "__main__":
    main()
