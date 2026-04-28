/**
 * S7b — `stagingPane` tests. Covers empty state, populated state, the
 * subview toggle, and per-AMEND-S7b-15 default-to-staging behaviour.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stagingPane } from '../ui/stagingPane.js';
import type { StagedMon } from '../cart/stagingStore.types.js';

const SAMPLE_MON: StagedMon = {
  pkBytes: new Uint8Array(80),
  sourceCartLabel: 'POKEMON CRYSTAL (32 KB)',
  sourceTid: 12345,
  sourceFamily: 'gen2',
  sourceOtName: 'JOEL',
  speciesId: 158,
  nicknameDisplay: 'TOTODILE',
  sourceRef: { bucket: 'box', boxIndex: 0, slot: 0 },
  destination: null,
  stagedAt: '2026-04-23T10:00:00Z',
};

function noop(): void {
  /* */
}

describe('stagingPane — empty state', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('renders the empty-state explainer text', () => {
    const pane = stagingPane({
      stagedMons: [],
      subview: 'staging',
      destinationConnected: false,
      sourceConnected: false,
      onSubviewChange: noop,
      onUnstage: noop,
      onPlaceClick: noop,
      onCommitSource: noop,
      onCommitDest: noop,
      onClearStaging: noop,
    });
    host.append(pane);
    expect(host.textContent).toMatch(/No mons staged/);
  });
});

describe('stagingPane — populated state', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('renders 3 staged mons with sprite + species + source label', () => {
    const mons: StagedMon[] = [0, 1, 2].map((i) => ({
      ...SAMPLE_MON,
      stagedAt: `2026-04-23T10:00:0${i}Z`,
      sourceRef: { bucket: 'box', boxIndex: 0, slot: i },
    }));
    const pane = stagingPane({
      stagedMons: mons,
      subview: 'staging',
      destinationConnected: false,
      sourceConnected: true,
      onSubviewChange: noop,
      onUnstage: noop,
      onPlaceClick: noop,
      onCommitSource: noop,
      onCommitDest: noop,
      onClearStaging: noop,
    });
    host.append(pane);
    expect(host.querySelectorAll('.staged-mon-card').length).toBe(3);
    expect(host.textContent).toMatch(/TOTODILE/);
    expect(host.textContent).toMatch(/POKEMON CRYSTAL/);
  });

  it('Commit-to-source button is disabled when sourceConnected=false', () => {
    const pane = stagingPane({
      stagedMons: [SAMPLE_MON],
      subview: 'staging',
      destinationConnected: false,
      sourceConnected: false,
      onSubviewChange: noop,
      onUnstage: noop,
      onPlaceClick: noop,
      onCommitSource: noop,
      onCommitDest: noop,
      onClearStaging: noop,
    });
    host.append(pane);
    const btn = host.querySelector('.commit-source-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('Commit-to-dest is disabled when ANY staged mon has destination=null', () => {
    const placedMon: StagedMon = {
      ...SAMPLE_MON,
      stagedAt: 'placed',
      sourceRef: { bucket: 'box', boxIndex: 0, slot: 1 },
      destination: {
        destCartLabel: 'POKEMON RUBY',
        destTid: 99999,
        destFormat: 'ruby',
        destBoxIndex: 0,
        destSlot: 0,
      },
    };
    const pane = stagingPane({
      stagedMons: [placedMon, SAMPLE_MON],
      subview: 'staging',
      destinationConnected: true,
      sourceConnected: true,
      onSubviewChange: noop,
      onUnstage: noop,
      onPlaceClick: noop,
      onCommitSource: noop,
      onCommitDest: noop,
      onClearStaging: noop,
    });
    host.append(pane);
    const btn = host.querySelector('.commit-dest-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('Commit-to-dest is enabled when ALL staged mons have a destination', () => {
    const placedMon: StagedMon = {
      ...SAMPLE_MON,
      destination: {
        destCartLabel: 'POKEMON RUBY',
        destTid: 99999,
        destFormat: 'ruby',
        destBoxIndex: 0,
        destSlot: 0,
      },
    };
    const pane = stagingPane({
      stagedMons: [placedMon],
      subview: 'staging',
      destinationConnected: true,
      sourceConnected: true,
      onSubviewChange: noop,
      onUnstage: noop,
      onPlaceClick: noop,
      onCommitSource: noop,
      onCommitDest: noop,
      onClearStaging: noop,
    });
    host.append(pane);
    const btn = host.querySelector('.commit-dest-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

describe('stagingPane — AMEND-S7b-15 subview default', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('after destination cart connect, the right pane still shows staging view by default', () => {
    const pane = stagingPane({
      stagedMons: [SAMPLE_MON],
      // The reducer's default is 'staging'; the controller is responsible
      // for keeping it that way until the user clicks the toggle.
      subview: 'staging',
      destinationConnected: true,
      sourceConnected: true,
      onSubviewChange: noop,
      onUnstage: noop,
      onPlaceClick: noop,
      onCommitSource: noop,
      onCommitDest: noop,
      onClearStaging: noop,
      renderDestinationView: () => {
        const div = document.createElement('div');
        div.textContent = 'DEST VIEW';
        div.className = 'dest-view-marker';
        return div;
      },
    });
    host.append(pane);
    // The destination subview marker should NOT be rendered.
    expect(host.querySelector('.dest-view-marker')).toBeNull();
    // The staging mon card IS rendered.
    expect(host.querySelector('.staged-mon-card')).not.toBeNull();
  });

  it('clicking the Destination toggle dispatches onSubviewChange("destination")', () => {
    let lastSubview: 'staging' | 'destination' | null = null;
    const pane = stagingPane({
      stagedMons: [SAMPLE_MON],
      subview: 'staging',
      destinationConnected: true,
      sourceConnected: true,
      onSubviewChange: (sv) => (lastSubview = sv),
      onUnstage: noop,
      onPlaceClick: noop,
      onCommitSource: noop,
      onCommitDest: noop,
      onClearStaging: noop,
    });
    host.append(pane);
    const btns = host.querySelectorAll('.subview-btn');
    expect(btns.length).toBe(2);
    (btns[1] as HTMLButtonElement).click();
    expect(lastSubview).toBe('destination');
  });
});
