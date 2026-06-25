#!/bin/bash
# 더블클릭으로 영상 다운로더를 켜는 런처 (macOS)
cd "$(dirname "$0")" || exit 1

echo "🎬 영상 다운로더를 시작합니다..."
echo

# 1) Node 확인
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js 가 필요합니다. https://nodejs.org 에서 설치 후 다시 실행하세요."
  read -r -p "엔터를 누르면 종료합니다..."
  exit 1
fi

# 2) yt-dlp 확인 (유튜브·인스타용). 없으면 brew 로 설치 시도.
if ! command -v yt-dlp >/dev/null 2>&1 && [ -z "$YTDLP_PATH" ]; then
  echo "ℹ️  yt-dlp 가 없어 설치를 시도합니다 (유튜브·인스타용)..."
  if command -v brew >/dev/null 2>&1; then
    brew install yt-dlp
  else
    echo "⚠️  Homebrew 가 없어 yt-dlp 를 자동 설치하지 못했습니다."
    echo "    tvcf 는 그대로 사용 가능하며, 유튜브·인스타가 필요하면 'brew install yt-dlp' 를 실행하세요."
  fi
fi

# 3) 의존성 설치 (최초 1회)
if [ ! -d node_modules ]; then
  echo "📦 처음 실행이라 필요한 패키지를 설치합니다..."
  npm install || { echo "❌ npm install 실패"; read -r -p "엔터를 누르면 종료..."; exit 1; }
fi

# 4) 서버 실행 (종료 시 이 창을 닫으면 됨)
echo
npm start
