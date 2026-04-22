/**
 * Sprite path helpers + image factory.
 *
 * Per PLAN_EVAL S5 A7, every emitted `<img>` carries explicit `width` and
 * `height` HTML attributes (not CSS) so the browser reserves layout
 * space before the PNG decodes. The values match the static-asset
 * dimensions documented in PLAN §3.6 / A7.
 *
 * The `class="sprite"` selector picks up the `image-rendering` triple
 * declared in `style.css` (per A6: `-webkit-optimize-contrast`,
 * `-moz-crisp-edges`, `crisp-edges`, `pixelated`).
 *
 * Vite serves files under `web/public/` at the relative path that
 * matches the build's `base: './'`. Sprite URLs are emitted as
 * `sprites/<set>/<ndex>.png` — relative so they resolve correctly under
 * file:// previews and base-pathed deploys (per PLAN_EVAL S5 R1/R2).
 */
import { img } from './dom.js';

export type SpriteSet = 'gen1' | 'gen2' | 'gen3' | 'overworld';

export const SPRITE_RENDER_SIZE: Readonly<Record<SpriteSet, number>> = {
  gen1: 56,
  gen2: 56,
  gen3: 64,
  overworld: 32, // 16x16 source rendered at 2x
};

export function spritePath(ndex: number, set: SpriteSet): string {
  return `sprites/${set}/${ndex}.png`;
}

export function spriteImg(ndex: number, set: SpriteSet, alt: string): HTMLImageElement {
  const size = SPRITE_RENDER_SIZE[set];
  const i = img({
    src: spritePath(ndex, set),
    alt,
    class: 'sprite',
    loading: 'lazy',
    decoding: 'async',
    width: String(size),
    height: String(size),
  });
  return i;
}
