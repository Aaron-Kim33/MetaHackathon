import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createApp } from '../server/index.mjs';
import { lanAddress } from './network.mjs';
import { saveQR, terminalQR } from './qr.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const address = lanAddress(networkInterfaces(), process.env.POPOUT_LAN_ADDRESS);
const port = Number(process.env.POPOUT_PORT || 4180);
// Re-running the documented command should not create a second server or alter job records.
let running;
try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
  if (response.ok) running = await response.json();
} catch {}
if (running?.service === 'reel-talk-popout') {
  await saveQR(`exp://${address}:8082`, path.join(root, '.local', 'expo-qr.png'));
  console.log(`출품용 서버가 이미 실행 중입니다.\nExpo Go: exp://${address}:8082\n새로고침: npm run reload\nQR: .local/expo-qr.png`);
  console.log(terminalQR(`exp://${address}:8082`));
  console.log('휴대폰 Expo Go에서 위 QR을 스캔하세요. 연결 후 npm run reload를 사용할 수 있습니다.');
  process.exit(0);
}
const app = await createApp();
await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, '0.0.0.0', resolve); });
console.log(`\nReel Talk · Pop Out\nPC 서버: http://${address}:${port}\n연결 코드: ${app.token}\nMeta 키: ${process.env.MODEL_API_KEY ? '설정됨 (실호출 미검증)' : '미설정 · 연습용 그림 사용 가능'}\n`);
await saveQR(`exp://${address}:8082`, path.join(root, '.local', 'expo-qr.png'));
console.log(`Expo Go: exp://${address}:8082 · QR: .local/expo-qr.png`);
console.log(terminalQR(`exp://${address}:8082`));
console.log('이 터미널을 켜둔 채 휴대폰 Expo Go에서 위 QR을 스캔하세요. 연결 후 이 터미널에서 r 키로 새로고침할 수 있습니다.');
const require = createRequire(import.meta.url);
const expoCli = require.resolve('expo/bin/cli');
const env = { ...process.env, POPOUT_LOCAL_DEV: '1', POPOUT_API_URL: `http://${address}:${port}`, POPOUT_TOKEN: app.token, REACT_NATIVE_PACKAGER_HOSTNAME: address, EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1' };
delete env.MODEL_API_KEY;
const child = spawn(process.execPath, [expoCli, 'start', '--go', '--lan', '--port', '8082'], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
const close = () => { child.kill(); app.server.close(); };
process.on('SIGINT', close); process.on('SIGTERM', close);
child.once('error', error => { console.error(error.message); app.server.close(); });
child.once('exit', code => { app.server.close(); process.exitCode = code || 0; });
