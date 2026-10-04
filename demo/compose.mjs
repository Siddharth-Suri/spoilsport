// Renders the final demo video: title → MCP calls → (agent clip) → two-window app demo → end card.
// Usage: node compose.mjs   (optional: put the agent screen recording at demo/clip.mov or demo/clip.mp4)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const FPS = 30;
const OUT = "out";
const FRAMES = path.join(OUT, "frames");
const SPEED = Number(process.env.SPEED ?? 1.1);
const END_LINKS = process.env.END_LINKS ?? "spoilsport.vercel.app";
const HOST = process.env.HOST ?? "spoilsport.vercel.app";
const MUSIC = process.env.MUSIC ?? (fs.existsSync("music.mp3") ? "music.mp3" : "");
const MUSIC_VOLUME = process.env.MUSIC_VOLUME ?? "0.6";
const CLIP_MAX = Number(process.env.CLIP_MAX ?? 16);

const app = JSON.parse(fs.readFileSync("raw/timeline.json", "utf8"));
app.speed = SPEED;

const mcpCalls = [
  { fn: "list_cometchat_bundles", arg: "()", res: "10 bundles" },
  { fn: "get_cometchat_implementation_bundle", arg: '"js-sdk-messaging-basics"', res: "init · login · send · listen" },
  { fn: "get_cometchat_implementation_bundle", arg: '"presence-and-typing"', res: "presence · typing" },
  { fn: "search_cometchat_docs", arg: '"create user with auth key"', res: "4 results" },
  { fn: "search_cometchat_docs", arg: '"create group join group"', res: "4 results" },
  { fn: "search_cometchat_docs", arg: '"message metadata"', res: "4 results" },
  { fn: "fetch_cometchat_doc_page", arg: '"/sdk/javascript/create-group"', res: "public rooms" },
  { fn: "fetch_cometchat_doc_page", arg: '"/sdk/javascript/user-management"', res: "createUser()" },
  { fn: "fetch_cometchat_doc_page", arg: '"/sdk/javascript/send-message"', res: "metadata + custom msgs" },
  { fn: "fetch_cometchat_doc_page", arg: '"/sdk/javascript/join-group"', res: "joinGroup()" },
];

// Optional agent clip → frames
let clip = null;
const clipSrc = ["clip.mov", "clip.mp4"].find((f) => fs.existsSync(f));
if (clipSrc) {
  const dir = "raw/clip";
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-i", clipSrc, "-t", String(CLIP_MAX), "-vf", `fps=${FPS},scale='min(2400,iw)':-2`, "-q:v", "3", `${dir}/%05d.jpg`]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", `${dir}/${files[0]}`]).toString().trim().split(",");
  clip = { fps: FPS, w: +probe[0], h: +probe[1], frames: files.map((f) => `${dir}/${f}`) };
  console.log("clip", clip.frames.length / FPS, "s", probe.join("x"));
}

const segments = [];
let cursor = 0;
const add = (kind, dur) => { segments.push({ kind, start: cursor, dur }); cursor += dur; };
add("title", 3.2);
add("mcp", 5.6);
if (clip) add("clip", clip.frames.length / FPS);
add("app", (app.end - app.start) / SPEED);
add("end", 4.2);
const total = cursor;
console.log("segments", segments.map((s) => `${s.kind}:${s.dur.toFixed(1)}`).join(" "), "total", total.toFixed(1), "s");
if (total >= 90) console.warn("WARNING: total ≥ 90s");

fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("file://" + path.resolve("compose.html"));
await page.evaluate(() => document.fonts.ready);
await page.evaluate((d) => window.init(d), { app, segments, mcpCalls, clip, endLinks: END_LINKS, host: HOST });

if (process.env.PREVIEW) {
  for (const t of process.env.PREVIEW.split(",").map(Number)) {
    await page.evaluate((g) => window.renderAt(g), t);
    await page.screenshot({ path: path.join(OUT, `preview-${t}.jpg`), type: "jpeg", quality: 90 });
  }
  await browser.close();
  process.exit(0);
}

const n = Math.round(total * FPS);
for (let i = 0; i < n; i++) {
  await page.evaluate((g) => window.renderAt(g), i / FPS);
  await page.screenshot({ path: path.join(FRAMES, `${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 94 });
  if (i % 150 === 0) console.log(`frame ${i}/${n}`);
}
await browser.close();

const out = path.join(OUT, "spoilsport-demo.mp4");
const video = ["-framerate", String(FPS), "-i", path.join(FRAMES, "%05d.jpg")];
const enc = ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
if (MUSIC) {
  // Loop the track if the video runs longer, fade it in/out, and cut at the video's end.
  const fadeOut = Math.max(0, total - 2.5).toFixed(2);
  execFileSync("ffmpeg", ["-y", "-v", "error", ...video, "-stream_loop", "-1", "-i", MUSIC,
    "-filter_complex", `[1:a]atrim=0:${total.toFixed(2)},afade=t=in:d=0.6,afade=t=out:st=${fadeOut}:d=2.5,volume=${MUSIC_VOLUME}[a]`,
    "-map", "0:v", "-map", "[a]", ...enc, "-c:a", "aac", "-b:a", "192k", "-shortest", out]);
} else {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...video, ...enc, out]);
}
console.log("wrote", out, total.toFixed(1), "s");
