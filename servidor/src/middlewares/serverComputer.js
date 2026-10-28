'use strict';
const { localIPv4Interfaces } = require('../discovery/beacon');

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);
const IPV4_MAPPED_PREFIX = '::ffff:';

const withoutIpv4MappedPrefix = (address) => (address?.startsWith(IPV4_MAPPED_PREFIX)
  ? address.slice(IPV4_MAPPED_PREFIX.length)
  : address);

// Changes to the registered places are only accepted from the computer that runs the server.
// Other devices on the Wi-Fi (a phone, for example) can only look at the panel.
function createServerComputerCheck(ownAddresses = () => localIPv4Interfaces().map((iface) => iface.address)) {
  return function isServerComputer(req) {
    const address = withoutIpv4MappedPrefix(req.socket.remoteAddress);
    return LOOPBACK_ADDRESSES.has(address) || ownAddresses().includes(address);
  };
}

module.exports = { createServerComputerCheck };
