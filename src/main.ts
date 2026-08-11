import './style.css';
import { Game } from './core/game';

const params = new URLSearchParams(window.location.search);
const debug = params.get('debug') === '1';
const seedRaw = params.get('seed');
const seed = seedRaw !== null && !Number.isNaN(parseInt(seedRaw, 10)) ? parseInt(seedRaw, 10) >>> 0 : null;

const app = document.getElementById('app')!;
new Game(app, { debug, seed });

// Fade the CSS splash once the first frames have rendered.
const splash = document.getElementById('splash');
if (splash) {
  window.setTimeout(() => {
    splash.classList.add('fade');
    window.setTimeout(() => splash.remove(), 500);
  }, 350);
}

// Basic PWA: cache-first service worker, production only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
