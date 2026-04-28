#!/usr/bin/env python3
"""
colorize-party-gen2.py

The party-gen2 PNGs we vendored from SoupPotato/sourcrystal/gfx/icons/
are stored as 4-color GRAYSCALE source art (white / lightgray / darkgray /
black). The ROM-build process colorizes them at runtime via:

  data/pokemon/menu_icon_pals.asm     (species → PAL_ICON_<COLOR> normal+shiny)
  constants/sprite_data_constants.asm (PAL_OW_RED..PURPLE → indices 0..7)
  gfx/overworld/npc_sprites.pal       (the actual RGB555 colors per NPC pal)

MonMenuIconPalToNPCPalTable maps the 8 PAL_ICON_<COLOR> tokens onto the
first 8 PAL_OW_<COLOR> entries (RED..PURPLE = 0..7). We use the "day"
variant of npc_sprites.pal — daytime palette is what shows in the party
menu most of the time and is the canonical look.

Pipeline:
  1. Parse scripts/data/soup-menu_icon_pals.asm to get species → palette token.
  2. For each ndex 1..251, look up its NORMAL-form palette token.
  3. Open web/public/sprites/party-gen2/<ndex>.png (RGBA, 4 grays),
     replace each gray level with its target color, write back.

Source PNGs use 4 luminance levels — we map them by bucketing:
  >=220 (white)  → palette[0]  (background)
  128..219 (170) → palette[1]  (light hue)
  43..127 (85)   → palette[2]  (dark hue / "primary")
  <43 (black)    → palette[3]  (outline)

Run: python3 scripts/colorize-party-gen2.py [--dry-run]
"""

from __future__ import annotations
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image

HERE = Path(__file__).resolve().parent
SPRITES_DIR = HERE.parent / "web" / "public" / "sprites" / "party-gen2"
ASM_PATH = HERE / "data" / "soup-menu_icon_pals.asm"
DRY_RUN = "--dry-run" in sys.argv

# ─── palette source-of-truth (vendored RGB555 from npc_sprites.pal, "day" block) ───
# Order matches MonMenuIconPalToNPCPalTable: RED, BLUE, GREEN, BROWN, PINK, GRAY, YELLOW, PURPLE.
# Each entry is [bg, light, hue, black] in RGB555 (0..31 per channel).
DAY_NPC_PALS_555: List[List[Tuple[int, int, int]]] = [
    # RED   (PAL_OW_RED)
    [(27, 31, 27), (31, 19, 10), (29,  3,  4), (0, 0, 0)],
    # BLUE  (PAL_OW_BLUE)
    [(27, 31, 27), (31, 19, 10), ( 1, 11, 31), (0, 0, 0)],
    # GREEN (PAL_OW_GREEN)
    [(27, 31, 27), (31, 19, 10), ( 4, 19,  0), (0, 0, 0)],
    # BROWN (PAL_OW_BROWN)
    [(27, 31, 27), (31, 19, 10), (15, 10,  3), (0, 0, 0)],
    # PINK  (PAL_OW_PINK)
    [(27, 31, 27), (31, 19, 10), (27,  7, 16), (0, 0, 0)],
    # GRAY  (PAL_OW_GRAY)
    [(27, 31, 27), (31, 19, 10), (11, 14, 15), (0, 0, 0)],
    # YELLOW (PAL_OW_YELLOW)
    [(27, 31, 27), (30, 27,  8), (29, 17,  0), (0, 0, 0)],
    # PURPLE (PAL_OW_PURPLE)
    [(27, 31, 27), (31, 19, 10), (17,  8, 28), (0, 0, 0)],
]

PAL_TOKEN_INDEX: Dict[str, int] = {
    "RED": 0, "BLUE": 1, "GREEN": 2, "BROWN": 3,
    "PINK": 4, "GRAY": 5, "YELLOW": 6, "PURPLE": 7,
}

# Sanity-anchor: first 25 entries of MonMenuIconPals (NORMAL palette only),
# from menu_icon_pals.asm. Catches parser drift if asm format changes.
ANCHOR: List[str] = [
    "GREEN",   # 1   BULBASAUR
    "GREEN",   # 2   IVYSAUR
    "GREEN",   # 3   VENUSAUR
    "RED",     # 4   CHARMANDER
    "RED",     # 5   CHARMELEON
    "RED",     # 6   CHARIZARD
    "BLUE",    # 7   SQUIRTLE
    "BLUE",    # 8   WARTORTLE
    "BLUE",    # 9   BLASTOISE
    "GREEN",   # 10  CATERPIE
    "GREEN",   # 11  METAPOD
    "BLUE",    # 12  BUTTERFREE
    "RED",     # 13  WEEDLE
    "YELLOW",  # 14  KAKUNA
    "YELLOW",  # 15  BEEDRILL
    "BROWN",   # 16  PIDGEY
    "BROWN",   # 17  PIDGEOTTO
    "RED",     # 18  PIDGEOT
    "PURPLE",  # 19  RATTATA
    "BROWN",   # 20  RATICATE
    "BROWN",   # 21  SPEAROW
    "BROWN",   # 22  FEAROW
    "PURPLE",  # 23  EKANS
    "PURPLE",  # 24  ARBOK
    "YELLOW",  # 25  PIKACHU
]


def expand5(v: int) -> int:
    """RGB555 (0..31) → RGB888 (0..255). pret/pokecrystal convention."""
    return ((v << 3) | (v >> 2)) & 0xFF


def to_888(triple555: Tuple[int, int, int]) -> Tuple[int, int, int]:
    return (expand5(triple555[0]), expand5(triple555[1]), expand5(triple555[2]))


def parse_menu_icon_pals(asm: str) -> List[Tuple[int, str, str]]:
    """Yield (ndex, normal_token, species_name) tuples from asm.
    Stops at `assert_table_length NUM_POKEMON` so EGG/unused are ignored."""
    out: List[Tuple[int, str, str]] = []
    n = 0
    pat = re.compile(r"^\s*icon_pals\s+(\w+)\s*,\s*(\w+)\s*;\s*(\w+)")
    for line in asm.splitlines():
        if re.search(r"assert_table_length\s+NUM_POKEMON\b", line):
            break
        m = pat.match(line)
        if not m:
            continue
        n += 1
        out.append((n, m.group(1), m.group(3)))
    return out


def palette_for(token: str) -> List[Tuple[int, int, int]]:
    """Return 4-color RGB888 palette for a PAL_ICON_<TOKEN>. Falls back to GRAY on miss."""
    idx = PAL_TOKEN_INDEX.get(token)
    if idx is None:
        idx = PAL_TOKEN_INDEX["GRAY"]
    return [to_888(c) for c in DAY_NPC_PALS_555[idx]]


def colorize_one(path: Path, pal: List[Tuple[int, int, int]]) -> Tuple[int, bool]:
    """Recolor a 4-gray RGBA PNG in place. Returns (unique_input_grays, ok)."""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    seen: set[int] = set()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            # Source is grayscale; just use the red channel as the gray level.
            v = r if r == g == b else round(0.299 * r + 0.587 * g + 0.114 * b)
            seen.add(v)
            if v >= 220:
                tr, tg, tb = pal[0]
            elif v >= 128:
                tr, tg, tb = pal[1]
            elif v >= 43:
                tr, tg, tb = pal[2]
            else:
                tr, tg, tb = pal[3]
            px[x, y] = (tr, tg, tb, a)
    if not DRY_RUN:
        im.save(path, format="PNG", optimize=True)
    return len(seen), len(seen) <= 6


def main() -> int:
    if not ASM_PATH.exists():
        print(f"missing {ASM_PATH}", file=sys.stderr)
        print(
            "fetch with: curl -sf https://raw.githubusercontent.com/SoupPotato/sourcrystal/master/data/pokemon/menu_icon_pals.asm > "
            f"{ASM_PATH}",
            file=sys.stderr,
        )
        return 2
    asm = ASM_PATH.read_text(encoding="utf-8")
    entries = parse_menu_icon_pals(asm)
    if len(entries) != 251:
        print(f"expected 251 species entries, parsed {len(entries)}", file=sys.stderr)
        return 2

    # Anchor cross-check.
    for i, expected in enumerate(ANCHOR):
        actual = entries[i][1]
        if actual != expected:
            print(
                f"anchor mismatch at ndex {i + 1}: parsed={actual} expected={expected}",
                file=sys.stderr,
            )
            return 2

    # Inventory.
    have = {
        int(p.stem)
        for p in SPRITES_DIR.iterdir()
        if p.suffix == ".png" and p.stem.isdigit()
    }

    summary: Counter[str] = Counter()
    pal_dist: Counter[str] = Counter()
    flagged: List[str] = []
    species_palettes: Dict[int, str] = {}

    for ndex, token, species in entries:
        if ndex not in have:
            summary["missing"] += 1
            flagged.append(f"  ndex {ndex} ({species}): missing source PNG")
            continue
        path = SPRITES_DIR / f"{ndex}.png"
        used_token = token if token in PAL_TOKEN_INDEX else "GRAY"
        pal = palette_for(token)
        unique, ok = colorize_one(path, pal)
        species_palettes[ndex] = used_token
        pal_dist[used_token] += 1
        if token not in PAL_TOKEN_INDEX:
            summary["fallback"] += 1
            flagged.append(
                f"  ndex {ndex} ({species}): unknown PAL_ICON_{token} → fell back to GRAY (unique={unique})"
            )
        elif not ok:
            summary["gray-after"] += 1
            flagged.append(
                f"  ndex {ndex} ({species}): too many unique input grays ({unique}); colorization may look off"
            )
        else:
            summary["colored"] += 1

    print(f"\n{'[DRY-RUN] ' if DRY_RUN else ''}colorize-party-gen2 summary", file=sys.stderr)
    for k in sorted(summary):
        print(f"  {k:<12} {summary[k]}", file=sys.stderr)
    print("\n  palette distribution (NORMAL form, used pal):", file=sys.stderr)
    for k in sorted(pal_dist):
        print(f"    {k:<8} {pal_dist[k]}", file=sys.stderr)
    if flagged:
        print(f"\n  flagged ({len(flagged)}):", file=sys.stderr)
        for line in flagged:
            print(line, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
