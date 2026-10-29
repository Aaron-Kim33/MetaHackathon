import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { lanAddress } from './network.mjs';
import { saveQR, terminalQR } from './qr.mjs';
const apk = new URL('../.local/builds/popout-dev.apk', import.meta.url);
await stat(apk);
const address = lanAddress(networkInterfaces(), process.env.POPOUT_LAN_ADDRESS);
const url = `http://${address}:4181`, open = `popout://expo-development-client/?url=${encodeURIComponent(`http://${address}:8082`)}`;
const build=JSON.parse(await readFile(new URL('../app.json',import.meta.url),'utf8')).expo.android.versionCode;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pop Out 설치 · Install</title><style>body{font:17px system-ui;background:#19151f;color:white;padding:28px;line-height:1.6}a{display:block;background:#bca3ed;color:#17111e;padding:16px;border-radius:14px;text-decoration:none;margin:20px 0}small{color:#ccc}</style><h1>Pop Out · Build ${build}</h1><p>휴대폰과 PC를 같은 네트워크에 연결하세요.<br>Connect your phone and PC to the same network.</p><a href="/popout-dev.apk?build=${build}">1. Android 업데이트 설치 · Install Android update</a><p>기존 앱을 삭제하지 말고 업데이트로 설치하세요. 마이크와 음성 인식 권한을 허용해 주세요.<br>Install as an update without uninstalling. Allow microphone and speech recognition permissions.</p><a href="${open}">2. 편집기 열기 · Open editor</a><small>연결 주소 / Server: http://${address}:8082<br>AI 생성·보정·보관함 복구에서 마이크 버튼을 누르세요.<br>Use the microphone in AI Create, Retouch or Library repair.<br>이 PC의 개발 서버를 켜두세요. Keep the development server running.</small></html>`;

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const pathname=new URL(req.url,'http://localhost').pathname;
  if (pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : html); return; }
  if (pathname !== '/popout-dev.apk') { res.writeHead(404); res.end(); return; }
  let current; try { current = await stat(apk); } catch { res.writeHead(503); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': current.size, 'Content-Disposition': `attachment; filename="popout-dev-v${build}.apk"` });
  if (req.method === 'HEAD') res.end(); else { const stream = createReadStream(apk); stream.on('error', () => res.destroy()); stream.pipe(res); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4181, address, resolve); });
await saveQR(url, fileURLToPath(new URL('../.local/install-qr.png', import.meta.url)));
console.log(`Android 설치: ${url}\n이 터미널을 켜두세요. Ctrl+C로 다운로드 서버를 종료합니다.\n${terminalQR(url)}`);
process.on('SIGINT', () => server.close()); process.on('SIGTERM', () => server.close());
