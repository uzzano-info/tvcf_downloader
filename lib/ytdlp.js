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

// 제목 등 메타데이터 조회 (다운로드 없이).
export async function ytInfo(pageUrl) {
  const args = ["-J", "--no-playlist", "--no-warnings", pageUrl];
  const json = JSON.parse(await run(args));
  const title = (json.title || json.id || "video").toString().trim().slice(0, 100) || "video";
  return { title, qualities: ["원본"] };
}

// 영상을 mp4 로 받아 임시 파일 경로를 돌려준다.
export async function ytDownload(pageUrl) {
  const dir = path.join(os.tmpdir(), `yt_${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  const tmpl = path.join(dir, "video.%(ext)s");
  const args = [
    // 호환성 높은 H.264(avc) mp4 우선, 없으면 차선책으로 폴백
    "-f", "b[ext=mp4][vcodec^=avc]/bv*[vcodec^=avc]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/best",
    "--merge-output-format", "mp4",
    "--no-playlist", "--no-warnings",
    "-o", tmpl,
  ];
  if (FFMPEG_DIR) args.push("--ffmpeg-location", FFMPEG_DIR);
  args.push(pageUrl);
  try {
    await run(args);
    const f = fs.readdirSync(dir).find((n) => n.startsWith("video."));
    if (!f) throw new Error("영상 다운로드에 실패했습니다.");
    return { file: path.join(dir, f), dir };
  } catch (e) {
    fs.rm(dir, { recursive: true, force: true }, () => {});
    throw e;
  }
}
