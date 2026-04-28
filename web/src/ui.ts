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
import { deriveSourceRefKey } from './cart/stagingStore.js';
import { deserializeGen12FromStaging, serializeGen12ForStaging } from './cart/stagingPayload.js';
import { entriesForBox as entriesForSourceBox } from './ui/boxBrowser.js';
import type { StagedSlot } from './cart/stagingStore.types.js';
import type { PreviewedPlacement } from './ui/workbench.js';
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
import { stagingPane } from './ui/stagingPane.js';
import { openStatScreenModal } from './ui/statScreen.js';
import {
  renderWorkbench,
  type LeftRole,
  type WorkbenchProps,
} from './ui/workbench.js';
import { confirmFlashDialog } from './ui/confirmFlashDialog.js';
import { flashProgressOverlay } from './ui/flashProgressOverlay.js';
import { recoveryDialog } from './ui/recoveryDialog.js';
import { StagingStore } from './cart/stagingStore.js';
import {
  runAddSelectedToTransfer as runAddSelectedToTransferImpl,
  runAddSelectedToDestination as runAddSelectedToDestinationImpl,
  runClearTransferBox as runClearTransferBoxImpl,
  runCommitSource as runCommitSourceImpl,
  runCommitDestination as runCommitDestinationImpl,
} from './ui/v2Actions.js';
import { flashCart, type CartFlasherDeps } from './cart/cartFlasher.js';
import { parseUrlFlags } from './cart/urlFlags.js';
import {
  composeSourceWrite,
  composeDestinationWrite,
  isComposeError,
  unpackBoxed,
  isDecodeError,
  encodeMonGen2,
  type CartFamily,
  type StagedMonRefGen12,
  type StagedMonRefGen3,
} from '@pokeportal/core';
import type { StagedMon } from './cart/stagingStore.types.js';

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
  // S7b — optional staging-store factory. Defaults to `StagingStore.open()`.
  // Tests inject a fake-indexeddb-backed store. `null` disables the
  // staging UI entirely (jsdom unit tests for non-staging surface).
  readonly stagingStoreFactory?: () => Promise<StagingStore | null>;
  /**
   * S7b — optional cart-flasher deps. Defaults to a `CartFlasherDeps`
   * built from `requestCartPort` + URL-flag overrides parsed at
   * controller-create time (Gap 1 + Gap 3 from EVAL.md). Tests inject a
   * stub that returns a fake port.
   */
  readonly flashDeps?: CartFlasherDeps;
  /**
   * S7b — runtime accessor for the IDB-backed staging store. Set by
   * `createController` to a closure that reads the store ref after it
   * opens. Render-side handlers call this to drive `stageMon`/`unstage`/
   * `setDestination` mutations without threading the store through props.
   */
  readonly getStagingStore?: () => StagingStore | null;
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
  // flashDeps is built lazily inside `createController` so URL-flag
  // parsing happens at runtime (test-friendly: each `createController`
  // call re-reads `window.location.search`). Leaving it `undefined` here
  // is the signal for the controller to build the default.
};

export interface Controller {
  dispatch(action: Action): void;
  state(): AppState;
  /** S7b — internal accessor for the live IDB-backed staging store.
   *  Returns null if the store hasn't opened yet (or IDB unavailable). */
  _stagingStore?(): StagingStore | null;
}

export function createController(
  root: HTMLElement,
  deps: ControllerDeps = DEFAULT_DEPS,
): Controller {
  let current: AppState = INITIAL_STATE;
  let stagingStore: StagingStore | null = null;

  // AMEND-S7b-3 / -19 / DECISION-6 — resolve cart-write HIL flags from
  // the URL once at controller-create time. Tests inject `flashDeps`
  // directly; production lazily builds from `requestCartPort` + the
  // parsed URL flags so the bisection levers (`?cart-write-chunk=64`,
  // `?cart-write-baud=1m`) take effect without code edits.
  const resolvedFlashDeps: CartFlasherDeps = deps.flashDeps ?? buildDefaultFlashDeps();
  const effectiveDeps: ControllerDeps = {
    ...deps,
    flashDeps: resolvedFlashDeps,
    getStagingStore: () => stagingStore,
  };

  const dispatch = (action: Action): void => {
    current = reducer(current, action);
    render(root, current, dispatch, effectiveDeps);
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
  render(root, current, dispatch, effectiveDeps);

  // S7b — open the IDB-backed staging store and subscribe. The store
  // surface is pub/sub: every mutation pushes a fresh `StagingSessionV1`
  // into the reducer via `staging_loaded`. AMEND-S7b-18 multi-tab banner
  // surfaces via the `subscribeMultiTab` channel.
  //
  // S8v2.2 — the subscribe wire continues to use the LEGACY callback
  // shape (`(session: StagingSessionV1) => void`) per
  // DECISION-S8v2.2-7. The dispatch additionally carries `slots`
  // (the new slot-addressed snapshot) so the reducer can populate
  // `state.staging.slots` directly without re-deriving from
  // `session.stagedMons`. AMEND-S8v2.2-9 — the overflow banner from
  // an IDB migration is dispatched once right after the first
  // staging_loaded.
  const factory = deps.stagingStoreFactory ?? defaultStagingStoreFactory;
  void factory()
    .then((store) => {
      if (!store) return;
      stagingStore = store;
      store.subscribe((session) => {
        dispatch({
          type: 'staging_loaded',
          session,
          slots: store.getAllSlots(),
        });
      });
      store.subscribeMultiTab(() => {
        dispatch({ type: 'multi_tab_claim_received' });
      });
      // AMEND-S8v2.2-9 — surface migration overflow once. The store
      // sets `pendingMigrationOverflow` during open() if a v1→v2
      // migration dropped staged mons past the 30-slot cap.
      if (store.pendingMigrationOverflow > 0) {
        dispatch({
          type: 'staging_migration_overflow',
          dropped: store.pendingMigrationOverflow,
        });
        store.pendingMigrationOverflow = 0;
      }
    })
    .catch(() => {
      /* IndexedDB unavailable — staging UI stays empty, app degrades gracefully */
    });

  return {
    dispatch,
    state: () => current,
    // Expose getStagingStore for the cart-flash handlers below — kept
    // off the public Controller interface so test suites that don't care
    // can ignore it.
    _stagingStore: () => stagingStore,
  } as Controller;
}

async function defaultStagingStoreFactory(): Promise<StagingStore | null> {
  try {
    return await StagingStore.open();
  } catch {
    return null;
  }
}

/**
 * Build the default `CartFlasherDeps` from `requestCartPort` + URL-flag
 * overrides. Per AMEND-S7b-3 / AMEND-S7b-19 / DECISION-6 the URL flags
 * `?cart-write-chunk=64` and `?cart-write-baud=1m` provide HIL bisection
 * levers without requiring a code edit when a real-cart write fails.
 */
function buildDefaultFlashDeps(): CartFlasherDeps {
  const search = typeof window !== 'undefined' && window.location ? window.location.search : '';
  const flags = parseUrlFlags(search);
  return {
    requestPort: requestCartPort,
    ...flags,
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

/** S8v2.3: v2 is now the default UI. The legacy S7b workbench is
 *  preserved behind `?ui=v1` as a fallback while we validate v2 in
 *  production. A future sprint will drop the v1 codepaths entirely. */
function hasLegacyV1Flag(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  try {
    return new URLSearchParams(window.location.search).get('ui') === 'v1';
  } catch {
    return false;
  }
}

/** Fetch a vendored demo .sav, wrap as a File, and feed it through the
 *  same parse pipeline as a real upload. Side ('source' or 'dest')
 *  picks which handler to hit. Surfaces in renderV2 behind the
 *  pre-existing `?debug=1` URL flag (see `hasDebugFlag` further down). */
async function loadDemoSave(
  side: 'source' | 'dest',
  fileName: string,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): Promise<void> {
  const url = `debug-saves/${fileName}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('[debug] failed to fetch demo save', url, res.status);
    return;
  }
  const buf = await res.arrayBuffer();
  const file = new File([buf], fileName, { type: 'application/octet-stream' });
  if (side === 'source') {
    await handleFileSelected(file, dispatch, deps);
  } else {
    await handleDestFileSelected(file, dispatch, deps);
  }
}

export function render(
  root: HTMLElement,
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): void {
  // v2 is the default; `?ui=v1` opts back into the legacy layout for
  // fallback / debugging during the v2 rollout.
  if (!hasLegacyV1Flag()) {
    renderV2(root, state, dispatch, deps);
    return;
  }
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
  // Per AMEND-S7b-15 / PLAN §10.1: in Cart Mode, the right pane is the
  // STAGING pane (always visible, even empty); the destination cart's box
  // browser becomes a sub-view of the staging pane via the segmented control.
  const grid = el('div', { class: 'panes-grid' });
  if (mode === 'cart') {
    grid.append(renderCartSourcePane(state, dispatch, deps));
    grid.append(renderStagingRightPane(state, dispatch, deps));
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

  // S7b cart-flash floating overlays. Render after the panes so they
  // visually float on top.
  appendCartFlashOverlays(root, state, dispatch, deps);
}

/**
 * S7b Cart-Mode right pane = staging pane (per PLAN §10.1 / AMEND-S7b-15).
 * The dest box browser becomes a sub-view of staging via the segmented
 * control. When a destination cart is connected, the user clicks
 * "Destination" to switch.
 */
/**
 * S8v2 entry point — workbench layout per user mock (2026-04-25). For
 * v1 of v2 (heh) only the empty-state shell is wired; subsequent phases
 * will swap inner pane content for loaded box browsers, populated temp
 * box, etc. The protocol layer + sink stack are unchanged.
 */
function renderV2(
  root: HTMLElement,
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): void {
  root.replaceChildren();
  // AMEND-S8v2.1-8 — defensive close: if `state.openMon` is set when v2
  // first renders (e.g. user toggled `?ui=v2` mid-session after clicking
  // a source mon), clear it so we don't have a stuck-overlay state. v2.1
  // doesn't surface the comparison overlay; that's S8v2.2.
  if (state.kind === 'loaded' && state.openMon) {
    queueMicrotask(() => dispatch({ type: 'mon_close' }));
  }
  // S8v2.2 — defensive selection clear is naturally handled by the
  // reducer's `withSelectionsCleared` path on context-shifting actions
  // (per AMEND-S8v2.2 §2.4). No first-render dispatch is needed: the
  // selection state space is v2-only (legacy renderer never populates
  // it), so a user toggling `?ui=v2` mid-session won't see a stale
  // selection unless they EXPLICITLY made one in v2 first. Documented
  // here so a future EVAL.md doesn't flag the v2.1 mon_close defense
  // as missing for selection.
  // Stadium-style speaker dialog: ONE Gen 2-framed box containing both
  // Bill's portrait (on the left, protruding above the top edge of
  // the box) and his speech (text to the right of the portrait).
  // Reads like the in-game NPC lower-third dialog — speaker partly
  // pokes out of the frame.
  const header = el('div', { class: 'gen2-dialog bill-intro' });
  header.append(
    el('img', {
      class: 'bill-portrait',
      src: 'sprites/bill/bill-portrait.png',
      alt: 'Bill, the Pokémon researcher',
    }),
  );
  const speech = el('div', { class: 'bill-speech' });
  // Middle line weaves the GS BALL into the explanation: it's the
  // power source that enabled the cross-gen storage upgrade. Bolded
  // for emphasis since it's the in-lore "how".
  const explainLine = el('div', { class: 'gen2-line' });
  explainLine.append(
    document.createTextNode('Thanks to the power of the '),
    el('strong', { class: 'gs-ball-mention' }, 'GS BALL'),
    document.createTextNode(
      ', I upgraded the PC Storage system so you can move Pokémon between generations.',
    ),
  );
  // Last line ends with the blinking ▼ "press A to continue" cursor
  // that appears in every in-game dialog box at the end of NPC speech.
  const lastLine = el('div', { class: 'gen2-line' });
  lastLine.append(
    document.createTextNode('Pick a SOURCE and a DESTINATION to get started!'),
    el('span', { class: 'dialog-cursor', 'aria-hidden': 'true' }, '▼'),
  );
  speech.append(
    el('div', { class: 'gen2-line' }, "Hi! I'm BILL!"),
    explainLine,
    lastLine,
  );
  header.append(speech);
  root.append(header);

  root.append(renderWorkbench(buildWorkbenchProps(state, dispatch, deps)));

  // Debug-only demo-save loader. Only renders when `?debug=1` is in
  // the URL; production users never see it. Buttons fetch a vendored
  // .sav from `web/public/debug-saves/` and pipe it through the
  // existing parse pipeline so the box browsers populate without
  // needing real cart hardware or .sav files on disk.
  if (hasDebugFlag()) {
    const dbg = el('div', { class: 'debug-bar' });
    dbg.append(el('span', { class: 'debug-bar-label' }, 'DEBUG · demo saves:'));
    const mk = (label: string, side: 'source' | 'dest', file: string): HTMLButtonElement => {
      const btn = el('button', { type: 'button', class: 'debug-bar-btn' }, label) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        void loadDemoSave(side, file, dispatch, deps);
      });
      return btn;
    };
    dbg.append(
      mk('SRC: Red', 'source', 'red.sav'),
      mk('SRC: Crystal', 'source', 'crystal.sav'),
      mk('DEST: Emerald', 'dest', 'emerald.sav'),
    );
    root.append(dbg);
  }

  // Legal footer — fan-project disclaimer + asset credits. Keeps
  // Nintendo / Game Freak / The Pokémon Company on side and credits
  // the artists whose sprites are vendored under web/public/sprites/.
  const footer = el('footer', { class: 'legal-footer' });
  footer.append(
    el(
      'p',
      {},
      'BILL’S PC is an unofficial fan tool. Pokémon, Game Boy, Game Boy Color, and Game Boy Advance are trademarks of Nintendo, Game Freak, and The Pokémon Company. This project is not affiliated with, endorsed, sponsored, or approved by them.',
    ),
    el(
      'p',
      {},
      'Save data is processed entirely in your browser — nothing is uploaded. Use only with cartridges and saves you legally own.',
    ),
    el(
      'p',
      { class: 'legal-warn' },
      '⚠ Built with AI-generated code. Use at your own risk — ALWAYS keep a backup of any save file before processing it with this tool. Corrupted writes can brick a save permanently.',
    ),
    (() => {
      const credits = el('p', {});
      credits.append(document.createTextNode('Console pixel-art by '));
      credits.append(
        el(
          'a',
          {
            href: 'https://www.deviantart.com/aloneagainstpixels',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          'AloneAgainstPixels',
        ),
      );
      credits.append(
        document.createTextNode(' (DeviantArt). Gen 1/2 party icons by '),
      );
      credits.append(
        el(
          'a',
          {
            href: 'https://github.com/SoupPotato/sourcrystal',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          'SoupPotato (Sour Crystal)',
        ),
      );
      credits.append(
        document.createTextNode('. Gen 3 party icons from '),
      );
      credits.append(
        el(
          'a',
          {
            href: 'https://github.com/pret/pokeemerald',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          'pret/pokeemerald',
        ),
      );
      credits.append(
        document.createTextNode(
          '. Bill portrait © The Pokémon Company / Nintendo, used here as nominal fair-use reference. Box wallpapers extracted via PKHeX assets.',
        ),
      );
      return credits;
    })(),
  );
  root.append(footer);

  // Cart-flash UI overlays. The v2 commit handlers (runCommitSource /
  // runCommitDestination in v2Actions.ts) own the typed-PROCEED dialog
  // themselves via document.body.append, so renderV2 only needs to surface
  // progress + recovery states triggered by flash_phase / flash_failed
  // dispatches downstream of those handlers. Without this block, v2 users
  // saw no "DO NOT UNPLUG" overlay during cart writes — flash silently ran
  // to completion or failure.
  const cf = state.cartFlash;
  if (cf && (cf.kind === 'cart_flash_progressing' || cf.kind === 'cart_recovery_progressing')) {
    root.append(flashProgressOverlay({ state: cf }));
  } else if (cf && cf.kind === 'cart_flash_failed') {
    root.append(
      recoveryDialog({
        errorReason: cf.errorReason,
        errorMessage: cf.errorMessage,
        recoveryAvailable: cf.recoveryAvailable,
        attemptsExhausted: false,
        onRetry: () => {
          if (cf.recoveryAvailable) {
            dispatch({ type: 'recovery_started', backupFilename: cf.recoveryAvailable.backupFilename });
          }
        },
        onDismiss: () => dispatch({ type: 'cart_flash_dismissed' }),
      }),
    );
  } else if (cf && cf.kind === 'cart_recovery_failed') {
    root.append(
      recoveryDialog({
        errorReason: cf.errorReason,
        errorMessage: cf.errorMessage,
        recoveryAvailable: null,
        attemptsExhausted: cf.attemptsExhausted,
        onRetry: () => {
          /* recovery exhausted — only dismiss is available */
        },
        onDismiss: () => dispatch({ type: 'cart_flash_dismissed' }),
      }),
    );
  }
}

/**
 * S8v2.1 — build the renderer's props from the current reducer state.
 *
 * Disambiguation rules (per AMEND-S8v2.1-3 + AMEND-S8v2.1-11):
 * - `cartReadProgress.side` and `cartReadError.side` are now carried on
 *   the action so the renderer can route progress / error back to the
 *   right LEFT-pane role without heuristics.
 * - Cart-read progress surfaces as a modal overlay attached to
 *   `document.body`, NOT as an inline pane card.
 * - `state.kind === 'parsing'` belongs to the source SAV-parse pipeline;
 *   `state.destParsing` to the dest SAV-parse pipeline.
 */
function buildWorkbenchProps(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): WorkbenchProps {
  const leftRole: LeftRole = state.v2LeftRole ?? 'source';

  const sourceLoaded =
    state.kind === 'loaded'
      ? {
          save: state.save,
          boxIndex: state.boxIndex,
          cursor: state.cursor,
          fileName: state.fileName,
        }
      : null;

  const sourceCartLoading =
    state.cartReadProgress && state.cartReadProgress.side === 'source'
      ? {
          bytesRead: state.cartReadProgress.bytesRead,
          bytesTotal: state.cartReadProgress.bytesTotal,
          ...(state.cartReadProgress.phase ? { phase: state.cartReadProgress.phase } : {}),
          label: state.cartConnection?.deviceId ?? '',
        }
      : null;

  const sourceSavParsing =
    state.kind === 'parsing'
      ? { fileName: state.fileName, size: state.size }
      : null;

  const sourceParseError =
    state.kind === 'parse_error'
      ? { reason: state.error.reason, message: state.error.message }
      : null;
  const sourceCartError =
    state.cartReadError && state.cartReadError.side === 'source'
      ? {
          reason: state.cartReadError.reason,
          message: state.cartReadError.message,
          ...(state.cartReadError.rawBytes ? { rawBytes: state.cartReadError.rawBytes } : {}),
          ...(state.cartReadError.rawFileName
            ? { rawFileName: state.cartReadError.rawFileName }
            : {}),
        }
      : null;
  const sourceError = sourceParseError ?? sourceCartError;

  const destLoaded = state.dest
    ? {
        save: state.dest.save,
        boxIndex: state.dest.boxIndex,
        cursor: state.dest.cursor,
        fileName: state.dest.fileName,
      }
    : null;

  const destCartLoading =
    state.cartReadProgress && state.cartReadProgress.side === 'dest'
      ? {
          bytesRead: state.cartReadProgress.bytesRead,
          bytesTotal: state.cartReadProgress.bytesTotal,
          ...(state.cartReadProgress.phase ? { phase: state.cartReadProgress.phase } : {}),
          label: state.cartConnection?.deviceId ?? '',
        }
      : null;

  const destSavParsing = state.destParsing
    ? { fileName: state.destParsing.fileName, size: state.destParsing.size }
    : null;

  const destParseError = state.destParseError
    ? {
        reason: state.destParseError.error.reason,
        message: state.destParseError.error.message,
      }
    : null;
  const destCartError =
    state.cartReadError && state.cartReadError.side === 'dest'
      ? {
          reason: state.cartReadError.reason,
          message: state.cartReadError.message,
          ...(state.cartReadError.rawBytes ? { rawBytes: state.cartReadError.rawBytes } : {}),
          ...(state.cartReadError.rawFileName
            ? { rawFileName: state.cartReadError.rawFileName }
            : {}),
        }
      : null;
  const destError = destParseError ?? destCartError;

  // S8v2.2 — slot-addressed staging snapshot + projections. Compute
  // ONCE per buildWorkbenchProps call (per AMEND-S8v2.2-7).
  const stagedSlots: ReadonlyArray<StagedSlot | null> =
    state.staging?.slots ?? Array.from({ length: 30 }, () => null);

  // `stagedSourceRefs` — refs of source-side mons currently in
  // staging that match the loaded source cart's TID + label, used to
  // render the `is-staged` overlay on source tiles. Only mons whose
  // origin matches the currently-loaded source cart get the marker
  // (mons staged from a previous source cart shouldn't render on
  // arbitrary other carts).
  const stagedSourceRefs: ReadonlyArray<MonRef> = (() => {
    if (state.kind !== 'loaded') return [];
    const cartLabel = state.cartConnection?.deviceId ?? state.fileName;
    const tid = state.save.trainer.tid;
    const out: MonRef[] = [];
    for (const s of stagedSlots) {
      if (s !== null && !s.sourceCommitted && s.sourceCartLabel === cartLabel && s.sourceTid === tid) {
        out.push(s.sourceRef);
      }
    }
    return out;
  })();

  // Reverse map: monRefKey(sourceRef) → transfer-slot index. The source
  // box browser uses this to render a `→ T<n>` corner badge on staged
  // tiles, mirroring the transfer-box's `→ B1/S03` placed badge.
  // Source-committed slots are excluded — once the mon is gone from the
  // source, the slot it used to occupy can be backfilled by another mon
  // (e.g. cart-side compaction) and that successor must NOT inherit the
  // committed mon's badge.
  const stagedSourceTransferSlot: ReadonlyMap<string, number> = (() => {
    if (state.kind !== 'loaded') return new Map();
    const cartLabel = state.cartConnection?.deviceId ?? state.fileName;
    const tid = state.save.trainer.tid;
    const out = new Map<string, number>();
    for (let i = 0; i < stagedSlots.length; i++) {
      const s = stagedSlots[i];
      if (s != null && !s.sourceCommitted && s.sourceCartLabel === cartLabel && s.sourceTid === tid) {
        out.set(monRefKey(s.sourceRef), i);
      }
    }
    return out;
  })();

  // `previewedPlacements` — slots with a `placement` matching the
  // currently-loaded dest cart + visible dest box. AMEND-S8v2.2-7:
  // return null when no occupied slot matches so consumers can
  // short-circuit cleanly.
  const previewedPlacements: ReadonlyMap<number, PreviewedPlacement> | null = (() => {
    if (!state.dest) return null;
    const destCartLabel = state.cartConnection?.deviceId ?? state.dest.fileName;
    const destTid = state.dest.save.trainer.tid;
    const visibleBoxIndex = state.dest.boxIndex;
    const m = new Map<number, PreviewedPlacement>();
    for (const s of stagedSlots) {
      if (
        s !== null &&
        s.placement !== null &&
        s.placement.destCartLabel === destCartLabel &&
        s.placement.destTid === destTid &&
        s.placement.destBoxIndex === visibleBoxIndex
      ) {
        m.set(s.placement.destSlot, {
          speciesId: s.speciesId,
          nicknameDisplay: s.nicknameDisplay,
          transferBoxIdx: s.idx,
        });
      }
    }
    return m.size > 0 ? m : null;
  })();

  return {
    leftRole,
    sourceLoaded,
    sourceCartLoading,
    sourceSavParsing,
    sourceError,
    destLoaded,
    destCartLoading,
    destSavParsing,
    destError,
    onLoadCart: (role) => {
      // AMEND-S8v2.1-1 — handleCartConnect's signature is
      // (side, state, dispatch, deps); pass `state` (snapshot at click)
      // so the same-cart refusal context lookup works.
      void handleCartConnect(role === 'source' ? 'source' : 'dest', state, dispatch, deps);
    },
    onLoadSav: (role, file) => {
      if (role === 'source') {
        void handleFileSelected(file, dispatch, deps);
      } else {
        void handleDestFileSelected(file, dispatch, deps);
      }
    },
    onSwitchRole: () => dispatch({ type: 'v2_switch_role' }),
    onSourceBoxChange: (delta) => dispatch({ type: 'box_change', delta }),
    onSourceCursorMove: (drow, dcol) => dispatch({ type: 'cursor_move', drow, dcol }),
    // S8v2.2-polish — plain click on a source tile opens the stat-screen
    // modal (read-only); cmd/ctrl-click toggles selection (add); shift-
    // click range-extends. Selection requires modifier keys; bulk
    // selectors live as explicit buttons under the LEFT pane.
    onSourceMonClick: (ref, modKeys) => {
      if (state.kind !== 'loaded') return;
      const entries = entriesForSourceBox(state.save, state.boxIndex);
      const target = entries.find((e) => monRefKey(e.ref) === monRefKey(ref));
      if (!target) return;
      const usingModifier = modKeys.shift || modKeys.meta || modKeys.ctrl;
      if (!usingModifier) {
        const sourceFormat = state.save.format;
        // Compute add-to-transfer button state up-front so the modal can
        // show the right label / disabled-style when the action isn't
        // viable. Party mons are blocked entirely (per user spec — only
        // box-stored mons are committable). Already-staged mons are
        // de-duped silently by the underlying placeAt path; we surface
        // it here as a clear button label.
        const isParty = ref.bucket === 'party';
        const cartLabel = state.cartConnection?.deviceId ?? state.fileName;
        const tid = state.save.trainer.tid;
        const sourceRefKey = deriveSourceRefKey(cartLabel, tid, ref);
        const alreadyStaged = (state.staging?.slots ?? []).some(
          (s) => s !== null && s.sourceRefKey === sourceRefKey,
        );
        const occupiedCount = (state.staging?.slots ?? []).reduce(
          (acc, s) => (s !== null ? acc + 1 : acc),
          0,
        );
        const transferFull = occupiedCount >= 30;
        const addLabel = isParty
          ? "Party mons can't transfer"
          : alreadyStaged
            ? 'Already in Transfer'
            : transferFull
              ? 'Transfer Box full'
              : 'Add to Transfer Box';
        const canAdd = !isParty && !alreadyStaged && !transferFull;
        openStatScreenModal({
          subject: { kind: 'sourceMon', mon: target.mon, sourceFormat },
          convert: (m) => {
            const r = deps.convert(m);
            if (deps.isRefusal(r)) return null;
            return r;
          },
          addToTransferLabel: addLabel,
          ...(canAdd
            ? {
                onAddToTransfer: () => {
                  // Pass [ref] as the refsOverride so the existing
                  // batch-add pipeline runs for just this single mon
                  // without disturbing any active source selection the
                  // user might have built up via cmd/ctrl/shift click.
                  void runAddSelectedToTransfer(state, dispatch, deps, [ref]);
                },
              }
            : {}),
          ...(target.mon.sourceGen === 2
            ? {
                onSaveAsPk2: () => {
                  downloadMonAsPk2(target.mon);
                },
              }
            : {}),
        });
        return;
      }
      const mode: 'replace' | 'add' | 'range' = modKeys.shift
        ? 'range'
        : 'add';
      dispatch({
        type: 'v2_select_toggle',
        side: 'source',
        ref,
        mode,
        slotInBox: target.slotInBox,
        entries: entries.map((e) => ({ ref: e.ref, slotInBox: e.slotInBox })),
      });
    },
    onDestBoxChange: (delta) => dispatch({ type: 'dest_box_change', delta }),
    onDestCursorMove: (drow, dcol) => dispatch({ type: 'dest_cursor_move', drow, dcol }),
    // S8v2.2 — dest tile click per DECISION-S8v2.2-3 (Finder-style):
    //   1. plain click on filled slot → cursor + replace selection.
    //   2. plain click on empty slot   → cursor + clear selection.
    //   3. cmd/ctrl-click on filled    → toggle ref in selection;
    //                                    cursor does NOT move.
    //   4. cmd/ctrl-click on empty     → no-op (no MonRef to toggle,
    //                                    cursor stays put).
    //   5. shift-click on any slot     → cursor + extend range to click.
    onDestSlotClick: (slot, modKeys) => {
      if (!state.dest) return;
      const row = Math.floor(slot / 6) as 0 | 1 | 2 | 3 | 4;
      const col = (slot % 6) as 0 | 1 | 2 | 3 | 4 | 5;
      const slotData = state.dest.save.pc.boxes[state.dest.boxIndex]?.[slot];
      const filled = slotData?.kind === 'filled';
      const usingModifier = modKeys.shift || modKeys.meta || modKeys.ctrl;
      // Cursor behavior: shift, plain → move; cmd/ctrl → don't move.
      const moveCursor = !(modKeys.meta || modKeys.ctrl);
      if (moveCursor && (row !== state.dest.cursor.row || col !== state.dest.cursor.col)) {
        dispatch({
          type: 'dest_cursor_move',
          drow: (row - state.dest.cursor.row) as -1 | 0 | 1,
          dcol: (col - state.dest.cursor.col) as -1 | 0 | 1,
        });
      }
      if (!filled) {
        if (modKeys.meta || modKeys.ctrl) {
          // Case 4 — cmd-click on empty: no-op for selection.
          return;
        }
        if (modKeys.shift) {
          // Case 5 — shift-click on empty slot: cursor moved above; no
          // selection change (no ref to extend to).
          return;
        }
        // Case 2 — plain click on empty slot: clear dest selection.
        if (state.v2DestSelection !== undefined || state.v2DestSelectionAnchor !== undefined) {
          dispatch({ type: 'v2_select_clear', side: 'dest' });
        }
        return;
      }
      // S8v2.2-polish — plain click on a filled dest tile opens the
      // stat modal (read-only). Dest-native mons live as encrypted Gen 3
      // box bytes; we don't currently have a Gen3Intermediate decoder
      // exposed for them, so the modal renders an informational notice
      // until that path is wired. Modifier keys still drive selection.
      if (!usingModifier) {
        openStatScreenModal({
          subject: {
            kind: 'destMon',
            // Construct a placeholder Gen3Intermediate with zero stats
            // so the modal renders the panel chrome; the user sees the
            // species name from the slot and the formula breakdown will
            // show base stats only. A future polish step can decode the
            // encrypted dest bytes into a proper Gen3Intermediate.
            intermediate: makePlaceholderGen3IntermediateFromDestSlot(
              slotData.species,
              slotData.bytes,
            ),
          },
        });
        return;
      }
      // Filled slot — build a MonRef and dispatch the selection toggle.
      const ref: MonRef = { bucket: 'box', boxIndex: state.dest.boxIndex, slot };
      const mode: 'replace' | 'add' | 'range' = modKeys.shift
        ? 'range'
        : 'add';
      // Build the entries list for range-extend math: occupied dest
      // slots in the current visible box, slot-major.
      const box = state.dest.save.pc.boxes[state.dest.boxIndex] ?? [];
      const entries: Array<{ ref: MonRef; slotInBox: number }> = [];
      for (let i = 0; i < box.length; i++) {
        if (box[i]?.kind === 'filled') {
          entries.push({
            ref: { bucket: 'box', boxIndex: state.dest.boxIndex, slot: i },
            slotInBox: i,
          });
        }
      }
      dispatch({
        type: 'v2_select_toggle',
        side: 'dest',
        ref,
        mode,
        slotInBox: slot,
        entries,
      });
    },
    onTransferTileClick: (idx, modKeys) => {
      const slot = state.staging?.slots[idx];
      if (!slot) return;
      const usingModifier = modKeys.shift || modKeys.meta || modKeys.ctrl;
      // S8v2.2-polish — plain click on a transfer tile opens the stat
      // modal (in EITHER role). When the LEFT pane is destination AND
      // the user is allowed to remove staged mons, the modal also
      // surfaces a "Remove from Transfer" action button.
      if (!usingModifier) {
        // Remove from Transfer is always available (sensible action in
        // either role). Send to Destination only when dest is loaded
        // AND in destination role — that's when the placement preview
        // path is meaningful.
        const inDestRole = state.v2LeftRole === 'destination';
        const destLoaded = !!state.dest;
        const placed = slot.placement !== null;
        const sendLabel = !inDestRole
          ? 'Switch to destination first'
          : !destLoaded
            ? 'Load a destination cart first'
            : placed
              ? `Already placed → B${slot.placement!.destBoxIndex + 1}/S${String(slot.placement!.destSlot + 1).padStart(2, '0')}`
              : 'Send to Destination';
        const canSend = inDestRole && destLoaded && !placed;
        openStatScreenModal({
          subject: { kind: 'transferSlot', slot },
          convert: (m) => {
            const r = deps.convert(m);
            if (deps.isRefusal(r)) return null;
            return r;
          },
          onRemoveTransfer: () => {
            void runRemoveFromTransfer(idx, deps);
          },
          sendToDestinationLabel: sendLabel,
          ...(canSend
            ? {
                onSendToDestination: () => {
                  // Single-mon variant — pass [idx] as override so we
                  // bypass the bulk-selection state and don't disturb
                  // any existing transfer selection.
                  void runAddSelectedToDestination(state, dispatch, deps, [idx]);
                },
              }
            : {}),
          ...(placed
            ? {
                onCancelSend: () => {
                  void stagingMutate(deps, (s) => s.setPlacement(idx, null));
                },
              }
            : {}),
          ...(slot.sourceFamily === 'gen2'
            ? {
                onSaveAsPk2: () => {
                  const mon = deserializeGen12FromStaging(slot.pkBytes);
                  if (!mon) {
                    console.error(`onSaveAsPk2: could not decode slot ${idx}`);
                    return;
                  }
                  downloadMonAsPk2(mon);
                },
              }
            : {}),
        });
        return;
      }
      const mode: 'replace' | 'add' | 'range' = modKeys.shift ? 'range' : 'add';
      dispatch({ type: 'v2_transfer_select_toggle', idx, mode });
    },
    onSelectAllSourceBox: () => {
      if (state.kind !== 'loaded') return;
      const entries = entriesForSourceBox(state.save, state.boxIndex);
      const refs = entries.map((e) => e.ref);
      dispatch({ type: 'v2_select_all_source_box', refs });
    },
    onSelectSourceParty: () => {
      if (state.kind !== 'loaded') return;
      const entries = entriesForSourceBox(state.save, 0);
      const refs = entries.map((e) => e.ref);
      dispatch({ type: 'v2_select_all_source_box', refs });
    },
    onSelectAllDestBox: () => {
      if (!state.dest) return;
      const box = state.dest.save.pc.boxes[state.dest.boxIndex] ?? [];
      const refs: MonRef[] = [];
      for (let i = 0; i < box.length; i++) {
        if (box[i]?.kind === 'filled') {
          refs.push({ bucket: 'box', boxIndex: state.dest.boxIndex, slot: i });
        }
      }
      dispatch({ type: 'v2_select_all_dest_box', refs });
    },
    onSelectAllTransferBox: () => {
      const slots = state.staging?.slots ?? [];
      const idxs: number[] = [];
      for (let i = 0; i < slots.length; i++) {
        if (slots[i] !== null) idxs.push(i);
      }
      dispatch({ type: 'v2_select_all_transfer_box', idxs });
    },
    // S8v2.3 — wire the trading-pipe Commit button to the real source /
    // dest commit handlers (replaces the prior alert() stub). Per
    // PLAN §1 criteria 11 + 12: source role drives `runCommitSource`,
    // dest role drives `runCommitDestination`.
    onCommit: () => {
      const role = state.v2LeftRole ?? 'source';
      if (role === 'source') {
        void runCommitSourceImpl({
          state,
          dispatch,
          controller: deps,
          flashDeps: deps.flashDeps ?? null,
          confirmFlashDialog,
          downloadFn: blobDownload,
        });
      } else {
        void runCommitDestinationImpl({
          state,
          dispatch,
          controller: deps,
          flashDeps: deps.flashDeps ?? null,
          confirmFlashDialog,
          downloadFn: blobDownload,
        });
      }
    },
    onAddSelectedToTransfer: () => {
      void runAddSelectedToTransfer(state, dispatch, deps);
    },
    onAddSelectedToDestination: () => {
      void runAddSelectedToDestination(state, dispatch, deps);
    },
    onClearTransferBox: () => {
      void runClearTransferBox(state, dispatch, deps);
    },
    // v2.3 — JSON snapshot of all occupied transfer-box slots. The slot
    // record (sentinel-JSON pkBytes + metadata) is decoded inline so the
    // exported file is human-readable JSON rather than a base64 blob.
    // v2.3 — debug — restore transfer box from a previously-exported JSON
    // file. CLEARS current contents and re-seeds from the file.
    onImportTransferBoxJson: (file) => {
      void (async () => {
        const store = deps.getStagingStore?.();
        if (!store) {
          console.error('onImportTransferBoxJson: no staging store available');
          return;
        }
        const text = await file.text();
        let parsed: { slots?: Array<Record<string, unknown>> };
        try {
          parsed = JSON.parse(text) as typeof parsed;
        } catch (e) {
          console.error('onImportTransferBoxJson: JSON parse failed:', (e as Error).message);
          return;
        }
        if (!Array.isArray(parsed.slots)) {
          console.error('onImportTransferBoxJson: invalid payload — missing `slots` array');
          return;
        }
        await store.clear();
        for (const entry of parsed.slots) {
          try {
            const idx = entry.idx as number;
            // Prefer `pkBytes` (raw byte array, round-trip-perfect since
            // export v2). Fall back to re-serializing `pkData` for old v1
            // exports — note v1 had a Uint8Array→{0:1,...} JSON-mangling
            // bug, so v1 imports may produce malformed nick/OT fields.
            const pkBytes = Array.isArray(entry.pkBytes)
              ? new Uint8Array(entry.pkBytes as number[])
              : serializeGen12ForStaging(entry.pkData as Parameters<typeof serializeGen12ForStaging>[0]);
            await store.placeAt(idx, {
              pkBytes,
              speciesId: entry.speciesId as number,
              nicknameDisplay: entry.nicknameDisplay as string,
              sourceCartLabel: entry.sourceCartLabel as string,
              sourceTid: entry.sourceTid as number,
              sourceFamily: entry.sourceFamily as 'gen1' | 'gen2' | 'gen3',
              sourceOtName: entry.sourceOtName as string,
              sourceRef: entry.sourceRef as Parameters<typeof store.placeAt>[1]['sourceRef'],
              sourceRefKey: entry.sourceRefKey as string,
              stagedAt: entry.stagedAt as string,
            });
            if (entry.sourceCommitted === true) {
              await store.setSourceCommitted(idx, true);
            }
            if (entry.placement) {
              await store.setPlacement(idx, entry.placement as Parameters<typeof store.setPlacement>[1]);
            }
          } catch (e) {
            console.error(
              `onImportTransferBoxJson: slot ${entry.idx} failed:`,
              (e as Error).message,
            );
          }
        }
      })();
    },
    onExportTransferBoxJson: () => {
      const slots = state.staging?.slots ?? [];
      const occupied = slots
        .map((s, idx) => ({ idx, slot: s }))
        .filter((x): x is { idx: number; slot: NonNullable<typeof x.slot> } => x.slot !== null);
      if (occupied.length === 0) return;
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 2,
        slots: occupied.map(({ idx, slot }) => ({
          idx,
          speciesId: slot.speciesId,
          nicknameDisplay: slot.nicknameDisplay,
          sourceCartLabel: slot.sourceCartLabel,
          sourceTid: slot.sourceTid,
          sourceFamily: slot.sourceFamily,
          sourceOtName: slot.sourceOtName,
          sourceRef: slot.sourceRef,
          sourceRefKey: slot.sourceRefKey,
          stagedAt: slot.stagedAt,
          placement: slot.placement,
          sourceCommitted: slot.sourceCommitted ?? false,
          // pkBytes carried as the raw sentinel-JSON envelope (byte
          // array). Round-trip-perfect; the import reads this back into a
          // Uint8Array verbatim. We also carry `pkData` (decoded snapshot)
          // for human readability — the import IGNORES it and uses
          // `pkBytes` to restore the slot byte-for-byte.
          pkBytes: Array.from(slot.pkBytes),
          pkData: deserializeGen12FromStaging(slot.pkBytes) ?? { _raw: Array.from(slot.pkBytes) },
        })),
      };
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const json = JSON.stringify(payload, null, 2);
      const bytes = new TextEncoder().encode(json);
      blobDownload(`transfer-box-${ts}.json`, bytes, 'application/json');
    },
    // Manual on-demand backup of the loaded SAV (source or dest, depending on
    // the active role). Cart-mode commits already auto-backup via S7b's
    // BackupSink; this button is mostly for SAV-mode users who want a
    // snapshot before staging+committing. Resolves to undefined when nothing
    // is loaded → button stays disabled.
    onBackupToSav: ((): (() => void) | undefined => {
      if (leftRole === 'source') {
        if (state.kind !== 'loaded') return undefined;
        const cartLabel = state.cartConnection?.deviceId ?? state.fileName;
        const tid = state.save.trainer.tid;
        const bytes = state.sourceBytes;
        return () => blobDownload(backupFilename(cartLabel, tid), bytes);
      }
      if (!state.dest) return undefined;
      const cartLabel = state.dest.fileName;
      const tid = state.dest.save.trainer.tid;
      const bytes = state.dest.save.bytes;
      return () => blobDownload(backupFilename(cartLabel, tid), bytes);
    })(),
    onDismissTransferBoxFullBanner: () =>
      dispatch({ type: 'v2_transfer_box_full_dismiss' }),
    onDismissTransferPlacementBanner: () =>
      dispatch({ type: 'v2_transfer_placement_banner_dismiss' }),
    onDismissTransferConvertSkipBanner: () =>
      dispatch({ type: 'v2_transfer_convert_skip_dismiss' }),
    onDismissTransferPartySkipBanner: () =>
      dispatch({ type: 'v2_transfer_party_skip_dismiss' }),
    onDismissStagingMigrationOverflowBanner: () =>
      dispatch({ type: 'staging_migration_overflow_dismiss' }),
    sourceSelection: state.v2SourceSelection ?? [],
    destSelection: state.v2DestSelection ?? [],
    transferSelection: state.v2TransferSelection ?? [],
    stagedSlots,
    stagedSourceRefs,
    stagedSourceTransferSlot,
    previewedPlacements,
    transferBoxFullBanner: state.transferBoxFullBanner ?? null,
    transferPlacementBanner: state.transferPlacementBanner ?? null,
    transferConvertSkipBanner: state.transferConvertSkipBanner ?? null,
    transferPartySkipBanner: state.transferPartySkipBanner ?? null,
    stagingMigrationOverflowBanner: state.stagingMigrationOverflowBanner ?? null,
    multiTabBanner: state.multiTabBanner ?? false,
    // Per C1: source-side dismiss = `reset` (clobbers BOTH source and dest
    // per INITIAL_STATE). Acceptable for v2.1 because the only error case
    // here is "the SAV failed to parse" — there's no loaded source to
    // preserve. Dest-side dismiss uses `dest_clear` (preserves source).
    onErrorDismiss: (role) =>
      dispatch({ type: role === 'source' ? 'source_clear' : 'dest_clear' }),
    // Same dispatch as onErrorDismiss but plumbed separately so the
    // pane Reset button has a clear semantic call site (and can later
    // gain a "are you sure?" confirmation step for loaded-data resets
    // without mutating the error-dismiss path).
    onPaneReset: (role) =>
      dispatch({ type: role === 'source' ? 'source_clear' : 'dest_clear' }),
    onDownloadRawCartDump: (role) => {
      const err = state.cartReadError;
      if (!err || err.side !== (role === 'source' ? 'source' : 'dest')) return;
      if (err.rawBytes) {
        blobDownload(err.rawFileName ?? 'cart.raw.sav', err.rawBytes);
      }
    },
  };
}

function renderStagingRightPane(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): HTMLElement {
  // Fall back to the legacy dest pane when staging hasn't loaded yet
  // (stagingStore.open is async — first render may not have it).
  const stagedMons = state.staging?.stagedMons ?? [];
  const subview = state.staging?.rightPaneSubview ?? 'staging';
  const destinationConnected = state.dest !== undefined;
  const sourceConnected = state.kind === 'loaded';

  return stagingPane({
    stagedMons,
    subview,
    destinationConnected,
    sourceConnected,
    multiTabBanner: state.multiTabBanner,
    onSubviewChange: (sv) => dispatch({ type: 'right_pane_subview', subview: sv }),
    onUnstage: (stagedAt) => {
      // The store-mutating call lives outside the reducer; re-dispatch
      // staging_loaded happens via the StagingStore.subscribe callback.
      void stagingMutate(deps, (s) => s.unstageMon(stagedAt));
    },
    onPlaceClick: (stagedAt) => {
      // Set placing-mode + flip to destination subview. The next click on
      // a dest-cart box slot assigns the staged mon's destination via
      // stagingStore.setDestination (see destBoxBrowser onSlotClick in
      // renderDestPane).
      dispatch({ type: 'place_mon_pending', stagedAt });
    },
    onCommitSource: () => {
      // AMEND-S7b-16 / DECISION-2 — block any commit while the same-cart
      // refusal flag is set. The user must dismiss the refusal modal
      // (or clear staging) before another commit can be scheduled.
      if (state.sameCartRefusal) return;
      dispatch({ type: 'commit_started', target: 'source', planSummary: `Delete ${stagedMons.length} mons` });
    },
    onCommitDest: () => {
      if (state.sameCartRefusal) return;
      dispatch({ type: 'commit_started', target: 'destination', planSummary: `Inject ${stagedMons.length} mons` });
    },
    onClearStaging: () => {
      void stagingMutate(deps, (s) => s.clear());
    },
    renderDestinationView: destinationConnected
      ? (): HTMLElement => renderCartDestPane(state, dispatch, deps)
      : undefined,
    renderConnectDestination: destinationConnected
      ? undefined
      : (): HTMLElement => renderCartConnectButton('dest', state, dispatch, deps),
  });
}

/**
 * Helper: dispatch a staging-store mutation. The controller-level
 * subscribe callback re-fires `staging_loaded` so we don't need to
 * dispatch it explicitly here.
 */
async function stagingMutate(
  deps: ControllerDeps,
  fn: (store: StagingStore) => Promise<void>,
): Promise<void> {
  const store = deps.getStagingStore?.();
  if (!store) return;
  await fn(store);
}

// ---------------------------------------------------------------------
// S8v2.2 — multi-select staging handlers (per AMEND-S8v2.2 §5.1 / 5.2).
// ---------------------------------------------------------------------

/**
 * Add the source selection's mons to the transfer box. Each successful
 * placement calls `stagingStore.placeAt(nextEmpty, payload)`. Skips
 * already-staged refs silently (per criterion 9). Caps the batch at
 * the transfer box's 30-slot capacity (criterion 10) and surfaces a
 * banner when the cap kicks in. Filters out un-convertible mons (per
 * §2.8) and surfaces a separate convert-skip banner.
 *
 * COPY semantics — `state.save` is not touched. The actual source
 * delete is the v2.3 commit step.
 */
async function runAddSelectedToTransfer(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
  refsOverride?: ReadonlyArray<MonRef>,
): Promise<void> {
  // S8v2.2.1 — body extracted to `web/src/ui/v2Actions.ts` so the
  // production handler can be invoked directly from the integration
  // tests instead of re-implementing its contract.
  await runAddSelectedToTransferImpl(state, dispatch, deps, refsOverride);
}

/**
 * Add the transfer-selection's slots to the destination cart as
 * placement annotations. Per AMEND-S8v2.2-R2 / -6 / §2.3:
 *   * The handler ONLY calls `setPlacement`. It MUST NOT call
 *     `removeAt` or `clear` — the MOVE-out-of-transfer is the v2.3
 *     commit step.
 *   * The placed slot stays occupied in the transfer box; the
 *     `is-placed` styling + arrow badge appear in the next render.
 *   * The dest preview is computed live in `buildWorkbenchProps` from
 *     the slot's `placement` field; no separate side-channel.
 *
 * If the dest box runs out of empty slots mid-batch, the unplaced
 * count surfaces via `v2_transfer_placement_banner`. The transfer-
 * selection clears entirely (DECISION-S8v2.2-11) — simpler than
 * preserving the unplaced subset.
 */
async function runAddSelectedToDestination(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
  idxsOverride?: ReadonlyArray<number>,
): Promise<void> {
  // S8v2.2.1 — body extracted to `web/src/ui/v2Actions.ts`. See note on
  // `runAddSelectedToTransfer`.
  await runAddSelectedToDestinationImpl(state, dispatch, deps, idxsOverride);
}

/**
 * S8v2.2-polish — remove a single staged slot from the transfer box.
 * Wired by the stat-screen modal's "Remove from Transfer" button. The
 * mutation goes through `stagingStore.removeAt(idx)`; the controller's
 * subscribe callback dispatches the resulting `staging_loaded` so the
 * render reflects the change.
 */
async function runRemoveFromTransfer(
  idx: number,
  deps: ControllerDeps,
): Promise<void> {
  await stagingMutate(deps, (s) => s.removeAt(idx));
}

/**
 * S8v2.2-polish — synthesize a Gen3Intermediate-shaped placeholder so
 * the Emerald stat-screen renderer can show the panel chrome for a
 * dest-native click. We don't currently have a decrypt-and-decode-to-
 * intermediate helper exposed for Gen 3 PC slots, so the IVs/EVs/level
 * default to neutral values; the user sees the species name + the base
 * stats expansion in the formula breakdown. A future polish step can
 * decode the encrypted dest-box bytes into a proper intermediate.
 */
function makePlaceholderGen3IntermediateFromDestSlot(
  species: number,
  bytes: Uint8Array,
): import('@pokeportal/core').Gen3Intermediate {
  // Decrypt + unpack the encrypted 80-byte PC slot record. unpackBoxed is
  // a convert-roundtrip-only decoder: it returns `level: 0` because the
  // boxed record only stores EXP (level lives in the party-tail), and
  // `nature: 0` because its comment says "S1 derives from DVs and decode
  // can't recover". For displaying NATIVE Gen 3 mons we override both:
  // nature = pid % 25 (canonical Gen 3 formula); level = approximated from
  // EXP via the Medium-Fast curve (level = cuberoot(exp)). The Medium-Fast
  // approximation is exact for ~60% of species; off by ±a-few-levels for
  // the other growth rates. Good enough for stat-inspect display until a
  // proper per-species growth-rate table is shipped.
  const unpacked = unpackBoxed(bytes);
  if (!isDecodeError(unpacked)) {
    const nature = (unpacked.pid % 25) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24;
    const level = Math.min(100, Math.max(1, Math.floor(Math.cbrt(unpacked.exp))));
    return { ...unpacked, nature, level };
  }
  return {
    species,
    nickname: new Uint8Array([0xff]),
    otName: new Uint8Array([0xff]),
    otGender: 0,
    tid: 0,
    sid: 0,
    pid: 0,
    ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: 0,
    abilitySlot: 0,
    moves: [0, 0, 0, 0],
    pp: [0, 0, 0, 0],
    ppUps: [0, 0, 0, 0],
    heldItem: 0,
    friendship: 0,
    exp: 0,
    level: 1,
    pokerus: 0,
    contestStats: { cool: 0, beauty: 0, cute: 0, clever: 0, tough: 0, sheen: 0 },
    ribbons: [],
    markings: 0,
    metLocation: 146,
    metLevel: 0,
    metGame: 'FireRed',
    originGame: 'FireRed',
    fatefulEncounter: false,
    isEgg: false,
    language: 2,
    _meta: {
      pidSearchIterations: 0,
      evScalingApplied: false,
      evRemainderDistributed: 0,
      zeroDvOverridesApplied: [],
      unownLetterConstrained: false,
      warnings: [],
    },
  };
}

/**
 * Clear the transfer box. Surfaces a confirm dialog (per AMEND-S8v2.2-10)
 * with EXACT copy mentioning both `N staged mons` and `pending placements`.
 * On confirm → `stagingStore.clear()`.
 */
async function runClearTransferBox(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): Promise<void> {
  // S8v2.2.1 — body extracted to `web/src/ui/v2Actions.ts`; the
  // `openConfirmDialog` helper below stays in `ui.ts` (it touches
  // `document.body` directly) and gets passed in as a dep.
  await runClearTransferBoxImpl(state, dispatch, deps, openConfirmDialog);
}

/**
 * Tiny confirm dialog helper — promise-returning wrapper around the
 * existing `dialog` chrome. Returns true iff the user clicks the
 * confirm button. Used by `runClearTransferBox`.
 *
 * Mounted on `document.body` so it floats above the workbench (mirrors
 * the theme picker / cart-error overlay pattern from S8v2.1).
 */
function openConfirmDialog(
  message: string,
  confirmLabel: string,
  cancelLabel: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'cart-error-overlay clear-transfer-confirm' });
    const inner = el('div', { class: 'cart-error-inner' });
    inner.append(el('div', { class: 'cart-error-reason' }, message));
    const btnRow = el('div', { class: 'wb-pane-actions clear-transfer-confirm-actions' });
    const cancel = el(
      'button',
      { type: 'button', class: 'cart-error-retry' },
      cancelLabel,
    ) as HTMLButtonElement;
    const confirm = el(
      'button',
      { type: 'button', class: 'primary clear-transfer-confirm-confirm' },
      confirmLabel,
    ) as HTMLButtonElement;
    const close = (result: boolean): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false);
    };
    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKey);
    btnRow.append(cancel, confirm);
    inner.append(btnRow);
    overlay.append(inner);
    document.body.append(overlay);
  });
}

/**
 * S7b — render typed-PROCEED dialog, flash progress overlay, and recovery
 * dialog as floating cards on top of the panes. The overlays are
 * conditional on the cart-flash sub-state.
 *
 * Per AMEND-S7b-16 / DECISION-2: a same-cart hard-refuse modal renders
 * here too when the destination connect path detects a TID+label match
 * with the source cart. No OVERRIDE escape hatch.
 */
function appendCartFlashOverlays(
  root: HTMLElement,
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): void {
  // AMEND-S7b-16 / DECISION-2 — same-cart refusal modal renders ABOVE
  // the cart-flash overlays so the user sees it even mid-flash. Hard
  // refuse: no OVERRIDE button, only "OK" to dismiss.
  if (state.sameCartRefusal) {
    root.append(renderSameCartRefusal(state.sameCartRefusal, dispatch));
    // Fall-through to also render any in-flight cart-flash overlay so
    // we don't accidentally hide a recovery dialog under the refusal
    // modal. The CSS z-index keeps the refusal on top.
  }

  const cf = state.cartFlash;
  if (!cf || cf.kind === 'cart_flash_idle') return;

  if (cf.kind === 'cart_flash_pending') {
    // Render the typed-PROCEED dialog. Per AMEND-S7b-8 the suffix
    // requires the cart label.
    const cartLabel = state.cartConnection?.deviceId ?? 'CART';
    const tid =
      state.kind === 'loaded'
        ? state.save.trainer.tid
        : (state.dest?.save.trainer.tid ?? 0);
    const action = cf.target === 'source' ? 'DELETE FROM' : 'WRITE TO';
    const dlg = confirmFlashDialog({
      action,
      cartLabel,
      cartTid: tid,
      summaryLines: cf.planSummary ? [cf.planSummary] : [],
      performSteps: [
        'Download backup of current cart bytes (mandatory)',
        'Flash modified bytes to cart',
        'Re-read cart and verify byte-by-byte',
      ],
      onConfirm: () => {
        // AMEND-S7b-16 / DECISION-2 — when the same-cart refusal flag
        // is set, refuse to commit even if the dialog somehow got
        // surfaced. Defense in depth.
        if (state.sameCartRefusal) return;
        // Gap-1 fix per EVAL.md "Headline gaps":
        // The actual cart write fires here. We snapshot bytes at the
        // moment the user clicks (AMEND-S7b-6 anti-aliasing), pick the
        // right compose function based on `cf.target`, and dispatch
        // phase/progress/succeeded/failed actions as `flashCart`
        // streams its callbacks back.
        void runCartFlash(cf.target, state, dispatch, deps);
      },
      onCancel: () => dispatch({ type: 'cart_flash_dismissed' }),
    });
    root.append(dlg);
    return;
  }

  if (
    cf.kind === 'cart_flash_progressing' ||
    cf.kind === 'cart_recovery_progressing'
  ) {
    root.append(flashProgressOverlay({ state: cf }));
    return;
  }

  if (cf.kind === 'cart_flash_failed') {
    root.append(
      recoveryDialog({
        errorReason: cf.errorReason,
        errorMessage: cf.errorMessage,
        recoveryAvailable: cf.recoveryAvailable,
        attemptsExhausted: false,
        onRetry: () => {
          if (cf.recoveryAvailable) {
            dispatch({ type: 'recovery_started', backupFilename: cf.recoveryAvailable.backupFilename });
          }
        },
        onDismiss: () => dispatch({ type: 'cart_flash_dismissed' }),
      }),
    );
    return;
  }

  if (cf.kind === 'cart_recovery_failed') {
    root.append(
      recoveryDialog({
        errorReason: cf.errorReason,
        errorMessage: cf.errorMessage,
        recoveryAvailable: null,
        attemptsExhausted: cf.attemptsExhausted,
        onRetry: () => undefined,
        onDismiss: () => dispatch({ type: 'cart_flash_dismissed' }),
      }),
    );
    return;
  }

  if (cf.kind === 'cart_flash_succeeded' || cf.kind === 'cart_recovery_done') {
    // Brief success card.
    const card = el(
      'div',
      { class: 'card cart-flash-success' },
      cf.kind === 'cart_recovery_done'
        ? 'Recovery complete — cart bytes restored from backup.'
        : 'Cart write succeeded and verified.',
    );
    root.append(card);
  }
}

/**
 * AMEND-S7b-16 / DECISION-2 — render the same-cart hard-refuse modal.
 * No OVERRIDE button: the only escape is "OK" (clears the flag) or
 * the user-driven "Cancel & clear staging" path on the staging pane.
 */
function renderSameCartRefusal(
  refusal: { sourceTid: number; sourceLabel: string },
  dispatch: (a: Action) => void,
): HTMLElement {
  const card = el('div', { class: 'card error same-cart-refusal' });
  card.append(
    el('div', { class: 'gen2-line confirm-title' }, 'Same cart detected'),
    el(
      'div',
      { class: 'gen2-line' },
      `This appears to be the SAME cart you read on the source side ` +
        `(TID ${refusal.sourceTid}, ${refusal.sourceLabel}). Same-cart ` +
        `read → mutate → write is not supported in S7b.`,
    ),
    el(
      'div',
      { class: 'gen2-line' },
      `Please disconnect and insert the destination cart, OR use ` +
        `"Cancel & clear staging" on the right pane to start over.`,
    ),
  );
  const ok = el(
    'button',
    { type: 'button', class: 'primary' },
    'OK',
  ) as HTMLButtonElement;
  ok.addEventListener('click', () => dispatch({ type: 'same_cart_refusal_dismissed' }));
  card.append(ok);
  return card;
}

/**
 * Gap-1 fix — actually invoke `flashCart` from the Commit button. Maps
 * `flashCart`'s phase/progress callbacks onto the existing reducer
 * actions and the result onto `flash_succeeded` / `flash_failed`.
 *
 * Per AMEND-S7b-6 the `bytes` snapshot is captured here at confirm-click
 * time (BEFORE we await any I/O), then handed to `flashCart` which
 * internally re-snapshots for the recovery buffer. No aliasing with
 * the staging-store view: `composeSourceWrite` and
 * `composeDestinationWrite` already return fresh `Uint8Array`s.
 */
async function runCartFlash(
  target: 'source' | 'destination',
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): Promise<void> {
  const flashDeps = deps.flashDeps;
  if (!flashDeps) {
    dispatch({
      type: 'flash_failed',
      target,
      errorReason: 'NO_FLASH_DEPS',
      errorMessage: 'No cart-flasher deps configured (test misconfiguration).',
      recoveryAvailable: null,
    });
    return;
  }

  // Resolve the cart-side context. The source case requires a loaded
  // Gen 1/2 save + sourceBytes; destination requires `state.dest`.
  const ctx = resolveCartFlashContext(target, state);
  if (ctx.kind === 'error') {
    dispatch({
      type: 'flash_failed',
      target,
      errorReason: 'NO_CART_CONTEXT',
      errorMessage: ctx.message,
      recoveryAvailable: null,
    });
    return;
  }
  const { bytes, cartCurrentBytes, family, cartLabel, tid } = ctx;
  const filename = backupFilename(cartLabel, tid);

  const result = await flashCart(flashDeps, {
    bytes,
    cartCurrentBytes,
    family,
    cartLabel,
    tid,
    backupFilename: filename,
    onPhase: (phase) => dispatch({ type: 'flash_phase', target, phase }),
    onProgress: (p) => {
      dispatch({
        type: 'flash_progress',
        target,
        bytesWritten: p.bytesWritten,
        bytesTotal: p.bytesTotal,
      });
    },
  });

  if (result.kind === 'ok') {
    dispatch({ type: 'flash_succeeded', target, verifiedBytes: result.verifiedBytes });
    return;
  }
  // Per AMEND-S7b-7: when BackupSink fails, recoveryAvailable on the
  // result is null; when verify fails post-write, it's populated. We
  // pass it through unchanged.
  dispatch({
    type: 'flash_failed',
    target,
    errorReason: (result.error as { reason?: string }).reason ?? 'WRITE_FAILED',
    errorMessage: result.error.message,
    recoveryAvailable: result.recoveryAvailable
      ? {
          backupFilename: result.recoveryAvailable.backupFilename,
          backupBytes: result.recoveryAvailable.backupBytes,
          family,
        }
      : null,
  });
}

interface CartFlashContextOk {
  readonly kind: 'ok';
  readonly bytes: Uint8Array;
  /** The cart's CURRENT bytes from the initial S7a read — used as the
   *  backup. Avoids a redundant cart re-read at flash time. */
  readonly cartCurrentBytes: Uint8Array;
  readonly family: CartFamily;
  readonly cartLabel: string;
  readonly tid: number;
}
interface CartFlashContextErr {
  readonly kind: 'error';
  readonly message: string;
}
type CartFlashContext = CartFlashContextOk | CartFlashContextErr;

/**
 * Resolve the (bytes, family, cartLabel, tid) tuple needed to call
 * `flashCart`. For 'source' commits we apply `composeSourceWrite` to
 * the source cart's SRAM bytes with the staged Gen 1/2 mons DELETED.
 * For 'destination' commits we apply `composeDestinationWrite` to the
 * dest save with the staged Gen 3 mons INJECTED.
 */
function resolveCartFlashContext(
  target: 'source' | 'destination',
  state: AppState,
): CartFlashContext {
  const stagedMons = state.staging?.stagedMons ?? [];

  if (target === 'source') {
    if (state.kind !== 'loaded') {
      return { kind: 'error', message: 'No source save loaded.' };
    }
    const family = familyFromSaveFormat(state.save.format);
    if (!family) {
      return {
        kind: 'error',
        message: `Unsupported source format ${state.save.format} for cart flash.`,
      };
    }
    const refs = stagedMons.map((m) => stagedToGen12Ref(m, state)).filter(notNull);
    const composed = composeSourceWrite(state.sourceBytes, refs);
    if (isComposeError(composed)) {
      return {
        kind: 'error',
        message: `composeSourceWrite failed at staged index ${composed.stagedIndex}: ${composed.reason}`,
      };
    }
    return {
      kind: 'ok',
      bytes: composed,
      cartCurrentBytes: state.sourceBytes,
      family,
      cartLabel: state.cartConnection?.deviceId ?? state.fileName,
      tid: state.save.trainer.tid,
    };
  }

  // destination: Gen 3 inject. Per DECISION-3/-10 only Gen 3 destinations
  // are supported in S7b; the cart family is always 'gba'.
  if (!state.dest) {
    return { kind: 'error', message: 'No destination save loaded.' };
  }
  // Per AMEND-S7b-17 #4 + Cart Mode Stage flow: pkBytes is always the
  // 80-byte Gen 3 PC slot record (Gen 1/2 origins pre-converted at
  // stage time; Gen 3 origins keep their encrypted slot bytes). Filter
  // by destination + slot-size, NOT by sourceFamily — sourceFamily
  // tracks origin for the source-delete path only.
  const refs: StagedMonRefGen3[] = stagedMons
    .filter((m) => m.destination !== null && m.pkBytes.length === 80)
    .map((m) => ({
      target: { boxIndex: m.destination!.destBoxIndex, slot: m.destination!.destSlot },
      bytes: m.pkBytes,
    }));
  const composed = composeDestinationWrite(state.dest.save, refs);
  if (isComposeError(composed)) {
    return {
      kind: 'error',
      message: `composeDestinationWrite failed at staged index ${composed.stagedIndex}: ${composed.reason}`,
    };
  }
  return {
    kind: 'ok',
    bytes: composed,
    cartCurrentBytes: state.dest.save.bytes,
    family: 'gba',
    cartLabel: state.cartConnection?.deviceId ?? state.dest.fileName,
    tid: state.dest.save.trainer.tid,
  };
}

function familyFromSaveFormat(format: SaveFormat): CartFamily | null {
  if (format === 'RBY-RED' || format === 'RBY-BLUE' || format === 'RBY-YELLOW') return 'gb';
  if (format === 'GS' || format === 'CRYSTAL') return 'gbc';
  return null;
}

function notNull<T>(x: T | null): x is T {
  return x !== null;
}

/**
 * Map a staged Gen 1/2 mon back to a `StagedMonRefGen12` (the shape
 * `composeSourceWrite` consumes). The source-format from the loaded
 * save dictates which writer the deleter dispatches to.
 */
function stagedToGen12Ref(
  m: StagedMon,
  state: Extract<AppState, { kind: 'loaded' }>,
): StagedMonRefGen12 | null {
  const ref = m.sourceRef;
  if (m.sourceFamily === 'gen1') {
    const fmt = state.save.format;
    if (fmt !== 'RBY-RED' && fmt !== 'RBY-BLUE' && fmt !== 'RBY-YELLOW') return null;
    return {
      family: 'gen1',
      format: fmt,
      ref:
        ref.bucket === 'box'
          ? { bucket: 'box', boxIndex: ref.boxIndex ?? 0, slot: ref.slot }
          : { bucket: ref.bucket, slot: ref.slot },
    };
  }
  if (m.sourceFamily === 'gen2') {
    const fmt = state.save.format;
    if (fmt !== 'GS' && fmt !== 'CRYSTAL') return null;
    return {
      family: 'gen2',
      format: fmt,
      ref:
        ref.bucket === 'box'
          ? { bucket: 'box', boxIndex: ref.boxIndex ?? 0, slot: ref.slot }
          : { bucket: ref.bucket, slot: ref.slot },
    };
  }
  return null;
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
          // Cart Mode Place flow: if a staged mon is awaiting placement,
          // assign its destination to this slot instead of moving the
          // cursor. Empty-slot guard: the inject path will refuse a
          // filled slot anyway, but blocking here gives a clearer signal.
          const placingAt = state.staging?.placingMonAt;
          if (placingAt && state.cartConnection && state.dest) {
            const targetSlot = state.dest.save.pc.boxes[state.dest.boxIndex]?.[slot];
            if (targetSlot && targetSlot.kind === 'empty') {
              const destFormat = state.dest.save.format.toLowerCase() as
                | 'ruby'
                | 'sapphire'
                | 'emerald'
                | 'firered'
                | 'leafgreen';
              void stagingMutate(deps, async (s) =>
                s.setDestination(placingAt, {
                  destCartLabel: state.cartConnection!.deviceId,
                  destTid: state.dest!.save.trainer.tid,
                  destFormat,
                  destBoxIndex: state.dest!.boxIndex,
                  destSlot: slot,
                }),
              );
              dispatch({ type: 'place_mon_assigned' });
              dispatch({ type: 'right_pane_subview', subview: 'staging' });
              return;
            }
          }
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
    if (state.cartReadError.rawBytes) {
      pane.append(renderRawCartDumpButton(state.cartReadError));
    }
  }
  pane.append(renderCartConnectButton('source', state, dispatch, deps));
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
  if (state.cartReadError && state.cartReadError.rawBytes) {
    // Mirror the source pane's raw-dump button so the user can grab the
    // bytes regardless of which side they tried to connect on.
    pane.append(renderRawCartDumpButton(state.cartReadError));
  }
  pane.append(renderCartConnectButton('dest', state, dispatch, deps));
  return pane;
}

/**
 * "Download raw cart dump" button — visible when a cart read returned
 * bytes but the parser rejected them (e.g. corrupted Gen 3 save sectors).
 * Lets the user binary-diff the bytes against a known-good FlashGBX dump
 * to bisect "is our protocol returning bad bytes" vs "is our parser too strict".
 */
function renderRawCartDumpButton(err: { rawBytes?: Uint8Array; rawFileName?: string }): HTMLElement {
  const wrap = el('div', { class: 'card cart-debug' });
  wrap.append(
    el(
      'div',
      { class: 'hint' },
      'The cart returned bytes but the parser rejected them. Download the raw dump to compare against FlashGBX or another known-good reader.',
    ),
  );
  const btn = el('button', { class: 'secondary', type: 'button' }, 'Download raw cart dump') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    if (err.rawBytes) blobDownload(err.rawFileName ?? 'cart.raw.sav', err.rawBytes);
  });
  wrap.append(btn);
  return wrap;
}

function renderCartConnectButton(
  side: 'source' | 'dest',
  state: AppState,
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
    void handleCartConnect(side, state, dispatch, deps);
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
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
): Promise<void> {
  const cartReadDeps = deps.cartReadDeps;
  if (!cartReadDeps) {
    dispatch({
      type: 'cart_connect_failed',
      side,
      reason: 'PORT_OPEN_FAILED',
      message: 'No cart-read deps configured',
    });
    return;
  }
  dispatch({ type: 'cart_connect_started', side });
  const result = await readCart(cartReadDeps, {
    onPhase: (phase) => {
      dispatch({
        type: 'cart_connect_progress',
        side,
        bytesRead: 0,
        bytesTotal: 0,
        ...(phase ? { phase } : {}),
      });
    },
    onProgress: (p) => {
      dispatch({
        type: 'cart_connect_progress',
        side,
        bytesRead: p.bytesRead,
        bytesTotal: p.bytesTotal,
        phase: 'reading',
      });
    },
  });
  if (result.kind === 'error') {
    dispatch({
      type: 'cart_connect_failed',
      side,
      reason: result.error.reason,
      message: result.error.message,
      ...(result.rawBytes ? { rawBytes: result.rawBytes } : {}),
      ...(result.rawFileName ? { rawFileName: result.rawFileName } : {}),
    });
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
    // AMEND-S7b-16 / DECISION-2 — same-cart hard-refuse. Compare the
    // dest cart's TID + cartLabel against the source cart's (the
    // pre-connect state, captured at button-click time). If both
    // match we surface a hard-refuse modal and DO NOT accept the dest
    // cart read (no destination is set, no commit can fire).
    const sourceCtx = sameCartSourceContext(state);
    if (sourceCtx) {
      const destTid = result.gen3!.trainer.tid;
      const destLabel = result.banner;
      if (destTid === sourceCtx.tid && destLabel === sourceCtx.label) {
        dispatch({
          type: 'same_cart_refused',
          sourceTid: sourceCtx.tid,
          sourceLabel: sourceCtx.label,
        });
        return;
      }
    }
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
    side,
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

/**
 * AMEND-S7b-16 / DECISION-2 — extract the source cart's (tid, label)
 * pair for the same-cart compare. Returns null when no source has been
 * loaded yet (then there's nothing to refuse against). The "label" is
 * the connection's `deviceId` (the firmware banner) — this is what
 * the dest pane will compare against, byte-for-byte.
 *
 * Edge case: two physically-different carts with the same TID but
 * different banners (rare — possible for two Pokemon Ruby JP from the
 * same factory batch). We refuse only when BOTH match (per the
 * amendment), which keeps the common case correct and the rare case
 * not-overly-aggressive.
 */
function sameCartSourceContext(
  state: AppState,
): { tid: number; label: string } | null {
  if (state.kind !== 'loaded') return null;
  const label = state.cartConnection?.deviceId;
  if (!label) return null;
  return { tid: state.save.trainer.tid, label };
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

  // CART MODE: STORE-in-destination becomes Stage-for-transfer. The
  // converted Gen 3 bytes go straight into the IDB staging box; the
  // user picks a destination slot later via the staging pane.
  if (state.cartConnection) {
    if (!result.ok) {
      return { enabled: false, disabledReason: 'Conversion failed; cannot stage', onStore: () => {} };
    }
    const sourceRef = state.openMon;
    if (!sourceRef) {
      return { enabled: false, disabledReason: 'No source mon selected', onStore: () => {} };
    }
    const sourceFamily = familyFromSaveFormat(state.save.format) === 'gb' ? 'gen1' : 'gen2';
    const speciesEntry = getSpecies(intermediate.species);
    const speciesName = speciesEntry?.name ?? `species-${intermediate.species}`;
    const onStore = (): void => {
      const stagedAt = new Date().toISOString();
      const mon: StagedMon = {
        pkBytes: result.bytes,
        sourceCartLabel: state.cartConnection!.deviceId,
        sourceTid: state.save.trainer.tid,
        sourceFamily,
        sourceOtName: state.save.trainer.name,
        speciesId: intermediate.species,
        nicknameDisplay: speciesName,
        stagedAt,
        sourceRef: {
          bucket: sourceRef.bucket,
          ...(sourceRef.boxIndex !== undefined ? { boxIndex: sourceRef.boxIndex } : {}),
          slot: sourceRef.slot,
        },
        destination: null,
      };
      void stagingMutate(deps, async (s) => {
        try {
          await s.stageMon(mon);
        } catch (e) {
          // Most likely an already-staged duplicate (per stagingStore.stageMon
          // sourceRefKey collision). Surface via console — a dialog would
          // need a state-machine action which is S7c follow-up.
          console.error('stageMon failed:', (e as Error).message);
        }
      });
      dispatch({ type: 'mon_close' });
    };
    return { enabled: true, onStore };
  }

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

/**
 * Save a single Gen 2 mon as a .pk2 file. PK2 layout matches pkhex:
 * 32-byte boxed record + 11-byte nickname + 11-byte OT name = 54 bytes.
 * Crystal-only — Gen 1 / GS encoding deferred (no encoder yet).
 */
function downloadMonAsPk2(mon: Gen12Pokemon): void {
  if (mon.sourceGen !== 2) {
    console.error(`downloadMonAsPk2: only Gen 2 supported (got sourceGen=${mon.sourceGen})`);
    return;
  }
  const enc = encodeMonGen2(mon);
  const out = new Uint8Array(enc.record.length + enc.nickname.length + enc.otName.length);
  out.set(enc.record, 0);
  out.set(enc.nickname, enc.record.length);
  out.set(enc.otName, enc.record.length + enc.nickname.length);
  // Filename uses tid + species id; nickname bytes include game-specific
  // encoding so we don't try to decode them for the filename.
  const filename = `gen2-${mon.speciesGen2Id}-tid${mon.tid}-${Date.now()}.pk2`;
  blobDownload(filename, out, 'application/octet-stream');
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
