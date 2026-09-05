"""Canonical definitions of the 78 tarot cards.

Every parser in this package maps its source text onto the ids defined here, so
that corpus.json ends up with exactly one entry per card no matter how many
books mention it.

Two numbering traditions show up in the source books and they disagree about
two cards:

    Rider-Waite-Smith (Waite 1910, De Laurence 1918, Dark Forest)
        VIII = Strength, XI = Justice
    Continental / Marseille (Papus 1889, Thierens 1930)
        VIII = Justice,  XI = Strength

`major_by_roman()` takes the tradition as an argument so a roman numeral in a
book is resolved against that book's own ordering rather than ours.
"""

import re
import unicodedata

SUITS = ["wands", "cups", "swords", "pentacles"]

SUIT_NAMES = {
    "wands": "Wands",
    "cups": "Cups",
    "swords": "Swords",
    "pentacles": "Pentacles",
}

SUIT_ELEMENT = {
    "wands": "Fire",
    "cups": "Water",
    "swords": "Air",
    "pentacles": "Earth",
}

# What each suit is called across the six books.
SUIT_ALIASES = {
    "wands": ["wands", "wand", "rods", "rod", "sceptres", "sceptre",
              "scepters", "batons", "baton", "staves", "staffs", "clubs"],
    "cups": ["cups", "cup", "chalices", "chalice", "goblets", "hearts"],
    "swords": ["swords", "sword", "epees", "spades"],
    "pentacles": ["pentacles", "pentacle", "coins", "coin", "deniers",
                  "denier", "money", "diamonds", "circles"],
}

RANKS = [
    (1, "Ace", ["ace", "one", "1", "i"]),
    (2, "Two", ["two", "2", "ii", "deuce"]),
    (3, "Three", ["three", "3", "iii"]),
    (4, "Four", ["four", "4", "iv"]),
    (5, "Five", ["five", "5", "v"]),
    (6, "Six", ["six", "6", "vi"]),
    (7, "Seven", ["seven", "7", "vii"]),
    (8, "Eight", ["eight", "8", "viii"]),
    (9, "Nine", ["nine", "9", "ix"]),
    (10, "Ten", ["ten", "10", "x"]),
    (11, "Page", ["page", "knave", "valet", "princess", "jack"]),
    (12, "Knight", ["knight", "cavalier", "chevalier", "prince", "horseman"]),
    (13, "Queen", ["queen", "dame"]),
    (14, "King", ["king", "roi"]),
]

COURT_RANKS = {11, 12, 13, 14}

# (rws_number, name, aliases) -- aliases are lowercase and punctuation-free.
MAJORS = [
    (0, "The Fool", ["the fool", "fool", "le mat", "the foolish man", "mat"]),
    (1, "The Magician", ["the magician", "magician", "the juggler", "juggler",
                         "le bateleur", "bateleur", "the magus", "magus"]),
    (2, "The High Priestess", ["the high priestess", "high priestess",
                               "the female pope", "female pope", "the popess",
                               "popess", "la papesse", "junon", "the priestess"]),
    (3, "The Empress", ["the empress", "empress", "limperatrice"]),
    (4, "The Emperor", ["the emperor", "emperor", "lempereur"]),
    (5, "The Hierophant", ["the hierophant", "hierophant", "the pope", "pope",
                           "le pape", "jupiter", "the high priest",
                           "high priest", "chief priest"]),
    (6, "The Lovers", ["the lovers", "lovers", "the lover", "lover",
                       "lamoureux", "the two paths"]),
    (7, "The Chariot", ["the chariot", "chariot", "le chariot",
                        "the triumphal car", "triumphal car", "osiris triumphant"]),
    (8, "Strength", ["strength", "fortitude", "la force", "force",
                     "strength fortitude", "strength or fortitude",
                     "fortitude or strength"]),
    (9, "The Hermit", ["the hermit", "hermit", "lermite", "the sage",
                       "the capuchin", "the old man"]),
    (10, "Wheel of Fortune", ["wheel of fortune", "the wheel of fortune",
                              "la roue de fortune", "the wheel", "wheel",
                              "rota fortunae"]),
    (11, "Justice", ["justice", "la justice", "themis"]),
    (12, "The Hanged Man", ["the hanged man", "hanged man", "le pendu",
                            "the hanging man", "pendu"]),
    (13, "Death", ["death", "la mort", "the reaper", "the skeleton reaper",
                   "the skeleton mower", "death or the skeleton mower"]),
    (14, "Temperance", ["temperance", "la temperance", "the two urns"]),
    (15, "The Devil", ["the devil", "devil", "le diable", "typhon"]),
    (16, "The Tower", ["the tower", "tower", "the lightning struck tower",
                       "the house of god", "la maison dieu", "maison dieu",
                       "the tower struck by lightning", "the fire of heaven",
                       "the blasted tower"]),
    (17, "The Star", ["the star", "star", "the stars", "letoile", "the blazing star"]),
    (18, "The Moon", ["the moon", "moon", "la lune"]),
    (19, "The Sun", ["the sun", "sun", "le soleil"]),
    (20, "Judgement", ["judgement", "judgment", "the judgement", "the judgment",
                       "the last judgment", "the last judgement", "le jugement",
                       "the angel", "resurrection"]),
    (21, "The World", ["the world", "world", "le monde", "the universe",
                       "universe", "the crown of the magi"]),
]

# Marseille order: VIII is Justice and XI is Strength, the reverse of RWS.
_MARSEILLE_SWAP = {8: 11, 11: 8}


def normalize(text):
    """Lowercase, strip accents and punctuation, collapse whitespace.

    Used for every alias comparison so that "L'Ermite", "The Hanged-Man" and
    "THE  HANGED MAN." all reduce to something matchable.
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def slugify(text):
    return normalize(text).replace(" ", "-")


def _build():
    cards = []
    by_id = {}
    alias_index = {}

    def add(card, aliases):
        cards.append(card)
        by_id[card["id"]] = card
        for alias in aliases:
            key = normalize(alias)
            if key:
                # First writer wins: majors are registered before minors so a
                # bare "strength" can never be stolen by a minor-arcana alias.
                alias_index.setdefault(key, card["id"])

    for number, name, aliases in MAJORS:
        card = {
            "id": slugify(name),
            "name": name,
            "arcana": "major",
            "number": number,
            "roman": ROMAN[number],
            "suit": None,
            "rank": None,
            "element": None,
        }
        add(card, aliases + [f"{ROMAN[number]} {name}", f"{number} {name}"])

    for suit in SUITS:
        for rank, rank_name, rank_aliases in RANKS:
            name = f"{rank_name} of {SUIT_NAMES[suit]}"
            card = {
                "id": slugify(name),
                "name": name,
                "arcana": "minor",
                "number": rank,
                "roman": None,
                "suit": suit,
                "rank": rank,
                "rank_name": rank_name,
                "element": SUIT_ELEMENT[suit],
                "court": rank in COURT_RANKS,
            }
            aliases = []
            for suit_alias in SUIT_ALIASES[suit]:
                for ra in rank_aliases + [rank_name.lower()]:
                    aliases.append(f"{ra} of {suit_alias}")
                    aliases.append(f"{suit_alias} {ra}")
                    aliases.append(f"the {ra} of {suit_alias}")
                    # Waite's minor headings read "Wands: Ten", "Cups: King".
                    aliases.append(f"{suit_alias} {ra}")
                    aliases.append(f"the suit of {suit_alias} {ra}")
            add(card, aliases)

    return cards, by_id, alias_index


ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
         "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX",
         "XX", "XXI"]

ROMAN_TO_INT = {r: i for i, r in enumerate(ROMAN) if r != "0"}
ROMAN_TO_INT["0"] = 0

CARDS, BY_ID, ALIAS_INDEX = _build()

assert len(CARDS) == 78, f"expected 78 cards, built {len(CARDS)}"


def find(text):
    """Resolve a piece of heading text to a card id, or None."""
    if not text:
        return None
    key = normalize(text)
    if not key:
        return None
    if key in ALIAS_INDEX:
        return ALIAS_INDEX[key]

    # Strip a leading enumerator: "16. THE TOWER", "XVI The Tower", "5 - Cups".
    stripped = re.sub(r"^(?:[0-9]{1,2}|[ivxl]{1,6})\s*[\.\)\-–—:]*\s*", "", key)
    if stripped != key and stripped in ALIAS_INDEX:
        return ALIAS_INDEX[stripped]

    # Drop a trailing gloss: "The Tower -- Misery, distress" or "Death. Saturn".
    for sep in (" -- ", " - ", ". ", ": ", ", "):
        head = key.split(sep)[0].strip()
        if head and head in ALIAS_INDEX:
            return ALIAS_INDEX[head]

    return None


def major_by_roman(roman, tradition="rws"):
    """Resolve a roman numeral to a major-arcana card id for a given book."""
    n = ROMAN_TO_INT.get(str(roman).upper().strip())
    if n is None:
        return None
    if tradition == "marseille":
        n = _MARSEILLE_SWAP.get(n, n)
    return slugify(MAJORS[n][1])


# Both Rider-Waite texts enumerate the trumps in words rather than digits
# ("ZERO. THE FOOL", "ONE. THE MAGICIAN"), so parsers need to strip these too.
WORD_NUMBERS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "twentyone": 21, "twenty one": 21, "twentytwo": 22,
    "twenty two": 22,
}

ENUMERATOR_WORDS = "|".join(sorted(WORD_NUMBERS, key=len, reverse=True))


def blank_entries():
    """A fresh {card_id: {}} map covering all 78 cards, in canonical order."""
    return {card["id"]: {} for card in CARDS}


if __name__ == "__main__":
    print(f"{len(CARDS)} cards, {len(ALIAS_INDEX)} aliases")
    for probe in ["THE TOWER", "16. THE TOWER", "Fortitude", "Wands: Ten",
                  "The Suit Of Wands: King", "Ace of Pentacles", "Le Pendu",
                  "Knight of Coins", "8. FORTITUDE", "The Last Judgment"]:
        print(f"  {probe!r:32} -> {find(probe)}")
    print(f"  roman VIII rws       -> {major_by_roman('VIII')}")
    print(f"  roman VIII marseille -> {major_by_roman('VIII', 'marseille')}")
