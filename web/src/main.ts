/**
 * Entry point for the pokeportal web demo. Bootstraps the controller
 * and mounts it to `#app`.
 */
import { createController } from './ui.js';

const root = document.getElementById('app');
if (!root) throw new Error('pokeportal: #app element missing from DOM');
createController(root);
