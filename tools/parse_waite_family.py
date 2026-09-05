"""Parse the two Rider-Waite texts: Waite's Pictorial Key and De Laurence.

De Laurence (1918) is a close reworking of Waite (1910), so both books share a
skeleton and one parser handles them with only a little per-book config:

    Part 2 §2  The Trumps Major and Their Inner Symbolism  -> imagery for majors
    Part 3 §2  The Lesser Arcana                           -> imagery + meanings
    Part 3 §3  The Greater Arcana and Their Divinatory     -> meanings for majors
    Part 3 §4  Some Additional Meanings of the Lesser      -> extra minor notes

Rather than matching each book's exact heading punctuation, we find regions by
a loose regex on the heading text and then detect card titles by asking
cards.find() whether a short standalone line names a card.
"""

import re

import cards
import textutil as T

SOURCES = {
    "waite": {
        "id": "waite",
        "title": "The Pictorial Key to the Tarot",
        "author": "Arthur Edward Waite",
        "year": 1910,
        "rights": "public-domain",
        "tradition": "rws",
    },
    "delaurence": {
        "id": "delaurence",
        "title": "The Illustrated Key to the Tarot",
        "author": "L. W. De Laurence",
        "year": 1918,
        "rights": "public-domain",
        "tradition": "rws",
    },
}

# Order matters: the first pattern that matches a heading claims it, so the
# more specific "additional meanings of the lesser arcana" must be tested
# before the broader "the lesser arcana".
_REGIONS = [
    ("symbolism", r"trumps\s+major\s+and\s+their\s+inner\s+symbolism"),
    ("additional", r"additional\s+meanings\s+of\s+the\s+lesser"),
    ("majors", r"greater\s+arcana\s+and\s+their\s+divinatory"),
    ("minors", r"the\s+lesser\s+arcana(?!\s+in\s+respect)"),
    ("celtic", r"ancient\s+celtic\s+method"),
    ("stop", r"^(?:bibliography|the\s+full\s+project\s+gutenberg|notes)\b"),
]

_HEADING = re.compile(r"^#{1,6}\s+(.*\S)\s*$")
# Tolerates the "Divanatory Meanings" typo in the Waite epub (Five of Cups).
_DIVINATORY = re.compile(r"\*?\s*Div\w{0,3}natory\s+Meanings?\s*\*?\s*:?\s*", re.I)
_REVERSED = re.compile(r"\*?\s*Reversed\s*\*?\s*:\s*", re.I)
_NUMBERED = re.compile(
    rf"^(\d{{1,2}}|{cards.ENUMERATOR_WORDS})\s*\.\s*(.+)$", re.I)
_SUIT_HEADER = re.compile(
    r"^\**\s*(?:the\s+suit\s+of\s+)?(wands?|cups?|swords?|pentacles?|coins?)\s*\**\s*\.?\s*$",
    re.I)


def _find_regions(lines):
    """Map region name -> (start, end) line indices, based on headings."""
    marks = []
    for i, line in enumerate(lines):
        m = _HEADING.match(line)
        if not m:
            continue
        text = cards.normalize(T.strip_emphasis(m.group(1)))
        for name, pattern in _REGIONS:
            if re.search(pattern, text):
                marks.append((i, name))
                break

    regions = {}
    for idx, (start, name) in enumerate(marks):
        end = marks[idx + 1][0] if idx + 1 < len(marks) else len(lines)
        # A region can appear twice (e.g. a contents entry); keep the longest.
        if name not in regions or (end - start) > (regions[name][1] - regions[name][0]):
            regions[name] = (start, end)
    return regions


_ENUMERATOR = re.compile(
    rf"^(?:\d{{1,2}}|[ivxl]{{1,6}}|{cards.ENUMERATOR_WORDS})\s*[.):\-]*\s*", re.I)


def _is_title_line(line, want=None):
    """If a short standalone line names a card, return its id.

    Matching is strict: after stripping markup and any leading enumerator, the
    *entire* line must equal a known alias. cards.find() is deliberately not
    used here because its prefix fallbacks would let a prose sentence such as
    "Death. The card is..." register as a card heading.
    """
    text = T.strip_emphasis(T.unescape_md(line)).strip()
    text = text.strip("*_# ").strip()
    if not text or len(text) > 60:
        return None

    key = cards.normalize(text.rstrip("."))
    key = _ENUMERATOR.sub("", key).strip()
    card_id = cards.ALIAS_INDEX.get(key)
    if not card_id:
        return None
    if want and cards.BY_ID[card_id]["arcana"] != want:
        return None
    return card_id


def _split_meanings(body):
    """Separate a card body into (description, upright, reversed)."""
    body = T.clean(body)
    description, meanings = body, ""
    m = _DIVINATORY.search(body)
    if m:
        description, meanings = body[:m.start()], body[m.end():]

    upright, reversed_ = meanings, ""
    r = _REVERSED.search(meanings)
    if r:
        upright, reversed_ = meanings[:r.start()], meanings[r.end():]
    elif not meanings:
        # Some entries carry only a "Reversed" note appended to the description.
        r = _REVERSED.search(description)
        if r:
            description, reversed_ = description[:r.start()], description[r.end():]

    return (T.reflow(T.strip_emphasis(description)),
            T.reflow(T.strip_emphasis(upright)),
            T.reflow(T.strip_emphasis(reversed_)))


def _parse_block_region(lines, want=None):
    """Walk a region collecting {card_id: body} keyed on detected title lines."""
    blocks, current, buffer = {}, None, []
    for line in lines:
        stripped = line.strip()
        if not stripped or set(stripped) <= {"*", "\\", "-", "—", "="}:
            if current:
                buffer.append("")
            continue
        card_id = _is_title_line(stripped, want=want)
        if card_id:
            if current and card_id != current:
                blocks.setdefault(current, "\n".join(buffer))
            if card_id not in blocks:
                current, buffer = card_id, []
            else:
                current, buffer = None, []
            continue
        if current:
            buffer.append(stripped)
    if current:
        blocks.setdefault(current, "\n".join(buffer))
    return blocks


def _parse_numbered_majors(lines, tradition):
    """Parse '1. THE MAGICIAN.--Skill... Reversed: ...' style entries."""
    out = {}
    chunks, buffer = [], []
    for raw in lines:
        # De Laurence emphasises the enumerator itself ("*Zero.* *The Fool.*"),
        # so emphasis has to come off before the numbering can be matched.
        stripped = T.strip_emphasis(T.unescape_md(raw)).strip()
        if _NUMBERED.match(stripped):
            if buffer:
                chunks.append(" ".join(buffer))
            buffer = [stripped]
        elif buffer:
            buffer.append(stripped)
    if buffer:
        chunks.append(" ".join(buffer))

    for chunk in chunks:
        m = _NUMBERED.match(chunk)
        if not m:
            continue
        token = m.group(1).lower()
        number = (int(token) if token.isdigit()
                  else cards.WORD_NUMBERS.get(token, -1))
        rest = m.group(2)
        rest = T.unescape_md(rest)
        split = re.split(r"\s*[—–]\s*|\s*-{1,2}\s*(?=[A-Z])", rest, maxsplit=1)
        title = T.strip_emphasis(split[0]).strip(" .*")
        body = split[1] if len(split) > 1 else ""

        card_id = cards.find(title)
        if not card_id and 0 <= number <= 21:
            card_id = cards.major_by_roman(cards.ROMAN[number], tradition)
        if not card_id or cards.BY_ID[card_id]["arcana"] != "major":
            continue

        upright, reversed_ = body, ""
        r = _REVERSED.search(body)
        if r:
            upright, reversed_ = body[:r.start()], body[r.end():]
        out.setdefault(card_id, {
            "upright": T.reflow(T.strip_emphasis(T.clean(upright))),
            "reversed": T.reflow(T.strip_emphasis(T.clean(reversed_))),
        })
    return out


def _parse_additional(lines):
    """Parse §4, where a suit header sets context for following rank entries."""
    out, suit = {}, None
    text = "\n".join(lines)
    for para in re.split(r"\n\s*\n", text):
        para = T.unescape_md(para.strip())
        if not para:
            continue

        header = _SUIT_HEADER.match(para.split("\n")[0].strip())
        if header:
            suit = cards.find(f"ace of {header.group(1).lower()}")
            suit = cards.BY_ID[suit]["suit"] if suit else None
            continue

        # "WANDS. *King*.--text" restates the suit inline.
        m = re.match(r"^\**\s*([A-Za-z]+)\s*\**\s*\.\s*(.+)$", para)
        lead = None
        if m:
            probe = cards.find(f"ace of {m.group(1).lower()}")
            if probe:
                suit = cards.BY_ID[probe]["suit"]
                lead = m.group(2)
        body = lead if lead is not None else para

        rm = re.match(r"^\**\s*\*?([A-Za-z]+)\*?\s*\**\s*\.?\s*[—–-]{1,2}\s*(.+)$",
                      T.strip_emphasis(body), flags=re.S)
        if not (rm and suit):
            continue
        card_id = cards.find(f"{rm.group(1)} of {suit}")
        if not card_id:
            continue
        note = rm.group(2)
        upright, reversed_ = note, ""
        r = _REVERSED.search(note)
        if r:
            upright, reversed_ = note[:r.start()], note[r.end():]
        out.setdefault(card_id, {
            "upright": T.reflow(T.clean(upright)),
            "reversed": T.reflow(T.clean(reversed_)),
        })
    return out


def parse(path, source_key):
    tradition = SOURCES[source_key]["tradition"]
    lines = open(path, encoding="utf-8").read().split("\n")
    regions = _find_regions(lines)

    def region(name):
        if name not in regions:
            return []
        start, end = regions[name]
        return lines[start + 1:end]

    minors = _parse_block_region(region("minors"), want="minor")
    symbolism = _parse_block_region(region("symbolism"), want="major")
    majors = _parse_numbered_majors(region("majors"), tradition)
    additional = _parse_additional(region("additional"))

    entries = {}
    for card_id, body in minors.items():
        description, upright, reversed_ = _split_meanings(body)
        entries[card_id] = {"description": description,
                            "upright": upright, "reversed": reversed_}

    for card_id, body in symbolism.items():
        entries.setdefault(card_id, {})["description"] = T.reflow(
            T.strip_emphasis(T.clean(body)))

    for card_id, data in majors.items():
        entry = entries.setdefault(card_id, {})
        entry["upright"] = data["upright"]
        entry["reversed"] = data["reversed"]

    for card_id, data in additional.items():
        entry = entries.setdefault(card_id, {})
        if data["upright"]:
            entry["additional"] = data["upright"]
        if data["reversed"] and not entry.get("reversed"):
            entry["reversed"] = data["reversed"]
        elif data["reversed"]:
            entry["additional_reversed"] = data["reversed"]

    return {k: v for k, v in entries.items() if any(v.values())}


def celtic_cross_text(path):
    """Return the raw §7 Celtic Cross description, used to label spread slots."""
    lines = open(path, encoding="utf-8").read().split("\n")
    regions = _find_regions(lines)
    if "celtic" not in regions:
        return ""
    start, end = regions["celtic"]
    return T.reflow(T.clean("\n".join(lines[start + 1:end])))


if __name__ == "__main__":
    import json
    import sys

    targets = [
        ("waite", "tarot book resources/arthur-edward-waite_pictorial-key-to-the-tarot.md"),
        ("delaurence", "tarot book resources/pg43548-images-3.md"),
    ]
    for key, path in targets:
        result = parse(path, key)
        missing = [c["id"] for c in cards.CARDS if c["id"] not in result]
        no_upright = [c for c, e in result.items() if not e.get("upright")]
        no_desc = [c for c, e in result.items() if not e.get("description")]
        print(f"{key:12} parsed {len(result)}/78  "
              f"missing={len(missing)} no_upright={len(no_upright)} "
              f"no_description={len(no_desc)}")
        if missing:
            print(f"   MISSING: {missing[:12]}")
        if no_upright:
            print(f"   NO UPRIGHT: {no_upright[:12]}")
        if no_desc:
            print(f"   NO DESC: {no_desc[:12]}")
    print()
    print(json.dumps(parse(targets[0][1], "waite")["the-tower"], indent=2)[:1200])
