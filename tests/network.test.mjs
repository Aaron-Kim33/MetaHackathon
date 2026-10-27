import test from 'node:test';
import assert from 'node:assert/strict';
import { lanAddress } from '../scripts/network.mjs';
const ipv4 = address => ({ family: 'IPv4', internal: false, address });
test('mobile launcher chooses the physical LAN rather than the VPN address', () => {
  const adapters = { TunnelBearWireguard: [ipv4('10.0.11.2')], Ethernet: [ipv4('192.168.100.7')] };
  assert.equal(lanAddress(adapters), '192.168.100.7');
  assert.equal(lanAddress({ ...adapters, 'Wi-Fi': [ipv4('192.168.1.6')] }), '192.168.1.6');
});
test('VPN-only networks require explicit selection and overrides must belong to the PC', () => {
  const adapters = { TunnelBearWireguard: [ipv4('10.0.11.2')] };
  assert.throws(() => lanAddress(adapters), /LAN/);
  assert.equal(lanAddress(adapters, '10.0.11.2'), '10.0.11.2');
  assert.throws(() => lanAddress(adapters, '203.0.113.5'), /사설/);
});
