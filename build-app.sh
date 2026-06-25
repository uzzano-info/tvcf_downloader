#!/bin/bash
# macOS .app 번들을 생성한다. (재실행 가능)
#   사용법: ./build-app.sh   →  dist/영상 다운로더.app 생성
set -e
cd "$(dirname "$0")"

APP_NAME="영상 줍줍"
APP="dist/${APP_NAME}.app"
CONTENTS="$APP/Contents"
RES="$CONTENTS/Resources/app"

echo "📦 의존성 확인..."
[ -d node_modules ] || npm install

echo "🧹 기존 번들 정리..."
rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$RES"

echo "📁 앱 소스 복사..."
cp -R server.js lib public package.json "$RES/"
cp -R node_modules "$RES/"   # ffmpeg-static 바이너리 포함 → 자체 완결

echo "🎨 앱 아이콘 적용..."
cp assets/AppIcon.icns "$CONTENTS/Resources/AppIcon.icns"

# --- Info.plist ---
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>영상 줍줍</string>
  <key>CFBundleDisplayName</key><string>영상 줍줍</string>
  <key>CFBundleIdentifier</key><string>com.local.jupjup</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><false/>
</dict>
</plist>
PLIST

# --- 실행 스크립트 ---
cat > "$CONTENTS/MacOS/launcher" <<'LAUNCH'
#!/bin/bash
# GUI 앱은 PATH 가 최소화되어 있으므로 흔한 경로를 직접 추가한다.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

DIR="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
cd "$DIR"

# Node 확인
NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  osascript -e 'display alert "Node.js 가 필요합니다" message "https://nodejs.org 에서 설치 후 다시 실행하세요."'
  exit 1
fi

# yt-dlp 안내 (유튜브·인스타용). 없으면 알림만 (tvcf 는 그대로 동작)
if ! command -v yt-dlp >/dev/null 2>&1; then
  osascript -e 'display notification "유튜브·인스타를 받으려면 터미널에서 brew install yt-dlp 를 실행하세요. tvcf 는 바로 사용 가능합니다." with title "영상 다운로더"'
fi

# 서버 실행 → 잠시 후 브라우저 자동 열기 (서버가 직접 열지 않도록 OPEN_BROWSER=0)
OPEN_BROWSER=0 "$NODE" server.js &
SERVER_PID=$!
sleep 1.5
open "http://localhost:3000"

# 앱이 종료(Dock 에서 종료)되면 서버도 함께 종료
trap 'kill $SERVER_PID 2>/dev/null' EXIT TERM INT
wait $SERVER_PID
LAUNCH
chmod +x "$CONTENTS/MacOS/launcher"

echo
echo "✅ 완성: $APP"
echo "   Finder 에서 더블클릭하면 브라우저가 열립니다."
echo "   원하면 Applications 폴더로 드래그해 두세요."
