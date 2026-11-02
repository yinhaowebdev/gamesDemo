import { isMuted, play, setMuted, setTheme, unlock } from "./audio/bus.ts";
import { startLink, stopLink } from "./link/play.ts";
import { startMatch3 } from "./match3/session.ts";
import { startZuma, stopZuma } from "./zuma/play.ts";

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`缺少 ${selector}`);
  return el;
}

const mute = must<HTMLButtonElement>("#mute");

function renderMute(): void {
  mute.textContent = isMuted() ? "声音" : "静音";
}

renderMute();
window.addEventListener("pointerdown", () => unlock());
mute.addEventListener("click", () => {
  setMuted(!isMuted());
  renderMute();
});

const menu = must<HTMLElement>("#menu");
const app = must<HTMLElement>("#app");
const link = must<HTMLElement>("#link");
const zuma = must<HTMLElement>("#zuma");

function showMenu(): void {
  stopLink();
  stopZuma();
  app.hidden = true;
  link.hidden = true;
  zuma.hidden = true;
  menu.hidden = false;
  setTheme("menu");
}

for (const id of ["#pick-match3", "#pick-link", "#pick-zuma"]) {
  must<HTMLButtonElement>(id).addEventListener("click", () => play("click"));
}

must<HTMLButtonElement>("#pick-match3").addEventListener("click", () => {
  stopLink();
  stopZuma();
  menu.hidden = true;
  link.hidden = true;
  zuma.hidden = true;
  app.hidden = false;
  setTheme("match3");
  startMatch3(showMenu);
});

must<HTMLButtonElement>("#pick-link").addEventListener("click", () => {
  stopZuma();
  menu.hidden = true;
  app.hidden = true;
  zuma.hidden = true;
  link.hidden = false;
  setTheme("link");
  startLink(showMenu);
});

must<HTMLButtonElement>("#pick-zuma").addEventListener("click", () => {
  stopLink();
  menu.hidden = true;
  app.hidden = true;
  link.hidden = true;
  zuma.hidden = false;
  setTheme("zuma");
  startZuma(showMenu);
});
