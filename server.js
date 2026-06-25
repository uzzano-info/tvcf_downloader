import http from "node:http";
import { spawn } from "node:child_process";
import handler from "./lib/handler.js";

// 플랫폼(Render 등)이 PORT 를 주면 그걸 쓰고, 로컬이면 3000.
const PORT = process.env.PORT || 3000;
const isLocal = !process.env.PORT; // 플랫폼 배포 시에는 브라우저 자동 실행 안 함

http.createServer(handler).listen(PORT, () => {
  const urlStr = `http://localhost:${PORT}`;
  console.log(`\n🎬 영상 다운로더 실행 중 ▶ ${urlStr}\n   (종료하려면 Ctrl+C)\n`);
  if (isLocal && process.env.OPEN_BROWSER !== "0") openBrowser(urlStr);
});

// OS 기본 브라우저로 자동 열기
function openBrowser(u) {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", u] : [u];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* 자동 열기 실패해도 무시 (위 주소를 수동으로 열면 됨) */
  }
}
