'use strict';

/**
 * collector.js
 *
 * Cross-platform discovery of listening network ports, the process that owns
 * each one, and (best effort) the project directory that process is running
 * from. Primary data source is `systeminformation`, which already knows how to
 * read connections + processes on Windows, macOS and Linux. We then enrich each
 * row with the working directory / project name using OS-specific tricks.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const si = require('systeminformation');

const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'

function execFileP(cmd, params, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, params, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 * 8 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

/** Walk up from a file/dir path looking for the nearest package.json. */
function findProject(startPath) {
  if (!startPath) return null;
  let dir = startPath;
  try {
    const st = fs.statSync(startPath);
    if (st.isFile()) dir = path.dirname(startPath);
  } catch (_) {
    // Path may not exist (e.g. a virtual arg); still try its dirname.
    dir = path.dirname(startPath);
  }
  let prev = null;
  let depth = 0;
  let fallback = null; // a package.json found inside node_modules, used only if nothing better
  while (dir && dir !== prev && depth < 16) {
    const candidate = path.join(dir, 'package.json');
    const insideNodeModules = /[\\/]node_modules[\\/]/.test(dir + path.sep);
    try {
      if (fs.existsSync(candidate)) {
        let name = path.basename(dir);
        try {
          const json = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          if (json && json.name) name = json.name;
        } catch (_) {}
        const hit = { dir, name, pkg: candidate };
        // Prefer the real project root, not a dependency's own package.json.
        if (!insideNodeModules) return hit;
        if (!fallback) fallback = hit;
      }
    } catch (_) {}
    prev = dir;
    dir = path.dirname(dir);
    depth++;
  }
  return fallback;
}

/** Pull the first existing filesystem path out of a command line string. */
function extractPathFromCommand(command, params) {
  const blob = [command, params].filter(Boolean).join(' ');
  if (!blob) return null;
  // Match quoted paths or bare tokens that look like paths.
  const tokens = blob.match(/"[^"]+"|'[^']+'|\S+/g) || [];
  for (const raw of tokens) {
    const tok = raw.replace(/^["']|["']$/g, '');
    if (tok.length < 2) continue;
    // Looks like a path (has a separator) and exists on disk.
    if (/[\\/]/.test(tok)) {
      try {
        if (fs.existsSync(tok)) return tok;
      } catch (_) {}
    }
  }
  return null;
}

/** Best-effort current working directory for a PID (unix only is reliable). */
async function getCwd(pid) {
  if (!pid || pid <= 0) return null;
  try {
    if (PLATFORM === 'linux') {
      return fs.readlinkSync('/proc/' + pid + '/cwd');
    }
    if (PLATFORM === 'darwin') {
      const out = await execFileP('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
      const line = out.split('\n').find((l) => l.startsWith('n'));
      if (line) return line.slice(1).trim();
    }
  } catch (_) {}
  return null;
}

/** Normalize a systeminformation connection state to a short label. */
function normState(state) {
  if (!state) return '';
  return String(state).toUpperCase();
}

/**
 * Collect everything. Returns:
 * {
 *   rows: [{ port, proto, pid, name, user, address, state, command, cwd,
 *            project, projectDir, listening }],
 *   updatedAt: number
 * }
 */
async function collect(options = {}) {
  const onlyListening = options.onlyListening !== false; // default: listening only

  let connections = [];
  let processes = { list: [] };
  try {
    [connections, processes] = await Promise.all([
      si.networkConnections(),
      si.processes(),
    ]);
  } catch (_) {
    // Fall through with whatever we got.
  }

  const procByPid = new Map();
  for (const p of processes.list || []) {
    procByPid.set(Number(p.pid), p);
  }

  // Deduplicate by pid+port+proto so multi-interface listeners collapse.
  const seen = new Map();

  for (const c of connections || []) {
    const state = normState(c.state);
    const isListen = state === 'LISTEN' || state === 'LISTENING';
    if (onlyListening && !isListen) continue;

    const pid = Number(c.pid) || 0;
    const port = parseInt(c.localPort, 10);
    if (!port && onlyListening) continue;

    const proc = procByPid.get(pid);
    const proto = (c.protocol || c.transport || 'tcp').toLowerCase();
    const key = pid + ':' + port + ':' + proto;
    if (seen.has(key)) {
      // Prefer a row that has a real listen address over a duplicate.
      continue;
    }

    const address = c.localAddress || '';
    const command = proc ? [proc.command, proc.params].filter(Boolean).join(' ').trim() : '';
    const name = proc ? proc.name : (c.process || '');

    seen.set(key, {
      port: port || 0,
      proto,
      pid,
      name: name || '—',
      user: proc ? (proc.user || '') : '',
      address,
      state: state || (isListen ? 'LISTEN' : ''),
      command: command || '',
      execPath: proc ? proc.path || '' : '',
      cwd: null, // filled in during enrichment
      project: null,
      projectDir: null,
      cpu: proc ? Number(proc.cpu || proc.pcpu || 0) : 0,
      mem: proc ? Number(proc.mem || proc.pmem || 0) : 0,
      listening: isListen,
    });
  }

  const rows = Array.from(seen.values());

  // Enrich with cwd + project info, in parallel but capped.
  await Promise.all(
    rows.map(async (row) => {
      if (!row.pid) return;
      const cwd = await getCwd(row.pid);
      if (cwd) row.cwd = cwd;

      // Try project from cwd first, then from the command line's script path,
      // then from the exec path.
      let project =
        findProject(cwd) ||
        findProject(extractPathFromCommand(row.command, '')) ||
        findProject(row.execPath);

      if (project) {
        row.project = project.name;
        row.projectDir = project.dir;
      } else if (cwd) {
        row.projectDir = cwd;
        row.project = path.basename(cwd);
      } else if (row.execPath) {
        row.projectDir = path.dirname(row.execPath);
      }
    })
  );

  // Sort by port ascending by default.
  rows.sort((a, b) => a.port - b.port);

  return { rows, updatedAt: Date.now() };
}

module.exports = {
  collect,
  findProject,
  PLATFORM,
};
