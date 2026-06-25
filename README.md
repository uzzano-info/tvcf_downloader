# 영상 다운로더

tvcf.co.kr · 유튜브 · 인스타그램(릴스/게시물) 영상을 mp4로 받는 웹서비스. 최대 10개 일괄 다운로드.

## 동작 방식
- **tvcf**: 재생 페이지에서 HLS(m3u8) 스트림을 추출 → ffmpeg로 mp4(faststart) 변환
- **유튜브 · 인스타그램 등**: `yt-dlp`로 H.264 mp4 우선 다운로드 (ffmpeg는 병합용)
- **화질 선택**: 영상별로 실제 제공되는 해상도를 골라 받음 (최대 **4K/2160p**)
  - 받은 영상이 H.264 가 아니면(720p↑ 에서 흔한 VP9/AV1) **H.264+AAC mp4 로 자동 재인코딩** → QuickTime·Safari·사진앱 등 모든 플레이어에서 재생. (H.264 면 빠르게 remux 만 하며, 고해상도 재인코딩은 다소 시간이 걸림)

yt-dlp는 수백 개 사이트를 지원하므로 tvcf 외 대부분의 영상 URL이 그대로 동작합니다.

## 필요 조건
- Node.js 18+
- **ffmpeg** — `ffmpeg-static` 의존성으로 자동 포함됨
- **yt-dlp** — 인스타그램 다운로드에 필요. 서버에 별도 설치해야 함
  - macOS: `brew install yt-dlp`
  - Linux/배포: `pip install yt-dlp` (또는 바이너리 설치)
  - 경로 지정이 필요하면 환경변수 `YTDLP_PATH` 사용

## 로컬에서 쉽게 사용 (권장)

> 유튜브·인스타는 클라우드 IP가 차단되므로, **로컬 실행이 가장 안정적**입니다(쿠키 불필요).

**가장 쉬운 방법 (macOS)**: Finder 에서 **`start.command` 더블클릭**.
처음 한 번은 자동으로 패키지·yt-dlp 설치 후 서버를 켜고 브라우저를 열어줍니다.

**터미널로 실행**:
```bash
npm install      # 최초 1회
npm start        # → http://localhost:3000 자동 열림
```
유튜브·인스타를 쓰려면 `yt-dlp` 가 설치돼 있어야 합니다: `brew install yt-dlp`

## 맥 앱으로 만들기

더블클릭으로 실행되는 `.app` 번들을 생성합니다:
```bash
./build-app.sh        # → dist/영상 줍줍.app 생성
```
- 앱 안에 소스·패키지·ffmpeg 가 모두 포함되어 자체 완결 (Node·yt-dlp 는 시스템 설치 필요)
- 생성된 `.app` 을 **Applications 폴더로 드래그**해 두고 더블클릭하면 브라우저가 열립니다
- 종료: Dock 에서 앱 아이콘 우클릭 → 종료
- 처음 열 때 Gatekeeper 가 막으면: `.app` **우클릭 → 열기** (서명 안 된 로컬 앱이라 1회 허용 필요)

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
