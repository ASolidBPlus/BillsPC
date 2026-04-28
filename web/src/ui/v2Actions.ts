/**
 * v2 multi-select staging actions extracted from `ui.ts`.
 *
 * S8v2.2.1 — these were previously closures inside `renderV2`. Lifted to
 * a standalone module so the integration tests
 * (`v2-source-stage-flow`, `v2-transfer-dest-flow`, `v2-clear-transfer`,
 * `v2-transfer-full-banner`, `v2-placement-collision`,
 * `v2-add-to-dest-no-remove`) can invoke the production handler directly
 * with a spied StagingStore — instead of re-implementing the contract in
 * the test (which masks regressions).
 *
 * Each handler is a pure async function: it reads `state` + `deps`,
 * mutates the staging store via the `getStagingStore()` accessor on
 * `deps`, and dispatches banner / selection-clear actions back through
 * `dispatch`. Behaviour is byte-identical to the prior in-`ui.ts`
 * implementation; the goal is testability, not refactoring.
 */

import type {
  Action,
  AppState,
  MonRef,
} from '../state.js';
import type { ControllerDeps } from '../ui.js';
import type {
  Gen12Pokemon,
  Gen3SaveContents,
  SaveContents,
  SaveFormat,
  StagedMonRefGen12,
  StagedMonRefGen3,
} from '@pokeportal/core';
import type { CartFamily } from '@pokeportal/core';
import {
  composeSourceWrite,
  composeDestinationWrite,
  isComposeError,
} from '@pokeportal/core';
import { getSpecies, decodeGen12 } from '@pokeportal/core/internal';
import type { StagedSlot } from '../cart/stagingStore.types.js';
import type { StagingStore } from '../cart/stagingStore.js';
import { deriveSourceRefKey } from '../cart/stagingStore.js';
import { serializeGen12ForStaging, deserializeGen12FromStaging } from '../cart/stagingPayload.js';
import { flashCart, type CartFlasherDeps, type CartFlashOptions } from '../cart/cartFlasher.js';
import { backupFilename } from '../cart/backupSink.js';
import { confirmFlashDialog as defaultConfirmFlashDialog } from './confirmFlashDialog.js';
import { blobDownload as defaultBlobDownload } from '../download.js';

/* ------------------------------------------------------------------ */
/* Internal helpers (mirror of the closures in ui.ts before extraction) */
/* ------------------------------------------------------------------ */

function monAt(save: SaveContents, ref: MonRef): Gen12Pokemon | null {
  if (ref.bucket === 'party') return save.party[ref.slot] ?? null;
  if (ref.bucket === 'currentBox') return save.currentBox?.[ref.slot] ?? null;
  return save.boxes[ref.boxIndex ?? 0]?.[ref.slot] ?? null;
}

function familyFromSaveFormat(format: SaveFormat): CartFamily | null {
  if (format === 'RBY-RED' || format === 'RBY-BLUE' || format === 'RBY-YELLOW') return 'gb';
  if (format === 'GS' || format === 'CRYSTAL') return 'gbc';
  return null;
}

async function stagingMutate(
  deps: ControllerDeps,
  fn: (store: StagingStore) => Promise<void>,
): Promise<void> {
  const store = deps.getStagingStore?.();
  if (!store) return;
  await fn(store);
}

/* ------------------------------------------------------------------ */
/* runAddSelectedToTransfer                                            */
/* ------------------------------------------------------------------ */

/**
 * Add the source selection's mons to the transfer box. Each successful
 * placement calls `stagingStore.placeAt(nextEmpty, payload)`. Skips
 * already-staged refs silently. Caps the batch at the transfer box's
 * 30-slot capacity and surfaces a banner when the cap kicks in.
 * Filters out un-convertible mons and surfaces a separate convert-skip
 * banner. Skips party-bucket mons (party can't transfer) and surfaces a
 * party-skip banner.
 *
 * COPY semantics — `state.save` is not touched.
 *
 * AMEND-S8v2.2-8 — `slot.speciesId` carries the POST-conversion ndex
 * (`conv.species`), not `mon.speciesGen2Id`.
 */
export async function runAddSelectedToTransfer(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
  refsOverride?: ReadonlyArray<MonRef>,
): Promise<void> {
  if (state.kind !== 'loaded') return;
  const sel = refsOverride ?? state.v2SourceSelection ?? [];
  if (sel.length === 0) return;
  const store = deps.getStagingStore?.();
  if (!store) return;

  const partyFiltered = sel.filter((r) => r.bucket !== 'party');
  const skippedParty = sel.length - partyFiltered.length;

  const occupiedCount = (state.staging?.slots ?? []).reduce(
    (acc, s) => (s !== null ? acc + 1 : acc),
    0,
  );
  const cap = 30 - occupiedCount;
  const eligible = partyFiltered.slice(0, Math.max(0, cap));
  const skippedCapacity = partyFiltered.length - eligible.length;

  const cartLabel = state.cartConnection?.deviceId ?? state.fileName;
  const tid = state.save.trainer.tid;
  const otName = state.save.trainer.name;
  const sourceFamily: 'gen1' | 'gen2' | 'gen3' = (() => {
    const family = familyFromSaveFormat(state.save.format);
    if (family === 'gb') return 'gen1';
    if (family === 'gbc') return 'gen2';
    return 'gen3';
  })();

  let skippedConvert = 0;
  let i = 0;
  for (const ref of eligible) {
    const mon = monAt(state.save, ref);
    if (!mon) continue;
    const conv = deps.convert(mon);
    if (deps.isRefusal(conv)) {
      skippedConvert += 1;
      continue;
    }
    const sourceRefKey = deriveSourceRefKey(cartLabel, tid, ref);
    if (store.isStaged(sourceRefKey)) continue;
    const idx = store.nextEmptySlot();
    if (idx === null) break;
    const postSpeciesId = conv.species;
    const speciesEntry = getSpecies(postSpeciesId);
    const decodedNick = decodeGen12(mon.nicknameBytes).trim();
    const nicknameDisplay = decodedNick || speciesEntry?.name || `species-${postSpeciesId}`;
    const pkBytes = serializeGen12ForStaging(mon);
    const stagedAt = `${new Date().toISOString()}:${i}`;
    try {
      await stagingMutate(deps, (s) =>
        s.placeAt(idx, {
          pkBytes,
          speciesId: postSpeciesId,
          nicknameDisplay,
          sourceCartLabel: cartLabel,
          sourceTid: tid,
          sourceFamily,
          sourceOtName: otName,
          sourceRef: ref,
          sourceRefKey,
          stagedAt,
        }),
      );
    } catch (e) {
      console.error('placeAt failed:', (e as Error).message);
    }
    i += 1;
  }

  if (skippedCapacity > 0) {
    dispatch({ type: 'v2_transfer_box_full', skipped: skippedCapacity });
  }
  if (skippedConvert > 0) {
    dispatch({ type: 'v2_transfer_convert_skip', skipped: skippedConvert });
  }
  if (skippedParty > 0) {
    dispatch({ type: 'v2_transfer_party_skip', skipped: skippedParty });
  }
  if (refsOverride === undefined) {
    dispatch({ type: 'v2_select_clear', side: 'source' });
  }
}

/* ------------------------------------------------------------------ */
/* runAddSelectedToDestination                                         */
/* ------------------------------------------------------------------ */

/**
 * Add the transfer-selection's slots to the destination cart as
 * placement annotations. Per AMEND-S8v2.2-R2 / -6:
 *   * The handler ONLY calls `setPlacement`. It MUST NOT call
 *     `removeAt` or `clear` — the MOVE-out-of-transfer is the v2.3
 *     commit step. Load-bearing v2.3 boundary, asserted in
 *     `v2-add-to-dest-no-remove.test.ts`.
 *   * The placed slot stays occupied in the transfer box.
 *   * The dest preview is computed live; no separate side-channel.
 *
 * If the dest box runs out of empty slots mid-batch, the unplaced count
 * surfaces via `v2_transfer_placement_banner`.
 */
export async function runAddSelectedToDestination(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
  idxsOverride?: ReadonlyArray<number>,
): Promise<void> {
  if (!state.dest) return;
  const sel = idxsOverride ?? state.v2TransferSelection ?? [];
  if (sel.length === 0) return;
  const slots = state.staging?.slots ?? [];

  const destCartLabel = state.cartConnection?.deviceId ?? state.dest.fileName;
  const destTid = state.dest.save.trainer.tid;
  const destBoxIndex = state.dest.boxIndex;
  const destFormat: 'frlg' | 'rse' = (() => {
    const f = state.dest.save.format;
    if (f === 'FIRERED' || f === 'LEAFGREEN') return 'frlg';
    return 'rse';
  })();

  const box = state.dest.save.pc.boxes[destBoxIndex] ?? [];
  const localOccupied = new Set<number>();
  for (let i = 0; i < box.length; i++) {
    if (box[i]?.kind === 'filled') localOccupied.add(i);
  }
  for (const s of slots) {
    if (
      s !== null &&
      s.placement !== null &&
      s.placement.destCartLabel === destCartLabel &&
      s.placement.destTid === destTid &&
      s.placement.destBoxIndex === destBoxIndex
    ) {
      if (!sel.includes(s.idx)) localOccupied.add(s.placement.destSlot);
    }
  }

  let cursorSlot = state.dest.cursor.row * 6 + state.dest.cursor.col;
  if (cursorSlot < 0) cursorSlot = 0;

  let unplaced = 0;
  for (const transferIdx of sel) {
    while (cursorSlot < 30 && localOccupied.has(cursorSlot)) cursorSlot += 1;
    if (cursorSlot >= 30) {
      unplaced += 1;
      continue;
    }
    const placement = {
      destBoxIndex,
      destSlot: cursorSlot,
      destCartLabel,
      destTid,
      destFormat,
    } as const;
    try {
      await stagingMutate(deps, (s) => s.setPlacement(transferIdx, placement));
    } catch (e) {
      console.error('setPlacement failed:', (e as Error).message);
    }
    localOccupied.add(cursorSlot);
    cursorSlot += 1;
  }

  if (unplaced > 0) {
    dispatch({ type: 'v2_transfer_placement_banner', unplaced });
  }
  if (idxsOverride === undefined) {
    dispatch({ type: 'v2_transfer_select_clear' });
  }
}

/* ------------------------------------------------------------------ */
/* runClearTransferBox                                                 */
/* ------------------------------------------------------------------ */

/**
 * Confirm-then-clear handler for the transfer box. The confirm dialog's
 * copy MUST mention BOTH `N staged mons` AND `pending placements` —
 * AMEND-S8v2.2-10 contract; substring-asserted in
 * `v2-clear-transfer.test.ts`.
 *
 * The `confirm` dependency is injectable so tests can stub it without
 * touching the JSDOM dialog chrome. Production callers pass the
 * `openConfirmDialog` helper from `ui.ts` (mounted on `document.body`).
 *
 * Early-returns when the transfer box is empty (nothing to clear, no
 * dialog shown).
 */
export async function runClearTransferBox(
  state: AppState,
  dispatch: (a: Action) => void,
  deps: ControllerDeps,
  confirmDialog: (
    message: string,
    confirmLabel: string,
    cancelLabel: string,
  ) => Promise<boolean>,
): Promise<void> {
  void dispatch;
  const slots = state.staging?.slots ?? [];
  const occupied = slots.reduce((a, s) => (s !== null ? a + 1 : a), 0);
  if (occupied === 0) return;
  // S8v2.3 / AMEND-S8v2.3-5 + orchestrator A2: split the count into
  // X = uncommitted (safe to clear) and Y = source-committed (PERMANENTLY
  // LOST when cleared because the source bytes have already been written
  // and the dest write never happened). When Y > 0 the dialog must call
  // out the loss explicitly; when Y === 0 the dialog stays terse.
  let uncommitted = 0;
  let sourceCommitted = 0;
  for (const s of slots) {
    if (s === null) continue;
    if (s.sourceCommitted === true) sourceCommitted += 1;
    else uncommitted += 1;
  }
  const message =
    sourceCommitted > 0
      ? `Clear ${occupied} staged mons? ${uncommitted} uncommitted (safe to clear). ${sourceCommitted} source-committed (PERMANENTLY LOST — source already deleted, never written to dest). This cannot be undone.`
      : `Clear ${occupied} staged mons? ${uncommitted} uncommitted (still on source — safe to clear). This cannot be undone.`;
  const confirmed = await confirmDialog(message, 'Clear', 'Cancel');
  if (!confirmed) return;
  await stagingMutate(deps, (s) => s.clear());
}

/* ------------------------------------------------------------------ */
/* S8v2.3 — commit handlers                                            */
/* ------------------------------------------------------------------ */

/**
 * v2.3 commit dependencies. Wraps `ControllerDeps` for the cart-write
 * + SAV-download path so the handler is fully unit-testable: tests pass
 * a fake `flashDeps`, a stub `confirmFlashDialog`, and a captured
 * `downloadFn` to assert what hit the wire.
 *
 * Production wraps these with the real implementations from
 * `web/src/ui.ts` (the real `flashCart` injection + the JSDOM-mounted
 * `confirmFlashDialog` + the `blobDownload` from `web/src/download.ts`).
 */
export interface CommitDeps {
  readonly state: AppState;
  readonly dispatch: (a: Action) => void;
  readonly controller: ControllerDeps;
  readonly flashDeps: CartFlasherDeps | null;
  readonly confirmFlashDialog: typeof defaultConfirmFlashDialog;
  readonly downloadFn: typeof defaultBlobDownload;
  /** Direct reference to `flashCart` for DI. Defaults to the real one. */
  readonly flash?: typeof flashCart;
  /** S8v2.3 — DI for `composeSourceWrite` so tests can sidestep the
   *  real Gen 1/2 deleter (which requires a fully-valid SRAM buffer
   *  with the right count + checksum bytes). Defaults to the real one. */
  readonly composeSource?: typeof composeSourceWrite;
  /** S8v2.3 — DI for `composeDestinationWrite` so tests can sidestep
   *  the real Gen 3 inject path (which requires properly-encrypted
   *  80-byte slot records). Defaults to the real one. */
  readonly composeDest?: typeof composeDestinationWrite;
}

/** Per AMEND-S8v2.3-6: in-flight guard reuses `state.cartFlash.kind`
 *  rather than introducing a separate `commitInFlight` flag. */
function isCartFlashInFlight(state: AppState): boolean {
  const kind = state.cartFlash?.kind;
  return (
    kind === 'cart_flash_progressing' ||
    kind === 'cart_flash_pending' ||
    kind === 'cart_recovery_progressing'
  );
}

/** Build a `StagedMonRefGen12` from a slot + the loaded source save's
 *  format. Returns null when the slot's source family doesn't match the
 *  loaded save format (a mismatched mon snuck into staging from another
 *  cart) — the handler filters these out before composing. */
function slotToGen12Ref(
  slot: StagedSlot,
  sourceFormat: SaveFormat,
): StagedMonRefGen12 | null {
  const ref = slot.sourceRef;
  if (slot.sourceFamily === 'gen1') {
    if (sourceFormat !== 'RBY-RED' && sourceFormat !== 'RBY-BLUE' && sourceFormat !== 'RBY-YELLOW') {
      return null;
    }
    return {
      family: 'gen1',
      format: sourceFormat,
      ref:
        ref.bucket === 'box'
          ? { bucket: 'box', boxIndex: ref.boxIndex ?? 0, slot: ref.slot }
          : { bucket: ref.bucket, slot: ref.slot },
    };
  }
  if (slot.sourceFamily === 'gen2') {
    if (sourceFormat !== 'GS' && sourceFormat !== 'CRYSTAL') return null;
    return {
      family: 'gen2',
      format: sourceFormat,
      ref:
        ref.bucket === 'box'
          ? { bucket: 'box', boxIndex: ref.boxIndex ?? 0, slot: ref.slot }
          : { bucket: ref.bucket, slot: ref.slot },
    };
  }
  return null;
}

/**
 * Order Gen 1/2 delete refs so sequential `composeSourceWrite` doesn't
 * trip over per-delete box/party compaction. Within the same (bucket,
 * boxIndex) group, deleting the highest slot first leaves earlier slot
 * indices stable. Different groups are independent — a single global
 * slot-DESC sort suffices.
 */
function sortRefsForDelete(
  refs: ReadonlyArray<StagedMonRefGen12>,
): ReadonlyArray<StagedMonRefGen12> {
  return [...refs].sort((a, b) => b.ref.slot - a.ref.slot);
}

/**
 * AMEND-S8v2.3-3 — for each placed slot, decode the v2.2 sentinel-prefixed
 * Gen12Pokemon JSON snapshot, run convert + pack, and assemble a
 * `StagedMonRefGen3` aimed at the slot's placement target. A per-slot
 * conversion failure surfaces as `{ kind: 'error', stagedIndex }` so the
 * handler bails without mutating anything.
 *
 * Guards against "convert refused / decode failed" mid-batch: the legacy
 * v1 path quietly filtered such slots out via `pkBytes.length === 80`,
 * but in v2.2 every staged slot has the sentinel-JSON shape — that
 * filter would be 0% match. Better: surface the failure with the slot
 * index, let the controller decide.
 */
export function pendingDestCommitRefs(
  slots: ReadonlyArray<StagedSlot | null>,
  controller: ControllerDeps,
):
  | { readonly kind: 'ok'; readonly slotIdxs: ReadonlyArray<number>; readonly refs: ReadonlyArray<StagedMonRefGen3> }
  | { readonly kind: 'error'; readonly stagedIndex: number; readonly reason: string } {
  const slotIdxs: number[] = [];
  const refs: StagedMonRefGen3[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s === null || s === undefined) continue;
    if (s.placement === null) continue;
    const decoded = deserializeGen12FromStaging(s.pkBytes);
    if (!decoded) {
      return {
        kind: 'error',
        stagedIndex: i,
        reason: `slot ${i}: pkBytes is not a v2.2 sentinel-JSON snapshot (cannot decode for dest commit)`,
      };
    }
    const conv = controller.convert(decoded);
    if (controller.isRefusal(conv)) {
      return {
        kind: 'error',
        stagedIndex: i,
        reason: `slot ${i}: convert refused: ${(conv as { reason?: string }).reason ?? 'unknown'}`,
      };
    }
    let bytes: Uint8Array;
    try {
      bytes = controller.packBoxed(conv);
    } catch (e) {
      return {
        kind: 'error',
        stagedIndex: i,
        reason: `slot ${i}: packBoxed threw: ${(e as Error).message}`,
      };
    }
    refs.push({
      target: { boxIndex: s.placement.destBoxIndex, slot: s.placement.destSlot },
      bytes,
    });
    slotIdxs.push(i);
  }
  return { kind: 'ok', slotIdxs, refs };
}

/**
 * S8v2.3 source commit. Branches on cart-mode vs SAV-mode (per PLAN §1
 * criterion 4).
 *
 * SAV mode:
 *   * Compose modified bytes via composeSourceWrite + filtered refs.
 *   * Trigger a download of the modified SAV (filename matches the
 *     loaded SAV; user is prompted to overwrite).
 *   * Re-parse the bytes for the in-memory state via `parseSave`, then
 *     dispatch `v2_source_bytes_refreshed` BEFORE the slot mutation
 *     so the source-tile overlay clears in the same render frame.
 *   * Flip `sourceCommitted` on each committed slot via the store.
 *   * Dispatch `v2_source_committed` once the IDB write completes.
 *
 * Cart mode (per AMEND-S8v2.3-2 + DECISION-1):
 *   * Show typed-PROCEED dialog with action `'WITH COMMIT'`.
 *   * On confirm, call `flashCart` directly (NOT the legacy
 *     `runCartFlash` wrapper — see DECISION-2 / PLAN §2.4) with the
 *     pre-composed `bytes`.
 *   * Wire flash_phase / flash_progress dispatches inline (~25 lines).
 *   * On `ok`, re-parse the verified bytes and dispatch
 *     `v2_source_bytes_refreshed` + flip slots + dispatch
 *     `v2_source_committed`.
 *   * On `failed`, dispatch `flash_failed` and RETURN — no slot
 *     mutation per AMEND-S8v2.3-8 / criterion 16.
 *
 * Guards (per AMEND-S8v2.3-6 + AMEND-S8v2.3-7):
 *   * `state.kind !== 'loaded'` → return.
 *   * Cart-flash already in flight → return.
 *   * No pending commits → return.
 */
export async function runCommitSource(deps: CommitDeps): Promise<void> {
  const { state } = deps;
  if (state.kind !== 'loaded') return;
  if (isCartFlashInFlight(state)) return;
  const slots = state.staging?.slots ?? [];
  const slotIdxs: number[] = [];
  const refs: StagedMonRefGen12[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s === null || s === undefined) continue;
    if (s.sourceCommitted === true) continue;
    const r = slotToGen12Ref(s, state.save.format);
    if (!r) continue; // mismatched format / family — silently skip
    refs.push(r);
    slotIdxs.push(i);
  }
  if (slotIdxs.length === 0) return;

  // Gen 1/2 box / party deletion compacts the remaining mons UP into the
  // freed slot. composeSourceWrite applies the deletes sequentially, so
  // refs must be ordered slot-DESC within each (bucket, box) group — delete
  // the highest-slot mon first so earlier slots stay valid. Different
  // (bucket, box) groups are independent, so a single global slot-DESC
  // sort is sufficient.
  const composeFn = deps.composeSource ?? composeSourceWrite;
  const composed = composeFn(state.sourceBytes, sortRefsForDelete(refs));
  if (isComposeError(composed)) {
    console.error(
      `runCommitSource: composeSourceWrite failed at staged index ${composed.stagedIndex}`,
    );
    return;
  }
  const newBytes = composed;

  const cartMode = !!state.cartConnection;
  const fileName = state.fileName;
  const cartLabel = state.cartConnection?.deviceId ?? state.fileName;
  const tid = state.save.trainer.tid;

  if (!cartMode) {
    // SAV-mode: download + dispatch refresh + flip slots.
    deps.downloadFn(fileName, newBytes);
    await commitSourceFinalize(deps, newBytes, slotIdxs);
    return;
  }

  // Cart-mode: typed-PROCEED gate, then flashCart.
  const flashDeps = deps.flashDeps;
  if (!flashDeps) {
    console.error('runCommitSource: cart mode requires flashDeps');
    return;
  }
  const family = familyFromSaveFormat(state.save.format);
  if (!family) {
    console.error(`runCommitSource: no cart family for source format ${state.save.format}`);
    return;
  }

  const confirmed = await new Promise<boolean>((resolve) => {
    const dlg = deps.confirmFlashDialog({
      action: 'WITH COMMIT',
      cartLabel,
      cartTid: tid,
      summaryLines: [`Commit ${slotIdxs.length} staged mon${slotIdxs.length === 1 ? '' : 's'} to source cart (DELETE).`],
      performSteps: [
        'Download backup of current cart bytes (mandatory)',
        'Flash modified bytes to cart',
        'Re-read cart and verify byte-by-byte',
      ],
      onConfirm: () => {
        dlg.remove();
        resolve(true);
      },
      onCancel: () => {
        dlg.remove();
        resolve(false);
      },
    });
    document.body.append(dlg);
  });
  if (!confirmed) return;

  await runFlashAndDispatch(
    deps,
    'source',
    {
      bytes: newBytes,
      cartCurrentBytes: state.sourceBytes,
      family,
      cartLabel,
      tid,
      backupFilename: backupFilename(cartLabel, tid),
    },
    async (verifiedBytes) => {
      await commitSourceFinalize(deps, verifiedBytes, slotIdxs);
    },
  );
}

/** Re-parse + dispatch source refresh, then flip slot flags + dispatch
 *  `v2_source_committed`. Shared by SAV and cart paths. */
async function commitSourceFinalize(
  deps: CommitDeps,
  bytes: Uint8Array,
  slotIdxs: ReadonlyArray<number>,
): Promise<void> {
  const { dispatch, controller } = deps;
  // Per AMEND-S8v2.3-1: re-parse BEFORE dispatch; on parse failure log +
  // continue the slot mutation (the cart write already landed; the
  // refresh is best-effort).
  let parsed: SaveContents | null = null;
  try {
    const r = controller.parseSave(bytes);
    if (controller.isSaveError(r)) {
      console.error('runCommitSource: parseSave returned error after commit', r);
    } else {
      parsed = r as SaveContents;
    }
  } catch (e) {
    console.error('runCommitSource: parseSave threw after commit:', (e as Error).message);
  }
  if (parsed) {
    dispatch({ type: 'v2_source_bytes_refreshed', bytes, save: parsed });
  }
  await stagingMutate(controller, async (s) => {
    for (const idx of slotIdxs) {
      try {
        await s.setSourceCommitted(idx, true);
      } catch (e) {
        console.error('runCommitSource: setSourceCommitted threw:', (e as Error).message);
      }
    }
  });
  dispatch({ type: 'v2_source_committed', slotIdxs });
}

/**
 * S8v2.3 destination commit. Symmetric to source-commit (per PLAN §1
 * criterion 6 + AMEND-S8v2.3-3 / -7 / -8).
 *
 * Critical: per AMEND-S8v2.3-3 the v1 filter `pkBytes.length === 80`
 * would reject every v2.2 slot (their pkBytes is sentinel-JSON, not
 * 80-byte Gen 3 records). v2.3 decodes per slot via
 * `pendingDestCommitRefs` → convert + pack inside the helper.
 */
export async function runCommitDestination(deps: CommitDeps): Promise<void> {
  const { state, controller } = deps;
  if (!state.dest) return;
  if (isCartFlashInFlight(state)) return;
  const slots = state.staging?.slots ?? [];
  const built = pendingDestCommitRefs(slots, controller);
  if (built.kind === 'error') {
    console.error(`runCommitDestination: ${built.reason}`);
    return;
  }
  if (built.slotIdxs.length === 0) return;

  const composeFn = deps.composeDest ?? composeDestinationWrite;
  const composed = composeFn(state.dest.save, built.refs);
  if (isComposeError(composed)) {
    console.error(
      `runCommitDestination: composeDestinationWrite failed at staged index ${composed.stagedIndex}`,
    );
    return;
  }
  const newBytes = composed;

  const cartMode = !!state.cartConnection;
  const cartLabel = state.cartConnection?.deviceId ?? state.dest.fileName;
  const fileName = state.dest.fileName;
  const tid = state.dest.save.trainer.tid;

  if (!cartMode) {
    deps.downloadFn(fileName, newBytes);
    await commitDestFinalize(deps, newBytes, built.slotIdxs);
    return;
  }

  const flashDeps = deps.flashDeps;
  if (!flashDeps) {
    console.error('runCommitDestination: cart mode requires flashDeps');
    return;
  }

  const confirmed = await new Promise<boolean>((resolve) => {
    const dlg = deps.confirmFlashDialog({
      action: 'WITH COMMIT',
      cartLabel,
      cartTid: tid,
      summaryLines: [`Commit ${built.slotIdxs.length} placed mon${built.slotIdxs.length === 1 ? '' : 's'} to destination cart (WRITE).`],
      performSteps: [
        'Download backup of current cart bytes (mandatory)',
        'Flash modified bytes to cart',
        'Re-read cart and verify byte-by-byte',
      ],
      onConfirm: () => {
        dlg.remove();
        resolve(true);
      },
      onCancel: () => {
        dlg.remove();
        resolve(false);
      },
    });
    document.body.append(dlg);
  });
  if (!confirmed) return;

  await runFlashAndDispatch(
    deps,
    'destination',
    {
      bytes: newBytes,
      cartCurrentBytes: state.dest.save.bytes,
      family: 'gba',
      cartLabel,
      tid,
      backupFilename: backupFilename(cartLabel, tid),
    },
    async (verifiedBytes) => {
      await commitDestFinalize(deps, verifiedBytes, built.slotIdxs);
    },
  );
}

async function commitDestFinalize(
  deps: CommitDeps,
  bytes: Uint8Array,
  slotIdxs: ReadonlyArray<number>,
): Promise<void> {
  const { dispatch, controller } = deps;
  let parsed: Gen3SaveContents | null = null;
  try {
    const r = controller.parseGen3Save(bytes);
    if (controller.isGen3SaveError(r)) {
      console.error('runCommitDestination: parseGen3Save returned error', r);
    } else {
      parsed = r as Gen3SaveContents;
    }
  } catch (e) {
    console.error('runCommitDestination: parseGen3Save threw:', (e as Error).message);
  }
  if (parsed) {
    dispatch({ type: 'v2_dest_bytes_refreshed', bytes, save: parsed });
  }
  await stagingMutate(controller, async (s) => {
    for (const idx of slotIdxs) {
      try {
        await s.removeAt(idx);
      } catch (e) {
        console.error('runCommitDestination: removeAt threw:', (e as Error).message);
      }
    }
  });
  dispatch({ type: 'v2_dest_committed', slotIdxs });
}

/**
 * Replicates the dispatch wiring of the legacy `runCartFlash` (per
 * DECISION-2: leave that intact, replicate the ~25 lines inline). On
 * `ok` the success callback runs (slot mutation + bytes refresh). On
 * `failed` the handler dispatches `flash_failed` and returns WITHOUT
 * invoking the success callback (per AMEND-S8v2.3-8).
 */
async function runFlashAndDispatch(
  deps: CommitDeps,
  target: 'source' | 'destination',
  opts: Omit<CartFlashOptions, 'onPhase' | 'onProgress'>,
  onOk: (verifiedBytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const { dispatch } = deps;
  const flashDeps = deps.flashDeps!;
  const flashFn = deps.flash ?? flashCart;
  // commit_started lights up the cart-flash overlay so the in-flight
  // guard (cartFlash.kind) covers the whole window.
  dispatch({
    type: 'commit_started',
    target,
    planSummary: target === 'source' ? 'Commit source' : 'Commit destination',
  });
  const result = await flashFn(flashDeps, {
    ...opts,
    onPhase: (phase) => dispatch({ type: 'flash_phase', target, phase }),
    onProgress: (p) =>
      dispatch({
        type: 'flash_progress',
        target,
        bytesWritten: p.bytesWritten,
        bytesTotal: p.bytesTotal,
      }),
  });
  if (result.kind === 'ok') {
    dispatch({ type: 'flash_succeeded', target, verifiedBytes: result.verifiedBytes });
    await onOk(result.verifiedBytes);
    return;
  }
  // AMEND-S8v2.3-8: no slot mutation on failure. The existing recovery
  // dialog renders from `state.cartFlash.kind === 'cart_flash_failed'`
  // unchanged.
  dispatch({
    type: 'flash_failed',
    target,
    errorReason: (result.error as { reason?: string }).reason ?? 'WRITE_FAILED',
    errorMessage: result.error.message,
    recoveryAvailable: result.recoveryAvailable
      ? {
          backupFilename: result.recoveryAvailable.backupFilename,
          backupBytes: result.recoveryAvailable.backupBytes,
          family: opts.family === 'gba' ? 'gba' : opts.family,
        }
      : null,
  });
}
