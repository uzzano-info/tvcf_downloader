import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// yt-dlp 실행 경로 (PATH 또는 환경변수). 상시 서버에 yt-dlp 가 설치돼 있어야 한다.
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const FFMPEG_DIR = ffmpegStatic ? path.dirname(ffmpegStatic) : null;

function run(args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(YTDLP, args);
    let out = "", err = "";
    ps.stdout.on("data", (d) => (out += d.toString()));
    ps.stderr.on("data", (d) => (err += d.toString()));
    ps.on("error", (e) =>
      reject(new Error(`yt-dlp 실행에 실패했습니다 (${e.code || e.message}). 설치 여부를 확인하세요.`))
    );
    ps.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error("영상 정보를 가져오지 못했습니다. " + err.slice(-200)))
    );
  });
}

// 4K 까지만 노출하는 표준 해상도 버킷
const BUCKETS = [2160, 1440, 1080, 720, 480, 360];

// 제목 + 선택 가능한 화질 목록 조회 (다운로드 없이).
export async function ytInfo(pageUrl) {
  const args = ["-J", "--no-playlist", "--no-warnings", pageUrl];
  const json = JSON.parse(await run(args));
  const title = (json.title || json.id || "video").toString().trim().slice(0, 100) || "video";

  // 실제 제공되는 영상 높이 중 4K 이하만 추려 표준 버킷에 매핑
  const heights = new Set(
    (json.formats || [])
      .filter((f) => f.vcodec && f.vcodec !== "none" && f.height && f.height <= 2160)
      .map((f) => f.height)
  );
  const avail = BUCKETS.filter((b) => [...heights].some((h) => h >= b));
  // "원본"(최고화질) + 가능한 해상도들
  const qualities = ["원본", ...avail.map(String)];
  return { title, qualities };
}

const FFMPEG = ffmpegStatic || "ffmpeg";

// 선택 화질(height 또는 "원본")에 맞는 yt-dlp 포맷 선택자.
// H.264 를 우선하되, 해당 해상도에 H.264 가 없으면(주로 720p↑ VP9/AV1) 그 화질의 최선 코덱을 받는다.
// (받은 뒤 H.264 가 아니면 아래에서 재인코딩하므로 화질을 포기하지 않는다.)
function formatFor(quality) {
  const h = parseInt(quality, 10);
  if (!h) {
    return "bv*[vcodec^=avc1]+ba/b[vcodec^=avc1]/bv*+ba/best";
  }
  return (
    `bv*[height<=${h}][vcodec^=avc1]+ba/b[height<=${h}][vcodec^=avc1]/` +
    `bv*[height<=${h}]+ba/b[height<=${h}]/best`
  );
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(FFMPEG, args);
    let err = "";
    ps.stderr.on("data", (d) => (err += d.toString()));
    ps.on("error", reject);
    ps.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(err.slice(-200)))));
  });
}

// 파일의 영상 코덱을 ffmpeg 로 확인 (별도 ffprobe 불필요).
async function videoCodec(file) {
  try {
    const out = await ffmpeg(["-hide_banner", "-i", file]).catch((e) => e.message);
    const m = /Video:\s*([a-z0-9]+)/i.exec(out || "");
    return m ? m[1].toLowerCase() : "";
  } catch { return ""; }
}

// 영상을 받아 H.264+AAC mp4(faststart, 모든 플레이어 호환)로 만들어 경로를 돌려준다.
export async function ytDownload(pageUrl, quality) {
  const dir = path.join(os.tmpdir(), `yt_${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  const tmpl = path.join(dir, "src.%(ext)s");
  const args = [
    "-f", formatFor(quality),
    "--no-playlist", "--no-warnings",
    "-o", tmpl,
  ];
  if (FFMPEG_DIR) args.push("--ffmpeg-location", FFMPEG_DIR);
  args.push(pageUrl);
  try {
    await run(args);
    const src = fs.readdirSync(dir).find((n) => n.startsWith("src."));
    if (!src) throw new Error("영상 다운로드에 실패했습니다.");
    const srcPath = path.join(dir, src);

    const codec = await videoCodec(srcPath);
    const isH264 = /h264|avc/.test(codec);
    const out = path.join(dir, "video.mp4");
    // H.264 면 빠르게 복사(remux), 아니면(VP9/AV1) H.264 로 재인코딩 → QuickTime 등에서도 재생됨
    const ffArgs = isH264
      ? ["-y", "-i", srcPath, "-c", "copy", "-movflags", "faststart", out]
      : ["-y", "-i", srcPath, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "faststart", out];
    await ffmpeg(ffArgs);
    return { file: out, dir };
  } catch (e) {
    fs.rm(dir, { recursive: true, force: true }, () => {});
    throw e;
  }
}
