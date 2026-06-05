'use strict';

/**
 * system.js — live system stats for the monitoring panel.
 */

const os = require('os');
const si = require('systeminformation');

let _staticCache = null;

async function getStatic() {
  if (_staticCache) return _staticCache;
  try {
    const [cpu, osInfo, sys] = await Promise.all([si.cpu(), si.osInfo(), si.system()]);
    _staticCache = {
      cpuBrand: ((cpu.manufacturer || '') + ' ' + (cpu.brand || '')).trim() || os.cpus()[0].model,
      cores: cpu.cores || os.cpus().length,
      physicalCores: cpu.physicalCores || cpu.cores || os.cpus().length,
      platform: osInfo.platform,
      distro: osInfo.distro,
      release: osInfo.release,
      arch: osInfo.arch || os.arch(),
      hostname: osInfo.hostname || os.hostname(),
      model: ((sys.manufacturer || '') + ' ' + (sys.model || '')).trim(),
    };
  } catch (_) {
    const cpus = os.cpus();
    _staticCache = {
      cpuBrand: cpus[0] ? cpus[0].model : 'CPU',
      cores: cpus.length,
      physicalCores: cpus.length,
      platform: process.platform,
      distro: process.platform,
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      model: '',
    };
  }
  return _staticCache;
}

/** Returns a live snapshot of CPU %, memory, load, uptime, network, battery. */
async function getSnapshot() {
  const snap = {
    cpu: 0,
    cpuPerCore: [],
    memUsed: 0,
    memTotal: os.totalmem(),
    memActive: 0,
    swapUsed: 0,
    swapTotal: 0,
    load: os.loadavg ? os.loadavg() : [0, 0, 0],
    uptime: os.uptime(),
    processes: 0,
    netRx: 0,
    netTx: 0,
    battery: null,
  };

  try {
    const [load, mem, net, batt, procs] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.networkStats().catch(() => null),
      si.battery().catch(() => null),
      si.processes().catch(() => null),
    ]);

    if (load) {
      snap.cpu = load.currentLoad || 0;
      snap.cpuPerCore = (load.cpus || []).map((c) => c.load || 0);
    }
    if (mem) {
      snap.memTotal = mem.total;
      snap.memUsed = mem.active != null ? mem.active : mem.used;
      snap.memActive = mem.active != null ? mem.active : mem.used;
      snap.swapUsed = mem.swapused || 0;
      snap.swapTotal = mem.swaptotal || 0;
    }
    if (net && net[0]) {
      snap.netRx = net[0].rx_sec || 0;
      snap.netTx = net[0].tx_sec || 0;
    }
    if (batt && batt.hasBattery) {
      snap.battery = { percent: batt.percent, charging: batt.isCharging, acConnected: batt.acConnected };
    }
    if (procs) snap.processes = procs.all || (procs.list ? procs.list.length : 0);
  } catch (_) {
    // os fallback already populated.
    const free = os.freemem();
    snap.memUsed = snap.memTotal - free;
  }

  return snap;
}

module.exports = { getStatic, getSnapshot };
