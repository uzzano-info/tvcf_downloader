import http from "node:http";
import handler from "./lib/handler.js";

const PORT = process.env.PORT || 3000;

http.createServer(handler).listen(PORT, () => {
  console.log(`tvcf downloader ▶ http://localhost:${PORT}`);
});
