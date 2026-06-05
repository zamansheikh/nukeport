'use strict';

/**
 * app.js — the interactive terminal dashboard.
 *
 * Layout (blessed-contrib 12x12 grid):
 *
 *   ┌──────────────────────── header ───────────────────────────┐
 *   │ ports table (rows 1-7, cols 0-8)      │ CPU line  (1-4)    │
 *   │                                       │ MEM gauge (5-7)    │
 *   ├─ detail panel (rows 8-10, cols 0-8) ──│ system    (8-10)   │
 *   └──────────────────────── footer ───────────────────────────┘
 */

const os = require('os');
const blessed = require('blessed');
const contrib = require('blessed-contrib');

const { collect } = require('./collector');
const { killPid } = require('./kill');
const { getStatic, getSnapshot } = require('./system');
const fmt = require('./format');

const HISTORY = 60; // points kept in the CPU/mem charts

const SORTS = [
  { key: 'port', label: 'Port', cmp: (a, b) => a.port - b.port },
  { key: 'pid', label: 'PID', cmp: (a, b) => a.pid - b.pid },
  { key: 'name', label: 'Process', cmp: (a, b) => String(a.name).localeCompare(String(b.name)) },
  { key: 'project', label: 'Project', cmp: (a, b) => String(a.project || '').localeCompare(String(b.project || '')) },
  { key: 'cpu', label: 'CPU', cmp: (a, b) => b.cpu - a.cpu },
  { key: 'mem', label: 'Mem', cmp: (a, b) => b.mem - a.mem },
];

async function launch() {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'nukeport',
    autoPadding: true,
    dockBorders: true,
  });

  const grid = new contrib.grid({ rows: 12, cols: 12, screen });

  // ---- State -------------------------------------------------------------
  const state = {
    rows: [],
    filter: '',
    onlyListening: true,
    sortIndex: 0,
    cpuHist: [],
    memHist: [],
    selectedKey: null,
    loading: true,
    lastError: null,
    staticInfo: null,
  };

  // ---- Header ------------------------------------------------------------
  const header = grid.set(0, 0, 1, 12, blessed.box, {
    tags: true,
    style: { fg: 'white', bg: 'black' },
  });

  // ---- Ports table -------------------------------------------------------
  const table = grid.set(1, 0, 7, 8, contrib.table, {
    keys: true,
    mouse: true,
    interactive: true,
    label: ' Listening Ports ',
    border: { type: 'line' },
    columnSpacing: 2,
    columnWidth: [7, 8, 16, 20, 7, 6, 18],
    fg: 'white',
    selectedFg: 'black',
    selectedBg: 'cyan',
    style: { border: { fg: 'cyan' }, header: { fg: 'brightcyan', bold: true } },
  });

  // ---- Detail panel ------------------------------------------------------
  const detail = grid.set(8, 0, 3, 8, blessed.box, {
    label: ' Details ',
    tags: true,
    scrollable: true,
    border: { type: 'line' },
    padding: { left: 1, right: 1 },
    style: { border: { fg: 'gray' }, fg: 'white' },
  });

  // ---- CPU line chart ----------------------------------------------------
  const cpuLine = grid.set(1, 8, 4, 4, contrib.line, {
    label: ' CPU % ',
    showLegend: false,
    wholeNumbersOnly: true,
    minY: 0,
    maxY: 100,
    border: { type: 'line' },
    // NOTE: the braille canvas only maps the 8 base color *names*
    // (black/red/green/yellow/blue/magenta/cyan/white). Any other name —
    // e.g. 'gray' — becomes "\x1b[3undefinedm", a malformed escape that
    // corrupts the whole chart. Use RGB arrays (resolved via x256) instead.
    style: { border: { fg: 'green' }, line: [0, 200, 80], text: [120, 200, 140], baseline: [90, 90, 90] },
  });

  // ---- Memory gauge ------------------------------------------------------
  const memGauge = grid.set(5, 8, 3, 4, contrib.gauge, {
    label: ' Memory ',
    stroke: 'magenta',
    fill: 'white',
    border: { type: 'line' },
    style: { border: { fg: 'magenta' } },
  });

  // ---- System info box ---------------------------------------------------
  const sysInfo = grid.set(8, 8, 3, 4, blessed.box, {
    label: ' System ',
    tags: true,
    border: { type: 'line' },
    padding: { left: 1, right: 1 },
    style: { border: { fg: 'yellow' }, fg: 'white' },
  });

  // ---- Footer ------------------------------------------------------------
  const footer = grid.set(11, 0, 1, 12, blessed.box, {
    tags: true,
    style: { fg: 'white', bg: 'black' },
  });

  // ---- Toast / status line ----------------------------------------------
  const toast = blessed.message({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '50%',
    height: 'shrink',
    align: 'center',
    valign: 'middle',
    border: { type: 'line' },
    tags: true,
    hidden: true,
    style: { border: { fg: 'green' }, fg: 'white' },
  });

  function notify(msg, kind = 'info', ms = 2200) {
    const color = kind === 'error' ? 'red' : kind === 'warn' ? 'yellow' : 'green';
    toast.style.border.fg = color;
    toast.display('{' + color + '-fg}' + msg + '{/}', Math.ceil(ms / 1000), () => {});
    screen.render();
  }

  // ---- Helpers -----------------------------------------------------------
  function rowKey(r) {
    return r.pid + ':' + r.port + ':' + r.proto;
  }

  function visibleRows() {
    let rows = state.rows.slice();
    const f = state.filter.trim().toLowerCase();
    if (f) {
      rows = rows.filter((r) =>
        [r.port, r.pid, r.name, r.project, r.address, r.projectDir, r.command]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(f)
      );
    }
    rows.sort(SORTS[state.sortIndex].cmp);
    return rows;
  }

  function currentSelection() {
    const rows = visibleRows();
    if (!rows.length) return null;
    let idx = table.rows.selected || 0;
    if (idx >= rows.length) idx = rows.length - 1;
    return rows[idx];
  }

  function renderTable() {
    const rows = visibleRows();
    const data = rows.map((r) => [
      String(r.port || '—'),
      String(r.pid || '—'),
      fmt.truncate(r.name, 15),
      fmt.truncate(r.project || '—', 19),
      r.cpu ? r.cpu.toFixed(0) + '%' : '·',
      r.mem ? r.mem.toFixed(0) + '%' : '·',
      fmt.truncate(r.address || '', 17),
    ]);

    table.setData({
      headers: ['Port', 'PID', 'Process', 'Project', 'CPU', 'Mem', 'Address'],
      data: data.length ? data : [['—', '—', state.loading ? 'scanning…' : 'no ports', '', '', '', '']],
    });

    // Restore selection by key if possible.
    if (state.selectedKey) {
      const i = rows.findIndex((r) => rowKey(r) === state.selectedKey);
      if (i >= 0) table.rows.select(i);
    }
    renderDetail();
  }

  function renderDetail() {
    const r = currentSelection();
    if (!r) {
      detail.setContent('{gray-fg}Select a port to see details.{/}');
      return;
    }
    state.selectedKey = rowKey(r);
    const lines = [
      '{bold}{cyan-fg}' + (r.name || 'process') + '{/}  {gray-fg}PID{/} {bold}' + r.pid + '{/}   {gray-fg}port{/} {green-fg}' + r.port + '{/} {gray-fg}' + r.proto + '/' + (r.state || '') + '{/}',
      '{gray-fg}Project:{/}  ' + (r.project ? '{yellow-fg}' + r.project + '{/}' : '{gray-fg}unknown{/}'),
      '{gray-fg}Location:{/} ' + (r.projectDir || r.cwd || '{gray-fg}—{/}'),
      '{gray-fg}Address:{/}  ' + (r.address || '—') + '    {gray-fg}User:{/} ' + (r.user || '—'),
      '{gray-fg}Command:{/}  ' + fmt.truncate(r.command || r.execPath || '—', 120),
    ];
    detail.setContent(lines.join('\n'));
  }

  function renderHeader() {
    const s = state.staticInfo || {};
    const listening = state.rows.length;
    const sortLabel = SORTS[state.sortIndex].label;
    const filterTxt = state.filter ? '  {yellow-fg}filter:{/}{black-fg}{yellow-bg} ' + fmt.truncate(state.filter, 20) + ' {/}' : '';
    const left =
      ' {green-fg}{bold}◤ nukeport{/} {gray-fg}v' + require('../package.json').version + '{/}' +
      '   {cyan-fg}' + listening + '{/} {gray-fg}ports{/}' +
      '   {gray-fg}sort:{/}{white-fg}' + sortLabel + '{/}' +
      '   {gray-fg}view:{/}{white-fg}' + (state.onlyListening ? 'listening' : 'all') + '{/}' +
      filterTxt;
    const right = '{gray-fg}' + (s.hostname || os.hostname()) + ' · ' + (s.distro || process.platform) + '{/} {bold}' + fmt.clock() + '{/} ';
    const width = screen.width || 80;
    const plainLeftLen = left.replace(/\{[^}]+\}/g, '').length;
    const plainRightLen = right.replace(/\{[^}]+\}/g, '').length;
    const gap = Math.max(1, width - plainLeftLen - plainRightLen);
    header.setContent(left + ' '.repeat(gap) + right);
  }

  function renderFooter() {
    const keys = [
      ['↑↓/jk', 'move'],
      ['Enter/k', 'kill'],
      ['K', 'force-kill'],
      ['f', 'filter'],
      ['s', 'sort'],
      ['a', 'all/listen'],
      ['o', 'open dir'],
      ['r', 'refresh'],
      ['?', 'help'],
      ['q', 'quit'],
    ];
    const parts = keys.map((k) => '{black-fg}{cyan-bg} ' + k[0] + ' {/}{cyan-fg}{black-bg}' + k[1] + '{/}');
    footer.setContent(' ' + parts.join(' '));
  }

  function renderSystem(snap) {
    const s = state.staticInfo || {};
    const load = (snap.load && snap.load[0] != null) ? snap.load.map((n) => n.toFixed(2)).join(' ') : '—';
    const batt = snap.battery
      ? snap.battery.percent + '% ' + (snap.battery.charging ? '{green-fg}⚡{/}' : snap.battery.acConnected ? '🔌' : '🔋')
      : '{gray-fg}—{/}';
    const lines = [
      '{gray-fg}Host:{/} ' + fmt.truncate(s.hostname || os.hostname(), 18),
      '{gray-fg}OS:{/}   ' + fmt.truncate((s.distro || process.platform) + ' ' + (s.arch || ''), 18),
      '{gray-fg}CPU:{/}  ' + fmt.truncate(s.cpuBrand || 'cpu', 18),
      '{gray-fg}Cores:{/}' + (s.cores || os.cpus().length) + '   {gray-fg}Load:{/} ' + load,
      '{gray-fg}Mem:{/}  ' + fmt.bytes(snap.memUsed) + ' / ' + fmt.bytes(snap.memTotal),
      '{gray-fg}Swap:{/} ' + (snap.swapTotal ? fmt.bytes(snap.swapUsed) + ' / ' + fmt.bytes(snap.swapTotal) : '—'),
      '{gray-fg}Net:{/}  {green-fg}↓{/}' + fmt.rate(snap.netRx) + ' {magenta-fg}↑{/}' + fmt.rate(snap.netTx),
      '{gray-fg}Procs:{/}' + (snap.processes || '—') + '   {gray-fg}Bat:{/} ' + batt,
      '{gray-fg}Up:{/}   ' + fmt.duration(snap.uptime),
    ];
    sysInfo.setContent(lines.join('\n'));
  }

  function renderCharts(snap) {
    state.cpuHist.push(Math.round(snap.cpu));
    if (state.cpuHist.length > HISTORY) state.cpuHist.shift();

    const x = state.cpuHist.map((_, i) => String(i));
    // RGB arrays only — see the canvas-color note on the cpuLine definition.
    const lineColor = snap.cpu > 85 ? [220, 60, 60] : snap.cpu > 60 ? [220, 200, 60] : [0, 200, 80];
    cpuLine.setLabel(' CPU ' + fmt.pct(snap.cpu) + ' ');
    cpuLine.setData([{ title: 'cpu', x, y: state.cpuHist, style: { line: lineColor } }]);

    const memPct = snap.memTotal ? (snap.memUsed / snap.memTotal) * 100 : 0;
    memGauge.setLabel(' Memory ' + fmt.pct(memPct) + ' ');
    memGauge.setStack([
      { percent: Math.round(memPct), stroke: memPct > 85 ? 'red' : memPct > 60 ? 'yellow' : 'magenta' },
      { percent: Math.max(0, 100 - Math.round(memPct)), stroke: 'black' },
    ]);
  }

  // ---- Data loops --------------------------------------------------------
  let portTimer = null;
  let sysTimer = null;
  let refreshing = false;

  async function refreshPorts(manual) {
    if (refreshing) return;
    refreshing = true;
    try {
      const { rows } = await collect({ onlyListening: state.onlyListening });
      state.rows = rows;
      state.loading = false;
      state.lastError = null;
      renderTable();
      renderHeader();
      if (manual) notify('Refreshed — ' + rows.length + ' port(s)', 'info', 1200);
    } catch (e) {
      state.lastError = e.message;
      notify('Scan failed: ' + e.message, 'error', 3000);
    } finally {
      refreshing = false;
      screen.render();
    }
  }

  async function refreshSystem() {
    try {
      const snap = await getSnapshot();
      renderCharts(snap);
      renderSystem(snap);
      renderHeader();
      screen.render();
    } catch (_) {}
  }

  // ---- Kill flow ---------------------------------------------------------
  function confirmKill(force) {
    const r = currentSelection();
    if (!r) {
      notify('No port selected.', 'warn', 1500);
      return;
    }
    if (!r.pid) {
      notify('No PID associated with this entry.', 'warn', 1800);
      return;
    }

    const box = blessed.question({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 'shrink',
      border: { type: 'line' },
      tags: true,
      keys: true,
      mouse: true,
      style: { border: { fg: force ? 'red' : 'yellow' }, fg: 'white' },
    });

    const verb = force ? '{red-fg}{bold}FORCE KILL{/}' : '{yellow-fg}{bold}Kill{/}';
    const msg =
      verb + ' {cyan-fg}' + (r.name || 'process') + '{/} (PID {bold}' + r.pid + '{/}) on port {green-fg}' + r.port + '{/}?\n' +
      (r.project ? '{gray-fg}project: ' + r.project + '{/}\n' : '') +
      '{gray-fg}' + fmt.truncate(r.projectDir || r.command || '', 70) + '{/}\n' +
      '{gray-fg}(y = yes,  n / Esc = cancel){/}';

    box.ask(msg, async (err, confirmed) => {
      screen.render();
      if (err || !confirmed) {
        table.focus();
        return;
      }
      const res = await killPid(r.pid, force);
      if (res.ok) {
        notify('✓ ' + res.message, 'info', 2000);
        // Remove from view immediately, then re-scan shortly.
        state.rows = state.rows.filter((x) => x.pid !== r.pid);
        renderTable();
        setTimeout(() => refreshPorts(false), 600);
      } else {
        notify('✗ ' + res.message, 'error', 3500);
      }
      table.focus();
      screen.render();
    });
  }

  // ---- Filter input ------------------------------------------------------
  function openFilter() {
    const input = blessed.textbox({
      parent: screen,
      bottom: 3,
      left: 0,
      width: '65%',
      height: 3,
      label: ' Filter (Enter=apply, Esc=clear) ',
      border: { type: 'line' },
      inputOnFocus: true,
      style: { border: { fg: 'yellow' }, fg: 'white' },
    });
    input.setValue(state.filter);
    input.focus();
    screen.render();

    const finish = (apply) => {
      if (apply) state.filter = input.getValue().trim();
      else state.filter = '';
      input.destroy();
      renderTable();
      renderHeader();
      table.focus();
      screen.render();
    };
    input.on('submit', () => finish(true));
    input.on('cancel', () => finish(false));
    input.key(['escape'], () => finish(false));
  }

  // ---- Help overlay ------------------------------------------------------
  let helpBox = null;
  function toggleHelp() {
    if (helpBox) {
      helpBox.destroy();
      helpBox = null;
      table.focus();
      screen.render();
      return;
    }
    helpBox = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 'shrink',
      label: ' nukeport — help ',
      tags: true,
      border: { type: 'line' },
      padding: 1,
      style: { border: { fg: 'cyan' }, fg: 'white' },
      content: [
        '{bold}{cyan-fg}Navigation{/}',
        '  ↑ ↓ / j k      move selection',
        '  PgUp / PgDn    jump',
        '',
        '{bold}{cyan-fg}Actions{/}',
        '  Enter / k      kill selected process (graceful)',
        '  K              force kill (SIGKILL / taskkill /F)',
        '  o              open project directory in file manager',
        '  c              copy project path to detail (then mouse-select)',
        '  r              rescan ports now',
        '  a              toggle listening-only / all connections',
        '  f  or  /       filter by port, pid, name or project',
        '  s              cycle sort column',
        '',
        '{bold}{cyan-fg}General{/}',
        '  ? / h          toggle this help',
        '  q / Esc / ^C   quit',
        '',
        '{gray-fg}Press any key to close…{/}',
      ].join('\n'),
    });
    helpBox.focus();
    helpBox.key(['escape', 'enter', 'space', 'q', '?', 'h'], () => toggleHelp());
    screen.render();
  }

  // ---- Open project directory -------------------------------------------
  function openDir() {
    const r = currentSelection();
    if (!r || !r.projectDir) {
      notify('No directory known for this entry.', 'warn', 1800);
      return;
    }
    const { exec } = require('child_process');
    const dir = r.projectDir;
    let cmd;
    if (process.platform === 'win32') cmd = 'explorer "' + dir + '"';
    else if (process.platform === 'darwin') cmd = 'open "' + dir + '"';
    else cmd = 'xdg-open "' + dir + '"';
    exec(cmd, () => {});
    notify('Opened ' + fmt.truncate(dir, 40), 'info', 1800);
  }

  // ---- Key bindings ------------------------------------------------------
  function bindKeys() {
    screen.key(['q', 'C-c'], () => shutdown());
    screen.key(['escape'], () => {
      if (helpBox) return toggleHelp();
      if (state.filter) {
        state.filter = '';
        renderTable();
        renderHeader();
        screen.render();
        return;
      }
      shutdown();
    });
    screen.key(['r'], () => refreshPorts(true));
    screen.key(['f', '/'], () => openFilter());
    screen.key(['?', 'h', 'S-h'], () => toggleHelp());
    screen.key(['o'], () => openDir());
    screen.key(['a'], () => {
      state.onlyListening = !state.onlyListening;
      notify('View: ' + (state.onlyListening ? 'listening only' : 'all connections'), 'info', 1400);
      refreshPorts(false);
    });
    screen.key(['s'], () => {
      state.sortIndex = (state.sortIndex + 1) % SORTS.length;
      renderTable();
      renderHeader();
      screen.render();
    });
    // Kill: Enter or lowercase k = graceful, uppercase K = force.
    screen.key(['k', 'enter'], () => confirmKill(false));
    screen.key(['S-k'], () => confirmKill(true));

    // Keep detail panel in sync as the selection moves.
    table.rows.on('select item', () => {
      renderDetail();
      screen.render();
    });
    table.rows.key(['up', 'down', 'k', 'j'], () => {
      setImmediate(() => {
        renderDetail();
        screen.render();
      });
    });
  }

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (portTimer) clearInterval(portTimer);
    if (sysTimer) clearInterval(sysTimer);
    screen.destroy();
    process.stdout.write('\x1b[0m');
    process.exit(0);
  }

  // ---- Boot --------------------------------------------------------------
  renderHeader();
  renderFooter();
  renderDetail();
  table.setData({ headers: ['Port', 'PID', 'Process', 'Project', 'CPU', 'Mem', 'Address'], data: [['—', '—', 'scanning…', '', '', '', '']] });
  bindKeys();
  table.focus();
  screen.render();

  // Load static info, then start loops.
  getStatic().then((s) => {
    state.staticInfo = s;
    renderHeader();
    screen.render();
  });

  await refreshPorts(false);
  await refreshSystem();

  portTimer = setInterval(() => refreshPorts(false), 4000);
  sysTimer = setInterval(() => refreshSystem(), 1500);

  // Redraw header clock every second even between system ticks.
  setInterval(() => {
    renderHeader();
    screen.render();
  }, 1000);

  screen.render();
}

module.exports = { launch };
