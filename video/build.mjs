#!/usr/bin/env node
// Assemble the demo video: 5 recorded clips + narration, with an intro and an outro card.
//
//   video/raw/seg1.mp4 … seg5.mp4        your screen recordings (any size/fps)
//   video/narration/*.mp3                narration (python video/tts.py)
//   video/narration.json                 text + subtitles (en / zh)
//   video/bgm.mp3                        optional background music
//
//   node video/build.mjs              -> video/out/aevumpay-demo.mp4 (+ .srt, .zh.srt, timeline.json)
//   node video/build.mjs --selftest   -> synthetic clips, to check the pipeline without recordings
//
// Every segment is padded (last frame held) or trimmed so it lasts at least as long as its
// narration, so audio and picture cannot drift. Intro/outro are title cards generated here,
// so you only record the five screen segments.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SEGMENTS = 5;
const FPS = 30;
const W = 1920;
const H = 1080;
const TAIL = 0.6;

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const tools = join(ROOT, "tools");
  if (existsSync(tools)) {
    for (const dir of readdirSync(tools)) {
      const candidate = join(tools, dir, "bin", "ffmpeg.exe");
      if (existsSync(candidate)) return candidate;
    }
  }
  return "ffmpeg";
}
const FFMPEG = findFfmpeg();
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, (m) => (m.endsWith(".exe") ? "ffprobe.exe" : "ffprobe"));

const run = (args) => execFileSync(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
const probe = (file) =>
  Number(
    execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim(),
  );
const seconds = (n) => n.toFixed(3);

const selftest = process.argv.includes("--selftest");
const rawDir = join(ROOT, "video", selftest ? ".selftest/raw" : "raw");
const audioDir = join(ROOT, "video", selftest ? ".selftest/narration" : "narration");
const outDir = join(ROOT, "video", selftest ? ".selftest/out" : "out");
const tmpDir = join(ROOT, "video", selftest ? ".selftest/tmp" : ".tmp");
for (const dir of [outDir, tmpDir]) mkdirSync(dir, { recursive: true });

const narrationFile = join(ROOT, "video", "narration.json");
const narration = existsSync(narrationFile) ? JSON.parse(readFileSync(narrationFile, "utf8")) : { segments: [] };
const bgm = join(ROOT, "video", "bgm.mp3");
const FONT = "C\\:/Windows/Fonts/arialbd.ttf";

if (selftest) {
  console.log("selftest: synthetic clips + narration");
  for (const dir of [rawDir, audioDir]) mkdirSync(dir, { recursive: true });
  const lens = [5, 2, 4, 3, 6];
  for (let i = 1; i <= SEGMENTS; i += 1) {
    run(["-y", "-f", "lavfi", "-i", "color=c=0x0B1220:s=1280x720:d=3", "-vf",
      `drawtext=fontfile='${FONT}':text='SEG ${i}':fontcolor=white:fontsize=120:x=(w-text_w)/2:y=(h-text_h)/2`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", join(rawDir, `seg${i}.mp4`)]);
    run(["-y", "-f", "lavfi", "-i", `sine=frequency=${300 + i * 60}:duration=${lens[i - 1]}`, "-af", "volume=0.15",
      "-c:a", "libmp3lame", join(audioDir, `seg${i}.mp3`)]);
  }
}

const timeline = [];
let cursor = 0;
const parts = [];

// ── title / end cards ───────────────────────────────────────────────────────
function card({ name, lines, audio, out }) {
  if (!existsSync(audio)) return null;
  const dur = probe(audio) + TAIL;
  const draw = lines
    .map((text, i) => {
      const size = i === 0 ? 84 : i === 1 ? 40 : 32;
      const color = i === 0 ? "0x39D98A" : i === 1 ? "white" : "0x9AA4B2";
      const y = 380 + i * (i === 0 ? 120 : 70);
      return `drawtext=fontfile='${FONT}':text='${text}':fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=${y}`;
    })
    .join(",");
  run(["-y", "-f", "lavfi", "-i", `color=c=0x0B1220:s=${W}x${H}:d=${seconds(dur)}`, "-i", audio,
    "-filter_complex", `[0:v]${draw},format=yuv420p[v];[1:a]aresample=48000,apad=whole_dur=${seconds(dur)}[a]`,
    "-map", "[v]", "-map", "[a]", "-t", seconds(dur), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k", out]);
  parts.push(out);
  timeline.push({ name, kind: "card", finalSeconds: Number(seconds(dur)), startedAt: Number(seconds(cursor)), subtitle: null });
  cursor += dur;
  console.log(`${name}: card ${seconds(dur)}s`);
  return out;
}

card({
  name: "intro",
  lines: ["AevumPay", "Metered agent payments with on-chain receipts", "QDay Aevum testnet  ·  chain 44005"],
  audio: join(audioDir, "intro.mp3"),
  out: join(tmpDir, "intro.mp4"),
});

// ── segments ────────────────────────────────────────────────────────────────
for (let i = 1; i <= SEGMENTS; i += 1) {
  const clip = join(rawDir, `seg${i}.mp4`);
  if (!existsSync(clip)) throw new Error(`missing ${clip} — record segment ${i} first (docs/VIDEO.md)`);
  const clipDur = probe(clip);
  const narr = join(audioDir, `seg${i}.mp3`);
  const hasNarr = existsSync(narr);
  const narrDur = hasNarr ? probe(narr) : 0;
  const target = Math.max(clipDur, narrDur + TAIL);
  const out = join(tmpDir, `seg${i}.mp4`);

  const video = [
    `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
    `fps=${FPS}`,
    "format=yuv420p",
    `tpad=stop_mode=clone:stop_duration=${seconds(Math.max(target - clipDur, 0))}`,
  ].join(",");
  const audio = hasNarr
    ? `[1:a]aresample=48000,apad=whole_dur=${seconds(target)}[a]`
    : `anullsrc=r=48000:cl=stereo,atrim=0:${seconds(target)}[a]`;
  const args = ["-y", "-i", clip];
  if (hasNarr) args.push("-i", narr);
  args.push("-filter_complex", `[0:v]${video}[v];${audio}`, "-map", "[v]", "-map", "[a]", "-t", seconds(target),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", out);
  run(args);

  parts.push(out);
  timeline.push({
    name: `seg${i}`,
    kind: "screen",
    clipSeconds: Number(seconds(clipDur)),
    narrationSeconds: Number(seconds(narrDur)),
    finalSeconds: Number(seconds(target)),
    startedAt: Number(seconds(cursor)),
    subtitle: narration.segments?.[i - 1] ?? null,
  });
  cursor += target;
  console.log(`seg${i}: clip ${seconds(clipDur)}s + narration ${seconds(narrDur)}s -> ${seconds(target)}s`);
}

card({
  name: "outro",
  lines: ["github.com/Chichuzxy/aevum-pay", "chichuzxy.github.io/aevum-pay", "contract 0x5378f4bb7996d237edc21a48e426505254b00149"],
  audio: join(audioDir, "outro.mp3"),
  out: join(tmpDir, "outro.mp4"),
});

// ── concat ──────────────────────────────────────────────────────────────────
const listFile = join(tmpDir, "list.txt");
writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n") + "\n");
const silent = join(tmpDir, "joined.mp4");
run(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent]);

let bedded = silent;
if (existsSync(bgm)) {
  bedded = join(tmpDir, "bedded.mp4");
  run(["-y", "-i", silent, "-stream_loop", "-1", "-i", bgm, "-filter_complex",
    "[1:a]volume=0.12[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]",
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", bedded]);
  console.log("bgm mixed at 12%");
}

// ── subtitles ───────────────────────────────────────────────────────────────
const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
};
const wrap = (text, width) => {
  const chars = [...text];
  const lines = [];
  for (let i = 0; i < chars.length; i += width) lines.push(chars.slice(i, i + width).join(""));
  return lines.join("\n");
};
function srtFor(key, width) {
  return timeline
    .filter((t) => t.subtitle?.[key])
    .map((t, index) => `${index + 1}\n${stamp(t.startedAt + 0.2)} --> ${stamp(t.startedAt + t.finalSeconds - 0.2)}\n${wrap(t.subtitle[key], width)}\n`)
    .join("\n");
}
// intro/outro subtitles come from narration.json's own blocks
const introBlock = narration.intro;
const outroBlock = narration.outro;
const attach = (name, block) => {
  const row = timeline.find((t) => t.name === name);
  if (row && block) row.subtitle = block;
};
attach("intro", introBlock);
attach("outro", outroBlock);

const baseFile = join(outDir, process.env.OUT_NAME ?? "aevumpay-demo.mp4");
run(["-y", "-i", bedded, "-c", "copy", baseFile]);
let finalFile = baseFile;
const burn = process.env.BURN_SRT;
if (burn && existsSync(burn)) {
  finalFile = join(outDir, process.env.OUT_BURNED ?? "aevumpay-demo-subs.mp4");
  const escaped = burn.replace(/\\/g, "/").replace(/:/g, "\\:");
  run(["-y", "-i", baseFile, "-vf",
    `subtitles='${escaped}':force_style='Fontname=Arial,Fontsize=19,Outline=0.7,Shadow=0,MarginV=46',`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", finalFile]);
  console.log(`burned subtitles -> ${finalFile}`);
}
const enSrt = srtFor("en", 62);
const zhSrt = srtFor("zh", 18);
if (enSrt) writeFileSync(join(outDir, "aevumpay-demo.srt"), enSrt);
if (zhSrt) writeFileSync(join(outDir, "aevumpay-demo.zh.srt"), zhSrt);
writeFileSync(join(outDir, "timeline.json"), JSON.stringify({ builtAt: new Date().toISOString(), totalSeconds: Number(seconds(cursor)), timeline }, null, 2) + "\n");

// ── verify ──────────────────────────────────────────────────────────────────
const streams = execFileSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "csv=p=0", finalFile], { encoding: "utf8" })
  .trim()
  .split("\n")
  .map((row) => row.split(","));
if (!streams.some((f) => f.includes("video")) || !streams.some((f) => f.includes("audio"))) {
  throw new Error(`output is missing a stream: ${JSON.stringify(streams)}`);
}
const total = probe(finalFile);
console.log("\n== output ==");
console.log(`video      ${finalFile}`);
console.log(`duration   ${Math.floor(total / 60)}m${String(Math.round(total % 60)).padStart(2, "0")}s`);
console.log(`subtitles  ${enSrt ? "en + zh" : "(none)"}`);
for (const t of timeline) console.log(`  ${String(t.startedAt).padStart(6)}s  ${t.name.padEnd(6)} ${String(t.finalSeconds).padStart(6)}s`);
if (selftest) console.log("\nselftest OK — cards, padding, subtitles and concat all work.");
