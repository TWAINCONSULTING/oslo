import { OBSTACLES } from '../config/content';

export interface DebugHooks {
  getStats: () => { fps: number; speed: number; dist: number; seed: number; repairs: number };
  forceSpawn: (defId: string) => void;
  restartSameSeed: () => void;
  restartWithSeed: (seed: number) => void;
  resetHighScore: () => void;
}

/**
 * Hidden dev panel (?debug=1 or Ctrl+Shift+D). Invincibility, hitboxes,
 * FPS/speed/seed readout, force-spawns, seeded restarts.
 */
export class DebugPanel {
  invincible = false;
  showHitboxes = false;

  private root: HTMLDivElement;
  private statsEl: HTMLDivElement;
  private accum = 0;

  constructor(parent: HTMLElement, private hooks: DebugHooks) {
    this.root = document.createElement('div');
    this.root.id = 'debug';
    const spawnButtons = Object.keys(OBSTACLES)
      .map((id) => `<button data-spawn="${id}">${id}</button>`)
      .join('');
    this.root.innerHTML = `
      <div class="dbg-stats"></div>
      <div class="dbg-row">
        <button data-act="inv">gud (I)</button>
        <button data-act="hit">hitbokser (B)</button>
        <button data-act="hiscore">nullstill rekord</button>
      </div>
      <div class="dbg-row">${spawnButtons}</div>
      <div class="dbg-row">
        <input type="number" class="dbg-seed" placeholder="seed" />
        <button data-act="seed">start med seed</button>
        <button data-act="same">samme seed (R)</button>
      </div>
    `;
    parent.appendChild(this.root);
    this.statsEl = this.root.querySelector('.dbg-stats')!;

    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('pointerup', (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      const spawn = btn.dataset.spawn;
      if (spawn) {
        this.hooks.forceSpawn(spawn);
        return;
      }
      switch (btn.dataset.act) {
        case 'inv':
          this.invincible = !this.invincible;
          btn.classList.toggle('active', this.invincible);
          break;
        case 'hit':
          this.showHitboxes = !this.showHitboxes;
          btn.classList.toggle('active', this.showHitboxes);
          break;
        case 'hiscore':
          this.hooks.resetHighScore();
          break;
        case 'same':
          this.hooks.restartSameSeed();
          break;
        case 'seed': {
          const input = this.root.querySelector<HTMLInputElement>('.dbg-seed')!;
          const v = parseInt(input.value, 10);
          if (!Number.isNaN(v)) this.hooks.restartWithSeed(v >>> 0);
          break;
        }
      }
    });

    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyI') {
      this.invincible = !this.invincible;
      this.syncButtons();
    } else if (e.code === 'KeyB') {
      this.showHitboxes = !this.showHitboxes;
      this.syncButtons();
    } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
      this.hooks.restartSameSeed();
    }
  };

  private syncButtons(): void {
    this.root.querySelector('[data-act="inv"]')?.classList.toggle('active', this.invincible);
    this.root.querySelector('[data-act="hit"]')?.classList.toggle('active', this.showHitboxes);
  }

  tick(dt: number): void {
    this.accum += dt;
    if (this.accum < 0.25) return;
    this.accum = 0;
    const s = this.hooks.getStats();
    this.statsEl.textContent =
      `fps ${s.fps.toFixed(0)}  speed ${s.speed.toFixed(1)} m/s\n` +
      `dist ${s.dist.toFixed(0)} m  repairs ${s.repairs}\n` +
      `seed ${s.seed}`;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}
