"""Text cleanup shared by the book parsers.

The source markdown came from two very different pipelines and each leaves its
own debris:

  * The Dark Forest guidebook was converted from a PDF, so visual line breaks
    became paragraph breaks and small-caps labels became letter-spaced runs
    ("U P R I G H T").
  * The Global Grey / Gutenberg epubs are clean, but use escaped markdown
    (`\\*\\*\\*`) as separators and *emphasis* around the labels we key on.
"""

import re

# A run of single letters separated by spaces, e.g. "U P R I G H T".
_LETTER_RUN = re.compile(r"\b(?:[A-Za-z] ){2,}[A-Za-z]\b")
_SENTENCE_END = re.compile(r"[.!?:;”’\"')\]]$")
_BULLET_START = re.compile(r"^[◆•●–—\-\*]\s*")


def despace(text):
    """Collapse letter-spaced runs: 'U P R I G H T' -> 'UPRIGHT'."""
    return _LETTER_RUN.sub(lambda m: m.group(0).replace(" ", ""), text)


def strip_heading(line):
    """Remove leading markdown hashes and surrounding whitespace."""
    return re.sub(r"^#{1,6}\s*", "", line).strip()


def unescape_md(text):
    """Undo the backslash escaping the epub converter applied."""
    return re.sub(r"\\([\\`*_{}\[\]()#+\-.!~<>|])", r"\1", text)


def strip_emphasis(text):
    """Drop markdown emphasis markers, keeping the words."""
    text = re.sub(r"\*\*\*(.+?)\*\*\*", r"\1", text, flags=re.S)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text, flags=re.S)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", text, flags=re.S)
    text = re.sub(r"_(.+?)_", r"\1", text, flags=re.S)
    return text


def clean(text):
    """Normalize whitespace and stray characters without reflowing."""
    if not text:
        return ""
    text = text.replace(" ", " ").replace("﻿", "")
    text = unescape_md(text)
    # Long dinkus runs used as section separators.
    text = re.sub(r"[*—–\-=_]{6,}", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def reflow(text, keep_bullets=True):
    """Rejoin lines the PDF pipeline split mid-sentence, into paragraphs.

    A blank line in the source may mean a real paragraph break or just a
    rendered line wrap. We treat it as a wrap when the previous chunk does not
    end on sentence punctuation, or when the next chunk opens lowercase --
    which is what a wrapped line looks like.
    """
    if not text:
        return ""
    chunks = [c.strip() for c in re.split(r"\n\s*\n", text) if c.strip()]
    chunks = [re.sub(r"\s*\n\s*", " ", c) for c in chunks]

    out = []
    for chunk in chunks:
        chunk = re.sub(r"\s+", " ", chunk).strip()
        if not chunk:
            continue
        is_bullet = bool(_BULLET_START.match(chunk))
        if out and not (keep_bullets and is_bullet):
            prev = out[-1]
            if not _SENTENCE_END.search(prev) or re.match(r"^[a-z(]", chunk):
                out[-1] = f"{prev} {chunk}"
                continue
        out.append(chunk)

    return "\n\n".join(out).strip()


def normalize_bullets(text, marker="◆"):
    """Turn the guidebook's diamond bullets into plain markdown list items."""
    lines = []
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith(marker):
            stripped = "- " + stripped[len(marker):].strip()
        lines.append(stripped)
    return "\n".join(lines)


def split_labeled(text, labels):
    """Split a run of text on inline ALL-CAPS labels.

    Used for trailing lines like
        "AS A PERSON spontaneous... TIMING less a fixed 'when'... LEANS yes..."
    Returns {label: text}. Text before the first label is returned under "".
    """
    if not text:
        return {}
    pattern = "|".join(re.escape(lbl) for lbl in sorted(labels, key=len, reverse=True))
    parts = re.split(rf"\b({pattern})\b", text)
    result = {}
    if parts and parts[0].strip():
        result[""] = parts[0].strip()
    for i in range(1, len(parts) - 1, 2):
        label = parts[i]
        body = parts[i + 1].strip(" .·—–-\n")
        if body:
            result[label] = body
    return result


def sentences(text, limit=None):
    """Split into sentences; used to build short summaries."""
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z“])", text.strip())
    parts = [p.strip() for p in parts if p.strip()]
    return parts[:limit] if limit else parts


def first_sentences(text, count=2):
    return " ".join(sentences(text, count))


def keywords_from(text):
    """Pull a middot/comma separated keyword list into a clean list."""
    if not text:
        return []
    text = despace(text)
    text = re.sub(r"[\n\r]+", " ", text)
    raw = re.split(r"[·•,;]|\s+-\s+", text)
    out = []
    for item in raw:
        item = re.sub(r"\s+", " ", item).strip(" .-–—")
        if item and len(item) < 60 and not item.isupper():
            out.append(item.lower())
    seen = set()
    deduped = []
    for item in out:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped
