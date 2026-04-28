#!/usr/bin/env python3
"""
gen-species-names.py

Regenerates `core/src/data/raw/species.json` with all 386 Gen 3 species
(in national-dex order) AND `core/src/data/raw/gen3-internal-to-ndex.json`
mapping each Gen 3 internal-storage byte to its national-dex id.

Sourced from pret/pokeemerald:
  include/constants/pokedex.h     — national-dex enum order
  src/data/text/species_names.h   — internal-id → display name (ALL CAPS)
  include/constants/species.h     — internal-id values

Why both files: Gen 3 saves store species using INTERNAL ids, NOT national
dex. Internal ids 1-251 happen to equal national dex (Gen 1/2 species are
in dex order in pret), but internals 252-276 are placeholder OLD_UNOWN
slots and 277+ are Hoenn species in a NON-DEX order. Reading a Bagon
slot's species byte returns 395 (internal), not 371 (national dex). This
script bridges the two so the UI can display the right name and our
species table can be keyed by national dex.

Usage: `python3 scripts/gen-species-names.py`
"""

from __future__ import annotations
import re
import sys
import urllib.request
from pathlib import Path

POKEDEX_URL = (
    'https://raw.githubusercontent.com/pret/pokeemerald/master/'
    'include/constants/pokedex.h'
)
SPECIES_CONST_URL = (
    'https://raw.githubusercontent.com/pret/pokeemerald/master/'
    'include/constants/species.h'
)
SPECIES_NAMES_URL = (
    'https://raw.githubusercontent.com/pret/pokeemerald/master/'
    'src/data/text/species_names.h'
)
OUT_SPECIES = (
    Path(__file__).resolve().parent.parent
    / 'core' / 'src' / 'data' / 'raw' / 'species.json'
)
OUT_INTERNAL = (
    Path(__file__).resolve().parent.parent
    / 'core' / 'src' / 'data' / 'raw' / 'gen3-internal-to-ndex.json'
)

SPECIAL_CASE = {
    'NIDORAN_F': 'Nidoran♀',
    'NIDORAN_M': 'Nidoran♂',
    'MR_MIME': 'Mr. Mime',
    'FARFETCHD': "Farfetch'd",
    'HO_OH': 'Ho-Oh',
    'PORYGON2': 'Porygon2',
}


def title_case(token: str) -> str:
    if token in SPECIAL_CASE:
        return SPECIAL_CASE[token]
    return token[0] + token[1:].lower()


def fetch(url: str) -> str:
    return urllib.request.urlopen(url, timeout=15).read().decode('utf-8')


def parse_pokedex_order() -> dict[str, int]:
    """Parse pokedex.h enum block. Returns token → national_dex_id."""
    text = fetch(POKEDEX_URL)
    out: dict[str, int] = {}
    n = -1  # NATIONAL_DEX_NONE = 0
    for line in text.splitlines():
        m = re.match(r'\s*NATIONAL_DEX_([A-Z_0-9]+)\s*,?', line)
        if not m:
            continue
        n += 1
        token = m.group(1)
        if token == 'NONE':
            continue
        if token.startswith('OLD_UNOWN_'):
            continue
        if n > 386:
            break
        out[token] = n
    return out


def parse_species_constants() -> dict[str, int]:
    """Parse species.h #define lines. Returns token → internal_id."""
    text = fetch(SPECIES_CONST_URL)
    out: dict[str, int] = {}
    for line in text.splitlines():
        m = re.match(r'#define\s+SPECIES_([A-Z_0-9]+)\s+(\d+)', line)
        if not m:
            continue
        out[m.group(1)] = int(m.group(2))
    return out


def main() -> int:
    ndex_by_token = parse_pokedex_order()
    internal_by_token = parse_species_constants()

    if len(ndex_by_token) != 386:
        print(f'  ERROR: parsed {len(ndex_by_token)} dex entries, expected 386', file=sys.stderr)
        return 2

    # Build national-dex-ordered species table.
    species_rows: list[dict] = []
    by_ndex: dict[int, str] = {ndex: token for token, ndex in ndex_by_token.items()}
    for ndex in range(1, 387):
        token = by_ndex.get(ndex)
        if token is None:
            print(f'  ERROR: no token for ndex {ndex}', file=sys.stderr)
            return 2
        species_rows.append({
            'gen2Id': ndex,
            'gen3DexId': ndex,
            'name': title_case(token),
        })

    # Render species.json (matching existing 2-space indent shape).
    lines = ['[']
    for i, r in enumerate(species_rows):
        comma = ',' if i + 1 < len(species_rows) else ''
        lines.append(
            f'  {{ "gen2Id": {r["gen2Id"]}, "gen3DexId": {r["gen3DexId"]}, "name": "{r["name"]}" }}{comma}'
        )
    lines.append(']')
    OUT_SPECIES.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'wrote {len(species_rows)} species entries to {OUT_SPECIES}')

    # Build internal-id → national-dex map. Keys are internal IDs of REAL
    # species (skip OLD_UNOWN placeholders 252-276 — they all collapse to
    # ndex 201, but the canonical Unown internal id is 201 itself).
    internal_to_ndex: dict[int, int] = {}
    for token, internal in internal_by_token.items():
        if token == 'NONE' or token.startswith('OLD_UNOWN_'):
            continue
        ndex = ndex_by_token.get(token)
        if ndex is None:
            continue  # tokens past DEOXYS (EGG etc.) — ignore
        internal_to_ndex[internal] = ndex

    # Render as compact JSON (sorted by internal id ascending).
    lines = ['{']
    keys = sorted(internal_to_ndex.keys())
    for i, internal in enumerate(keys):
        comma = ',' if i + 1 < len(keys) else ''
        lines.append(f'  "{internal}": {internal_to_ndex[internal]}{comma}')
    lines.append('}')
    OUT_INTERNAL.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'wrote {len(internal_to_ndex)} internal-id mappings to {OUT_INTERNAL}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
