/**
 * S10 — edit-mon modal tests.
 *
 * Verifies live-derived shiny / nature / ability indicators recompute
 * on PID changes, and that the D6 click-through confirm-dialog fires
 * for impossible combos.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSave, isSaveError, convert, isRefusal, packBoxed } from '@pokeportal/core';
import { openEditMonModal } from '../ui/editMonModal.js';
import type { Gen3MonEdits } from '../state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_CRYSTAL = resolve(HERE, '../../../tests/fixtures/saves/demo-crystal.sav');

const FERALIGATR_GEN2_ID = 160;

function feraligatrSlot(): Uint8Array {
  const sram = new Uint8Array(readFileSync(DEMO_CRYSTAL));
  const save = parseSave(sram);
  if (isSaveError(save)) throw new Error('demo-crystal parse failed');
  const fer =
    save.party.find((m) => m.speciesGen2Id === FERALIGATR_GEN2_ID) ??
    save.boxes.flat().find((m) => m.speciesGen2Id === FERALIGATR_GEN2_ID);
  if (!fer) throw new Error('Feraligatr not found');
  const conv = convert(fer);
  if (isRefusal(conv)) throw new Error('Feraligatr conversion refused');
  return packBoxed(conv);
}

describe('openEditMonModal — live derived display', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders the form fields seeded from the slot bytes', () => {
    const slot = feraligatrSlot();
    openEditMonModal({
      currentSlot: slot,
      boxIndex: 0,
      slot: 0,
      onApply: () => {},
      onCancel: () => {},
    });
    const overlay = document.body.querySelector('.edit-mon-overlay');
    expect(overlay).not.toBeNull();
    const pidInput = overlay!.querySelector('.edit-mon-input-pid') as HTMLInputElement;
    expect(pidInput.value).toMatch(/^0x[0-9A-F]{8}$/);
    const tidInput = overlay!.querySelector('.edit-mon-input-tid') as HTMLInputElement;
    expect(/^\d+$/.test(tidInput.value)).toBe(true);
    // Six IV inputs.
    for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) {
      expect(overlay!.querySelector(`.edit-mon-input-${k}`)).not.toBeNull();
    }
  });

  it('flips shiny indicator when PID changes such that (tid^sid^pidH^pidL)&7===0', () => {
    const slot = feraligatrSlot();
    openEditMonModal({
      currentSlot: slot,
      boxIndex: 0,
      slot: 0,
      onApply: () => {},
      onCancel: () => {},
    });
    const overlay = document.body.querySelector('.edit-mon-overlay')!;
    const tidInput = overlay.querySelector('.edit-mon-input-tid') as HTMLInputElement;
    const sidInput = overlay.querySelector('.edit-mon-input-sid') as HTMLInputElement;
    const pidInput = overlay.querySelector('.edit-mon-input-pid') as HTMLInputElement;
    // Force tid=0, sid=0, pid=0 → shiny per the formula.
    tidInput.value = '0';
    tidInput.dispatchEvent(new Event('input'));
    sidInput.value = '0';
    sidInput.dispatchEvent(new Event('input'));
    pidInput.value = '00000000';
    pidInput.dispatchEvent(new Event('input'));
    const shinyEl = overlay.querySelector('.edit-mon-derived-shiny');
    expect(shinyEl?.classList.contains('shiny')).toBe(true);
    expect(shinyEl?.textContent).toContain('SHINY');
  });

  it('updates the nature label when PID changes', () => {
    const slot = feraligatrSlot();
    openEditMonModal({
      currentSlot: slot,
      boxIndex: 0,
      slot: 0,
      onApply: () => {},
      onCancel: () => {},
    });
    const overlay = document.body.querySelector('.edit-mon-overlay')!;
    const pidInput = overlay.querySelector('.edit-mon-input-pid') as HTMLInputElement;
    pidInput.value = '00000000';
    pidInput.dispatchEvent(new Event('input'));
    // Re-query after each render — the derived row is rebuilt via
    // replaceChildren on every input event.
    expect(overlay.querySelector('.edit-mon-derived-nature')?.textContent).toContain('Hardy');
    pidInput.value = '00000001';
    pidInput.dispatchEvent(new Event('input'));
    expect(overlay.querySelector('.edit-mon-derived-nature')?.textContent).toContain('Lonely');
  });

  it('updates the ability slot indicator (PID & 1) on PID change', () => {
    const slot = feraligatrSlot();
    openEditMonModal({
      currentSlot: slot,
      boxIndex: 0,
      slot: 0,
      onApply: () => {},
      onCancel: () => {},
    });
    const overlay = document.body.querySelector('.edit-mon-overlay')!;
    const pidInput = overlay.querySelector('.edit-mon-input-pid') as HTMLInputElement;
    pidInput.value = '00000000';
    pidInput.dispatchEvent(new Event('input'));
    expect(overlay.querySelector('.edit-mon-derived-ability')?.textContent).toContain('slot 0');
    pidInput.value = '00000003';
    pidInput.dispatchEvent(new Event('input'));
    expect(overlay.querySelector('.edit-mon-derived-ability')?.textContent).toContain('slot 1');
  });
});

describe('openEditMonModal — apply / cancel paths', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('Apply with no warnings dispatches onApply with the edits payload', () => {
    const slot = feraligatrSlot();
    let captured: Gen3MonEdits | null = null;
    openEditMonModal({
      currentSlot: slot,
      boxIndex: 0,
      slot: 0,
      onApply: (edits) => {
        captured = edits;
      },
      onCancel: () => {},
    });
    const overlay = document.body.querySelector('.edit-mon-overlay')!;
    const pidInput = overlay.querySelector('.edit-mon-input-pid') as HTMLInputElement;
    pidInput.value = '12345678';
    pidInput.dispatchEvent(new Event('input'));
    const apply = overlay.querySelector('.edit-mon-apply') as HTMLButtonElement;
    apply.click();
    expect(captured).not.toBeNull();
    expect(captured!.pid).toBe(0x12345678);
  });

  it('OT name with non-encodable chars surfaces a confirm-card (D6 click-through)', () => {
    const slot = feraligatrSlot();
    let captured: Gen3MonEdits | null = null;
    openEditMonModal({
      currentSlot: slot,
      boxIndex: 0,
      slot: 0,
      onApply: (edits) => {
        captured = edits;
      },
      onCancel: () => {},
    });
    const overlay = document.body.querySelector('.edit-mon-overlay')!;
    const otInput = overlay.querySelector('.edit-mon-input-ot') as HTMLInputElement;
    // Emoji doesn't encode through Gen 3 charmap.
    otInput.value = '😀';
    otInput.dispatchEvent(new Event('input'));
    const apply = overlay.querySelector('.edit-mon-apply') as HTMLButtonElement;
    apply.click();
    // The confirm-card should have appeared.
    const confirm = document.body.querySelector('.edit-mon-confirm-overlay');
    expect(confirm).not.toBeNull();
    // Click "Apply anyway" → onApply fires.
    const proceed = confirm!.querySelector('.edit-mon-confirm-apply') as HTMLButtonElement;
    proceed.click();
    expect(captured).not.toBeNull();
  });

  it('Cancel button removes the overlay and calls onCancel', () => {
    const slot = feraligatrSlot();
    let cancelled = false;
    openEditMonModal({
      currentSlot: slot,
      boxIndex: 0,
      slot: 0,
      onApply: () => {},
      onCancel: () => {
        cancelled = true;
      },
    });
    const overlay = document.body.querySelector('.edit-mon-overlay')!;
    const cancel = overlay.querySelector('.secondary') as HTMLButtonElement;
    cancel.click();
    expect(document.body.querySelector('.edit-mon-overlay')).toBeNull();
    expect(cancelled).toBe(true);
  });
});
