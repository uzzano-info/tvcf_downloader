import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStreams, safeName, convertToFile } from "./tvcf.js";
import { ytInfo, ytDownload } from "./ytdlp.js";

const isTvcf = (u) => /^https?:\/\/(www\.)?tvcf\.co\.kr\/play\//.test(u || "");

// URL 종류에 맞춰 제목/화질을 조회한다.
async function getInfo(pageUrl) {
  if (isTvcf(pageUrl)) {
    const info = await resolveStreams(pageUrl);
    return { title: info.title, qualities: Object.keys(info.streams) };
  }
  // tvcf 외(인스타그램 등)는 yt-dlp 로 처리
  return ytInfo(pageUrl);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString();
}

// 단일 요청으로 변환/다운로드 → mp4 첨부파일 전송 → 임시파일 삭제.
async function handleDownload(pageUrl, quality, res) {
  let file, cleanup, title;

  if (isTvcf(pageUrl)) {
    const info = await resolveStreams(pageUrl);
    const m3u8 = info.streams[quality] || Object.values(info.streams)[0];
    title = info.title;
    file = await convertToFile(m3u8, info.pageUrl);
    cleanup = () => fs.rm(file, () => {});
  } else {
    const meta = await ytInfo(pageUrl).catch(() => ({ title: "video" }));
    title = meta.title;
    const dl = await ytDownload(pageUrl, quality);
    file = dl.file;
    cleanup = () => fs.rm(dl.dir, { recursive: true, force: true }, () => {});
  }

  const qtag = quality && quality !== "원본" ? `_${/^\d+$/.test(quality) ? quality + "p" : quality}` : "";
  const filename = `${safeName(title)}${qtag}.mp4`;
  try {
    const stat = fs.statSync(file);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    await new Promise((resolve) => {
      const rs = fs.createReadStream(file);
      rs.pipe(res);
      rs.on("close", resolve);
      res.on("close", resolve);
    });
  } finally {
    cleanup();
  }
}

// 로컬 server.js 와 Vercel 함수가 공유하는 라우터.
export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    // 로컬 직접 실행 시 정적 파일 제공 (Vercel 에서는 /public 이 자동 서빙됨)
    if (req.method === "GET" && (url.pathname === "/" || !url.pathname.startsWith("/api/"))) {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
      const file = path.join(PUBLIC, path.normalize(rel));
      if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file).toLowerCase();
        const types = { ".html": "text/html; charset=utf-8", ".png": "image/png",
          ".svg": "image/svg+xml", ".ico": "image/x-icon", ".css": "text/css", ".js": "text/javascript" };
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
        return;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/info") {
      const { url: pageUrl } = JSON.parse(await readBody(req));
      const info = await getInfo(pageUrl);
      return sendJson(res, 200, info);
    }

    if (req.method === "POST" && url.pathname === "/api/batch-info") {
      let { urls } = JSON.parse(await readBody(req));
      if (!Array.isArray(urls)) throw new Error("urls 배열이 필요합니다.");
      urls = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
      if (urls.length === 0) throw new Error("주소를 1개 이상 입력해 주세요.");
      if (urls.length > 10) throw new Error("한 번에 최대 10개까지만 가능합니다.");
      const results = await Promise.all(
        urls.map(async (pageUrl) => {
          try {
            const info = await getInfo(pageUrl);
            return { url: pageUrl, ok: true, title: info.title, qualities: info.qualities };
          } catch (e) {
            return { url: pageUrl, ok: false, error: e.message };
          }
        })
      );
      return sendJson(res, 200, { results });
    }

    // 단일 요청 다운로드 (서버리스 호환)
    if (req.method === "GET" && url.pathname === "/api/download") {
      const pageUrl = url.searchParams.get("url");
      const quality = url.searchParams.get("quality") || "HD";
      return await handleDownload(pageUrl, quality, res);
    }

    sendJson(res, 404, { error: "Not Found" });
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: e.message || "서버 오류" });
    else res.end();
  }
}
