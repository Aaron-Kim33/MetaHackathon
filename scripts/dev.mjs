import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { createApp, localToken } from '../server/index.mjs';
import { lanAddress } from './network.mjs';
import { saveQR, terminalQR } from './qr.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const address = lanAddress(networkInterfaces(), process.env.POPOUT_LAN_ADDRESS), port = Number(process.env.POPOUT_PORT || 4180);
let health;
try { health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) }).then(r => r.json()); } catch {}
let app;
if (health?.service !== 'reel-talk-popout') {
  app = await createApp();
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, '0.0.0.0', resolve); });
}
const token = app?.token || process.env.POPOUT_TOKEN || await localToken(path.join(root, '.local'));
const metroUrl = `http://${address}:8082`, url = `popout://expo-development-client/?url=${encodeURIComponent(metroUrl)}`;
await saveQR(url, path.join(root, '.local', 'dev-qr.png'));
console.log(`설치한 Pop Out 개발 앱으로 여세요.\n${url}\nQR: .local/dev-qr.png\n새로고침: npm run reload`);
console.log(terminalQR(url));
let metro = false;
try { metro = (await fetch('http://127.0.0.1:8082/status', { signal: AbortSignal.timeout(1500) }).then(r => r.text())).includes('packager-status:running'); } catch {}
if (!metro || app) {
  let child;
  if (!metro) {
    const env = { ...process.env, POPOUT_LOCAL_DEV: '1', POPOUT_API_URL: `http://${address}:${port}`, POPOUT_TOKEN: token, REACT_NATIVE_PACKAGER_HOSTNAME: address, EXPO_NO_TELEMETRY: '1' };
    delete env.MODEL_API_KEY;
    child = spawn(process.execPath, ['node_modules/expo/bin/cli', 'start', '--dev-client', '--lan', '--port', '8082'], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    child.on('exit', code => { app?.server.close(); process.exitCode = code || 0; });
  }
  const close = () => { child?.kill(); app?.server.close(); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
  process.stdin.on('data', chunk => { if (chunk.toString().trim() === 'r') spawn(process.execPath, ['scripts/reload.mjs'], { cwd: root, windowsHide: true, stdio: 'inherit' }); });

}
