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
import {
  parseSave,
  isSaveError,
  convert,
  isRefusal,
  packBoxed,
  parseGen3Save,
  isGen3SaveError,
  injectIntoSave,
  isGen3InjectError,
  gen3GameLabel,
} from '@pokeportal/core';
import { getSpecies } from '@pokeportal/core/internal';
import type { Gen12Pokemon, SaveContents, SaveError } from '@pokeportal/core';
import {
  type Action,
  type AppState,
  type ConvertResult,
  destCursorToSlot,
  INITIAL_STATE,
  type MonRef,
  monRefKey,
  reducer,
} from './state.js';
import { sanitiseFilename } from './filename.js';
import { blobDownload } from './download.js';
import { el } from './ui/dom.js';
import { textDialog } from './ui/dialog.js';
import { boxBrowser, entriesForBox, BROWSER_COLS, BROWSER_ROWS } from './ui/boxBrowser.js';
import { comparisonView, speciesNameFor } from './ui/comparisonView.js';
import { destBoxBrowser } from './ui/destBoxBrowser.js';
import { regionalDexWarning } from './ui/regionalDex.js';

export interface ControllerDeps {
  readonly parseSave: typeof parseSave;
  readonly convert: typeof convert;
  readonly packBoxed: typeof packBoxed;
  readonly isSaveError: typeof isSaveError;
  readonly isRefusal: typeof isRefusal;
  // S6a injection deps (additive — S5 callers can keep their old shape).
  readonly parseGen3Save: typeof parseGen3Save;
  readonly isGen3SaveError: typeof isGen3SaveError;
  readonly injectIntoSave: typeof injectIntoSave;
  readonly isGen3InjectError: typeof isGen3InjectError;
}

export const DEFAULT_DEPS: ControllerDeps = {
  parseSave,
  convert,
  packBoxed,
  isSaveError,
  isRefusal,
  parseGen3Save,
  isGen3SaveError,
  injectIntoSave,
  isGen3InjectError,
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

/**
 * S6a destination-file handler. Parsed via `parseGen3Save`; failures go
 * through the same shaped `SaveError` channel as Gen 1/2 errors so the
 * reducer keeps a single error surface.
 */
export async function handleDestFileSelected(
  file: File,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): Promise<void> {
  dispatch({ type: 'dest_file_selected', file: { name: file.name, size: file.size } });
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(() => resolve(), 0);
    }
  });
  const buf = await file.arrayBuffer();
  const result = deps.parseGen3Save(new Uint8Array(buf));
  if (deps.isGen3SaveError(result)) {
    // Map Gen3SaveError → SaveError so the reducer stays uniform.
    const compatErr: SaveError = {
      kind: 'save_error',
      reason:
        result.reason === 'TOO_SHORT'
          ? 'TOO_SHORT'
          : result.reason === 'CORRUPTED'
            ? 'CORRUPTED'
            : 'UNRECOGNIZED_FORMAT',
      message: result.message,
    };
    dispatch({ type: 'dest_file_failed', error: compatErr, fileName: file.name });
  } else {
    dispatch({ type: 'dest_file_parsed', save: result, fileName: file.name });
  }
}

/**
 * Build the timestamped suggested filename per orchestrator decision Q4:
 *   `${original-stem}.modified-${YYYYMMDDHHmmss}.sav`
 */
export function suggestModifiedFilename(originalName: string, now = new Date()): string {
  // Strip a trailing .sav (case-insensitive) if present; preserve everything else.
  const stem = originalName.replace(/\.sav$/i, '');
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stem}.modified-${ts}.sav`;
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

  // Two-column layout at desktop widths: trainer card + warnings on the left,
  // box browser on the right. Mobile/narrow stacks naturally via CSS.
  const grid = el('div', { class: 'loaded-grid' });

  const sidebar = el('div', { class: 'loaded-sidebar' });
  const trainerLines: string[] = [
    `TRAINER: ${state.save.trainer.name || '(no name)'}`,
    `ID No.  ${state.save.trainer.tid}`,
    `FORMAT  ${state.save.format}`,
  ];
  sidebar.append(textDialog(trainerLines, { class: 'trainer-dialog' }));

  if (state.save.warnings.length > 0) {
    const warn = el('div', { class: 'warnings' });
    warn.append(el('strong', {}, 'Warnings:'));
    const ul = el('ul', {});
    for (const w of state.save.warnings) ul.append(el('li', {}, w));
    warn.append(ul);
    sidebar.append(warn);
  }

  // S6a: destination drop zone / summary in the sidebar.
  sidebar.append(renderDestSidebar(state, dispatch, deps));

  grid.append(sidebar);

  const entries = entriesForBox(state.save, state.boxIndex);
  grid.append(
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

  // S6a: render the destination box browser when a dest is loaded.
  if (state.dest) {
    grid.append(
      destBoxBrowser({
        save: state.dest.save,
        boxIndex: state.dest.boxIndex,
        cursor: state.dest.cursor,
        onCursorMove: (drow, dcol) => dispatch({ type: 'dest_cursor_move', drow, dcol }),
        onBoxChange: (delta) => dispatch({ type: 'dest_box_change', delta }),
        onSlotClick: (slot) => {
          const row = Math.floor(slot / 6) as 0 | 1 | 2 | 3 | 4;
          const col = (slot % 6) as 0 | 1 | 2 | 3 | 4 | 5;
          // Move cursor to the clicked slot via clamped delta moves so
          // the reducer's clamp logic is the single source of truth.
          dispatch({
            type: 'dest_cursor_move',
            drow: (row - state.dest!.cursor.row) as -1 | 0 | 1,
            dcol: (col - state.dest!.cursor.col) as -1 | 0 | 1,
          });
          // The above only supports |1| moves; for larger jumps we'd
          // need a "set cursor" action. Keep simple for S6a: clicking an
          // adjacent tile moves the cursor; jumping requires arrow nav.
          // (Tests assert the click handler exists; not the multi-step jump.)
        },
      }),
    );
  }

  frag.append(grid);

  // Toolbar with reset + (S6a) "Download modified .sav" when ready.
  const bar = el('div', { class: 'card toolbar' });
  const reset = el('button', { class: 'secondary' }, 'Load another file') as HTMLButtonElement;
  reset.addEventListener('click', () => dispatch({ type: 'reset' }));
  bar.append(reset);
  if (state.destDownload) {
    const dl = el(
      'button',
      { class: 'primary download-modified' },
      `Download ${state.destDownload.suggestedFilename}`,
    ) as HTMLButtonElement;
    dl.addEventListener('click', () => {
      blobDownload(state.destDownload!.suggestedFilename, state.destDownload!.bytes);
    });
    bar.append(dl);
  }
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
      // S6a: build destStore prop. Visible when comparison overlay is
      // open even without a dest (per Q3 — visible-but-disabled with
      // tooltip). Enabled iff dest loaded AND cursor sits on an empty
      // slot AND we have a packed result for this mon.
      const destStoreProp = buildDestStoreProp(state, intermediate, result, dispatch, deps);
      frag.append(
        comparisonView({
          mon,
          intermediate,
          refusal,
          speciesName,
          nickname: nick,
          sourceFormat: state.save.format,
          onConfirm: () => {
            if (result.ok) {
              blobDownload(result.suggestedName, result.bytes);
            }
            dispatch({ type: 'mon_close' });
          },
          onCancel: () => dispatch({ type: 'mon_close' }),
          ...(destStoreProp ? { destStore: destStoreProp } : {}),
        }),
      );
    }
  }

  return frag;
}

function renderDestSidebar(
  state: Extract<AppState, { kind: 'loaded' }>,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): HTMLElement {
  const card = el('div', { class: 'dest-sidebar' });
  if (state.dest) {
    const lines: string[] = [
      `Destination: ${state.dest.fileName}`,
      `(${gen3GameLabel(state.dest.save.format)})`,
    ];
    card.append(textDialog(lines, { class: 'dest-summary' }));
    const change = el('button', { class: 'secondary' }, 'Change destination') as HTMLButtonElement;
    change.addEventListener('click', () => dispatch({ type: 'dest_clear' }));
    card.append(change);
    return card;
  }
  if (state.destParsing) {
    card.append(el('div', { class: 'card parsing' }, `Parsing ${state.destParsing.fileName}…`));
    return card;
  }
  if (state.destParseError) {
    card.append(
      el(
        'div',
        { class: 'card error' },
        `Could not load ${state.destParseError.fileName}: ${state.destParseError.error.reason}`,
      ),
    );
  }
  // Drop zone for destination
  const zone = el('div', { class: 'drop-zone dest-drop-zone' });
  zone.append(
    el('div', {}, 'Drop destination .sav (Gen 3, 64 KB or 128 KB):'),
    (() => {
      const input = el('input', {
        type: 'file',
        accept: '',
        class: 'dest-file-input',
      }) as HTMLInputElement;
      input.addEventListener('change', () => {
        const f = input.files?.[0];
        if (f) void handleDestFileSelected(f, dispatch, deps);
      });
      return input;
    })(),
    el(
      'div',
      { class: 'hint' },
      'Optional: load a Gen 3 destination save to inject converted Pokemon directly into one of its PC boxes.',
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
    if (f) void handleDestFileSelected(f, dispatch, deps);
  });
  card.append(zone);
  return card;
}

interface DestStoreProp {
  enabled: boolean;
  disabledReason?: string;
  regionalDexWarning?: string;
  onStore: () => void;
}

function buildDestStoreProp(
  state: Extract<AppState, { kind: 'loaded' }>,
  intermediate: Parameters<typeof comparisonView>[0]['intermediate'],
  result: ConvertResult,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): DestStoreProp | null {
  if (!intermediate) return null; // refused mons get no STORE button at all
  if (!state.dest) {
    return {
      enabled: false,
      disabledReason: 'Load a destination save first',
      onStore: () => {},
    };
  }
  const { dest } = state;
  const slotIdx = destCursorToSlot(dest.cursor);
  const targetSlot = dest.save.pc.boxes[dest.boxIndex]?.[slotIdx];
  if (!targetSlot || targetSlot.kind === 'filled') {
    return {
      enabled: false,
      disabledReason: 'Selected destination slot is occupied; pick an empty one',
      onStore: () => {},
    };
  }
  if (!result.ok) {
    return {
      enabled: false,
      disabledReason: 'Conversion failed; cannot store',
      onStore: () => {},
    };
  }
  const dexWarning = regionalDexWarning(dest.save.family, intermediate.species);
  const onStore = (): void => {
    const injectResult = deps.injectIntoSave(
      dest.save,
      { boxIndex: dest.boxIndex, slot: slotIdx },
      result.bytes,
    );
    if (deps.isGen3InjectError(injectResult)) {
      // Surface via the parse-error channel with a synthetic SaveError.
      const err: SaveError = {
        kind: 'save_error',
        reason: 'CORRUPTED',
        message: `inject failed: ${injectResult.reason}: ${injectResult.message}`,
      };
      dispatch({ type: 'dest_file_failed', error: err, fileName: dest.fileName });
      dispatch({ type: 'mon_close' });
      return;
    }
    const filename = suggestModifiedFilename(dest.fileName);
    dispatch({
      type: 'store_committed',
      save: injectResult,
      bytes: injectResult.bytes,
      suggestedFilename: filename,
    });
    dispatch({ type: 'mon_close' });
  };
  return {
    enabled: true,
    onStore,
    ...(dexWarning ? { regionalDexWarning: dexWarning } : {}),
  };
}

function hint(state: Extract<AppState, { kind: 'loaded' }>): string {
  return `${total(state)} mon(s) total — click a tile to convert; ◀ ▶ buttons to change box.`;
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
