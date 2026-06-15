import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// Vercel 등 ffmpeg 가 PATH 에 없는 환경에서는 동봉된 ffmpeg-static 바이너리를 쓰고,
// 그게 없으면 시스템 ffmpeg 로 폴백한다.
export const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// tvcf 재생 페이지에서 스트림 정보와 제목을 추출한다.
export async function resolveStreams(pageUrl) {
  if (!/^https?:\/\/(www\.)?tvcf\.co\.kr\/play\//.test(pageUrl || "")) {
    throw new Error("tvcf.co.kr/play/ 형식의 URL이 아닙니다.");
  }
  const res = await fetch(pageUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`페이지를 불러오지 못했습니다 (HTTP ${res.status})`);
  const html = await res.text();

  // RSC 페이로드는 따옴표가 이스케이프(\") 되어 있을 수 있어 둘 다 매칭한다.
  const streams = {};
  const re = /\\?"(HD|SD|mobile)\\?":\\?"(https:\/\/[^"\\]+\.m3u8)/g;
  let m;
  while ((m = re.exec(html))) {
    if (!streams[m[1]]) streams[m[1]] = m[2];
  }
  if (Object.keys(streams).length === 0) {
    throw new Error("이 페이지에서 다운로드 가능한 영상 스트림을 찾지 못했습니다.");
  }

  const titleMatch =
    html.match(/og:title"\s+content="([^"]+)"/) || html.match(/<title>([^<]+)<\/title>/);
  let title = titleMatch ? titleMatch[1] : "tvcf_video";
  title = title.replace(/\s*\|\s*TVCF\s*$/i, "").trim() || "tvcf_video";

  return { title, streams, pageUrl };
}

export function safeName(s) {
  return s.replace(/[\/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

// HLS(m3u8) → 일반(seekable, faststart) mp4 로 변환해 임시 파일 경로를 돌려준다.
// 한 번의 요청 안에서 변환까지 끝내므로 서버리스(인스턴스 간 상태 공유 X)에서도 안전하다.
export function convertToFile(m3u8, pageUrl) {
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `tvcf_${randomUUID()}.mp4`);
    const args = [
      "-headers", `Referer: ${pageUrl}\r\nUser-Agent: ${UA}\r\n`,
      "-i", m3u8,
      "-c", "copy",
      "-bsf:a", "aac_adtstoasc",
      "-movflags", "faststart",
      "-y", file,
    ];
    const ff = spawn(FFMPEG, args);
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("error", (e) =>
      reject(new Error(`ffmpeg 실행에 실패했습니다 (${e.code || e.message}).`))
    );
    ff.on("close", (code) => {
      if (code === 0 && fs.existsSync(file)) resolve(file);
      else { fs.rm(file, () => {}); reject(new Error("영상 변환에 실패했습니다. " + err.slice(-200))); }
    });
  });
}
