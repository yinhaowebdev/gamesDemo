const KEY = "xxl-muted";

export type Cue = "click" | "clear" | "triple" | "shoot" | "seat" | "win" | "lose";
export type ThemeName = "menu" | "match3" | "link" | "zuma";

interface Theme {
  tune: number[];
  wave: OscillatorType;
  gap: number;
  music: number;
}

const THEMES: Record<ThemeName, Theme> = {
  menu: {
    tune: [523.25, 659.25, 783.99, 659.25, 587.33, 523.25, 392, 440],
    wave: "triangle",
    gap: 320,
    music: 0.03,
  },
  match3: {
    tune: [659.25, 783.99, 987.77, 880, 783.99, 659.25, 587.33, 698.46],
    wave: "sine",
    gap: 260,
    music: 0.028,
  },
  link: {
    tune: [392, 493.88, 587.33, 493.88, 440, 392, 329.63, 349.23],
    wave: "triangle",
    gap: 280,
    music: 0.032,
  },
  zuma: {
    tune: [440, 554.37, 659.25, 493.88, 440, 369.99, 415.3, 329.63],
    wave: "square",
    gap: 240,
    music: 0.016,
  },
};

let ctx: AudioContext | null = null;
let muted = localStorage.getItem(KEY) === "1";
let armed = false;
let musicOn = false;
let musicTimer = 0;
let step = 0;
let theme: ThemeName = "menu";

export function isMuted(): boolean {
  return muted;
}

function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function current(): Theme {
  return THEMES[theme];
}

function voice(freq: number, duration: number, gain: number, delay: number, type: OscillatorType): void {
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

function tone(freq: number, duration: number, gain: number, delay: number, type: OscillatorType): void {
  voice(freq, duration, gain, delay, type);
  voice(freq * 2, duration * 0.7, gain * 0.28, delay, type === "square" ? "triangle" : type);
}

function stopMusic(): void {
  musicOn = false;
  window.clearTimeout(musicTimer);
}

function startMusic(): void {
  if (musicOn || muted || document.hidden) return;
  musicOn = true;
  const tick = (): void => {
    if (!musicOn || muted || document.hidden) return;
    const sound = current();
    const note = sound.tune[step % sound.tune.length] ?? 523;
    tone(note, 0.18, sound.music, 0, sound.wave);
    step += 1;
    musicTimer = window.setTimeout(tick, sound.gap);
  };
  tick();
}

function suspendPlayback(): void {
  stopMusic();
  if (ctx && ctx.state === "running") void ctx.suspend();
}

function resumePlayback(): void {
  if (!armed || muted || document.hidden) return;
  const context = audio();
  if (context.state === "suspended") {
    void context.resume().then(() => startMusic());
    return;
  }
  startMusic();
}

export function setTheme(next: ThemeName): void {
  if (theme === next) return;
  theme = next;
  step = 0;
  if (!musicOn) return;
  stopMusic();
  startMusic();
}

export function unlock(): void {
  if (document.hidden) return;
  armed = true;
  const context = audio();
  if (context.state === "suspended") void context.resume();
  startMusic();
}

export function setMuted(next: boolean): void {
  muted = next;
  localStorage.setItem(KEY, next ? "1" : "0");
  if (muted) stopMusic();
  else resumePlayback();
}

export function play(cue: Cue): void {
  if (muted || document.hidden) return;
  const context = audio();
  if (context.state === "suspended") void context.resume();
  const wave = current().wave;
  if (cue === "click") tone(880, 0.06, 0.08, 0, wave);
  else if (cue === "shoot") tone(520, 0.09, 0.1, 0, wave);
  else if (cue === "seat") tone(640, 0.08, 0.09, 0, wave);
  else if (cue === "clear") {
    tone(660, 0.1, 0.12, 0, wave);
    tone(880, 0.14, 0.12, 0.08, wave);
  } else if (cue === "triple") {
    tone(523, 0.08, 0.11, 0, wave);
    tone(659, 0.08, 0.11, 0.07, wave);
    tone(784, 0.12, 0.11, 0.14, wave);
  } else if (cue === "win") {
    tone(523, 0.12, 0.12, 0, wave);
    tone(659, 0.12, 0.12, 0.1, wave);
    tone(784, 0.18, 0.12, 0.2, wave);
  } else {
    tone(392, 0.16, 0.1, 0, wave);
    tone(262, 0.22, 0.1, 0.12, wave);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspendPlayback();
  else resumePlayback();
});
