"""Parse the Dark Forest guidebook into per-card entries.

Layout of one card in the source (converted from PDF, so headings sometimes
split across two lines and small-caps labels are letter-spaced):

    ### The Fool
    Air · Uranus · zero, the number of pure potential
    ###### <one-line hook, often wrapped over two ###### lines>
    ###### IN THE PICTURE
    ...  ◆ bulleted observations about the imagery
    ###### UPRIGHT
    ...
    REVERSED optional
    ...
    KEYWORDS a memory aid
    U P R I G H T ...  R E V E R S E D ...
    ###### IN LIFE
    LOVE — ...   WORK & MONEY — ...
    ###### REFLECTION
    ###### <question>            Affirmation · ...
    ###### ADVICE
    ...   AS A PERSON ...  TIMING ...  LEANS ...
"""

import re

import cards
import textutil as T

SOURCE = {
    "id": "darkforest",
    "title": "The Dark Forest Guide to Tarot",
    "author": "Dark Forest Tarot",
    "year": None,
    "rights": "commercial",
    "note": "Commercial guidebook - bundled for personal use only.",
    "tradition": "rws",
}

_SECTION = re.compile(
    r"^(?:#{1,6}\s*)?(IN THE PICTURE|UPRIGHT|REVERSED|KEYWORDS|IN LIFE|"
    r"REFLECTION|ADVICE)\b"
)
_HEADING3 = re.compile(r"^###\s+(?!#)(.*\S)\s*$")
# Any heading of five hashes or fewer ends a card block. Six-hash headings are
# the in-card section markers (IN THE PICTURE, UPRIGHT, ...) and must not.
_BOUNDARY = re.compile(r"^#{1,5}\s+(?!#)")
_IN_LIFE = re.compile(r"\b(LOVE|WORK & MONEY)\s*[—–-]\s*")
_ADVICE_TAIL = ["AS A PERSON", "TIMING", "LEANS"]


def _heading_positions(lines):
    return [(i, m.group(1).strip())
            for i, line in enumerate(lines)
            if (m := _HEADING3.match(line))]


def _card_blocks(lines):
    """Yield (card_id, title, body_lines), stitching split headings."""
    headings = _heading_positions(lines)
    starts = []
    i = 0
    while i < len(headings):
        line_no, text = headings[i]
        best = None
        # A title may be broken over up to three ### lines ("Three of" /
        # "Pentacles"). Prefer the longest join that resolves to a real card.
        for span in (3, 2, 1):
            if i + span > len(headings):
                continue
            parts = headings[i:i + span]
            if any(parts[k + 1][0] - parts[k][0] > 3 for k in range(len(parts) - 1)):
                continue
            title = " ".join(p[1] for p in parts)
            card_id = cards.find(title)
            if card_id:
                best = (line_no, card_id, title, span)
                break
        if best:
            starts.append((*best, i))
            i += best[3]
        else:
            i += 1

    boundaries = [i for i, line in enumerate(lines) if _BOUNDARY.match(line)]

    for line_no, card_id, title, span, heading_index in starts:
        # End at the next section heading of any level, not just the next card.
        # The last card of each suit is followed by a suit divider, and the last
        # card in the book by Part III, whose text would otherwise be swallowed.
        last_title_line = headings[heading_index + span - 1][0]
        end = next((b for b in boundaries if b > last_title_line), len(lines))
        yield card_id, title, lines[line_no:end]


def _split_sections(body_lines):
    """Split a card body into {SECTION: raw text}, plus a leading preamble."""
    sections = {}
    current = "_PREAMBLE"
    buffer = []
    for line in body_lines[1:]:
        m = _SECTION.match(line.strip())
        if m:
            sections[current] = "\n".join(buffer)
            current = m.group(1)
            # Keep any text that trailed the marker on the same line.
            remainder = line.strip()[m.end():].strip()
            remainder = re.sub(r"^(optional|a memory aid)\b", "", remainder).strip()
            buffer = [remainder] if remainder else []
        else:
            buffer.append(line)
    sections[current] = "\n".join(buffer)
    return sections


def _parse_preamble(text):
    """Pull the correspondences line and the one-line hook out of the preamble."""
    correspondences = ""
    hook_lines = []
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            hook_lines.append(T.strip_heading(line))
        elif "·" in line and not correspondences:
            correspondences = line
        else:
            hook_lines.append(line)
    return correspondences, T.reflow("\n\n".join(hook_lines))


def _parse_keywords(text):
    text = T.despace(re.sub(r"\s*\n\s*", " ", text))
    text = re.sub(r"^\s*(a memory aid)\s*", "", text, flags=re.I)
    upright, reversed_ = text, ""
    if "REVERSED" in text:
        upright, reversed_ = text.split("REVERSED", 1)
    upright = re.sub(r"^\s*UPRIGHT\s*", "", upright)
    return T.keywords_from(upright), T.keywords_from(reversed_)


def _parse_in_life(text):
    text = T.reflow(text)
    out = {}
    parts = _IN_LIFE.split(text)
    for i in range(1, len(parts) - 1, 2):
        key = "love" if parts[i] == "LOVE" else "work"
        out[key] = re.sub(r"\s+", " ", parts[i + 1]).strip()
    return out


def _parse_reflection(text):
    question_parts, affirmation = [], ""
    for raw in text.split("\n"):
        line = T.strip_heading(raw.strip())
        if not line:
            continue
        if line.lower().startswith("affirmation"):
            affirmation = re.sub(r"^affirmation\s*[·:•-]\s*", "", line,
                                 flags=re.I).strip()
        else:
            question_parts.append(line)
    return T.reflow(" ".join(question_parts)), affirmation


def _parse_advice(text):
    text = T.reflow(text)
    parts = T.split_labeled(text, _ADVICE_TAIL)
    advice = parts.pop("", "")
    return {
        "advice": advice,
        "as_a_person": parts.get("AS A PERSON", ""),
        "timing": parts.get("TIMING", ""),
        "leans": parts.get("LEANS", ""),
    }


def _merge_bullet_tails(text):
    """Fold trailing prose back into the bullet it belongs to.

    The PDF hard-wrapped each observation after its opening sentence, so the
    rest of the bullet arrives as a separate paragraph. Once the first bullet
    has started, every following non-bullet chunk is a continuation of it.
    """
    chunks = [c for c in text.split("\n\n") if c.strip()]
    out, seen_bullet = [], False
    for chunk in chunks:
        if chunk.startswith("- "):
            seen_bullet = True
            out.append(chunk)
        elif seen_bullet and out:
            out[-1] = f"{out[-1]} {chunk}"
        else:
            out.append(chunk)
    return "\n\n".join(out)


# Page furniture left by the PDF conversion: letter-spaced page numbers
# ("1 7"), running heads ("P A R T  T W O"), and the publisher's promo lines.
# These land mid-section and would otherwise be glued onto real card text.
_JUNK = re.compile(
    r"^(?:#{1,6}\s*)?(?:"
    r"[\d\s]{1,9}"
    r"|(?:[A-Z]\s){2,}[A-Z][A-Z0-9\s·]*"
    r"|.*darkforesttarotcards\.com.*"
    r"|STAR\d+"
    r"|☾|[🌑🌒🌓🌔🌕\s]+"
    r")\s*$"
)


def _strip_junk(lines):
    return [line for line in lines if not _JUNK.match(line.strip())]


def parse(path):
    lines = _strip_junk(open(path, encoding="utf-8").read().split("\n"))
    entries = {}

    for card_id, title, body in _card_blocks(lines):
        if card_id in entries:
            continue  # first occurrence wins; later ones are cross-references
        sections = _split_sections(body)
        correspondences, hook = _parse_preamble(sections.get("_PREAMBLE", ""))
        kw_up, kw_rev = _parse_keywords(sections.get("KEYWORDS", ""))
        reflection, affirmation = _parse_reflection(sections.get("REFLECTION", ""))
        advice = _parse_advice(sections.get("ADVICE", ""))

        raw_picture = T.clean(sections.get("IN THE PICTURE", ""))
        # A diamond bullet can land mid-line after the PDF conversion; force
        # each one to start its own chunk before reflow glues paragraphs back.
        raw_picture = re.sub(r"\s*◆\s*", "\n\n◆ ", raw_picture)
        picture = _merge_bullet_tails(T.reflow(T.normalize_bullets(raw_picture)))
        # Drop the stock "before you reach for a keyword" preamble sentence.
        picture = re.sub(r"^Before you reach for a keyword[^.]*\.\s*", "", picture)

        entries[card_id] = {
            "title": title,
            "correspondences": correspondences,
            "hook": hook,
            "picture": picture,
            "upright": T.reflow(T.clean(sections.get("UPRIGHT", ""))),
            "reversed": T.reflow(T.clean(sections.get("REVERSED", ""))),
            "keywords_upright": kw_up,
            "keywords_reversed": kw_rev,
            "in_life": _parse_in_life(sections.get("IN LIFE", "")),
            "reflection": reflection,
            "affirmation": affirmation,
            **advice,
        }

    return entries


if __name__ == "__main__":
    import json
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else (
        "tarot book resources/Dark-Forest-Guidebook-v2.1-widowfix.md")
    result = parse(path)
    print(f"parsed {len(result)} / 78 cards")
    missing = [c["id"] for c in cards.CARDS if c["id"] not in result]
    if missing:
        print(f"MISSING: {missing}")
    empties = {}
    for cid, e in result.items():
        blank = [k for k, v in e.items() if not v]
        if blank:
            empties[cid] = blank
    if empties:
        print(f"cards with empty fields: {len(empties)}")
        for cid, blank in list(empties.items())[:8]:
            print(f"  {cid}: {blank}")
    print()
    print(json.dumps(result.get("the-tower", {}), indent=2)[:2600])
