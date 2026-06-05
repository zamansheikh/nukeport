'use strict';

/**
 * kill.js — cross-platform process termination.
 */

const { execFile } = require('child_process');

function execFileP(cmd, params, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, params, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/**
 * Kill a process by PID.
 * @param {number} pid
 * @param {boolean} force  Use SIGKILL / taskkill /F.
 * @returns {Promise<{ok:boolean, message:string}>}
 */
async function killPid(pid, force = false) {
  pid = Number(pid);
  if (!pid || pid <= 0) {
    return { ok: false, message: 'Invalid PID.' };
  }
  if (pid === process.pid) {
    return { ok: false, message: 'Refusing to kill nukeport itself.' };
  }

  if (process.platform === 'win32') {
    const params = ['/PID', String(pid), '/T']; // /T also kills child tree
    if (force) params.push('/F');
    const { err, stderr } = await execFileP('taskkill', params);
    if (err) {
      // Retry forcefully if a graceful taskkill was refused.
      if (!force) {
        const retry = await execFileP('taskkill', ['/PID', String(pid), '/T', '/F']);
        if (!retry.err) return { ok: true, message: 'Force-killed PID ' + pid + '.' };
        return { ok: false, message: (retry.stderr || retry.err.message || 'taskkill failed').trim() };
      }
      return { ok: false, message: (stderr || err.message || 'taskkill failed').trim() };
    }
    return { ok: true, message: (force ? 'Force-killed' : 'Killed') + ' PID ' + pid + '.' };
  }

  // POSIX: try the signal directly via process.kill.
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    return { ok: true, message: (force ? 'Sent SIGKILL to ' : 'Sent SIGTERM to ') + pid + '.' };
  } catch (e) {
    if (e.code === 'EPERM') {
      // Permission — try with sudo-less kill command (may still need perms).
      const { err } = await execFileP('kill', [force ? '-9' : '-15', String(pid)]);
      if (!err) return { ok: true, message: 'Killed PID ' + pid + '.' };
      return { ok: false, message: 'Permission denied killing PID ' + pid + ' (try running with elevated privileges).' };
    }
    if (e.code === 'ESRCH') {
      return { ok: false, message: 'Process ' + pid + ' no longer exists.' };
    }
    return { ok: false, message: e.message };
  }
}

module.exports = { killPid };
