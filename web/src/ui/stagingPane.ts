/**
 * Right-pane staging UI. Per PLAN §10.6 + AMEND-S7b-15:
 *   - Default subview: 'staging' (always; the user clicks 'Destination'
 *     to switch).
 *   - Each staged mon shows sprite + species + source label + Place at...
 *   - Two big commit buttons:
 *       * "Commit to source: delete N" — enabled when source connected
 *       * "Commit to dest: inject N" — enabled when dest connected AND
 *         all staged mons placed
 *   - "Cancel & clear staging" at the bottom.
 *   - Empty state explainer when stagedMons is empty.
 *
 * Per DECISION-4 + AMEND-S7b-23 — sprites are the overworld walker pack
 * already vendored at `web/public/sprites/overworld/` (covers ndex
 * 1..386). Matches the destBoxBrowser idiom.
 */

import { dialog } from './dialog.js';
import { el } from './dom.js';
import { spriteImg } from './sprites.js';
import type { StagedMon } from '../cart/stagingStore.types.js';

export interface StagingPaneProps {
  readonly stagedMons: ReadonlyArray<StagedMon>;
  readonly subview: 'staging' | 'destination';
  readonly destinationConnected: boolean;
  readonly sourceConnected: boolean;
  readonly multiTabBanner?: boolean;
  readonly onSubviewChange: (subview: 'staging' | 'destination') => void;
  readonly onUnstage: (stagedAt: string) => void;
  readonly onPlaceClick: (stagedAt: string) => void;
  readonly onCommitSource: () => void;
  readonly onCommitDest: () => void;
  readonly onClearStaging: () => void;
  /** Optional renderer for the destination subview — caller-supplied so
   *  the staging pane stays decoupled from the dest box browser. */
  readonly renderDestinationView?: () => HTMLElement;
  /** Optional renderer for a "Connect destination cart" affordance.
   *  Shown above the staging list when destinationConnected is false,
   *  so the user has a one-click path to swap to their dest cart after
   *  the source-side commit completes. Caller renders the actual
   *  button (it's just the renderCartConnectButton('dest', ...) call). */
  readonly renderConnectDestination?: () => HTMLElement;
}

export function stagingPane(props: StagingPaneProps): HTMLElement {
  const wrap = el('div', { class: 'pane staging-pane' });
  wrap.append(el('div', { class: 'pane-label' }, 'STAGING'));

  if (props.multiTabBanner) {
    wrap.append(
      el(
        'div',
        { class: 'card multi-tab-banner' },
        'Another tab has the staging box open. Changes here may overwrite that tab’s session.',
      ),
    );
  }

  // Subview toggle (only when destination connected — otherwise staging
  // is the only useful view).
  if (props.destinationConnected) {
    wrap.append(renderSubviewToggle(props));
  } else if (props.renderConnectDestination) {
    // No dest cart yet → surface a connect button so the user can swap
    // to their destination cart after the source-side commit.
    wrap.append(props.renderConnectDestination());
  }

  if (props.subview === 'destination' && props.renderDestinationView) {
    wrap.append(props.renderDestinationView());
    return wrap;
  }

  // Staging subview content.
  if (props.stagedMons.length === 0) {
    wrap.append(
      el(
        'div',
        { class: 'card staging-empty' },
        'No mons staged yet. Pick a mon from the cart on the left to stage it for transfer.',
      ),
    );
  } else {
    const list = el('div', { class: 'staging-list' });
    for (const mon of props.stagedMons) {
      list.append(renderStagedMonCard(mon, props));
    }
    wrap.append(list);
    wrap.append(renderSummaryAndButtons(props));
  }

  return wrap;
}

function renderSubviewToggle(props: StagingPaneProps): HTMLElement {
  const toggle = el('div', { class: 'staging-subview-toggle' });
  for (const sv of ['staging', 'destination'] as const) {
    const btn = el(
      'button',
      {
        type: 'button',
        class: 'subview-btn' + (props.subview === sv ? ' is-active' : ''),
      },
      sv === 'staging' ? 'Staging' : 'Destination',
    ) as HTMLButtonElement;
    btn.addEventListener('click', () => props.onSubviewChange(sv));
    toggle.append(btn);
  }
  return toggle;
}

function renderStagedMonCard(mon: StagedMon, props: StagingPaneProps): HTMLElement {
  const card = dialog({ class: 'gen2-dialog staged-mon-card' });
  card.append(
    el(
      'div',
      { class: 'staged-mon-sprite' },
      spriteImg(mon.speciesId, 'party-gen2', mon.nicknameDisplay),
    ),
    el('div', { class: 'gen2-line staged-mon-name' }, `${mon.nicknameDisplay} (#${mon.speciesId})`),
    el('div', { class: 'gen2-line staged-mon-source' }, `Source: ${mon.sourceCartLabel}`),
  );
  if (mon.destination) {
    card.append(
      el(
        'div',
        { class: 'gen2-line staged-mon-dest' },
        `Place at: ${mon.destination.destCartLabel} B${mon.destination.destBoxIndex + 1}/S${mon.destination.destSlot + 1}`,
      ),
    );
  } else {
    const placeBtn = el(
      'button',
      { type: 'button', class: 'primary place-button' },
      props.destinationConnected ? 'Place at…' : 'Place at… (connect dest cart)',
    ) as HTMLButtonElement;
    if (!props.destinationConnected) placeBtn.setAttribute('disabled', 'disabled');
    placeBtn.addEventListener('click', () => props.onPlaceClick(mon.stagedAt));
    card.append(placeBtn);
  }
  const unstageBtn = el(
    'button',
    { type: 'button', class: 'secondary unstage-button' },
    'Unstage',
  ) as HTMLButtonElement;
  unstageBtn.addEventListener('click', () => props.onUnstage(mon.stagedAt));
  card.append(unstageBtn);
  return card;
}

function renderSummaryAndButtons(props: StagingPaneProps): HTMLElement {
  const wrap = el('div', { class: 'staging-actions' });
  const placedCount = props.stagedMons.filter((m) => m.destination !== null).length;
  wrap.append(
    el(
      'div',
      { class: 'gen2-line staging-summary' },
      `Staged: ${props.stagedMons.length} / ${placedCount} placed`,
    ),
  );

  const commitSourceBtn = el(
    'button',
    { type: 'button', class: 'primary commit-source-button' },
    `Commit to source: delete ${props.stagedMons.length}`,
  ) as HTMLButtonElement;
  if (!props.sourceConnected) commitSourceBtn.setAttribute('disabled', 'disabled');
  commitSourceBtn.addEventListener('click', () => props.onCommitSource());

  const commitDestBtn = el(
    'button',
    { type: 'button', class: 'primary commit-dest-button' },
    `Commit to dest: inject ${props.stagedMons.length}`,
  ) as HTMLButtonElement;
  if (!props.destinationConnected || placedCount !== props.stagedMons.length) {
    commitDestBtn.setAttribute('disabled', 'disabled');
  }
  commitDestBtn.addEventListener('click', () => props.onCommitDest());

  const clearBtn = el(
    'button',
    { type: 'button', class: 'secondary clear-staging-button' },
    'Cancel & clear staging',
  ) as HTMLButtonElement;
  clearBtn.addEventListener('click', () => props.onClearStaging());

  wrap.append(commitSourceBtn, commitDestBtn, clearBtn);
  return wrap;
}
