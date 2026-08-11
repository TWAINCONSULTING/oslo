import { STRINGS } from '../config/strings';

export type HintKind = 'lanes' | 'jump' | 'slide';

const HINT_CONTENT: Record<HintKind, { arrow: string; text: string }> = {
  lanes: { arrow: '⬅➡', text: STRINGS.hintLanes },
  jump: { arrow: '⬆', text: STRINGS.hintJump },
  slide: { arrow: '⬇', text: STRINGS.hintSlide },
};

/** In-game overlay: score, distance, tokens, contextual hints, record flash. */
export class Hud {
  private root: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private distEl: HTMLSpanElement;
  private tokensEl: HTMLSpanElement;
  private hintEl: HTMLDivElement;
  private hintArrow: HTMLSpanElement;
  private hintText: HTMLSpanElement;
  private recordEl: HTMLDivElement;
  private lastScore = -1;
  private lastDist = -1;
  private lastTokens = -1;
  private hintTimer = 0;
  private popTimer = 0;

  onPause: () => void = () => undefined;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-left">
          <div class="hud-score">0</div>
          <div class="hud-dist"><span>0</span> ${STRINGS.meters}</div>
        </div>
        <div class="hud-right">
          <div class="hud-tokens"><span class="hud-coin"></span><span class="hud-token-count">0</span></div>
          <button class="hud-pause" aria-label="${STRINGS.pause}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="2.5" y="1.5" width="4" height="13" rx="1.4"/>
              <rect x="9.5" y="1.5" width="4" height="13" rx="1.4"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="hud-hint"><span class="hint-arrow"></span><span class="hint-text"></span></div>
      <div class="hud-record">${STRINGS.newRecord}</div>
    `;
    parent.appendChild(this.root);
    this.scoreEl = this.root.querySelector('.hud-score')!;
    this.distEl = this.root.querySelector('.hud-dist span')!;
    this.tokensEl = this.root.querySelector('.hud-token-count')!;
    this.hintEl = this.root.querySelector('.hud-hint')!;
    this.hintArrow = this.root.querySelector('.hint-arrow')!;
    this.hintText = this.root.querySelector('.hint-text')!;
    this.recordEl = this.root.querySelector('.hud-record')!;
    const pauseBtn = this.root.querySelector('.hud-pause')!;
    pauseBtn.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      this.onPause();
    });
    pauseBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.hideHint();
    this.recordEl.classList.remove('show');
  }

  reset(): void {
    this.lastScore = this.lastDist = this.lastTokens = -1;
    this.set(0, 0, 0);
    this.recordEl.classList.remove('show');
  }

  set(score: number, dist: number, tokens: number): void {
    if (score !== this.lastScore) {
      this.scoreEl.textContent = String(score);
      this.lastScore = score;
    }
    if (dist !== this.lastDist) {
      this.distEl.textContent = String(dist);
      this.lastDist = dist;
    }
    if (tokens !== this.lastTokens) {
      this.tokensEl.textContent = String(tokens);
      this.lastTokens = tokens;
    }
  }

  tokenPop(): void {
    this.scoreEl.classList.add('pop');
    this.popTimer = 0.14;
  }

  showHint(kind: HintKind, seconds = 2.6): void {
    const c = HINT_CONTENT[kind];
    this.hintArrow.textContent = c.arrow;
    this.hintText.textContent = c.text;
    this.hintEl.classList.add('show');
    this.hintTimer = seconds;
  }

  hideHint(): void {
    this.hintEl.classList.remove('show');
    this.hintTimer = 0;
  }

  flashRecord(): void {
    this.recordEl.classList.add('show');
    window.setTimeout(() => this.recordEl.classList.remove('show'), 2100);
  }

  tick(dt: number): void {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hideHint();
    }
    if (this.popTimer > 0) {
      this.popTimer -= dt;
      if (this.popTimer <= 0) this.scoreEl.classList.remove('pop');
    }
  }
}
