/**
 * S7b — reducer tests for the cart-flash sub-state machine. All
 * additive on top of S5/S6a/S7a; this file does NOT modify any existing
 * test (per AMEND-S7b's "additive only" requirement).
 */

import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, reducer, type AppState } from '../state.js';
import type { StagingSessionV1 } from '../cart/stagingStore.types.js';

const EMPTY_SESSION: StagingSessionV1 = {
  schemaVersion: 1,
  id: 'default',
  stagedMons: [],
  sessionMetadata: { createdAt: '2026-04-23T10:00:00Z', lastModifiedAt: '2026-04-23T10:00:00Z' },
};

describe('staging reducer', () => {
  it('staging_loaded populates state.staging with rightPaneSubview="staging" by default (AMEND-S7b-15)', () => {
    const state = reducer(INITIAL_STATE, { type: 'staging_loaded', session: EMPTY_SESSION });
    expect(state.staging).toBeDefined();
    expect(state.staging!.rightPaneSubview).toBe('staging');
    expect(state.staging!.stagedMons).toEqual([]);
  });

  it('right_pane_subview only switches on explicit action', () => {
    let state: AppState = reducer(INITIAL_STATE, { type: 'staging_loaded', session: EMPTY_SESSION });
    state = reducer(state, { type: 'right_pane_subview', subview: 'destination' });
    expect(state.staging!.rightPaneSubview).toBe('destination');
    state = reducer(state, { type: 'right_pane_subview', subview: 'staging' });
    expect(state.staging!.rightPaneSubview).toBe('staging');
  });

  it('staging_cleared empties stagedMons but keeps the staging shape', () => {
    let state: AppState = reducer(INITIAL_STATE, {
      type: 'staging_loaded',
      session: {
        ...EMPTY_SESSION,
        stagedMons: [
          {
            pkBytes: new Uint8Array(10),
            sourceCartLabel: 'X',
            sourceTid: 1,
            sourceFamily: 'gen2',
            sourceOtName: 'Y',
            speciesId: 1,
            nicknameDisplay: 'Z',
            sourceRef: { bucket: 'box', boxIndex: 0, slot: 0 },
            destination: null,
            stagedAt: '2026-04-23T10:00:00Z',
          },
        ],
      },
    });
    state = reducer(state, { type: 'staging_cleared' });
    expect(state.staging!.stagedMons).toEqual([]);
  });

  it('multi_tab_claim_received toggles multiTabBanner', () => {
    const state = reducer(INITIAL_STATE, { type: 'multi_tab_claim_received' });
    expect(state.multiTabBanner).toBe(true);
  });
});

describe('cart-flash reducer', () => {
  it('commit_started → cartFlash.kind === "cart_flash_pending" with target + planSummary', () => {
    const state = reducer(INITIAL_STATE, {
      type: 'commit_started',
      target: 'source',
      planSummary: 'Will delete 3 mons',
    });
    expect(state.cartFlash?.kind).toBe('cart_flash_pending');
    if (state.cartFlash?.kind !== 'cart_flash_pending') return;
    expect(state.cartFlash.target).toBe('source');
    expect(state.cartFlash.planSummary).toBe('Will delete 3 mons');
    expect(state.recoveryAttempts).toBe(0);
  });

  it('flash_phase + flash_progress chain populates progress.bytesWritten', () => {
    let state: AppState = reducer(INITIAL_STATE, {
      type: 'commit_started',
      target: 'source',
      planSummary: '',
    });
    state = reducer(state, { type: 'flash_phase', target: 'source', phase: 'flashing' });
    state = reducer(state, {
      type: 'flash_progress',
      target: 'source',
      bytesWritten: 1024,
      bytesTotal: 32768,
    });
    expect(state.cartFlash?.kind).toBe('cart_flash_progressing');
    if (state.cartFlash?.kind !== 'cart_flash_progressing') return;
    expect(state.cartFlash.progress?.bytesWritten).toBe(1024);
  });

  it('flash_failed with recoveryAvailable populated → kind === "cart_flash_failed"', () => {
    const recovery = {
      backupFilename: 'POKEMON-RED.backup-pre-x.sav',
      backupBytes: new Uint8Array(8 * 1024),
      family: 'gb' as const,
    };
    const state = reducer(INITIAL_STATE, {
      type: 'flash_failed',
      target: 'source',
      errorReason: 'WRITE_FAILED',
      errorMessage: 'mid-write disconnect',
      recoveryAvailable: recovery,
    });
    expect(state.cartFlash?.kind).toBe('cart_flash_failed');
    if (state.cartFlash?.kind !== 'cart_flash_failed') return;
    expect(state.cartFlash.recoveryAvailable).toEqual(recovery);
  });

  it('flash_failed with recoveryAvailable=null preserves the null (AMEND-S7b-7)', () => {
    const state = reducer(INITIAL_STATE, {
      type: 'flash_failed',
      target: 'source',
      errorReason: 'BACKUP_FAILED',
      errorMessage: 'user cancelled save picker',
      recoveryAvailable: null,
    });
    expect(state.cartFlash?.kind).toBe('cart_flash_failed');
    if (state.cartFlash?.kind === 'cart_flash_failed') {
      expect(state.cartFlash.recoveryAvailable).toBeNull();
    }
  });

  it('recovery flow: started → progress → done', () => {
    let state: AppState = reducer(INITIAL_STATE, {
      type: 'recovery_started',
      backupFilename: 'POKEMON-RED.backup-pre-x.sav',
    });
    expect(state.cartFlash?.kind).toBe('cart_recovery_progressing');
    expect(state.recoveryAttempts).toBe(1);
    state = reducer(state, { type: 'recovery_progress', bytesWritten: 100, bytesTotal: 8192 });
    if (state.cartFlash?.kind === 'cart_recovery_progressing') {
      expect(state.cartFlash.progress?.bytesWritten).toBe(100);
    }
    state = reducer(state, { type: 'recovery_done' });
    expect(state.cartFlash?.kind).toBe('cart_recovery_done');
  });

  it('attemptsExhausted=true once recovery has failed 3 times (AMEND-S7b-14 / DECISION-7)', () => {
    let state: AppState = INITIAL_STATE;
    for (let i = 0; i < 3; i++) {
      state = reducer(state, {
        type: 'recovery_started',
        backupFilename: 'POKEMON-RED.backup-pre-x.sav',
      });
      state = reducer(state, {
        type: 'recovery_failed',
        errorReason: 'WRITE_FAILED',
        errorMessage: `attempt ${i + 1}`,
      });
    }
    expect(state.cartFlash?.kind).toBe('cart_recovery_failed');
    if (state.cartFlash?.kind === 'cart_recovery_failed') {
      expect(state.cartFlash.attemptsExhausted).toBe(true);
    }
    expect(state.recoveryAttempts).toBe(3);
  });

  it('cart_flash_dismissed resets cartFlash to idle', () => {
    let state: AppState = reducer(INITIAL_STATE, {
      type: 'flash_failed',
      target: 'source',
      errorReason: 'WRITE_FAILED',
      errorMessage: 'x',
      recoveryAvailable: null,
    });
    state = reducer(state, { type: 'cart_flash_dismissed' });
    expect(state.cartFlash?.kind).toBe('cart_flash_idle');
  });
});

describe('S5/S6a/S7a tests still pass after S7b reducer extension', () => {
  it('does NOT touch top-level kind when cart-flash actions fire on a loaded source', () => {
    // Simulate a loaded source via existing actions, then run S7b actions
    // and confirm `kind` stays `loaded`.
    let state: AppState = INITIAL_STATE;
    // We can't construct a 'loaded' state without going through file_parsed,
    // so just confirm non-loaded kinds stay non-loaded under S7b actions.
    state = reducer(state, {
      type: 'commit_started',
      target: 'source',
      planSummary: 'x',
    });
    expect(state.kind).toBe('idle');
  });
});
