const privateAddress = address => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
export function lanAddress(interfaces, override) {
  const entries = Object.entries(interfaces).flatMap(([name, items]) => (items || []).filter(item => item.family === 'IPv4' && !item.internal && privateAddress(item.address)).map(item => ({ name, address: item.address })));
  if (override) {
    if (!entries.some(item => item.address === override)) throw new Error('POPOUT_LAN_ADDRESS는 PC의 사설 네트워크 주소여야 해요.');
    return override;
  }
  const physical = entries.filter(item => !/vpn|tunnel|wireguard|tailscale|zerotier|virtual|vethernet|docker|wsl/i.test(item.name));
  const priority = name => /wi-?fi|wlan|무선/i.test(name) ? 0 : /ethernet|이더넷/i.test(name) ? 1 : 2;
  physical.sort((a, b) => priority(a.name) - priority(b.name));
  if (!physical.length) throw new Error('휴대폰과 연결할 사설 LAN 주소를 찾지 못했어요. PC를 네트워크에 연결하거나 POPOUT_LAN_ADDRESS를 지정하세요.');
  return physical[0].address;
}
