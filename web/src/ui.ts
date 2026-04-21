/**
 * Render functions and DOM controller for the upload UI.
 *
 * The renderer takes an `AppState` and rebuilds the entire `<div id="app">`
 * subtree. There's no virtual DOM; the page is small and rebuild is
 * cheap.
 *
 * Per PLAN_EVAL A12, the file input uses `accept=""` (any file) so OS
 * MIME quirks don't drop legitimate `.sav` uploads.
 *
 * Per PLAN_EVAL A13, the controller dispatches `file_selected` then
 * yields via `requestAnimationFrame` before invoking parseSave so the
 * "parsing…" state actually paints.
 *
 * Per PLAN_EVAL A14, empty-party / all-refused / warnings panels render
 * explicitly above the mon list.
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
import { zipFiles, type ZipEntry } from './zip.js';

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
  };

  render(root, current, dispatch, deps);

  return {
    dispatch,
    state: () => current,
  };
}

export async function handleFileSelected(
  file: File,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): Promise<void> {
  dispatch({ type: 'file_selected', file: { name: file.name, size: file.size } });
  // Yield once so the "parsing" state has a chance to paint.
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

interface MonEntry {
  readonly ref: MonRef;
  readonly mon: Gen12Pokemon;
  readonly result: ConvertResult;
}

function renderLoaded(
  state: Extract<AppState, { kind: 'loaded' }>,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): DocumentFragment {
  const frag = document.createDocumentFragment();

  // Trainer card (with format badge).
  const trainerCard = el('div', { class: 'card' });
  trainerCard.append(
    (() => {
      const grid = el('div', { class: 'trainer-grid' });
      grid.append(
        el('div', {}, `Trainer: ${state.save.trainer.name || '(no name)'}`),
        el('div', {}, `TID: ${state.save.trainer.tid}`),
        el('span', { class: 'format-badge' }, state.save.format),
      );
      return grid;
    })(),
  );
  frag.append(trainerCard);

  // Warnings panel ABOVE the mon list (per PLAN_EVAL A14).
  if (state.save.warnings.length > 0) {
    const warn = el('div', { class: 'warnings' });
    warn.append(el('strong', {}, 'Warnings:'));
    const ul = el('ul', {});
    for (const w of state.save.warnings) ul.append(el('li', {}, w));
    warn.append(ul);
    frag.append(warn);
  }

  // Compute every mon entry up front so the toolbar / empty-state can
  // reference live data.
  const entries = collectEntries(state.save, deps);
  // Run convert lazily for any mon not yet processed; cache into state.
  const newResults = new Map(state.results);
  for (const e of entries) {
    const key = monRefKey(e.ref);
    if (!newResults.has(key)) {
      newResults.set(key, runConvert(e.mon, e.ref, deps));
    }
  }
  // If results changed, re-dispatch a no-op convert_done to commit. We
  // mutate state directly here for efficiency: the renderer is the only
  // path that triggers this and we want the next render to read the cache.
  if (newResults.size !== state.results.size) {
    // Snapshot the new map back into state without re-rendering — render is
    // already running. This is safe because no other consumer reads
    // `state.results` mid-render.
    (state as { results: ReadonlyMap<string, ConvertResult> }).results = newResults;
  }

  const enriched: MonEntry[] = entries.map((e) => ({
    ref: e.ref,
    mon: e.mon,
    result: newResults.get(monRefKey(e.ref))!,
  }));

  const totalMons = enriched.length;
  const refusedCount = enriched.filter((e) => !e.result.ok).length;
  const convertibleCount = totalMons - refusedCount;

  // Empty save state.
  if (totalMons === 0) {
    frag.append(el('div', { class: 'card empty' }, 'Save loaded but contains no Pokemon.'));
    frag.append(renderToolbar(0, 0, true, dispatch, enriched));
    return frag;
  }

  // Party.
  if (state.save.party.length > 0) {
    frag.append(
      renderSection(
        'Party',
        state.save.party.length,
        enriched.filter((e) => e.ref.bucket === 'party'),
        dispatch,
      ),
    );
  }

  // Current box (Gen 1 / Gen 2 live buffer).
  if (state.save.currentBox && state.save.currentBox.length > 0) {
    const sec = renderCollapsibleSection(
      `Current PC Box (${state.save.currentBox.length})`,
      state.currentBoxExpanded,
      enriched.filter((e) => e.ref.bucket === 'currentBox'),
      () => dispatch({ type: 'current_box_toggled' }),
    );
    frag.append(sec);
  }

  // Stored boxes.
  for (let i = 0; i < state.save.boxes.length; i++) {
    const box = state.save.boxes[i]!;
    if (box.length === 0) continue;
    const expanded = state.expandedBoxes.has(i);
    const inBox = enriched.filter((e) => e.ref.bucket === 'box' && e.ref.boxIndex === i);
    const sec = renderCollapsibleSection(`Box ${i + 1} (${box.length})`, expanded, inBox, () =>
      dispatch({ type: 'box_toggled', boxIndex: i }),
    );
    frag.append(sec);
  }

  frag.append(renderToolbar(totalMons, refusedCount, convertibleCount === 0, dispatch, enriched));

  return frag;
}

interface RawEntry {
  readonly ref: MonRef;
  readonly mon: Gen12Pokemon;
}

function collectEntries(save: SaveContents, _deps: ControllerDeps): RawEntry[] {
  void _deps;
  const out: RawEntry[] = [];
  for (let i = 0; i < save.party.length; i++) {
    out.push({ ref: { bucket: 'party', slot: i }, mon: save.party[i]! });
  }
  if (save.currentBox) {
    for (let i = 0; i < save.currentBox.length; i++) {
      out.push({ ref: { bucket: 'currentBox', slot: i }, mon: save.currentBox[i]! });
    }
  }
  for (let b = 0; b < save.boxes.length; b++) {
    const box = save.boxes[b]!;
    for (let i = 0; i < box.length; i++) {
      out.push({ ref: { bucket: 'box', boxIndex: b, slot: i }, mon: box[i]! });
    }
  }
  return out;
}

function runConvert(mon: Gen12Pokemon, _ref: MonRef, deps: ControllerDeps): ConvertResult {
  void _ref;
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
  // Decode nickname bytes as printable Gen 1/2 chars; falls back to the
  // species name if nothing decodable. We avoid importing decodeGen12
  // here to keep the bundle small — a lightweight ASCII-printable filter
  // covers the common case (uppercase ASCII), and unknown bytes drop
  // into 'no-nickname' via sanitiseFilename's empty fallback.
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

function renderSection(
  title: string,
  _count: number,
  entries: MonEntry[],
  dispatch: (a: Action) => void,
): HTMLElement {
  void _count;
  const card = el('div', { class: 'card section' });
  card.append(el('h2', {}, title));
  for (const e of entries) {
    card.append(renderMonRow(e, dispatch));
  }
  return card;
}

function renderCollapsibleSection(
  title: string,
  expanded: boolean,
  entries: MonEntry[],
  onToggle: () => void,
): HTMLElement {
  const card = el('div', { class: 'card section' });
  const head = el('h2', {});
  head.append(document.createTextNode(title));
  const toggle = el(
    'span',
    { class: 'box-toggle' },
    expanded ? '[collapse]' : '[expand]',
  ) as HTMLSpanElement;
  toggle.addEventListener('click', onToggle);
  head.append(toggle);
  card.append(head);
  if (expanded) {
    for (const e of entries) {
      card.append(renderMonRow(e, () => undefined));
    }
  }
  return card;
}

function renderMonRow(entry: MonEntry, _dispatch: (a: Action) => void): HTMLElement {
  void _dispatch;
  const row = el('div', { class: 'mon-row' });
  const speciesEntry = getSpecies(entry.mon.speciesGen2Id);
  const speciesName = speciesEntry?.name ?? `(unknown #${entry.mon.speciesGen2Id})`;
  const nick = decodeNickFallback(entry.mon, speciesName);
  const meta = el('div', { class: 'mon-meta' });
  meta.append(
    el('strong', {}, speciesName),
    document.createTextNode(' '),
    el('span', { class: 'nick' }, `"${nick}" Lv${entry.mon.level}`),
  );
  if (!entry.result.ok) {
    meta.append(el('span', { class: 'refusal' }, `${entry.result.reason}`));
  }
  row.append(meta);

  if (entry.result.ok) {
    const dl = el('button', {}, 'Download .pk3') as HTMLButtonElement;
    dl.addEventListener('click', () => {
      if (entry.result.ok) blobDownload(entry.result.suggestedName, entry.result.bytes);
    });
    row.append(dl);
  } else {
    row.append(el('span', { class: 'refusal', title: entry.result.message }, 'refused'));
  }
  return row;
}

function renderToolbar(
  total: number,
  refused: number,
  allRefused: boolean,
  dispatch: (a: Action) => void,
  entries: MonEntry[],
): HTMLElement {
  const bar = el('div', { class: 'card toolbar' });
  const convertAll = el('button', {}, 'Convert all (.zip)') as HTMLButtonElement;
  if (allRefused || total === 0) {
    convertAll.disabled = true;
    convertAll.title =
      total === 0
        ? 'No Pokemon in this save.'
        : `All ${total} mons are refused — see refusal reasons inline.`;
  }
  convertAll.addEventListener('click', () => {
    const zipEntries: ZipEntry[] = [];
    let i = 0;
    for (const e of entries) {
      if (!e.result.ok) continue;
      const idx = i.toString().padStart(3, '0');
      zipEntries.push({ name: `${idx}-${e.result.suggestedName}`, bytes: e.result.bytes });
      i++;
    }
    if (zipEntries.length === 0) return;
    const zip = zipFiles(zipEntries);
    blobDownload('pokeportal-pk3-bundle.zip', zip, 'application/zip');
  });

  const reset = el('button', { class: 'secondary' }, 'Load another file') as HTMLButtonElement;
  reset.addEventListener('click', () => dispatch({ type: 'reset' }));

  bar.append(convertAll, reset);
  bar.append(el('span', { class: 'summary' }, `${total} mon(s), ${refused} refused`));
  return bar;
}

function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: (string | Node)[]
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) {
    if (typeof c === 'string') e.append(document.createTextNode(c));
    else e.append(c);
  }
  return e;
}
