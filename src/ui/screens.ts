import { STRINGS } from '../config/strings';

export interface GameOverStats {
  score: number;
  distance: number;
  tokens: number;
  best: number;
  isRecord: boolean;
}

/**
 * Menu / pause / game-over overlays. Whole-screen tap triggers the primary
 * action; toggle buttons stop propagation.
 */
export class Screens {
  onStart: () => void = () => undefined;
  onResume: () => void = () => undefined;
  onToggleSound: () => boolean = () => true;
  onToggleVibration: () => boolean = () => true;

  private root: HTMLDivElement;
  private start: HTMLDivElement;
  private gameover: HTMLDivElement;
  private pause: HTMLDivElement;
  private countdown: HTMLDivElement;

  constructor(parent: HTMLElement, sound: boolean, vibration: boolean) {
    this.root = document.createElement('div');
    this.root.id = 'screens';
    parent.appendChild(this.root);

    this.start = this.makeScreen(`
      <div class="title">OSLO<span class="accent">&nbsp;RUSH</span></div>
      <div class="subtitle">${STRINGS.subtitle}</div>
      <div class="chip start-best">${STRINGS.best}: <strong>0</strong></div>
      <div class="tap-cta">${STRINGS.tapToStart}</div>
      <div class="swipe-note">${STRINGS.swipeToMove}</div>
      ${this.togglesHtml(sound, vibration)}
    `);
    this.gameover = this.makeScreen(`
      <div class="gameover-title">${STRINGS.gameOver}</div>
      <div class="record-badge" style="display:none">${STRINGS.newRecord}</div>
      <div class="stats">
        <div class="stat-row main"><span>${STRINGS.score}</span><strong class="go-score">0</strong></div>
        <div class="stat-row"><span>${STRINGS.distance}</span><strong><span class="go-dist">0</span> ${STRINGS.meters}</strong></div>
        <div class="stat-row"><span>${STRINGS.collected}</span><strong class="go-tokens">0</strong></div>
        <div class="stat-row"><span>${STRINGS.best}</span><strong class="go-best">0</strong></div>
      </div>
      <button class="btn go-retry">${STRINGS.retry}</button>
      ${this.togglesHtml(sound, vibration)}
    `);
    this.pause = this.makeScreen(`
      <div class="gameover-title">${STRINGS.pause}</div>
      <div class="tap-cta">${STRINGS.resume}</div>
      ${this.togglesHtml(sound, vibration)}
    `);
    this.countdown = this.makeScreen(`<div class="countdown">${STRINGS.ready}</div>`);
    this.countdown.classList.remove('screen-backdrop');

    // Primary actions.
    this.start.addEventListener('pointerup', () => this.onStart());
    this.gameover.addEventListener('pointerup', () => this.onStart());
    this.gameover.querySelector('.go-retry')!.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      this.onStart();
    });
    this.pause.addEventListener('pointerup', () => this.onResume());

    // Toggles.
    for (const screen of [this.start, this.gameover, this.pause]) {
      const soundBtn = screen.querySelector<HTMLButtonElement>('.toggle-sound')!;
      const vibBtn = screen.querySelector<HTMLButtonElement>('.toggle-vib')!;
      for (const btn of [soundBtn, vibBtn]) {
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      }
      soundBtn.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.setToggle('.toggle-sound', this.onToggleSound());
      });
      vibBtn.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.setToggle('.toggle-vib', this.onToggleVibration());
      });
    }
  }

  private togglesHtml(sound: boolean, vibration: boolean): string {
    return `
      <div class="toggles">
        <button class="toggle toggle-sound ${sound ? 'on' : ''}"><span class="dot"></span>${STRINGS.sound}</button>
        <button class="toggle toggle-vib ${vibration ? 'on' : ''}"><span class="dot"></span>${STRINGS.vibration}</button>
      </div>
    `;
  }

  private setToggle(selector: string, on: boolean): void {
    for (const el of this.root.querySelectorAll(selector)) {
      el.classList.toggle('on', on);
    }
  }

  private makeScreen(html: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'screen screen-backdrop';
    el.innerHTML = html;
    this.root.appendChild(el);
    return el;
  }

  showStart(best: number): void {
    this.hideAll();
    this.start.querySelector('.start-best strong')!.textContent = String(best);
    (this.start.querySelector('.start-best') as HTMLElement).style.display = best > 0 ? '' : 'none';
    this.start.classList.add('show');
  }

  showGameOver(stats: GameOverStats): void {
    this.hideAll();
    this.gameover.querySelector('.go-score')!.textContent = String(stats.score);
    this.gameover.querySelector('.go-dist')!.textContent = String(stats.distance);
    this.gameover.querySelector('.go-tokens')!.textContent = String(stats.tokens);
    this.gameover.querySelector('.go-best')!.textContent = String(stats.best);
    (this.gameover.querySelector('.record-badge') as HTMLElement).style.display = stats.isRecord ? '' : 'none';
    this.gameover.classList.add('show');
  }

  showPause(): void {
    this.hideAll();
    this.pause.classList.add('show');
  }

  showCountdown(): void {
    this.hideAll();
    this.countdown.classList.add('show');
  }

  hideAll(): void {
    for (const s of [this.start, this.gameover, this.pause, this.countdown]) {
      s.classList.remove('show');
    }
  }
}
