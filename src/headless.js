'use strict';

/**
 * headless.js — non-GUI commands (`nodekill ls`, `nodekill kill <port>`).
 */

const { collect } = require('./collector');
const { killPid } = require('./kill');
const { pad, truncate } = require('./format');

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

async function printPortsTable() {
  process.stdout.write(C.dim + 'Scanning listening ports…' + C.reset + '\n');
  const { rows } = await collect({ onlyListening: true });

  if (!rows.length) {
    process.stdout.write(C.yellow + 'No listening ports found.' + C.reset + '\n');
    return;
  }

  const header =
    C.bold +
    pad('PORT', 7) +
    pad('PID', 8) +
    pad('PROCESS', 18) +
    pad('PROJECT', 22) +
    pad('ADDRESS', 22) +
    'LOCATION' +
    C.reset;
  process.stdout.write('\n' + header + '\n');
  process.stdout.write(C.gray + '─'.repeat(100) + C.reset + '\n');

  for (const r of rows) {
    process.stdout.write(
      C.green + pad(String(r.port), 7) + C.reset +
      pad(String(r.pid), 8) +
      C.cyan + pad(truncate(r.name, 17), 18) + C.reset +
      pad(truncate(r.project || '—', 21), 22) +
      pad(truncate(r.address || '', 21), 22) +
      C.gray + truncate(r.projectDir || r.cwd || '', 40) + C.reset +
      '\n'
    );
  }
  process.stdout.write('\n' + C.dim + rows.length + ' listening port(s). Run `nodekill` for the interactive dashboard.' + C.reset + '\n');
}

async function killByPortOrPid(target, force) {
  const num = parseInt(target, 10);
  if (isNaN(num)) {
    process.stdout.write(C.red + '✗ Invalid target: ' + target + C.reset + '\n');
    return false;
  }

  const { rows } = await collect({ onlyListening: false });

  // Match a listening port first; otherwise treat the number as a PID.
  const byPort = rows.filter((r) => r.port === num);
  let pids;
  let label;
  if (byPort.length) {
    pids = [...new Set(byPort.map((r) => r.pid).filter(Boolean))];
    label = 'port ' + num + ' (' + byPort[0].name + ')';
  } else {
    pids = [num];
    label = 'PID ' + num;
  }

  if (!pids.length) {
    process.stdout.write(C.yellow + 'Nothing is listening on ' + label + '.' + C.reset + '\n');
    return false;
  }

  let allOk = true;
  for (const pid of pids) {
    const res = await killPid(pid, force);
    if (res.ok) {
      process.stdout.write(C.green + '✓ ' + res.message + C.reset + '\n');
    } else {
      allOk = false;
      process.stdout.write(C.red + '✗ ' + res.message + C.reset + '\n');
    }
  }
  if (allOk) process.stdout.write(C.dim + 'Done — freed ' + label + '.' + C.reset + '\n');
  return allOk;
}

module.exports = { printPortsTable, killByPortOrPid };
