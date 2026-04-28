#!/usr/bin/env python3
"""
Re-download SoupPotato Gen 1/2 party icons (grayscale source) to
web/public/sprites/party-gen2/<ndex>.png so colorize-party-gen2.py can
re-process them.

Use case: the colored sprites were post-processed (corner-floodfill) and
the result regressed visually. We need the clean grayscale source back
to re-run the canonical colorize pipeline without the floodfill step.

Run: python3 scripts/redownload-party-gen2.py
Then: python3 scripts/colorize-party-gen2.py
"""

from __future__ import annotations
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

REPO = 'https://raw.githubusercontent.com/SoupPotato/sourcrystal/master/gfx/icons'
ASM = Path('scripts/data/soup-menu_icon_pals.asm')
OUT = Path('web/public/sprites/party-gen2')

# SoupPotato ROM-hack icon naming differs from pretty-print pokedex names
# in a few special cases. Map asm-token → on-disk filename here.
NAME_OVERRIDES = {
    'NIDORAN_F': 'nidoran_f',
    'NIDORAN_M': 'nidoran_m',
    'MR_MIME': 'mr__mime',
    'FARFETCH_D': 'farfetch_d',
    'MIME_JR': 'mime_jr',
    'HO_OH': 'ho_oh',
    'PORYGON_Z': 'porygon_z',
    'TYPE_NULL': 'type_null',
    'JANGMO_O': 'jangmo_o',
    'HAKAMO_O': 'hakamo_o',
    'KOMMO_O': 'kommo_o',
    # SoupPotato's asm has these typos in the comment column. The actual
    # icon files in their repo use the correct spellings.
    'MARROWAK': 'marowak',
    'MAGANIUM': 'meganium',
}


def species_names() -> list[str]:
    text = ASM.read_text()
    # NB: include digits — `PORYGON2` (ndex 233) and any other digit-bearing
    # species names would silently drop without [0-9]. The original `[A-Z_]+`
    # pattern shifted the entire post-Porygon2 list down by one, so
    # file 248.png ended up holding Lugia's icon instead of Tyranitar's
    # (and the cascade continued through Celebi).
    names = re.findall(r';\s*([A-Z0-9_]+)\s*$', text, re.MULTILINE)
    # Skip header lines if any
    return [n for n in names if n not in ('NORMAL', 'SHINY', 'SPECIES')]


def candidate_filenames(asm_token: str) -> list[str]:
    out = []
    if asm_token in NAME_OVERRIDES:
        out.append(NAME_OVERRIDES[asm_token])
    out.append(asm_token.lower())
    out.append(asm_token.lower().replace('_', ''))
    return out


def fetch(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    names = species_names()
    print(f'parsed {len(names)} species from asm')
    failures: list[tuple[int, str]] = []
    for ndex, asm_token in enumerate(names, start=1):
        if ndex > 251:
            break  # `egg` and any forms past 251 — skip
        data: bytes | None = None
        for fname in candidate_filenames(asm_token):
            url = f'{REPO}/{fname}.png'
            data = fetch(url)
            if data is not None:
                break
        if data is None:
            failures.append((ndex, asm_token))
            print(f'  ✗ #{ndex:3d} {asm_token}: 404 on all candidates', file=sys.stderr)
            continue
        (OUT / f'{ndex}.png').write_bytes(data)
        if ndex % 25 == 0:
            print(f'  ✓ #{ndex:3d} {asm_token} ({len(data)} B)')
    print(f'done. {len(names) - len(failures)}/{251} downloaded')
    if failures:
        print(f'failures ({len(failures)}):')
        for ndex, name in failures:
            print(f'  #{ndex} {name}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
