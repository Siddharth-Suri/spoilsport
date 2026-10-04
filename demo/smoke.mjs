import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "out";
const browser = await chromium.launch();
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("console", m.text()));
  return page;
};
const a = await mk();
const b = await mk();

await a.goto(BASE);
await a.fill("#name", "Maya");
await a.click("text=Continue");
await a.fill('input[placeholder^="Show title"]', "Severance S2");
await a.fill('input[type=number] >> nth=0', "10");
await a.click("text=Create room");
await a.waitForSelector(".room");
const url = a.url();
console.log("room url", url);

await b.goto(url);
await b.fill("#name", "Dev");
await b.click("text=Continue");
await b.waitForSelector(".room");

// Maya jumps to E4 · 30m and posts
await a.click("text=/Finished E1/");
await a.click("text=/Finished E2/");
await a.click("text=/Finished E3/");
for (let i = 0; i < 6; i++) await a.click("text=+5m");
await a.fill(".composer input", "I can't believe who was in the elevator!!");
await a.press(".composer input", "Enter");
await b.waitForTimeout(2500);
await b.screenshot({ path: `${OUT}/b-locked.png` });
console.log("locked count:", await b.locator(".bubble.locked").count());

// Dev catches up
for (let i = 0; i < 4; i++) await b.click("text=/Finished E/");
await b.waitForTimeout(800);
await b.screenshot({ path: `${OUT}/b-unlocked.png` });
console.log("locked after:", await b.locator(".bubble.locked").count());
await a.screenshot({ path: `${OUT}/a.png` });
await browser.close();
