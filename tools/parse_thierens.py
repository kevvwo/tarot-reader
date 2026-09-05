"""Parse Thierens, General Book of the Tarot (1930) -- the astrological layer.

Majors are headed with a roman numeral, the name and a planetary or zodiacal
attribution:

    #### XVI. The Tower. Uranus
    #### 0. (Zero) The Fool. Our Earth

Minors are headed plainly and carry three labelled sections:

    #### Ace of Wands
    TRADITION: ...  Reversed: ...
    THEORY: ...
    CONCLUSION: ...

Thierens follows the Marseille ordering (VIII Justice, XI Strength), but every
heading also spells the card's name, so names are matched directly and the
numerals are only used as a fallback.
"""

import re

import cards
import textutil as T

SOURCE = {
    "id": "thierens",
    "title": "General Book of the Tarot",
    "author": "A. E. Thierens",
    "year": 1930,
    "rights": "public-domain",
    "tradition": "marseille",
}

_HEADING = re.compile(r"^#{3,6}\s+(.*\S)\s*$")
_ENUM = re.compile(
    rf"^(?:\d{{1,2}}|[ivxl]{{1,6}}|{cards.ENUMERATOR_WORDS})\s*[.):\-]*\s*", re.I)
_LABEL = re.compile(r"^\s*(TRADITION|THEORY|CONCLUSION)\s*:\s*", re.I)
_REVERSED = re.compile(r"\bReversed\s*:\s*", re.I)
_STOP = re.compile(r"^(bibliography|notes|index)\b", re.I)


def _resolve_heading(text):
    """Return (card_id, attribution) for a heading line, or (None, '')."""
    text = T.strip_emphasis(T.unescape_md(T.strip_heading(text)))
    text = re.sub(r"\(([^)]*)\)", " ", text)  # drop "(Zero)" style asides
    segments = [s.strip() for s in re.split(r"\.\s*", text) if s.strip()]

    for i in range(len(segments)):
        # Longest span first so "The Wheel of Fortune" wins over "The Wheel".
        for j in range(len(segments), i, -1):
            raw = cards.normalize(" ".join(segments[i:j]))
            # Try the untouched name before stripping a leading enumerator:
            # minor ranks are themselves word-numbers, so stripping first would
            # turn "Two of Wands" into "of Wands" and lose the card.
            for key in (raw, _ENUM.sub("", raw).strip()):
                if key in cards.ALIAS_INDEX:
                    return cards.ALIAS_INDEX[key], " ".join(segments[j:]).strip()
    return None, ""


def _split_labeled_sections(body):
    """Split a minor-arcana body into TRADITION / THEORY / CONCLUSION."""
    sections, current, buffer = {}, None, []
    for raw in body.split("\n"):
        m = _LABEL.match(raw)
        if m:
            if current:
                sections[current] = "\n".join(buffer)
            current = m.group(1).upper()
            buffer = [raw[m.end():]]
        elif current:
            buffer.append(raw)
        else:
            buffer.append(raw)
            current = current or "_LEAD"
    if current:
        sections[current] = "\n".join(buffer)
    return sections


def parse(path):
    lines = open(path, encoding="utf-8").read().split("\n")

    # Collect heading positions that resolve to cards.
    marks = []
    for i, line in enumerate(lines):
        m = _HEADING.match(line)
        if not m:
            continue
        if _STOP.match(T.strip_heading(line)):
            marks.append((i, None, ""))
            continue
        card_id, attribution = _resolve_heading(line)
        if card_id:
            marks.append((i, card_id, attribution))

    entries = {}
    for idx, (start, card_id, attribution) in enumerate(marks):
        if not card_id or card_id in entries:
            continue
        end = marks[idx + 1][0] if idx + 1 < len(marks) else len(lines)
        body = T.clean("\n".join(lines[start + 1:end]))
        sections = _split_labeled_sections(body)

        entry = {"attribution": attribution}
        if "TRADITION" in sections or "CONCLUSION" in sections:
            tradition = T.reflow(T.strip_emphasis(sections.get("TRADITION", "")))
            upright, reversed_ = tradition, ""
            r = _REVERSED.search(tradition)
            if r:
                upright, reversed_ = tradition[:r.start()], tradition[r.end():]
            entry.update({
                "tradition": upright.strip(),
                "reversed": reversed_.strip(),
                "theory": T.reflow(T.strip_emphasis(sections.get("THEORY", ""))),
                "conclusion": T.reflow(T.strip_emphasis(sections.get("CONCLUSION", ""))),
            })
        else:
            entry["commentary"] = T.reflow(T.strip_emphasis(body))

        entries[card_id] = entry

    return entries


if __name__ == "__main__":
    import json
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else (
        "tarot book resources/a-e-thierens_general-book-of-the-tarot.md")
    result = parse(path)
    missing = [c["id"] for c in cards.CARDS if c["id"] not in result]
    print(f"thierens parsed {len(result)}/78  missing={len(missing)}")
    if missing:
        print(f"   MISSING: {missing}")
    with_attr = sum(1 for e in result.values() if e.get("attribution"))
    with_trad = sum(1 for e in result.values() if e.get("tradition"))
    with_comm = sum(1 for e in result.values() if e.get("commentary"))
    print(f"   attributions={with_attr} tradition_sections={with_trad} "
          f"commentary={with_comm}")
    print()
    print(json.dumps(result.get("the-tower", {}), indent=2)[:900])
    print()
    print(json.dumps(result.get("ace-of-wands", {}), indent=2)[:900])
