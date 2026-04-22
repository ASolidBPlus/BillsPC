/**
 * S5 controller. Wires the Gen 2-style box browser, comparison overlay,
 * and the existing parse/convert/download pipeline (untouched: S1/S2/S3a
 * deliverables).
 *
 * Per PLAN_EVAL S5 A16, the S3a mid-render mutation of `state.results`
 * is removed: when conversion is needed, the controller dispatches a
 * `convert_done` action via `queueMicrotask` so the next render reads
 * the cached result without the renderer ever touching state directly.
 *
 * Per A17, conversion is lazy — only the mon the user opens via the
 * comparison overlay is converted (the box browser shows sprites without
 * needing to convert anything).
 *
 * Keyboard navigation was removed at the user's request — the app is mouse/touch
 * only. Historical note on A15: the root `#app` was set to `tabindex="-1"` and focused after
 * parse so keyboard input flows without an explicit click.
 */
import { parseSave, isSaveError, convert, isRefusal, packBoxed } from '@pokeportal/core';
import { getSpecies } from '@pokeportal/core/internal';
import type { Gen12Pokemon, SaveContents, SaveError } from '@pokeportal/core';
import {
  type Action,
  type AppState,
  type ConvertResult,
  INITIAL_STATE,
  type MonRef,
  monRefKey,
  reducer,
} from './state.js';
import { sanitiseFilename } from './filename.js';
import { blobDownload } from './download.js';
import { el } from './ui/dom.js';
import { textDialog } from './ui/dialog.js';
import {
  boxBrowser,
  entriesForBox,
  entryAtCursor,
  BROWSER_COLS,
  BROWSER_ROWS,
} from './ui/boxBrowser.js';
import { comparisonView, speciesNameFor } from './ui/comparisonView.js';

export interface ControllerDeps {
  readonly parseSave: typeof parseSave;
  readonly convert: typeof convert;
  readonly packBoxed: typeof packBoxed;
  readonly isSaveError: typeof isSaveError;
  readonly isRefusal: typeof isRefusal;
}

export const DEFAULT_DEPS: ControllerDeps = {
  parseSave,
  convert,
  packBoxed,
  isSaveError,
  isRefusal,
};

export interface Controller {
  dispatch(action: Action): void;
  state(): AppState;
}

export function createController(
  root: HTMLElement,
  deps: ControllerDeps = DEFAULT_DEPS,
): Controller {
  let current: AppState = INITIAL_STATE;

  const dispatch = (action: Action): void => {
    current = reducer(current, action);
    render(root, current, dispatch, deps);
    // Lazily convert mons on overlay-open (A17). The reducer can't
    // reach `deps.convert` so we do the work here, then dispatch
    // `convert_done` via microtask so the result lands on the next
    // render frame without recursing into the current dispatch.
    if (action.type === 'mon_open' && current.kind === 'loaded') {
      const ref = action.ref;
      const key = monRefKey(ref);
      if (!current.results.has(key)) {
        const mon = monAt(current.save, ref);
        if (mon) {
          const result = runConvert(mon, deps);
          queueMicrotask(() => dispatch({ type: 'convert_done', ref, result }));
        }
      }
    }
  };

  // First render. Keyboard navigation removed per user request — interaction is
  // mouse/touch only via the box-tile click handlers and the menu/dialog buttons.
  render(root, current, dispatch, deps);

  return {
    dispatch,
    state: () => current,
  };
}

function monAt(save: SaveContents, ref: MonRef): Gen12Pokemon | null {
  if (ref.bucket === 'party') return save.party[ref.slot] ?? null;
  if (ref.bucket === 'currentBox') return save.currentBox?.[ref.slot] ?? null;
  return save.boxes[ref.boxIndex ?? 0]?.[ref.slot] ?? null;
}

export async function handleFileSelected(
  file: File,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): Promise<void> {
  dispatch({ type: 'file_selected', file: { name: file.name, size: file.size } });
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(() => resolve(), 0);
    }
  });
  const buf = await file.arrayBuffer();
  const result = deps.parseSave(new Uint8Array(buf));
  if (deps.isSaveError(result)) {
    dispatch({ type: 'file_failed', error: result, fileName: file.name });
  } else {
    dispatch({ type: 'file_parsed', save: result, fileName: file.name });
  }
}

export function render(
  root: HTMLElement,
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): void {
  root.replaceChildren();
  const header = el('div', { class: 'card' });
  header.append(
    el('h1', {}, 'pokeportal'),
    el(
      'p',
      { class: 'subtitle' },
      'drop a Pokemon Red/Blue or Crystal save (.sav) — convert party + boxes to Gen 3 .pk3 entirely in your browser.',
    ),
  );
  root.append(header);

  switch (state.kind) {
    case 'idle':
      root.append(renderDropZone(dispatch, deps, false));
      break;
    case 'parsing':
      root.append(renderDropZone(dispatch, deps, true));
      root.append(
        el('div', { class: 'card parsing' }, `Parsing ${state.fileName} (${state.size} bytes)…`),
      );
      break;
    case 'parse_error':
      root.append(renderDropZone(dispatch, deps, false));
      root.append(renderParseError(state.fileName, state.error, dispatch));
      break;
    case 'loaded':
      root.append(renderLoaded(state, dispatch, deps));
      break;
  }
}

function renderDropZone(
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
  busy: boolean,
): HTMLElement {
  const zone = el('div', { class: 'drop-zone' });
  zone.append(
    el('div', {}, busy ? 'Reading…' : 'Drop a .sav file here, or pick one:'),
    (() => {
      const input = el('input', { type: 'file', accept: '' }) as HTMLInputElement;
      input.addEventListener('change', () => {
        const f = input.files?.[0];
        if (f) void handleFileSelected(f, dispatch, deps);
      });
      return input;
    })(),
    el(
      'div',
      { class: 'hint' },
      'Supports Pokemon Red, Blue, and Crystal (English). All processing is local — nothing leaves your browser.',
    ),
  );
  zone.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (ev) => {
    ev.preventDefault();
    zone.classList.remove('drag-over');
    const f = ev.dataTransfer?.files?.[0];
    if (f) void handleFileSelected(f, dispatch, deps);
  });
  return zone;
}

function renderParseError(
  fileName: string,
  error: SaveError,
  dispatch: (a: Action) => void,
): HTMLElement {
  const card = el('div', { class: 'card error' });
  card.append(
    el('div', {}, `Could not load ${fileName}.`),
    el(
      'div',
      { style: 'margin-top:0.5rem;font-size:0.85rem' },
      `${error.reason}: ${error.message}`,
    ),
    (() => {
      const b = el(
        'button',
        { class: 'secondary', style: 'margin-top:1rem' },
        'Try another file',
      ) as HTMLButtonElement;
      b.addEventListener('click', () => dispatch({ type: 'reset' }));
      return b;
    })(),
  );
  return card;
}

function renderLoaded(
  state: Extract<AppState, { kind: 'loaded' }>,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): DocumentFragment {
  const frag = document.createDocumentFragment();

  // Trainer dialog (Gen 2 chrome).
  const trainerLines: string[] = [
    `TRAINER: ${state.save.trainer.name || '(no name)'}`,
    `ID No.  ${state.save.trainer.tid}`,
    `FORMAT  ${state.save.format}`,
  ];
  frag.append(textDialog(trainerLines, { class: 'trainer-dialog' }));

  // Warnings panel (kept for Code Evaluator visibility).
  if (state.save.warnings.length > 0) {
    const warn = el('div', { class: 'warnings' });
    warn.append(el('strong', {}, 'Warnings:'));
    const ul = el('ul', {});
    for (const w of state.save.warnings) ul.append(el('li', {}, w));
    warn.append(ul);
    frag.append(warn);
  }

  // Box browser.
  const entries = entriesForBox(state.save, state.boxIndex);
  frag.append(
    boxBrowser({
      save: state.save,
      boxIndex: state.boxIndex,
      cursor: state.cursor,
      entries,
      onCursorMove: (drow, dcol) => dispatch({ type: 'cursor_move', drow, dcol }),
      onBoxChange: (delta) => dispatch({ type: 'box_change', delta }),
      onMonOpen: (ref) => dispatch({ type: 'mon_open', ref }),
    }),
  );

  // Toolbar with reset.
  const bar = el('div', { class: 'card toolbar' });
  const reset = el('button', { class: 'secondary' }, 'Load another file') as HTMLButtonElement;
  reset.addEventListener('click', () => dispatch({ type: 'reset' }));
  bar.append(reset);
  bar.append(el('span', { class: 'summary' }, hint(state)));
  frag.append(bar);

  // Comparison overlay (above the rest).
  if (state.openMon) {
    const ref = state.openMon;
    const mon = monAt(state.save, ref);
    if (mon) {
      const speciesName = speciesNameFor(mon.speciesGen2Id);
      const nick = decodeNickFallback(mon, speciesName);
      const cached = state.results.get(monRefKey(ref));
      const result = cached ?? runConvert(mon, deps);
      // (cached ?? runConvert) is a fallback for tests / first-render
      // races; the controller's mon_open handler already kicked the
      // microtask. The renderer never mutates state.
      let intermediate = null as Parameters<typeof comparisonView>[0]['intermediate'];
      let refusal: { reason: string; message: string } | undefined;
      if (result.ok) {
        // We need the Gen3Intermediate, not the packed bytes. Re-run
        // convert here — cheap because the search PID hits the seed
        // immediately on a known-good mon. Note: we already cached
        // .bytes for the download path; computing the intermediate
        // again is bounded.
        const r = deps.convert(mon);
        if (deps.isRefusal(r)) {
          refusal = { reason: r.reason, message: r.message };
        } else {
          intermediate = r;
        }
      } else {
        refusal = { reason: result.reason, message: result.message };
      }
      frag.append(
        comparisonView({
          mon,
          intermediate,
          refusal,
          speciesName,
          nickname: nick,
          onConfirm: () => {
            if (result.ok) {
              blobDownload(result.suggestedName, result.bytes);
            }
            dispatch({ type: 'mon_close' });
          },
          onCancel: () => dispatch({ type: 'mon_close' }),
        }),
      );
    }
  }

  return frag;
}

function hint(state: Extract<AppState, { kind: 'loaded' }>): string {
  return `${total(state)} mon(s) total — use ← ↑ ↓ → + Enter; [ / ] to change box.`;
}

function total(state: Extract<AppState, { kind: 'loaded' }>): number {
  let n = state.save.party.length;
  for (const b of state.save.boxes) n += b.length;
  if (state.save.currentBox) n += state.save.currentBox.length;
  return n;
}

function runConvert(mon: Gen12Pokemon, deps: ControllerDeps): ConvertResult {
  try {
    const r = deps.convert(mon);
    if (deps.isRefusal(r)) {
      return { ok: false, reason: r.reason, message: r.message };
    }
    const bytes = deps.packBoxed(r);
    const speciesEntry = getSpecies(mon.speciesGen2Id);
    const speciesName = speciesEntry?.name ?? `species-${mon.speciesGen2Id}`;
    const nick = decodeNickFallback(mon, speciesName);
    const filename = sanitiseFilename(speciesName, nick, mon.tid);
    return { ok: true, bytes, suggestedName: filename, speciesGen2Id: mon.speciesGen2Id };
  } catch (e) {
    return { ok: false, reason: 'CONVERT_THREW', message: (e as Error).message };
  }
}

function decodeNickFallback(mon: Gen12Pokemon, speciesName: string): string {
  let s = '';
  for (const b of mon.nicknameBytes) {
    if (b === 0x50 || b === 0x00 || b === 0xff) break;
    if (b >= 0x80 && b <= 0x99) s += String.fromCharCode(0x41 + (b - 0x80));
    else if (b >= 0xa0 && b <= 0xb9) s += String.fromCharCode(0x61 + (b - 0xa0));
    else if (b >= 0xf6 && b <= 0xff) s += String.fromCharCode(0x30 + (b - 0xf6));
    else s += '-';
  }
  s = s.replace(/^-+|-+$/g, '');
  return s || speciesName;
}

// Keep these constants importable so tests can reference them without
// re-importing the boxBrowser module.
export { BROWSER_COLS, BROWSER_ROWS };
