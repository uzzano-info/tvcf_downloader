import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const WORK = path.join(os.tmpdir(), "tvcf_dl");
fs.mkdirSync(WORK, { recursive: true });
const READY = new Map(); // id -> { file, name }
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// tvcf 재생 페이지에서 스트림 정보와 제목을 추출한다.
async function resolveStreams(pageUrl) {
  if (!/^https?:\/\/(www\.)?tvcf\.co\.kr\/play\//.test(pageUrl)) {
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

function safeName(s) {
  return s.replace(/[\/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

const HHMMSS = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/;

// ffmpeg 로 HLS(m3u8)를 "일반(seekable) mp4" 로 변환한다.
// 변환에는 수 초가 걸리므로, 진행 상황(JSON 한 줄씩)을 흘려보내 연결을 유지(heartbeat)하고
// 완료되면 다운로드용 id 를 내려준다. 실제 파일은 /api/file 에서 받는다.
// (stdout 으로 바로 보내려면 fragmented mp4 가 되어 일부 플레이어가 첫 조각만 재생하는 문제가 있음)
function prepare(m3u8, pageUrl, filename, res) {
  const id = randomUUID();
  const file = path.join(WORK, `${id}.mp4`);
  const args = [
    "-headers", `Referer: ${pageUrl}\r\nUser-Agent: ${UA}\r\n`,
    "-i", m3u8,
    "-c", "copy",
    "-bsf:a", "aac_adtstoasc",
    "-movflags", "faststart",
    "-y", file,
  ];
  const ff = spawn("ffmpeg", args);
  let err = "";

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  const send = (o) => { try { res.write(JSON.stringify(o) + "\n"); } catch {} };

  ff.stderr.on("data", (d) => {
    err += d.toString();
    const m = HHMMSS.exec(d.toString());
    if (m) send({ progress: (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) });
  });

  ff.on("error", () => {
    send({ error: "ffmpeg 실행에 실패했습니다. ffmpeg 가 설치되어 있는지 확인하세요." });
    res.end();
  });

  ff.on("close", (code) => {
    if (code === 0 && fs.existsSync(file)) {
      READY.set(id, { file, name: filename });
      // 30분 뒤 자동 정리
      setTimeout(() => { READY.delete(id); fs.rm(file, () => {}); }, 30 * 60 * 1000).unref();
      send({ done: true, id, name: filename });
    } else {
      fs.rm(file, () => {});
      send({ error: "영상 변환에 실패했습니다.", detail: err.slice(-300) });
    }
    res.end();
  });

  res.on("close", () => { if (!ff.killed) ff.kill("SIGKILL"); });
}

// 변환 완료된 파일을 첨부파일로 전송하고 정리한다.
function serveFile(id, res) {
  const entry = READY.get(id);
  if (!entry || !fs.existsSync(entry.file)) {
    sendJson(res, 404, { error: "파일이 만료되었거나 존재하지 않습니다. 다시 시도해 주세요." });
    return;
  }
  const stat = fs.statSync(entry.file);
  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Length": stat.size,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`,
  });
  const rs = fs.createReadStream(entry.file);
  rs.pipe(res);
  rs.on("close", () => { READY.delete(id); fs.rm(entry.file, () => {}); });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "public", "index.html")).pipe(res);
    return;
  }

  // 영상 정보(제목/화질 목록) 조회
  if (req.method === "POST" && url.pathname === "/api/info") {
    try {
      const { url: pageUrl } = JSON.parse(await readBody(req));
      const info = await resolveStreams(pageUrl);
      sendJson(res, 200, { title: info.title, qualities: Object.keys(info.streams) });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  // 여러 영상 정보 일괄 조회 (최대 10개)
  if (req.method === "POST" && url.pathname === "/api/batch-info") {
    try {
      let { urls } = JSON.parse(await readBody(req));
      if (!Array.isArray(urls)) throw new Error("urls 배열이 필요합니다.");
      urls = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
      if (urls.length === 0) throw new Error("주소를 1개 이상 입력해 주세요.");
      if (urls.length > 10) throw new Error("한 번에 최대 10개까지만 가능합니다.");
      const results = await Promise.all(
        urls.map(async (pageUrl) => {
          try {
            const info = await resolveStreams(pageUrl);
            return { url: pageUrl, ok: true, title: info.title, qualities: Object.keys(info.streams) };
          } catch (e) {
            return { url: pageUrl, ok: false, error: e.message };
          }
        })
      );
      sendJson(res, 200, { results });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  // 변환 시작 (진행 상황을 ndjson 으로 스트리밍, 완료 시 다운로드 id 반환)
  if (req.method === "GET" && url.pathname === "/api/prepare") {
    try {
      const pageUrl = url.searchParams.get("url");
      const quality = url.searchParams.get("quality") || "HD";
      const info = await resolveStreams(pageUrl);
      const m3u8 = info.streams[quality] || Object.values(info.streams)[0];
      const filename = `${safeName(info.title)}_${quality}.mp4`;
      prepare(m3u8, info.pageUrl, filename, res);
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  // 변환 완료된 파일 다운로드
  if (req.method === "GET" && url.pathname === "/api/file") {
    serveFile(url.searchParams.get("id"), res);
    return;
  }

  sendJson(res, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  console.log(`tvcf downloader ▶ http://localhost:${PORT}`);
});
