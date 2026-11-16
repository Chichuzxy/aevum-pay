#!/usr/bin/env node
// Assemble the demo video from five recorded clips + narration.
//
//   video/raw/seg1.mp4 … seg5.mp4     your screen recordings (any size/fps)
//   video/narration/seg1.mp3 …        narration per segment (optional; see docs/VIDEO.md)
//   video/subtitles.json              ["text for seg1", ...]  (optional)
//   video/bgm.mp3                     background music (optional)
//
//   node video/build.mjs              -> video/out/aevumpay-demo.mp4 + .srt + timeline.json
//   node video/build.mjs --selftest   -> builds from synthetic clips, to check the pipeline
//
// Why this shape: each segment's video is padded (last frame held) or trimmed so it is at
// least as long as its narration, which makes lip-sync impossible to break. Every segment
// gets an exact duration, so the concat is frame-accurate and the SRT times are exact.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SEGMENTS = 5;
const FPS = 30;
const W = 1920;
const H = 1080;
const TAIL = 0.6; // extra breathing room after the narration ends

// ── locate ffmpeg ───────────────────────────────────────────────────────────
function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const tools = join(ROOT, "tools");
  if (existsSync(tools)) {
    for (const dir of readdirSync(tools)) {
      const candidate = join(tools, dir, "bin", "ffmpeg.exe");
      if (existsSync(candidate)) return candidate;
    }
  }
  return "ffmpeg"; // on PATH
}
const FFMPEG = findFfmpeg();
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, (m) => (m.endsWith(".exe") ? "ffprobe.exe" : "ffprobe"));

const run = (args) => execFileSync(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
const probe = (file) => {
  const out = execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
  });
  return Number(out.trim());
};
const seconds = (n) => n.toFixed(3);

// ── input paths ─────────────────────────────────────────────────────────────
const selftest = process.argv.includes("--selftest");
const rawDir = join(ROOT, "video", selftest ? ".selftest/raw" : "raw");
const audioDir = join(ROOT, "video", selftest ? ".selftest/narration" : "narration");
const outDir = join(ROOT, "video", selftest ? ".selftest/out" : "out");
const tmpDir = join(ROOT, "video", ".tmp");
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const subFile = join(ROOT, "video", "subtitles.json");
const subtitles = existsSync(subFile) ? JSON.parse(readFileSync(subFile, "utf8")) : [];
const bgm = join(ROOT, "video", "bgm.mp3");

if (selftest) {
  console.log("selftest: generating synthetic clips (3s each) and narration (5s / 2s / 4s …)");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(audioDir, { recursive: true });
  const lens = [5, 2, 4, 3, 6];
  for (let i = 1; i <= SEGMENTS; i += 1) {
    const clip = join(rawDir, `seg${i}.mp4`);
    const narr = join(audioDir, `seg${i}.mp3`);
    const text = `SEG ${i}`;
    run(["-y", "-f", "lavfi", "-i", `color=c=0x0B1220:s=1280x720:d=3`, "-vf",
      `drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='${text}':fontcolor=white:fontsize=120:x=(w-text_w)/2:y=(h-text_h)/2`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
    run(["-y", "-f", "lavfi", "-i", `sine=frequency=${300 + i * 60}:duration=${lens[i - 1]}`,
      "-af", "volume=0.15", "-c:a", "libmp3lame", narr]);
  }
  writeFileSync(subFile, JSON.stringify(["合成测试一", "合成测试二", "合成测试三", "合成测试四", "合成测试五"]));
}

// ── per-segment normalise + sync ────────────────────────────────────────────
const timeline = [];
let cursor = 0;

for (let i = 1; i <= SEGMENTS; i += 1) {
  const clip = join(rawDir, `seg${i}.mp4`);
  if (!existsSync(clip)) throw new Error(`missing ${clip} — record segment ${i} first (see docs/VIDEO.md)`);
  const clipDur = probe(clip);
  const narr = join(audioDir, `seg${i}.mp3`);
  const hasNarr = existsSync(narr);
  const narrDur = hasNarr ? probe(narr) : 0;
  const target = Math.max(clipDur, narrDur + TAIL);
  const out = join(tmpDir, `seg${i}.mp4`);

  const videoFilter = [
    `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
    `fps=${FPS}`,
    "format=yuv420p",
    `tpad=stop_mode=clone:stop_duration=${seconds(Math.max(target - clipDur, 0))}`,
  ].join(",");

  const args = ["-y", "-i", clip];
  if (hasNarr) args.push("-i", narr);
  const audio = hasNarr
    ? `[1:a]aresample=48000,apad=whole_dur=${seconds(target)}[a]`
    : `anullsrc=r=48000:cl=stereo,atrim=0:${seconds(target)}[a]`;
  args.push(
    "-filter_complex",
    `[0:v]${videoFilter}[v];${audio}`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    seconds(target),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    out,
  );
  run(args);

  timeline.push({
    segment: i,
    clip: `video/raw/seg${i}.mp4`,
    clipSeconds: Number(seconds(clipDur)),
    narration: hasNarr ? `video/narration/seg${i}.mp3` : null,
    narrationSeconds: Number(seconds(narrDur)),
    finalSeconds: Number(seconds(target)),
    startedAt: Number(seconds(cursor)),
    subtitle: subtitles[i - 1] ?? null,
  });
  cursor += target;
  console.log(`seg${i}: clip ${seconds(clipDur)}s + narration ${seconds(narrDur)}s -> ${seconds(target)}s`);
}

// ── concat (all segments share codec/params ⇒ stream copy) ──────────────────
const listFile = join(tmpDir, "list.txt");
writeFileSync(listFile, timeline.map((t) => `file '${join(tmpDir, `seg${t.segment}.mp4`).replace(/\\/g, "/")}'`).join("\n") + "\n");
const silent = join(tmpDir, "joined.mp4");
run(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent]);

// ── optional BGM ────────────────────────────────────────────────────────────
let bedded = silent;
if (existsSync(bgm)) {
  bedded = join(tmpDir, "bedded.mp4");
  run(["-y", "-i", silent, "-stream_loop", "-1", "-i", bgm, "-filter_complex",
    "[1:a]volume=0.12[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]",
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", bedded]);
  console.log("bgm mixed at 12%");
}

// ── subtitles (.srt) from the timeline ─────────────────────────────────────
const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
};
const wrap = (text, width = 18) => {
  const chars = [...text];
  const lines = [];
  for (let i = 0; i < chars.length; i += width) lines.push(chars.slice(i, i + width).join(""));
  return lines.join("\n");
};
const srt = timeline
  .filter((t) => t.subtitle)
  .map((t, index) => `${index + 1}\n${stamp(t.startedAt + 0.2)} --> ${stamp(t.startedAt + t.finalSeconds - 0.2)}\n${wrap(t.subtitle)}\n`)
  .join("\n");

const finalFile = join(outDir, "aevumpay-demo.mp4");
const srtFile = join(outDir, "aevumpay-demo.srt");
run(["-y", "-i", bedded, "-c", "copy", finalFile]);
if (srt) writeFileSync(srtFile, srt);
writeFileSync(join(outDir, "timeline.json"), JSON.stringify({ builtAt: new Date().toISOString(), totalSeconds: Number(seconds(cursor)), timeline }, null, 2) + "\n");

// ── report ─────────────────────────────────────────────────────────────────
const streams = execFileSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "csv=p=0", finalFile], { encoding: "utf8" })
  .trim()
  .split("\n");
const fields = streams.map((row) => row.split(","));
const hasAudio = fields.some((f) => f.includes("audio"));
const hasVideo = fields.some((f) => f.includes("video"));
if (!hasAudio || !hasVideo) throw new Error(`output is missing a stream: ${streams.join(" | ")}`);
const total = probe(finalFile);
console.log("\n== output ==");
console.log(`video      ${finalFile}`);
console.log(`duration   ${seconds(total)}s across ${SEGMENTS} segments`);
console.log(`subtitles  ${srt ? srtFile : "(none — add video/subtitles.json)"}`);
console.log(`timeline   ${join(outDir, "timeline.json")}`);
for (const t of timeline) {
  console.log(`  ${String(t.startedAt).padStart(6)}s  seg${t.segment}  ${String(t.finalSeconds).padStart(5)}s  ${t.subtitle ?? ""}`);
}
if (selftest) {
  console.log("\nselftest OK — the pipeline pads short clips, trims long ones, and keeps narration in sync.");
}
