"""Parse Papus, The Tarot of the Bohemians (1889 / trans. 1896).

Three useful regions:

  Chapters X-XIII  "The Symbolical Tarot"  -- long symbolic essays per major,
                   headed "#### 16. The Lightning-Struck Tower".
  Second Lesson    minor arcana for divination. A suit header sets context and
                   bare rank lines follow:
                       SCEPTRES.
                       KING OF SCEPTRES. *A dark man, a friend*.
                       TWO. *Opposition to the commencement*.
  Third Lesson     major arcana one-liners:
                       1. *The Juggler* signifies MALE INQUIRER.

Papus uses the Marseille ordering and older card names (Juggler, Pope,
Foolish Man), all of which are registered as aliases in cards.py, so headings
resolve by name and the numerals are never trusted.
"""

import re

import cards
import textutil as T

SOURCE = {
    "id": "papus",
    "title": "The Tarot of the Bohemians",
    "author": "Papus (Gerard Encausse)",
    "year": 1889,
    "rights": "public-domain",
    "tradition": "marseille",
}

_HEADING = re.compile(r"^(#{3,6})\s+(.*\S)\s*$")
_ENUM = re.compile(r"^(?:\d{1,2}|[ivxl]{1,6})\s*[.):\-]*\s*", re.I)

_RANK_WORDS = {
    "king": "King", "queen": "Queen", "knight": "Knight",
    "knave": "Page", "page": "Page", "valet": "Page",
    "ace": "Ace", "two": "Two", "three": "Three", "four": "Four",
    "five": "Five", "six": "Six", "seven": "Seven", "eight": "Eight",
    "nine": "Nine", "ten": "Ten",
}
_RANK_RE = "|".join(sorted(_RANK_WORDS, key=len, reverse=True))
_RANK_LINE = re.compile(
    rf"^\**\s*({_RANK_RE})\b(?:\s+OF\s+([A-Za-z]+))?\s*\**\s*[.:]\s*(.*)$", re.I)
_SUIT_LINE = re.compile(r"^\**\s*([A-Za-z]+)\s*\**\s*\.\s*$")
_SIGNIFIES = re.compile(r"^(\d{1,2})\s*\.\s*(.+?)\s+signifies\s+(.*)$", re.I)


def _suit_of(word):
    probe = cards.find(f"ace of {word.lower()}")
    return cards.BY_ID[probe]["suit"] if probe else None


def _resolve_heading(text):
    text = T.strip_emphasis(T.unescape_md(T.strip_heading(text)))
    segments = [s.strip() for s in re.split(r"\.\s*", text) if s.strip()]
    for i in range(len(segments)):
        for j in range(len(segments), i, -1):
            raw = cards.normalize(" ".join(segments[i:j]))
            for key in (raw, _ENUM.sub("", raw).strip()):
                if key in cards.ALIAS_INDEX:
                    return cards.ALIAS_INDEX[key]
    return None


def _region_bounds(lines, start_pat, end_pat):
    start = end = None
    for i, line in enumerate(lines):
        m = _HEADING.match(line)
        if not m:
            continue
        text = cards.normalize(T.strip_emphasis(m.group(2)))
        if start is None and re.search(start_pat, text):
            start = i
        elif start is not None and re.search(end_pat, text):
            end = i
            break
    if start is None:
        return None
    return start, (end if end is not None else len(lines))


def _parse_symbolic(lines):
    """Long per-major essays from chapters X-XIII."""
    marks = []
    for i, line in enumerate(lines):
        m = _HEADING.match(line)
        if not m:
            continue
        marks.append((i, _resolve_heading(line)))

    entries = {}
    for idx, (start, card_id) in enumerate(marks):
        end = marks[idx + 1][0] if idx + 1 < len(marks) else len(lines)
        if not card_id or card_id in entries:
            continue
        if cards.BY_ID[card_id]["arcana"] != "major":
            continue
        body = T.reflow(T.strip_emphasis(T.clean("\n".join(lines[start + 1:end]))))
        if body:
            entries[card_id] = {"symbolism": body}
    return entries


def _parse_minor_lesson(lines):
    """Minor arcana meanings, where a suit header scopes the rank lines."""
    entries, suit, current, buffer = {}, None, None, []

    def flush():
        if current and current not in entries:
            text = T.reflow(T.strip_emphasis(T.clean("\n".join(buffer))))
            if text:
                entries[current] = {"divinatory": text}

    for raw in lines:
        line = T.unescape_md(raw.strip())
        if not line:
            if current:
                buffer.append("")
            continue

        rank_match = _RANK_LINE.match(line)
        if rank_match:
            rank = _RANK_WORDS[rank_match.group(1).lower()]
            named_suit = _suit_of(rank_match.group(2)) if rank_match.group(2) else None
            use_suit = named_suit or suit
            if use_suit:
                flush()
                suit = use_suit
                current = cards.find(f"{rank} of {use_suit}")
                buffer = [rank_match.group(3)]
                continue

        suit_match = _SUIT_LINE.match(line)
        if suit_match:
            probe = _suit_of(suit_match.group(1))
            if probe:
                flush()
                suit, current, buffer = probe, None, []
                continue

        if current:
            buffer.append(line)

    flush()
    return entries


def _parse_major_lesson(lines):
    """One-line divinatory meanings: 'N. *The Juggler* signifies X.'"""
    entries = {}
    for raw in lines:
        line = T.strip_emphasis(T.unescape_md(raw.strip()))
        m = _SIGNIFIES.match(line)
        if not m:
            continue
        card_id = cards.find(m.group(2).strip(" .*"))
        if not card_id or cards.BY_ID[card_id]["arcana"] != "major":
            continue
        meaning = T.clean(m.group(3)).strip(" .")
        entries.setdefault(card_id, {})["divinatory"] = meaning
    return entries


def parse(path):
    lines = open(path, encoding="utf-8").read().split("\n")
    entries = {}

    symbolic = _region_bounds(lines, r"the symbolical tarot",
                              r"general summary of the symbolical tarot")
    if symbolic:
        for card_id, data in _parse_symbolic(lines[symbolic[0]:symbolic[1]]).items():
            entries.setdefault(card_id, {}).update(data)

    minor = _region_bounds(lines, r"second lesson", r"third lesson")
    if minor:
        for card_id, data in _parse_minor_lesson(lines[minor[0]:minor[1]]).items():
            entries.setdefault(card_id, {}).update(data)

    major = _region_bounds(lines, r"third lesson", r"fourth lesson")
    if major:
        for card_id, data in _parse_major_lesson(lines[major[0]:major[1]]).items():
            entries.setdefault(card_id, {}).update(data)

    return entries


if __name__ == "__main__":
    import json
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else (
        "tarot book resources/papus_absolute-key-to-occult-science-the-tarot-of-the-bohemians.md")
    result = parse(path)
    missing = [c["id"] for c in cards.CARDS if c["id"] not in result]
    print(f"papus parsed {len(result)}/78  missing={len(missing)}")
    if missing:
        print(f"   MISSING: {missing[:20]}")
    print(f"   symbolism={sum(1 for e in result.values() if e.get('symbolism'))} "
          f"divinatory={sum(1 for e in result.values() if e.get('divinatory'))}")
    print()
    for probe in ("the-tower", "ace-of-cups", "six-of-swords"):
        print(f"--- {probe} ---")
        print(json.dumps(result.get(probe, {}), indent=2)[:520])
