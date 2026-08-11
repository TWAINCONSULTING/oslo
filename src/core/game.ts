import * as THREE from 'three';
import { CONTENT, DIFFICULTY, OBSTACLES, activeCollectible, activeTheme, laneX } from '../config/content';
import { speedAt } from '../world/difficulty';
import { Spawner } from '../world/spawner';
import { Environment } from '../world/environment';
import { Backdrop } from '../world/sky';
import { ObstacleManager } from '../world/obstacles';
import { TokenManager } from '../world/collectibles';
import { createCharacter, type CourierCharacter } from '../player/character';
import { PlayerController } from '../player/controller';
import { Particles } from '../fx/particles';
import { SpeedLines } from '../fx/speedlines';
import { Hud } from '../ui/hud';
import { Screens } from '../ui/screens';
import { DebugPanel } from '../ui/debug';
import { AudioFX } from './audio';
import { CameraRig } from './camera';
import { Input, type GameAction } from './input';
import { Loop } from './loop';
import { randomSeed } from './rng';
import { scoreFor } from './scoring';
import { loadData, resetHighScore, saveData } from './storage';
import { HAPTIC, setHapticsEnabled, vibrate } from './haptics';

export interface GameOptions {
  debug: boolean;
  seed: number | null;
}

type Phase = 'menu' | 'running' | 'crashing' | 'gameover';

const SPEED_MIN = DIFFICULTY.speedKeys[0].v;
const SPEED_MAX = DIFFICULTY.speedKeys[DIFFICULTY.speedKeys.length - 1].v;

export class Game {
  // three.js core
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cameraRig: CameraRig;
  private loop: Loop;

  // world
  private backdrop: Backdrop;
  private env: Environment;
  private obstacleMgr: ObstacleManager;
  private tokenMgr: TokenManager;
  private particles: Particles;
  private speedLines: SpeedLines;
  private character: CourierCharacter;
  private controller = new PlayerController();
  private spawner: Spawner | null = null;

  // ui / io
  private audio = new AudioFX();
  private input: Input;
  private hud: Hud;
  private screens: Screens;
  private debugPanel: DebugPanel | null = null;

  // state
  private phase: Phase = 'menu';
  private paused = false;
  private resumeTimer = 0;
  private timescale = 1;
  private elapsed = 0;
  private time = 0;
  private traveled = 0;
  private speed = 0;
  private startRamp = 0;
  private crashTimer = 0;
  private gameoverAt = 0;
  private tokensCollected = 0;
  private score = 0;
  private recordFlashed = false;
  private lastSeed = 0;
  private revalidateTimer = 0;
  private pickupCombo = 0;
  private lastPickupAt = -10;
  private belled = new Set<number>();
  private hintShown = { jump: false, slide: false };
  private actedThisRun = { jump: false, slide: false };
  private runCount = 0;

  // perf
  private frameEma = 16;
  private dprCap: number;
  private dprCurrent: number;
  private perfTimer = 0;

  // debug hitboxes
  private hitboxHelpers = new Map<number | 'player', THREE.Box3Helper>();

  /** Cancels every window/document listener this instance registered. */
  private aborter = new AbortController();

  constructor(private root: HTMLElement, private options: GameOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.dprCap = Math.min(window.devicePixelRatio || 1, 2);
    this.dprCurrent = this.dprCap;
    this.renderer.setPixelRatio(this.dprCurrent);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    root.appendChild(this.renderer.domElement);

    const theme = activeTheme();
    this.cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
    this.scene.add(this.cameraRig.camera);

    this.backdrop = new Backdrop(this.scene, theme);
    this.env = new Environment(this.scene, theme, this.options.seed ?? randomSeed());
    this.obstacleMgr = new ObstacleManager(this.scene);
    this.tokenMgr = new TokenManager(this.scene);
    this.particles = new Particles(this.scene);
    this.speedLines = new SpeedLines(this.cameraRig.camera);

    this.character = createCharacter(CONTENT.activeCharacter);
    this.scene.add(this.character.root);

    const data = loadData();
    this.runCount = data.runs;
    this.audio.setEnabled(data.sound);
    setHapticsEnabled(data.vibration);

    this.hud = new Hud(root);
    this.hud.onPause = () => this.doPause();
    this.screens = new Screens(root, data.sound, data.vibration);
    this.screens.onStart = () => this.startRun();
    this.screens.onResume = () => this.requestResume();
    this.screens.onToggleSound = () => {
      const on = !loadData().sound;
      saveData({ sound: on });
      // While paused the context stays suspended — unlocking here would let
      // the ambience play over the frozen pause screen.
      if (!this.paused) {
        this.audio.unlock();
        this.audio.setEnabled(on);
        if (on) this.audio.click();
      } else {
        this.audio.setEnabled(on);
      }
      return on;
    };
    this.screens.onToggleVibration = () => {
      const on = !loadData().vibration;
      saveData({ vibration: on });
      setHapticsEnabled(on);
      if (on) vibrate(HAPTIC.tap);
      return on;
    };

    this.input = new Input(
      root,
      (a) => this.onAction(a),
      () => this.onTap()
    );

    if (options.debug) this.enableDebug();
    const sig = { signal: this.aborter.signal };
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyD' && e.ctrlKey && e.shiftKey) this.enableDebug();
      },
      sig
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.doPause();
      },
      sig
    );
    window.addEventListener('blur', () => this.doPause(), sig);
    window.addEventListener('resize', () => this.onResize(), sig);
    window.addEventListener(
      'orientationchange',
      () => {
        window.setTimeout(() => this.onResize(), 250);
      },
      sig
    );

    this.screens.showStart(data.high);
    this.loop = new Loop((dt) => this.frame(dt));
    this.loop.start();

    // Lightweight introspection for automated validation and debugging.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = this;
    (window as unknown as { __osloRush?: unknown }).__osloRush = {
      get phase() {
        return g.phase;
      },
      get paused() {
        return g.paused;
      },
      get lane() {
        return g.controller.targetLane;
      },
      get y() {
        return g.controller.y;
      },
      get airT() {
        return g.controller.airT;
      },
      get slideT() {
        return g.controller.slideT;
      },
      get timescale() {
        return g.timescale;
      },
      get sliding() {
        return g.controller.sliding;
      },
      get score() {
        return g.score;
      },
      get distance() {
        return g.traveled;
      },
      get speed() {
        return g.speed;
      },
      get seed() {
        return g.lastSeed;
      },
      get obstacleIds() {
        return g.spawner ? [...new Set(g.spawner.obstacles.map((o) => o.defId))] : [];
      },
      get actions() {
        return [...g.actionLog];
      },
      setInvincible(on: boolean) {
        g.enableDebug();
        if (g.debugPanel) g.debugPanel.invincible = on;
      },
      forceSpawn(id: string) {
        if (g.spawner && g.phase === 'running') {
          const obs = g.spawner.forceSpawn(id, g.traveled);
          if (obs) g.obstacleMgr.spawn(obs);
        }
      },
    };
  }

  // -- lifecycle ------------------------------------------------------------

  private startRun(seed?: number): void {
    if (this.phase === 'running' || this.phase === 'crashing') {
      if (seed === undefined) return; // normal path: only from menu / game over
    }
    if (this.phase === 'gameover' && performance.now() - this.gameoverAt < 300 && seed === undefined) {
      return; // ignore the same tap burst that triggered game over UI
    }

    this.lastSeed = seed ?? this.options.seed ?? randomSeed();
    this.options.seed = null; // ?seed= applies to the first run only

    const data = saveData({ runs: loadData().runs + 1 });
    this.runCount = data.runs;
    const skipIntro = this.runCount > 2;
    this.spawner = new Spawner(this.lastSeed, skipIntro);

    this.obstacleMgr.clear();
    this.tokenMgr.clear();
    this.particles.clear();
    this.belled.clear();
    this.clearHitboxHelpers();
    this.env.reset(0);
    this.controller.reset();
    this.character.root.position.set(0, 0, 0);

    this.phase = 'running';
    this.paused = false;
    this.resumeTimer = 0;
    this.timescale = 1;
    this.time = 0;
    this.traveled = 0;
    this.speed = 0;
    this.startRamp = 0;
    this.tokensCollected = 0;
    this.score = 0;
    this.recordFlashed = false;
    this.revalidateTimer = 0;
    this.pickupCombo = 0;
    this.hintShown = { jump: false, slide: false };
    this.actedThisRun = { jump: false, slide: false };

    // Materialize the opening stretch.
    this.applySpawnBatch(this.spawner.update(0, 0, speedAt(0), this.controller.solverState));

    this.screens.hideAll();
    this.hud.reset();
    this.hud.show();
    this.cameraRig.startFollow();
    this.audio.unlock();
    this.audio.click();
    this.audio.startAmbience();

    if (this.runCount <= 2) {
      window.setTimeout(() => {
        if (this.phase === 'running' && !this.paused) this.hud.showHint('lanes', 2.4);
      }, 600);
    }
  }

  private crash(contactZ: number): void {
    this.phase = 'crashing';
    this.crashTimer = 0;
    this.audio.crash();
    this.audio.stopAmbience();
    vibrate(HAPTIC.crash);
    this.cameraRig.crashKick();
    this.particles.sparks(this.controller.x, 1.0, contactZ);
    this.hud.hideHint();
  }

  private finishGameOver(): void {
    this.phase = 'gameover';
    this.gameoverAt = performance.now();
    this.timescale = 1;
    // Include the crash skid so score and distance agree on screen.
    this.score = scoreFor(this.traveled, this.tokensCollected);
    const data = loadData();
    const isRecord = this.score > data.high && this.score > 0;
    // Longest distance is tracked independently of the score record.
    saveData({ bestDistance: Math.max(data.bestDistance, Math.floor(this.traveled)) });
    if (isRecord) {
      saveData({ high: this.score });
      this.audio.record();
      vibrate(HAPTIC.record);
    }
    this.hud.hide();
    this.screens.showGameOver({
      score: this.score,
      distance: Math.floor(this.traveled),
      tokens: this.tokensCollected,
      best: Math.max(data.high, this.score),
      isRecord,
    });
  }

  private doPause(): void {
    if (this.phase !== 'running') return;
    if (this.paused) {
      // Backgrounded during the resume countdown: cancel it and re-pause
      // properly (otherwise the resumed AudioContext keeps playing while the
      // tab is hidden and the countdown fires into a stale frame on return).
      if (this.resumeTimer > 0) {
        this.resumeTimer = 0;
        this.audio.suspend();
        this.screens.showPause();
      }
      return;
    }
    this.paused = true;
    this.resumeTimer = 0;
    this.audio.suspend();
    this.screens.showPause();
  }

  private requestResume(): void {
    if (!this.paused || this.resumeTimer > 0) return;
    this.resumeTimer = 0.7;
    this.screens.showCountdown();
    this.audio.resume();
    this.audio.countTick(false);
  }

  // -- input ----------------------------------------------------------------

  /** Recent inputs (debug introspection). */
  private actionLog: string[] = [];

  private onAction(a: GameAction): void {
    this.actionLog.push(`${a}@${(performance.now() / 1000).toFixed(2)}:${this.phase}${this.paused ? ':paused' : ''}`);
    if (this.actionLog.length > 24) this.actionLog.shift();
    if (this.phase !== 'running' || this.paused) return;
    this.controller.enqueue(a);
    if (a === 'jump') this.actedThisRun.jump = true;
    if (a === 'slide') this.actedThisRun.slide = true;
    if (a === 'left' || a === 'right') this.hud.hideHint();
  }

  private onTap(): void {
    if (this.paused) {
      this.requestResume();
    } else if (this.phase === 'menu') {
      this.startRun();
    } else if (this.phase === 'gameover') {
      this.startRun();
    }
  }

  // -- per-frame ------------------------------------------------------------

  private frame(dt: number): void {
    this.elapsed += dt;
    this.trackPerf(dt);
    this.hud.tick(dt);
    this.debugPanel?.tick(dt);

    if (this.paused) {
      if (this.resumeTimer > 0) {
        this.resumeTimer -= dt;
        if (this.resumeTimer <= 0) {
          this.paused = false;
          this.screens.hideAll();
          this.audio.countTick(true);
          this.loop.resetClock();
        }
      }
      return; // frozen frame stays on screen
    }

    const tsTarget = this.phase === 'crashing' ? 0.16 : 1;
    this.timescale += (tsTarget - this.timescale) * (1 - Math.exp(-9 * dt));
    const dts = dt * this.timescale;

    switch (this.phase) {
      case 'menu':
        this.updateMenu(dt);
        break;
      case 'running':
        this.updateRunning(dt, dts);
        break;
      case 'crashing':
        this.updateCrashing(dt, dts);
        break;
      case 'gameover':
        this.updateGameOver(dt);
        break;
    }

    this.renderer.render(this.scene, this.cameraRig.camera);
  }

  private updateMenu(dt: number): void {
    this.character.root.position.x = 0;
    this.character.update(dt, {
      mode: 'idle',
      runPhase: 0,
      speedNorm: 0,
      y: 0,
      grounded: true,
      airProgress: 0,
      sliding: false,
      slideProgress: 0,
      lean: 0,
      squash: 0,
      elapsed: this.elapsed,
    });
    this.cameraRig.update(dt, { playerX: 0, playerY: 0, speedNorm: 0, elapsed: this.elapsed });
    this.env.update(0);
  }

  private speedNorm(): number {
    return Math.min(1, Math.max(0, (this.speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)));
  }

  private updateRunning(dt: number, dts: number): void {
    const spawner = this.spawner!;

    // Speed & distance (with a short launch ramp).
    this.startRamp = Math.min(1, this.startRamp + dt / 1.1);
    const ramp = this.startRamp * this.startRamp * (3 - 2 * this.startRamp);
    this.time += dts;
    this.speed = speedAt(this.time) * (0.3 + 0.7 * ramp);
    this.traveled += this.speed * dts;
    spawner.advanceMovers(dts);

    // Player.
    const ev = this.controller.update(dts, this.speed);
    if (ev.jumped) {
      this.audio.jump();
      this.particles.dust(this.controller.x, 0);
      this.hud.hideHint();
    }
    if (ev.landed) {
      this.audio.land();
      vibrate(HAPTIC.land);
      this.particles.dust(this.controller.x, 0);
      this.cameraRig.onLand();
    }
    if (ev.startedSlide) {
      this.audio.slide();
      this.particles.dust(this.controller.x, 0.3);
      this.hud.hideHint();
    }
    if (ev.laneChanged) this.audio.laneWhoosh();

    // Spawning, pruning, fairness repair.
    this.applySpawnBatch(spawner.update(this.traveled, this.time, this.speed, this.controller.solverState));
    const pruned = spawner.prune(this.traveled);
    for (const uid of pruned.obstacles) {
      this.obstacleMgr.despawn(uid);
      this.belled.delete(uid);
      this.removeHitboxHelper(uid);
    }
    for (const uid of pruned.tokens) this.tokenMgr.despawn(uid);
    this.revalidateTimer += dts;
    if (this.revalidateTimer >= 0.5) {
      this.revalidateTimer = 0;
      const removed = spawner.revalidate(this.traveled, this.time, this.speed, this.controller.solverState);
      for (const uid of removed) {
        this.obstacleMgr.despawn(uid);
        this.removeHitboxHelper(uid);
      }
    }

    // World visuals.
    this.env.update(this.traveled);
    this.obstacleMgr.update(this.traveled, this.elapsed);
    this.tokenMgr.update(this.traveled, this.elapsed, dts);
    this.particles.update(dts, this.speed * dts);
    this.speedLines.update(dt, this.speed, this.speedNorm());

    // Tram bells.
    for (const obs of spawner.obstacles) {
      if (obs.defId !== 'tram' || this.belled.has(obs.uid)) continue;
      const zn = this.traveled - obs.dCur;
      if (zn > -34) {
        this.belled.add(obs.uid);
        if (obs.vRel > 0 || obs.variant % 3 === 0) this.audio.tramBell();
      }
    }

    // Pickups (tolerances derived from the active collectible's radius).
    const hb = this.controller.hitbox();
    const pickup = activeCollectible();
    const zTol = pickup.radius * 1.33;
    const xTol = pickup.radius + 0.05;
    const yTol = pickup.radius * 0.6;
    for (const t of spawner.tokens) {
      if (t.collected) continue;
      const z = this.traveled - t.d;
      if (z < -zTol || z > zTol) continue;
      if (Math.abs(hb.x - laneX(t.lane)) > xTol) continue;
      if (t.y < hb.y0 - yTol || t.y > hb.y1 + yTol) continue;
      t.collected = true;
      this.tokenMgr.collect(t.uid);
      this.tokensCollected++;
      if (this.time - this.lastPickupAt > 1.2) this.pickupCombo = 0;
      this.lastPickupAt = this.time;
      this.audio.pickup(this.pickupCombo++);
      this.particles.pop(laneX(t.lane), t.y, z);
      this.hud.tokenPop();
    }

    // Collisions. Swept in z while grounded: at top speed on a slow device a
    // single clamped frame can cover more than a thin obstacle's window, so a
    // point sample could tunnel straight through a barrier. While airborne we
    // keep the point test (pro-player: landing edge cases stay forgiving).
    if (!this.debugPanel?.invincible) {
      const grounded = this.controller.grounded;
      for (const obs of spawner.obstacles) {
        const zn = this.traveled - obs.dCur; // near face; negative while ahead
        if (zn < -3 || zn - obs.len > 3) continue;
        const frameSweep = grounded ? (this.speed + obs.vRel) * dts : 0;
        const zPrev = zn - frameSweep;
        // Segment [zPrev, zn] vs window: previous end must not be fully past,
        // current end must have reached it.
        const zOverlap = zPrev - obs.len + 0.1 < hb.halfD && zn - 0.1 > -hb.halfD;
        if (!zOverlap) continue;
        if (Math.abs(hb.x - obs.cx) >= hb.halfW + obs.hx - 0.14) continue;
        if (!(hb.y1 > obs.y0 + 0.06 && hb.y0 < obs.y1 - 0.06)) continue;
        this.crash(zn);
        break;
      }
    }

    // Contextual hints while learning.
    this.updateHints();

    // Score & record flash.
    this.score = scoreFor(this.traveled, this.tokensCollected);
    this.hud.set(this.score, Math.floor(this.traveled), this.tokensCollected);
    const best = loadData().high;
    if (!this.recordFlashed && best > 0 && this.score > best) {
      this.recordFlashed = true;
      this.hud.flashRecord();
      this.audio.record();
      vibrate(HAPTIC.record);
    }

    // Character & camera.
    this.character.root.position.x = this.controller.x;
    this.character.update(dts, {
      mode: 'run',
      runPhase: this.controller.runPhase,
      speedNorm: this.speedNorm(),
      y: this.controller.y,
      grounded: this.controller.grounded,
      airProgress: this.controller.airProgress,
      sliding: this.controller.sliding,
      slideProgress: this.controller.slideProgress,
      lean: this.controller.lean,
      squash: this.controller.squash,
      elapsed: this.elapsed,
    });
    this.cameraRig.update(dt, {
      playerX: this.controller.x,
      playerY: this.controller.y,
      speedNorm: this.speedNorm(),
      elapsed: this.elapsed,
    });

    this.updateHitboxHelpers();
  }

  private updateCrashing(dt: number, dts: number): void {
    this.crashTimer += dt;
    this.speed *= Math.exp(-5 * dts);
    this.traveled += this.speed * dts;
    this.env.update(this.traveled);
    this.obstacleMgr.update(this.traveled, this.elapsed);
    this.tokenMgr.update(this.traveled, this.elapsed, dts);
    this.particles.update(dts, this.speed * dts);
    this.speedLines.update(dt, this.speed, 0);
    this.character.update(dt, {
      mode: 'crash',
      runPhase: this.controller.runPhase,
      speedNorm: 0,
      y: this.controller.y,
      grounded: true,
      airProgress: 0,
      sliding: false,
      slideProgress: 0,
      lean: this.controller.lean,
      squash: 0,
      elapsed: this.elapsed,
    });
    this.cameraRig.update(dt, {
      playerX: this.controller.x,
      playerY: this.controller.y,
      speedNorm: 0,
      elapsed: this.elapsed,
    });
    if (this.crashTimer >= 0.8) this.finishGameOver();
  }

  private updateGameOver(dt: number): void {
    this.character.update(dt, {
      mode: 'crash',
      runPhase: this.controller.runPhase,
      speedNorm: 0,
      y: 0,
      grounded: true,
      airProgress: 0,
      sliding: false,
      slideProgress: 0,
      lean: 0,
      squash: 0,
      elapsed: this.elapsed,
    });
    this.cameraRig.update(dt, { playerX: this.controller.x, playerY: 0, speedNorm: 0, elapsed: this.elapsed });
    this.particles.update(dt, 0);
  }

  private updateHints(): void {
    if (this.time > 60) return;
    const showAll = this.runCount <= 2;
    for (const obs of this.spawner!.obstacles) {
      const def = OBSTACLES[obs.defId];
      const tta = (obs.dCur - this.traveled) / Math.max(1, this.speed);
      if (tta < 0.55 || tta > 1.4) continue;
      if (!obs.lanes.includes(this.controller.targetLane)) continue;
      if (def.kind === 'jump' && !this.hintShown.jump && (showAll || !this.actedThisRun.jump)) {
        this.hintShown.jump = true;
        this.hud.showHint('jump', 1.6);
      } else if (def.kind === 'slide' && !this.hintShown.slide && (showAll || !this.actedThisRun.slide)) {
        this.hintShown.slide = true;
        this.hud.showHint('slide', 1.6);
      }
    }
  }

  private applySpawnBatch(batch: ReturnType<Spawner['update']>): void {
    for (const o of batch.obstacles) this.obstacleMgr.spawn(o);
    for (const t of batch.tokens) this.tokenMgr.spawn(t);
  }

  // -- perf -----------------------------------------------------------------

  private trackPerf(dt: number): void {
    this.frameEma = this.frameEma * 0.95 + dt * 1000 * 0.05;
    this.perfTimer += dt;
    if (this.perfTimer < 2) return;
    this.perfTimer = 0;
    if (this.frameEma > 21 && this.dprCurrent > 1.15) {
      this.dprCurrent = Math.max(1.1, this.dprCurrent * 0.85);
      this.renderer.setPixelRatio(this.dprCurrent);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    } else if (this.frameEma < 13 && this.dprCurrent < this.dprCap) {
      this.dprCurrent = Math.min(this.dprCap, this.dprCurrent * 1.08);
      this.renderer.setPixelRatio(this.dprCurrent);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  private onResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.cameraRig.resize(window.innerWidth / window.innerHeight);
  }

  // -- debug ----------------------------------------------------------------

  private enableDebug(): void {
    if (this.debugPanel) return;
    this.debugPanel = new DebugPanel(this.root, {
      getStats: () => ({
        fps: 1000 / Math.max(1, this.frameEma),
        speed: this.speed,
        dist: this.traveled,
        seed: this.lastSeed,
        repairs: this.spawner?.lastRepairCount ?? 0,
      }),
      forceSpawn: (defId) => {
        if (!this.spawner || this.phase !== 'running') return;
        const obs = this.spawner.forceSpawn(defId, this.traveled);
        if (obs) this.obstacleMgr.spawn(obs);
      },
      restartSameSeed: () => this.startRun(this.lastSeed),
      restartWithSeed: (seed) => this.startRun(seed),
      resetHighScore: () => {
        resetHighScore();
        if (this.phase === 'menu') this.screens.showStart(0);
      },
    });
  }

  private updateHitboxHelpers(): void {
    const show = this.debugPanel?.showHitboxes ?? false;
    if (!show) {
      if (this.hitboxHelpers.size) this.clearHitboxHelpers();
      return;
    }
    const spawner = this.spawner!;
    const seen = new Set<number | 'player'>();
    for (const obs of spawner.obstacles) {
      seen.add(obs.uid);
      let helper = this.hitboxHelpers.get(obs.uid);
      if (!helper) {
        helper = new THREE.Box3Helper(new THREE.Box3(), 0xff4455);
        this.hitboxHelpers.set(obs.uid, helper);
        this.scene.add(helper);
      }
      const zn = this.traveled - obs.dCur;
      helper.box.min.set(obs.cx - obs.hx, obs.y0, zn - obs.len);
      helper.box.max.set(obs.cx + obs.hx, obs.y1, zn);
    }
    seen.add('player');
    let ph = this.hitboxHelpers.get('player');
    if (!ph) {
      ph = new THREE.Box3Helper(new THREE.Box3(), 0x44ff88);
      this.hitboxHelpers.set('player', ph);
      this.scene.add(ph);
    }
    const hb = this.controller.hitbox();
    ph.box.min.set(hb.x - hb.halfW, hb.y0, -hb.halfD);
    ph.box.max.set(hb.x + hb.halfW, hb.y1, hb.halfD);
    for (const [key, helper] of this.hitboxHelpers) {
      if (!seen.has(key)) {
        this.scene.remove(helper);
        this.hitboxHelpers.delete(key);
      }
    }
  }

  private disposeHelper(h: THREE.Box3Helper): void {
    this.scene.remove(h);
    h.geometry.dispose();
    (h.material as THREE.Material).dispose();
  }

  private removeHitboxHelper(uid: number): void {
    const h = this.hitboxHelpers.get(uid);
    if (h) {
      this.disposeHelper(h);
      this.hitboxHelpers.delete(uid);
    }
  }

  private clearHitboxHelpers(): void {
    for (const h of this.hitboxHelpers.values()) this.disposeHelper(h);
    this.hitboxHelpers.clear();
  }

  /** Tear down listeners, DOM and GPU resources (tests / hot reload). */
  dispose(): void {
    this.loop.stop();
    this.aborter.abort();
    this.input.dispose();
    this.clearHitboxHelpers();
    this.obstacleMgr.dispose();
    this.tokenMgr.dispose();
    this.particles.dispose();
    this.speedLines.dispose();
    this.env.dispose();
    this.character.dispose();
    this.backdrop.dispose();
    this.debugPanel?.dispose();
    this.audio.stopAmbience();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete (window as unknown as { __osloRush?: unknown }).__osloRush;
  }
}
