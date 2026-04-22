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
  deleteMonGen1,
  deleteMonGen2,
} from '@pokeportal/core';
import { getSpecies } from '@pokeportal/core/internal';
import { setCartDebug } from '@pokeportal/core';
import type {
  Gen12Pokemon,
  Gen1DeleteRef,
  Gen1WriterFormat,
  Gen2DeleteRef,
  Gen2WriterFormat,
  SaveContents,
  SaveError,
  SaveFormat,
} from '@pokeportal/core';
import { zipFiles } from './zip.js';
import {
  type Action,
  type AppState,
  type ConvertResult,
  destCursorToSlot,
  INITIAL_STATE,
  type Mode,
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
import { modeToggle } from './ui/modeToggle.js';
import { cartProgress } from './ui/cartProgress.js';
import { isWebSerialAvailable } from './cart/browserCompat.js';
import { readCart, type CartReadDeps } from './cart/cartReader.js';
import { requestCartPort } from './cart/serialPort.js';
import { BackupSink, backupFilename } from './cart/backupSink.js';
import { isCartError } from '@pokeportal/core';

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
  // S6b source-side deletes for the two-save zip flow.
  readonly deleteMonGen1: typeof deleteMonGen1;
  readonly deleteMonGen2: typeof deleteMonGen2;
  // S7a — cart mode. `cartReadDeps` is overridable so jsdom tests can
  // inject a mock port factory; defaults to `requestCartPort` (the live
  // navigator.serial wrapper). `cartAvailable` is computed at controller
  // creation time from `'serial' in navigator`.
  readonly cartReadDeps?: CartReadDeps;
  readonly cartAvailable?: boolean;
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
  deleteMonGen1,
  deleteMonGen2,
  cartReadDeps: { requestPort: requestCartPort },
  cartAvailable: isWebSerialAvailable(),
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
  const bytes = new Uint8Array(buf);
  const result = deps.parseSave(bytes);
  if (deps.isSaveError(result)) {
    dispatch({ type: 'file_failed', error: result, fileName: file.name });
  } else {
    dispatch({ type: 'file_parsed', save: result, fileName: file.name, bytes });
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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function timestamp(now: Date): string {
  return (
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  );
}

function stripSav(name: string): string {
  return name.replace(/\.sav$/i, '');
}

/**
 * Build the timestamped suggested filename per orchestrator decision Q4:
 *   `${original-stem}.modified-${YYYYMMDDHHmmss}.sav`
 */
export function suggestModifiedFilename(originalName: string, now = new Date()): string {
  return `${stripSav(originalName)}.modified-${timestamp(now)}.sav`;
}

/**
 * S6b transfer-zip filename:
 *   `${source-stem}-to-${dest-stem}.transfer-${YYYYMMDDHHmmss}.zip`
 */
export function suggestTransferZipFilename(
  sourceName: string,
  destName: string,
  now = new Date(),
): string {
  return `${stripSav(sourceName)}-to-${stripSav(destName)}.transfer-${timestamp(now)}.zip`;
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
      'drop a Pokemon Red/Blue or Crystal save on the left, optionally drop a Gen 3 destination .sav on the right — convert + inject directly into a chosen PC slot.',
    ),
  );
  root.append(header);

  const mode: Mode = state.mode ?? 'upload';
  const cartAvailable = deps.cartAvailable ?? isWebSerialAvailable();
  root.append(
    modeToggle({
      mode,
      cartAvailable,
      onModeChange: (next) => dispatch({ type: 'mode_changed', mode: next }),
      onDisabledClick: () => {
        // First-time disabled-click → small explainer card. We append a
        // floating card to the root rather than a modal — the toggle
        // tooltip already carries the same message.
        const card = el('div', { class: 'card cart-fallback-explainer' }, FALLBACK_EXPLAINER);
        root.append(card);
        setTimeout(() => card.remove(), 6000);
      },
    }),
  );

  // Debug-only "Test backup" affordance per orchestrator decision Q4.
  if (mode === 'cart' && hasDebugFlag()) {
    root.append(renderTestBackupButton());
  }

  // Symmetric 2-pane layout. Source on the left, destination on the right.
  // Each side is independent — the user can drop them in either order. Empty
  // slots show the dotted upload zone; loaded slots show trainer + box browser.
  const grid = el('div', { class: 'panes-grid' });
  if (mode === 'cart') {
    grid.append(renderCartSourcePane(state, dispatch, deps));
    grid.append(renderCartDestPane(state, dispatch, deps));
  } else {
    grid.append(renderSourcePane(state, dispatch, deps));
    grid.append(renderDestPane(state, dispatch, deps));
  }
  root.append(grid);

  // Toolbar (reset / download-modified) only when something is loaded.
  if (state.kind === 'loaded' || state.dest || state.destDownload) {
    root.append(renderToolbar(state, dispatch));
  }

  // Comparison overlay — opened from clicking a source-side mon.
  if (state.kind === 'loaded' && state.openMon) {
    appendComparisonOverlay(root, state, dispatch, deps);
  }
}

const FALLBACK_EXPLAINER =
  'Cart Mode requires a Chromium-based browser (Chrome, Edge, Opera, Brave). Use Upload Mode instead.';

function hasDebugFlag(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  try {
    const v = new URLSearchParams(window.location.search).get('debug');
    return v === 'true' || v === '1';
  } catch {
    return false;
  }
}

// Wire `?debug=1` (or `?debug=true`) → enable cart wire-level debug log.
// Idempotent — safe to call on every render.
if (hasDebugFlag()) setCartDebug(true);

function renderTestBackupButton(): HTMLElement {
  const wrap = el('div', { class: 'card cart-debug' });
  const btn = el(
    'button',
    { class: 'secondary', type: 'button' },
    'Test backup (debug)',
  ) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    void runTestBackup(wrap);
  });
  wrap.append(btn);
  return wrap;
}

async function runTestBackup(host: HTMLElement): Promise<void> {
  const sample = new Uint8Array(32 * 1024);
  for (let i = 0; i < sample.length; i++) sample[i] = (i * 7) & 0xff;
  // No-op inner sink to prove the decorator's pre-write happens first.
  const innerCalls: number[] = [];
  const inner = {
    label: 'no-op',
    write: async (b: Uint8Array): Promise<void> => {
      innerCalls.push(b.length);
    },
  };
  const sink = new BackupSink(inner, sample, backupFilename('test-cart', 12345));
  try {
    await sink.write(sample);
    const ok = el(
      'div',
      { class: 'cart-debug__msg' },
      `Backup flow OK. Inner sink wrote ${innerCalls[0]} bytes.`,
    );
    host.append(ok);
  } catch (e) {
    const err = el(
      'div',
      { class: 'cart-debug__msg error' },
      `Backup flow failed: ${(e as Error).message}`,
    );
    host.append(err);
  }
}

function renderSourcePane(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): HTMLElement {
  const pane = el('div', { class: 'pane source-pane' });
  pane.append(el('div', { class: 'pane-label' }, 'SOURCE'));
  switch (state.kind) {
    case 'idle':
      pane.append(renderSourceDropZone(dispatch, deps, false));
      break;
    case 'parsing':
      pane.append(renderSourceDropZone(dispatch, deps, true));
      pane.append(
        el('div', { class: 'card parsing' }, `Parsing ${state.fileName} (${state.size} bytes)…`),
      );
      break;
    case 'parse_error':
      pane.append(renderSourceDropZone(dispatch, deps, false));
      pane.append(renderParseError(state.fileName, state.error, dispatch));
      break;
    case 'loaded': {
      const trainerLines = [
        `TRAINER: ${state.save.trainer.name || '(no name)'}`,
        `ID No.  ${state.save.trainer.tid}`,
        `FORMAT  ${state.save.format}`,
      ];
      pane.append(textDialog(trainerLines, { class: 'trainer-dialog' }));
      if (state.save.warnings.length > 0) {
        const warn = el('div', { class: 'warnings' });
        warn.append(el('strong', {}, 'Warnings:'));
        const ul = el('ul', {});
        for (const w of state.save.warnings) ul.append(el('li', {}, w));
        warn.append(ul);
        pane.append(warn);
      }
      const entries = entriesForBox(state.save, state.boxIndex);
      pane.append(
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
      break;
    }
  }
  return pane;
}

function renderDestPane(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): HTMLElement {
  const pane = el('div', { class: 'pane dest-pane' });
  pane.append(el('div', { class: 'pane-label' }, 'DESTINATION'));
  if (state.dest) {
    const lines = [
      `Destination: ${state.dest.fileName}`,
      `(${gen3GameLabel(state.dest.save.format)})`,
    ];
    pane.append(textDialog(lines, { class: 'trainer-dialog dest-summary' }));
    pane.append(
      destBoxBrowser({
        save: state.dest.save,
        boxIndex: state.dest.boxIndex,
        cursor: state.dest.cursor,
        onCursorMove: (drow, dcol) => dispatch({ type: 'dest_cursor_move', drow, dcol }),
        onBoxChange: (delta) => dispatch({ type: 'dest_box_change', delta }),
        onSlotClick: (slot) => {
          const row = Math.floor(slot / 6) as 0 | 1 | 2 | 3 | 4;
          const col = (slot % 6) as 0 | 1 | 2 | 3 | 4 | 5;
          dispatch({
            type: 'dest_cursor_move',
            drow: (row - state.dest!.cursor.row) as -1 | 0 | 1,
            dcol: (col - state.dest!.cursor.col) as -1 | 0 | 1,
          });
        },
      }),
    );
    return pane;
  }
  if (state.destParsing) {
    pane.append(renderDestDropZone(dispatch, deps, true));
    pane.append(
      el(
        'div',
        { class: 'card parsing' },
        `Parsing ${state.destParsing.fileName} (${state.destParsing.size} bytes)…`,
      ),
    );
    return pane;
  }
  if (state.destParseError) {
    pane.append(
      el(
        'div',
        { class: 'card error' },
        `Could not load ${state.destParseError.fileName}: ${state.destParseError.error.reason}`,
      ),
    );
  }
  pane.append(renderDestDropZone(dispatch, deps, false));
  return pane;
}

function renderCartSourcePane(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): HTMLElement {
  const pane = el('div', { class: 'pane source-pane cart-pane' });
  pane.append(el('div', { class: 'pane-label' }, 'SOURCE (CART)'));
  // If a save is already loaded (read came from the cart), show the
  // box browser identical to Upload Mode — the renderer doesn't care
  // where bytes came from.
  if (state.kind === 'loaded') {
    return renderSourcePane(state, dispatch, deps);
  }
  if (state.cartReadProgress) {
    pane.append(
      cartProgress({
        label: state.cartConnection?.deviceId ?? '',
        bytesRead: state.cartReadProgress.bytesRead,
        bytesTotal: state.cartReadProgress.bytesTotal,
        ...(state.cartReadProgress.phase ? { phase: state.cartReadProgress.phase } : {}),
      }),
    );
    return pane;
  }
  if (state.cartReadError) {
    pane.append(
      el(
        'div',
        { class: 'card error' },
        `Cart read failed: ${state.cartReadError.reason} — ${state.cartReadError.message}`,
      ),
    );
  }
  pane.append(renderCartConnectButton('source', dispatch, deps));
  return pane;
}

function renderCartDestPane(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): HTMLElement {
  const pane = el('div', { class: 'pane dest-pane cart-pane' });
  pane.append(el('div', { class: 'pane-label' }, 'DESTINATION (CART)'));
  if (state.dest) {
    return renderDestPane(state, dispatch, deps);
  }
  if (state.cartReadProgress) {
    // While a cart is being read into either side, only the source pane
    // shows the progress card by convention. Dest pane stays in its
    // pre-connect state until the source-pane progress completes.
  }
  pane.append(renderCartConnectButton('dest', dispatch, deps));
  return pane;
}

function renderCartConnectButton(
  side: 'source' | 'dest',
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): HTMLElement {
  const wrap = el('div', { class: 'cart-connect' });
  const btn = el(
    'button',
    { class: 'primary', type: 'button' },
    side === 'source' ? 'Connect cart (read)' : 'Connect destination cart',
  ) as HTMLButtonElement;
  if (!(deps.cartAvailable ?? isWebSerialAvailable())) {
    btn.setAttribute('disabled', 'disabled');
    btn.setAttribute('title', FALLBACK_EXPLAINER);
  }
  btn.addEventListener('click', () => {
    void handleCartConnect(side, dispatch, deps);
  });
  wrap.append(btn);
  wrap.append(
    el(
      'div',
      { class: 'hint' },
      side === 'source'
        ? 'Insert a Gen 1/2 (or Gen 3) cart and click Connect.'
        : 'Insert a Gen 3 cart and click Connect.',
    ),
  );
  return wrap;
}

export async function handleCartConnect(
  side: 'source' | 'dest',
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): Promise<void> {
  const cartReadDeps = deps.cartReadDeps;
  if (!cartReadDeps) {
    dispatch({
      type: 'cart_connect_failed',
      reason: 'PORT_OPEN_FAILED',
      message: 'No cart-read deps configured',
    });
    return;
  }
  dispatch({ type: 'cart_connect_started' });
  const result = await readCart(cartReadDeps, {
    onPhase: (phase) => {
      dispatch({
        type: 'cart_connect_progress',
        bytesRead: 0,
        bytesTotal: 0,
        ...(phase ? { phase } : {}),
      });
    },
    onProgress: (p) => {
      dispatch({
        type: 'cart_connect_progress',
        bytesRead: p.bytesRead,
        bytesTotal: p.bytesTotal,
        phase: 'reading',
      });
    },
  });
  if (result.kind === 'error') {
    if (isCartError(result.error)) {
      dispatch({
        type: 'cart_connect_failed',
        reason: result.error.reason,
        message: result.error.message,
      });
    } else {
      dispatch({
        type: 'cart_connect_failed',
        reason: result.error.reason,
        message: result.error.message,
      });
    }
    return;
  }
  if (side === 'source' && result.kind === 'gen12') {
    dispatch({
      type: 'cart_connect_succeeded',
      connection: { variant: detectVariantFromBanner(result.banner), deviceId: result.banner },
      save: result.gen12!,
      bytes: result.bytes,
      fileName: result.fileName,
    });
    return;
  }
  if (side === 'dest' && result.kind === 'gen3') {
    dispatch({
      type: 'cart_dest_connect_succeeded',
      connection: { variant: detectVariantFromBanner(result.banner), deviceId: result.banner },
      save: result.gen3!,
      bytes: result.bytes,
      fileName: result.fileName,
    });
    return;
  }
  // Mismatch: e.g. user clicked source but inserted a Gen 3 cart, or
  // vice versa. Surface as a friendly error.
  dispatch({
    type: 'cart_connect_failed',
    reason: 'UNSUPPORTED_CART',
    message:
      side === 'source'
        ? 'A Gen 3 cart was detected on the source side. Use the destination side instead.'
        : 'A Gen 1/2 cart was detected on the destination side. Use the source side instead.',
  });
}

function detectVariantFromBanner(banner: string): 'insidegadgets' | 'lesserkuma' {
  // Stock-firmware banners now contain "GBxCart RW" (synthesised from the
  // V/h single-byte replies). LK banners come straight from
  // QUERY_FW_INFO and use a different prefix (e.g. "FlashGBX...").
  return /GBxCart RW/i.test(banner) ? 'insidegadgets' : 'lesserkuma';
}

function renderToolbar(state: AppState, dispatch: (a: Action) => void): HTMLElement {
  const bar = el('div', { class: 'card toolbar' });
  const reset = el('button', { class: 'secondary' }, 'Reset') as HTMLButtonElement;
  reset.addEventListener('click', () => dispatch({ type: 'reset' }));
  bar.append(reset);
  if (state.dest) {
    const clearDest = el(
      'button',
      { class: 'secondary' },
      'Clear destination',
    ) as HTMLButtonElement;
    clearDest.addEventListener('click', () => dispatch({ type: 'dest_clear' }));
    bar.append(clearDest);
  }
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
  if (state.kind === 'loaded') {
    bar.append(el('span', { class: 'summary' }, hint(state)));
  }
  return bar;
}

function renderSourceDropZone(
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
  busy: boolean,
): HTMLElement {
  const zone = el('div', { class: 'drop-zone source-drop-zone' });
  zone.append(
    el('div', {}, busy ? 'Reading…' : 'Drop a Gen 1/2 .sav here, or pick one:'),
    (() => {
      const input = el('input', { type: 'file', accept: '' }) as HTMLInputElement;
      input.addEventListener('change', () => {
        const f = input.files?.[0];
        if (f) void handleFileSelected(f, dispatch, deps);
      });
      return input;
    })(),
    el('div', { class: 'hint' }, 'Pokemon Red, Blue, Yellow, Gold, Silver, Crystal (English).'),
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

function renderDestDropZone(
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
  busy: boolean,
): HTMLElement {
  const zone = el('div', { class: 'drop-zone dest-drop-zone' });
  zone.append(
    el('div', {}, busy ? 'Reading…' : 'Drop a Gen 3 .sav here, or pick one:'),
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
      'Ruby, Sapphire, Emerald, FireRed, LeafGreen (English, 64 KB or 128 KB).',
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

function appendComparisonOverlay(
  root: HTMLElement,
  state: Extract<AppState, { kind: 'loaded' }>,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): void {
  if (!state.openMon) return;
  const ref = state.openMon;
  const mon = monAt(state.save, ref);
  if (!mon) return;
  const speciesName = speciesNameFor(mon.speciesGen2Id);
  const nick = decodeNickFallback(mon, speciesName);
  const cached = state.results.get(monRefKey(ref));
  const result = cached ?? runConvert(mon, deps);
  let intermediate = null as Parameters<typeof comparisonView>[0]['intermediate'];
  let refusal: { reason: string; message: string } | undefined;
  if (result.ok) {
    const r = deps.convert(mon);
    if (deps.isRefusal(r)) {
      refusal = { reason: r.reason, message: r.message };
    } else {
      intermediate = r;
    }
  } else {
    refusal = { reason: result.reason, message: result.message };
  }
  const destStoreProp = buildDestStoreProp(state, intermediate, result, dispatch, deps);
  root.append(
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
  const sourceRef = state.openMon;
  if (!sourceRef) {
    // STORE button only renders inside the comparison overlay, which only
    // opens when openMon is set — so this is a defensive bailout.
    return {
      enabled: false,
      disabledReason: 'No source mon selected',
      onStore: () => {},
    };
  }
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
    // S6b: also delete the transferred mon from the source. Bundle both
    // modified saves into a zip so the user gets a single download
    // mirroring a real cart-to-cart trade.
    const sourceDelete = applySourceDelete(state.save, state.sourceBytes, sourceRef, deps);
    if (sourceDelete.kind === 'error') {
      const err: SaveError = {
        kind: 'save_error',
        reason: 'CORRUPTED',
        message: `source delete failed: ${sourceDelete.message}`,
      };
      dispatch({ type: 'file_failed', error: err, fileName: state.fileName });
      dispatch({ type: 'mon_close' });
      return;
    }
    const now = new Date();
    const ts = timestamp(now);
    const sourceModifiedName = `${stripSav(state.fileName)}.modified-${ts}.sav`;
    const destModifiedName = `${stripSav(dest.fileName)}.modified-${ts}.sav`;
    const zipBytes = zipFiles([
      { name: sourceModifiedName, bytes: sourceDelete.bytes },
      { name: destModifiedName, bytes: injectResult.bytes },
    ]);
    const zipName = suggestTransferZipFilename(state.fileName, dest.fileName, now);
    dispatch({
      type: 'store_committed',
      save: injectResult,
      bytes: zipBytes,
      suggestedFilename: zipName,
      sourceSave: sourceDelete.reparsed,
      sourceBytes: sourceDelete.bytes,
    });
    dispatch({ type: 'mon_close' });
  };
  return {
    enabled: true,
    onStore,
    ...(dexWarning ? { regionalDexWarning: dexWarning } : {}),
  };
}

interface SourceDeleteOk {
  readonly kind: 'ok';
  readonly bytes: Uint8Array;
  readonly reparsed: SaveContents;
}
interface SourceDeleteErr {
  readonly kind: 'error';
  readonly message: string;
}

function gen1Format(format: SaveFormat): Gen1WriterFormat | null {
  if (format === 'RBY-RED' || format === 'RBY-BLUE' || format === 'RBY-YELLOW') return format;
  return null;
}
function gen2Format(format: SaveFormat): Gen2WriterFormat | null {
  if (format === 'GS' || format === 'CRYSTAL') return format;
  return null;
}

function applySourceDelete(
  save: SaveContents,
  sourceBytes: Uint8Array,
  ref: { bucket: 'party' | 'currentBox' | 'box'; boxIndex?: number; slot: number },
  deps: ControllerDeps,
): SourceDeleteOk | SourceDeleteErr {
  try {
    const g1 = gen1Format(save.format);
    const g2 = gen2Format(save.format);
    let modified: Uint8Array;
    if (g1) {
      const delRef: Gen1DeleteRef =
        ref.bucket === 'box'
          ? { bucket: 'box', boxIndex: ref.boxIndex ?? 0, slot: ref.slot }
          : { bucket: ref.bucket, slot: ref.slot };
      modified = deps.deleteMonGen1(sourceBytes, g1, delRef);
    } else if (g2) {
      const delRef: Gen2DeleteRef =
        ref.bucket === 'box'
          ? { bucket: 'box', boxIndex: ref.boxIndex ?? 0, slot: ref.slot }
          : { bucket: ref.bucket, slot: ref.slot };
      modified = deps.deleteMonGen2(sourceBytes, g2, delRef);
    } else {
      return { kind: 'error', message: `unsupported source format ${save.format}` };
    }
    const reparsed = deps.parseSave(modified);
    if (deps.isSaveError(reparsed)) {
      return { kind: 'error', message: `${reparsed.reason}: ${reparsed.message}` };
    }
    return { kind: 'ok', bytes: modified, reparsed };
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
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
