import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { lanAddress } from './network.mjs';
import { saveQR, terminalQR } from './qr.mjs';
const apk = new URL('../.local/builds/popout-dev.apk', import.meta.url);
await stat(apk);
const address = lanAddress(networkInterfaces(), process.env.POPOUT_LAN_ADDRESS);
const url = `http://${address}:4181`, open = `popout://expo-development-client/?url=${encodeURIComponent(`http://${address}:8082`)}`;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pop Out 설치</title><style>body{font:17px system-ui;background:#19151f;color:white;padding:28px;line-height:1.6}a{display:block;background:#bca3ed;color:#17111e;padding:16px;border-radius:14px;text-decoration:none;margin:20px 0}small{color:#ccc}</style><h1>Pop Out 개발 앱</h1><p>같은 Wi-Fi에서 안드로이드 휴대폰에 설치하세요.</p><p>기존 작업을 이어받으려면 먼저 Expo Go의 마지막 편집 화면을 열고 2초 뒤 돌아오세요.</p><a href="exp://${address}:8082">기존 작업 동기화 · Expo Go 열기</a><a href="/popout-dev.apk">1. Android 앱 다운로드</a><p>다운로드한 APK를 열어 설치하세요. 브라우저에서 이 앱 설치 허용을 요청하면 허용하세요.</p><a href="${open}">2. 설치한 앱으로 편집기 열기</a><small>기기 자동 누끼: 사진을 길게 누르거나 피사체 → 기기에서 자동 누끼. 입체 효과: 입체 보기. 이 PC의 개발 서버를 켜두세요.</small></html>`;
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : html); return; }
  if (req.url !== '/popout-dev.apk') { res.writeHead(404); res.end(); return; }
  let current; try { current = await stat(apk); } catch { res.writeHead(503); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': current.size, 'Content-Disposition': 'attachment; filename="popout-dev.apk"' });
  if (req.method === 'HEAD') res.end(); else { const stream = createReadStream(apk); stream.on('error', () => res.destroy()); stream.pipe(res); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4181, '0.0.0.0', resolve); });
await saveQR(url, fileURLToPath(new URL('../.local/install-qr.png', import.meta.url)));
console.log(`Android 설치: ${url}\n이 터미널을 켜두세요. Ctrl+C로 다운로드 서버를 종료합니다.\n${terminalQR(url)}`);
process.on('SIGINT', () => server.close()); process.on('SIGTERM', () => server.close());
