const socket = new WebSocket('ws://127.0.0.1:8082/message');
let sent = false;
const timer = setTimeout(() => finish('개발 서버가 응답하지 않아요. 먼저 npm start를 실행하세요.', 1), 8000);
function finish(message, code = 0) {
  clearTimeout(timer);
  console.log(message);
  socket.close();
  process.exitCode = code;
}
socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ version: 2, id: 'popout-peers', target: 'server', method: 'getpeers' }));
});
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id === 'popout-peers') {
    const count = Object.keys(message.result || {}).length;
    if (!count) { finish('연결된 앱이 없습니다. 설치한 개발 앱에서 개발 서버(8082)에 다시 연결해 주세요.', 1); return; }
    sent = true;
    socket.send(JSON.stringify({ version: 2, method: 'reload' }));
    console.log(`활성 개발 연결 ${count}개에 새로고침을 요청합니다. 휴대폰 대수가 아닙니다.`);
  } else if (sent && message.method === 'reload') {
    finish('개발 서버가 새로고침 명령을 전송했습니다.');
  }
});
socket.addEventListener('error', () => finish('개발 서버에 연결할 수 없어요. 먼저 npm start를 실행하세요.', 1));
