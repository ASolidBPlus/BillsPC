/**
 * S8v2.1 — reducer tests for the actions added by the v2 workbench:
 *
 * - `v2_switch_role` toggles `state.v2LeftRole` between source/destination
 *   (AMEND-S8v2.1-2). Default-when-unset is 'source' so the first toggle
 *   lands on 'destination'.
 * - `cart_connect_started` / `cart_connect_progress` / `cart_connect_failed`
 *   carry a required `side: 'source' | 'dest'` field that flows into
 *   `state.cartReadProgress.side` and `state.cartReadError.side`
 *   (AMEND-S8v2.1-3).
 *
 * These tests document the reducer contract relied on by `buildWorkbenchProps`
 * in `web/src/ui.ts` to disambiguate which LEFT-pane role's loading /
 * error UI to surface.
 */

import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, reducer, type AppState } from '../state.js';

describe('v2 workbench reducer actions (S8v2.1)', () => {
  describe('v2_switch_role (AMEND-S8v2.1-2)', () => {
    it('first toggle from undefined → destination', () => {
      const s = reducer(INITIAL_STATE, { type: 'v2_switch_role' });
      expect(s.v2LeftRole).toBe('destination');
    });

    it('toggling from destination → source', () => {
      const s1 = reducer(INITIAL_STATE, { type: 'v2_switch_role' });
      const s2 = reducer(s1, { type: 'v2_switch_role' });
      expect(s2.v2LeftRole).toBe('source');
    });

    it('toggle is stable across alternating dispatches', () => {
      let s: AppState = INITIAL_STATE;
      for (let i = 0; i < 6; i++) {
        s = reducer(s, { type: 'v2_switch_role' });
        expect(s.v2LeftRole).toBe(i % 2 === 0 ? 'destination' : 'source');
      }
    });

    it('v2_switch_role does NOT clobber an in-flight cart read', () => {
      const s1 = reducer(INITIAL_STATE, { type: 'cart_connect_started', side: 'source' });
      const s2 = reducer(s1, { type: 'v2_switch_role' });
      expect(s2.cartReadProgress).toBeDefined();
      expect(s2.cartReadProgress?.side).toBe('source');
      expect(s2.v2LeftRole).toBe('destination');
    });

    it('v2_switch_role preserves existing reducer state (no clear of dest, mode, etc.)', () => {
      const s1 = reducer(INITIAL_STATE, { type: 'mode_changed', mode: 'cart' });
      const s2 = reducer(s1, { type: 'v2_switch_role' });
      expect(s2.mode).toBe('cart');
      expect(s2.v2LeftRole).toBe('destination');
    });
  });

  describe('cartReadProgress.side (AMEND-S8v2.1-3)', () => {
    it('cart_connect_started records side on cartReadProgress', () => {
      const s = reducer(INITIAL_STATE, { type: 'cart_connect_started', side: 'source' });
      expect(s.cartReadProgress?.side).toBe('source');
    });

    it('cart_connect_started records dest side too', () => {
      const s = reducer(INITIAL_STATE, { type: 'cart_connect_started', side: 'dest' });
      expect(s.cartReadProgress?.side).toBe('dest');
    });

    it('cart_connect_progress carries side through to state', () => {
      let s: AppState = reducer(INITIAL_STATE, { type: 'cart_connect_started', side: 'dest' });
      s = reducer(s, {
        type: 'cart_connect_progress',
        side: 'dest',
        bytesRead: 1024,
        bytesTotal: 8192,
        phase: 'reading',
      });
      expect(s.cartReadProgress).toEqual({
        bytesRead: 1024,
        bytesTotal: 8192,
        phase: 'reading',
        side: 'dest',
      });
    });

    it('side switches if a second cart_connect_started is dispatched mid-flight', () => {
      // Realistic case: source read finishes / cancels, user immediately
      // initiates a dest cart read. The new side overrides the prior.
      const s1 = reducer(INITIAL_STATE, { type: 'cart_connect_started', side: 'source' });
      const s2 = reducer(s1, { type: 'cart_connect_started', side: 'dest' });
      expect(s2.cartReadProgress?.side).toBe('dest');
    });
  });

  describe('cartReadError.side (AMEND-S8v2.1-3)', () => {
    it('cart_connect_failed records side on cartReadError', () => {
      const s = reducer(INITIAL_STATE, {
        type: 'cart_connect_failed',
        side: 'source',
        reason: 'PORT_OPEN_FAILED',
        message: 'Port opening failed',
      });
      expect(s.cartReadError?.side).toBe('source');
    });

    it('cart_connect_failed carries optional rawBytes + filename', () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const s = reducer(INITIAL_STATE, {
        type: 'cart_connect_failed',
        side: 'dest',
        reason: 'CORRUPTED',
        message: 'Save corrupted',
        rawBytes: bytes,
        rawFileName: 'cart.raw.sav',
      });
      expect(s.cartReadError).toEqual({
        reason: 'CORRUPTED',
        message: 'Save corrupted',
        side: 'dest',
        rawBytes: bytes,
        rawFileName: 'cart.raw.sav',
      });
    });

    it('cart_connect_failed clears cartReadProgress (whether for the same side or other)', () => {
      let s: AppState = reducer(INITIAL_STATE, { type: 'cart_connect_started', side: 'source' });
      s = reducer(s, {
        type: 'cart_connect_failed',
        side: 'source',
        reason: 'PORT_OPEN_FAILED',
        message: 'x',
      });
      expect(s.cartReadProgress).toBeUndefined();
      expect(s.cartReadError?.side).toBe('source');
    });
  });
});
