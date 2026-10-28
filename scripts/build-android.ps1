$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath $env:ANDROID_HOME)) { throw 'Android SDK가 필요합니다. Android Studio에서 설치해 주세요.' }
if (-not $env:JAVA_HOME) {
  $java = Get-Command java -ErrorAction Stop
  $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $java.Source)
}
node scripts/setup-cutout-model.mjs
if ($LASTEXITCODE -ne 0) { throw 'CPU 누끼 모델 준비 실패' }
node node_modules/expo/bin/cli prebuild --platform android --no-install
if ($LASTEXITCODE -ne 0) { throw 'Android 프로젝트 생성 실패' }
Push-Location android
try {
  .\gradlew.bat :app:assembleDebug '-PreactNativeArchitectures=arm64-v8a' --max-workers 2 --console plain
  if ($LASTEXITCODE -ne 0) { throw 'APK 빌드 실패' }
} finally { Pop-Location }
New-Item -ItemType Directory -Path .local/builds -Force | Out-Null
Copy-Item -LiteralPath android/app/build/outputs/apk/debug/app-debug.apk -Destination .local/builds/popout-dev.apk -Force
Write-Host "설치 파일: $((Resolve-Path .local/builds/popout-dev.apk).Path)"
