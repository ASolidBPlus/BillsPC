/**
 * Sprite path helpers + image factory.
 *
 * Per PLAN_EVAL S5 A7, every emitted `<img>` carries explicit `width` and
 * `height` HTML attributes (not CSS) so the browser reserves layout
 * space before the PNG decodes.
 *
 * The overworld set ships 288×32 nine-frame walking strips (HGSS-style).
 * We render those as a `<div>` with a `background-image` so CSS keyframes
 * can cycle through the first two walk frames for an in-place animation.
 * The other sets (gen1/gen2/gen3 front sprites) stay as plain `<img>`.
 *
 * The `class="sprite"` selector picks up the `image-rendering` triple
 * declared in `style.css` (per A6: `-webkit-optimize-contrast`,
 * `-moz-crisp-edges`, `crisp-edges`, `pixelated`).
 */
import type { SaveFormat } from '@pokeportal/core';
import { el, img } from './dom.js';

export type SpriteSet = 'gen1' | 'gen2' | 'gen3' | 'overworld';

export const SPRITE_RENDER_SIZE: Readonly<Record<SpriteSet, number>> = {
  // All Gen 1/2/3 source/destination sprites render at the same size so the
  // two comparison panes look balanced regardless of which cart's native
  // sprite resolution we got (Red is 40×40, Crystal 56×56, Emerald 64×64).
  // Pixel-rendering keeps them crisp at the upscaled size.
  gen1: 96,
  gen2: 96,
  gen3: 96,
  overworld: 32, // single-frame display size; source strip is 288×32 (9 frames)
};

/**
 * Map a save's source format to the per-cart sprite subdir for the Gen 1/2
 * source side. Returns `null` for the destination ('gen3' set), overworld,
 * and any non-source-side calls.
 *
 * Triggered when the caller passes a non-null `format`: that signals "this
 * is a SOURCE-side render, pick the right cart's art." `set` is ignored in
 * that path (callers historically passed gen1/gen2 but the format is a
 * stronger signal of which cart we're looking at).
 *
 * - RBY-RED  / RBY-BLUE → red-blue/<n>.png    (shared sprites, transparent)
 * - RBY-YELLOW          → yellow/<n>.png      (transparent)
 * - CRYSTAL             → crystal-anim/<n>.gif (animated! native browser playback)
 * - GS                  → crystal/<n>.png     (no GS sprite set fetched yet — fallback)
 */
function perCartPath(set: SpriteSet, ndex: number, format: SaveFormat | null): string | null {
  if (set === 'gen3' || set === 'overworld' || format === null) return null;
  if (format === 'RBY-RED' || format === 'RBY-BLUE') {
    return `sprites/red-blue/${ndex}.png`;
  }
  if (format === 'RBY-YELLOW') {
    return `sprites/yellow/${ndex}.png`;
  }
  if (format === 'CRYSTAL') {
    return `sprites/crystal-anim/${ndex}.gif`;
  }
  if (format === 'GS') {
    return `sprites/crystal/${ndex}.png`;
  }
  return null;
}

/**
 * Species that should render visibly larger in the box browser — pseudo-legendary
 * and legendary mons. Multiplier applied via CSS scale on `.box-tile.is-big`.
 */
const BIG_NDEX = new Set<number>([
  // Gen 1 legendaries
  144, 145, 146, 150, 151,
  // Gen 2 legendaries / Lugia / Ho-Oh / Celebi
  243, 244, 245, 249, 250, 251,
  // Notably-large vanilla species (visual cue, not a strict tier)
  130, 143, 149, 208, 248,
]);

export function isBigSpecies(ndex: number): boolean {
  return BIG_NDEX.has(ndex);
}

export function spritePath(ndex: number, set: SpriteSet, format: SaveFormat | null = null): string {
  return perCartPath(set, ndex, format) ?? `sprites/${set}/${ndex}.png`;
}

export function spriteImg(
  ndex: number,
  set: SpriteSet,
  alt: string,
  format: SaveFormat | null = null,
): HTMLElement {
  if (set === 'overworld') return overworldTile(ndex, alt);
  const size = SPRITE_RENDER_SIZE[set];
  return img({
    src: spritePath(ndex, set, format),
    alt,
    class: 'sprite',
    loading: 'lazy',
    decoding: 'async',
    width: String(size),
    height: String(size),
  });
}

/**
 * 32×32 in-place walking animation tile. The source PNG is a 288×32 strip
 * with 9 frames of 32×32 each; the strip layout is roughly:
 *   0 = down idle, 1 = down walk-A, 2 = down walk-B,
 *   3 = up idle,   4 = up walk-A,   5 = up walk-B,
 *   6 = side idle, 7 = side walk-A, 8 = side walk-B (typically left-facing).
 *
 * For the box browser we cycle frames 0→1→2→0 (the down-facing pair).
 * That looks like an idle-bob / walk-in-place from the player's
 * perspective looking down at the box from above.
 *
 * Big species (legendaries, Snorlax, etc.) get a `is-big` class that the
 * stylesheet scales up by ~1.4×.
 */
function overworldTile(ndex: number, alt: string): HTMLElement {
  const tile = el('div', {
    class: 'sprite ow-sprite' + (isBigSpecies(ndex) ? ' is-big' : ''),
    role: 'img',
    'aria-label': alt,
    style: `background-image: url(${spritePath(ndex, 'overworld')});`,
  });
  return tile;
}
