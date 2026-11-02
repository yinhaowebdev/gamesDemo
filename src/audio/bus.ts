const KEY = "xxl-muted";

export type Cue = "click" | "clear" | "triple" | "shoot" | "seat" | "win" | "lose";

let ctx: AudioContext | null = null;
let muted = localStorage.getItem(KEY) === "1";
let musicOn = false;
let musicTimer = 0;
let step = 0;

const TUNE = [523.25, 659.25, 783.99, 659.25, 587.33, 523.25, 392, 440];

export function isMuted(): boolean {
  return muted;
}

function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function tone(freq: number, duration: number, gain: number, delay: number, type: OscillatorType): void {
  const context = audio();
  const start = context.currentTime + delay;
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp);
  amp.connect(context.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function stopMusic(): void {
  musicOn = false;
  window.clearTimeout(musicTimer);
}

function startMusic(): void {
  if (musicOn || muted) return;
  musicOn = true;
  const tick = (): void => {
    if (!musicOn || muted) return;
    tone(TUNE[step % TUNE.length] ?? 523, 0.18, 0.03, 0, "triangle");
    step += 1;
    musicTimer = window.setTimeout(tick, 320);
  };
  tick();
}

export function unlock(): void {
  const context = audio();
  if (context.state === "suspended") void context.resume();
  startMusic();
}

export function setMuted(next: boolean): void {
  muted = next;
  localStorage.setItem(KEY, next ? "1" : "0");
  if (muted) stopMusic();
  else {
    const context = audio();
    if (context.state === "suspended") void context.resume();
    startMusic();
  }
}

export function play(cue: Cue): void {
  if (muted) return;
  const context = audio();
  if (context.state === "suspended") void context.resume();
  if (cue === "click") tone(880, 0.06, 0.08, 0, "sine");
  else if (cue === "shoot") tone(520, 0.09, 0.1, 0, "triangle");
  else if (cue === "seat") tone(640, 0.08, 0.09, 0, "sine");
  else if (cue === "clear") {
    tone(660, 0.1, 0.12, 0, "triangle");
    tone(880, 0.14, 0.12, 0.08, "triangle");
  } else if (cue === "triple") {
    tone(523, 0.08, 0.11, 0, "triangle");
    tone(659, 0.08, 0.11, 0.07, "triangle");
    tone(784, 0.12, 0.11, 0.14, "triangle");
  } else if (cue === "win") {
    tone(523, 0.12, 0.12, 0, "triangle");
    tone(659, 0.12, 0.12, 0.1, "triangle");
    tone(784, 0.18, 0.12, 0.2, "triangle");
  } else {
    tone(392, 0.16, 0.1, 0, "sine");
    tone(262, 0.22, 0.1, 0.12, "sine");
  }
}
