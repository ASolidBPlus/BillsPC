/**
 * Entry point for the pokeportal web demo. Bootstraps the controller
 * and mounts it to `#app`.
 */
import { createController } from './ui.js';

declare const __BUILD_COMMIT__: string;

console.log(
  `%c[BillsPC] build ${__BUILD_COMMIT__}`,
  'color:#fff;background:#5878a8;font-weight:bold;padding:2px 6px;border-radius:3px',
);

const buildPill = document.createElement('div');
buildPill.id = 'build-pill';
buildPill.textContent = `build ${__BUILD_COMMIT__}`;
buildPill.title =
  'Build commit — share this SHA when reporting bugs so we can confirm what code you ran';
document.body.appendChild(buildPill);

const root = document.getElementById('app');
if (!root) throw new Error('pokeportal: #app element missing from DOM');
createController(root);
