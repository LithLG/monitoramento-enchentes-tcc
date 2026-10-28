'use strict';
const dgram = require('node:dgram');
const os = require('node:os');

const MESSAGE_PREFIX = 'TCC-SERVIDOR;';

function localIPv4Interfaces() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal);
}

function broadcastAddress({ address, netmask }) {
  const ip = address.split('.').map(Number);
  const mask = netmask.split('.').map(Number);
  return ip.map((octet, i) => (octet & mask[i]) | (~mask[i] & 255)).join('.');
}

function announceOnAllNetworks(socket, message, discoveryPort) {
  for (const iface of localIPv4Interfaces()) {
    socket.send(message, discoveryPort, broadcastAddress(iface), () => {});
  }
}

function startDiscoveryBeacon({ httpPort, discoveryPort, intervalMs, logger = console }) {
  const socket = dgram.createSocket('udp4');
  const message = `${MESSAGE_PREFIX}${httpPort}`;
  let timer = null;

  socket.on('error', (error) => logger.warn(`[descoberta] ${error.message}`));
  socket.bind(() => {
    socket.setBroadcast(true);
    timer = setInterval(() => announceOnAllNetworks(socket, message, discoveryPort), intervalMs);
  });

  return function stopDiscoveryBeacon() {
    clearInterval(timer);
    socket.close();
  };
}

module.exports = { startDiscoveryBeacon, broadcastAddress, localIPv4Interfaces, MESSAGE_PREFIX };
