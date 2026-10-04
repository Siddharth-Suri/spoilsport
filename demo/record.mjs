// Drives two real users through Spoilsport and captures high-res screencast frames of both windows,
// plus a timeline of captions/zoom targets for the compositor (compose.py).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:5173";
const RAW = "raw";
const VW = 900, VH = 720, DSF = 2;
// Window content origins on the 3840x2160 stage (must match compose.py).
export const WIN = { maya: { x: 100, y: 300 }, dev: { x: 1940, y: 300 } };

fs.rmSync(RAW, { recursive: true, force: true });
fs.mkdirSync(RAW, { recursive: true });

const CURSOR = `
(() => {
  const install = () => {
    if (document.getElementById("__cur")) return;
    const st = document.createElement("style");
    st.textContent = \`
      #__cur{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .2s;will-change:transform;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
      .__rip{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #ff8a5c;z-index:2147483646;pointer-events:none;animation:__rip .5s ease-out forwards}
      @keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}\`;
    document.head.appendChild(st);
    const c = document.createElement("div");
    c.id = "__cur";
    c.innerHTML = '<svg viewBox="0 0 32 32" width="30" height="30"><path d="M6 3 L6 25 L11.5 19.5 L15.5 28.5 L19.5 26.8 L15.6 18 L23.5 18 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.opacity = 1; c.style.transform = \`translate(\${e.clientX - 6}px,\${e.clientY - 3}px)\`; }, true);
    addEventListener("mousedown", (e) => { const r = document.createElement("div"); r.className = "__rip"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
  };
  if (document.body) install(); else addEventListener("DOMContentLoaded", install);
})();`;

const browser = await chromium.launch();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const events = [];
const caption = (text) => events.push({ t: now(), type: "caption", text });
const zoom = (rect, scale) => events.push({ t: now(), type: "zoom", rect, scale });

async function makeWindow(name) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(name, "pageerror", e.message));
  const dir = path.join(RAW, name);
  fs.mkdirSync(dir);
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ t: f.metadata.timestamp, file: path.basename(file) });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const start = () => cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VW * DSF, maxHeight: VH * DSF, everyNthFrame: 1 });
  const stop = () => cdp.send("Page.stopScreencast");
  return { name, page, frames, start, stop, pos: { x: VW / 2, y: VH + 40 } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

async function glide(w, x, y, ms = 700) {
  const { x: sx, y: sy } = w.pos;
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps);
    await w.page.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k);
    await sleep(ms / steps);
  }
  w.pos = { x, y };
}
async function center(w, sel) {
  const loc = w.page.locator(sel).first();
  await loc.waitFor();
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}
async function click(w, sel, ms = 650) {
  const c = await center(w, sel);
  await glide(w, c.x, c.y, ms);
  await sleep(120);
  await w.page.mouse.down();
  await sleep(70);
  await w.page.mouse.up();
  await sleep(150);
}
async function type(w, sel, text, delay = 55) {
  await click(w, sel);
  await w.page.keyboard.type(text, { delay });
}
/** Element rect in stage (3840x2160) pixels, padded. */
async function stageRect(w, sel, pad = 40) {
  const { box } = await center(w, sel);
  const o = WIN[w.name];
  return { x: o.x + (box.x - pad) * DSF, y: o.y + (box.y - pad) * DSF, w: (box.width + pad * 2) * DSF, h: (box.height + pad * 2) * DSF };
}
async function windowRect(w) {
  const o = WIN[w.name];
  return { x: o.x - 40, y: o.y - 110, w: VW * DSF + 80, h: VH * DSF + 150 };
}

const maya = await makeWindow("maya");
const dev = await makeWindow("dev");

// Pre-load pages before recording starts so the video opens on a ready UI.
await maya.page.goto(BASE);
await dev.page.goto(BASE);
await maya.page.waitForSelector("#name");
await dev.page.waitForSelector("#name");
await sleep(600);

const tStart = now();
await maya.start();
await dev.start();
await sleep(300);
caption("Maya starts a watch party for the show she's bingeing");
await type(maya, "#name", "Maya", 70);
await click(maya, "text=Continue");
await maya.page.waitForSelector('input[placeholder^="Show title"]');
await sleep(300);
await type(maya, 'input[placeholder^="Show title"]', "Severance · Season 2", 45);
await click(maya, 'input[type=number] >> nth=0', 400);
await maya.page.keyboard.press("ControlOrMeta+A");
await maya.page.keyboard.type("10", { delay: 80 });
await click(maya, "text=Create room");
await maya.page.waitForSelector(".room");
await sleep(500);
await click(maya, ".invite");
const url = maya.page.url();
await sleep(500);

caption("Dev opens the invite. He's only just started episode 1");
await dev.page.goto(url);
await dev.page.waitForSelector("#name");
await sleep(300);
await type(dev, "#name", "Dev", 80);
await click(dev, "text=Continue");
await dev.page.waitForSelector(".room");
await sleep(900);

caption("Maya drags to where she actually is: halfway through Episode 4");
zoom(await windowRect(maya), 1.0);
{
  const { box } = await center(maya, ".track");
  const y = box.y + box.height / 2;
  await glide(maya, box.x + 4, y, 600);
  await maya.page.mouse.down();
  const target = box.x + box.width * ((3 * 50 + 30) / 500);
  await glide(maya, target, y, 1300);
  await maya.page.mouse.up();
}
await sleep(1200);
zoom(null);

caption("Every message is stamped with the sender's spot in the show");
await type(maya, ".composer input", "WAIT. Who was in the elevator?! 😱", 50);
await maya.page.keyboard.press("Enter");
await sleep(900);

caption("Dev is behind, so it arrives blurred. No spoiler.");
zoom(await stageRect(dev, ".messages .msg:last-child", 60), 1.0);
await sleep(2600);
zoom(null);
await sleep(400);

caption("Behind-you messages come through clear. Ahead-of-you ones stay hidden.");
await type(dev, ".composer input", "Only on E1, no spoilers pls 🙏", 50);
await dev.page.keyboard.press("Enter");
await sleep(700);
caption("Even the typing indicator knows Maya is ahead");
zoom(await stageRect(dev, ".typing", 140), 1.0);
await type(maya, ".composer input", "My lips are sealed. Mostly. That finale tho 🔥", 75);
await sleep(500);
await maya.page.keyboard.press("Enter");
await sleep(1400);
zoom(null);
await sleep(300);

caption("A few episodes later, Dev catches up…");
{
  const { box } = await center(dev, ".track");
  const y = box.y + box.height / 2;
  await glide(dev, box.x + 4, y, 600);
  await dev.page.mouse.down();
  await glide(dev, box.x + box.width * ((4 * 50 + 2) / 500), y, 1600);
  await dev.page.mouse.up();
}
await sleep(250);
caption("…and the messages unlock live as he passes their spot");
zoom(await windowRect(dev), 1.0);
await sleep(2600);
zoom(null);

caption("Real-time chat, presence and typing, all via CometChat");
await type(dev, ".composer input", "THE ELEVATOR. I'm screaming 😭", 50);
await dev.page.keyboard.press("Enter");
await sleep(2400);

const tEnd = now();
await maya.stop();
await dev.stop();
await browser.close();

fs.writeFileSync(
  path.join(RAW, "timeline.json"),
  JSON.stringify(
    {
      start: tStart,
      end: tEnd,
      epochStart: t0 / 1000 + tStart,
      windows: WIN,
      events: events.map((e) => ({ ...e, t: e.t - tStart })),
      frames: { maya: maya.frames, dev: dev.frames },
    },
    null,
    1,
  ),
);
console.log("recorded", (tEnd - tStart).toFixed(1), "s;", maya.frames.length, dev.frames.length, "frames");
