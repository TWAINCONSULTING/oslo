/**
 * All user-facing UI text. Norwegian (bokmål) by default.
 * Swap this file (or the STRINGS export) to localize the game.
 */
export const STRINGS = {
  title: 'OSLO RUSH',
  subtitle: 'Bybud i full fart',
  tapToStart: 'Trykk for å starte',
  swipeToMove: 'Sveip for å bevege deg',
  newRecord: 'Ny rekord!',
  retry: 'Prøv igjen',
  distance: 'Distanse',
  score: 'Poeng',
  collected: 'Samlet',
  sound: 'Lyd',
  vibration: 'Vibrasjon',
  best: 'Beste',
  pause: 'Pause',
  resume: 'Trykk for å fortsette',
  gameOver: 'Kollisjon!',
  hintJump: 'Sveip opp for å hoppe',
  hintSlide: 'Sveip ned for å skli',
  hintLanes: 'Sveip til siden for å bytte felt',
  ready: 'Klar…',
  meters: 'm',
} as const;

export type StringKey = keyof typeof STRINGS;
