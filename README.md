# 영상 다운로더

tvcf.co.kr · 유튜브 · 인스타그램(릴스/게시물) 영상을 mp4로 받는 웹서비스. 최대 10개 일괄 다운로드.

## 동작 방식
- **tvcf**: 재생 페이지에서 HLS(m3u8) 스트림을 추출 → ffmpeg로 mp4(faststart) 변환
- **유튜브 · 인스타그램 등**: `yt-dlp`로 H.264 mp4 우선 다운로드 (ffmpeg는 병합용)

yt-dlp는 수백 개 사이트를 지원하므로 tvcf 외 대부분의 영상 URL이 그대로 동작합니다.

## 필요 조건
- Node.js 18+
- **ffmpeg** — `ffmpeg-static` 의존성으로 자동 포함됨
- **yt-dlp** — 인스타그램 다운로드에 필요. 서버에 별도 설치해야 함
  - macOS: `brew install yt-dlp`
  - Linux/배포: `pip install yt-dlp` (또는 바이너리 설치)
  - 경로 지정이 필요하면 환경변수 `YTDLP_PATH` 사용

## 로컬 실행
```bash
npm install
node server.js   # http://localhost:3000
```

## 배포 (상시 서버 권장: Render / Railway / Fly.io / VPS)
인스타그램은 **데이터센터 IP에서 차단**될 수 있고 `yt-dlp`(Python) 바이너리가 필요해
**Vercel 등 서버리스에는 적합하지 않습니다.** 상시 실행 서버에 배포하세요.

빌드 단계에서 yt-dlp를 설치해야 합니다. 예) Render Build Command:
```bash
npm install && pip install -U yt-dlp
```
Start Command: `node server.js`

> 참고: `vercel.json`은 tvcf 전용 배포 시에만 유효합니다(인스타 기능은 Vercel에서 동작하지 않음).
> IG가 차단되면 `yt-dlp`에 로그인 쿠키(`--cookies`)가 필요할 수 있습니다.
