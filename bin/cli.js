#!/usr/bin/env node
'use strict';

/**
 * nukeport CLI entry point.
 *
 * Usage:
 *   nukeport            Launch the interactive terminal GUI dashboard.
 *   nukeport ls         Print listening ports as a plain table and exit.
 *   nukeport kill <p>   Kill whatever process owns port <p> (no GUI).
 *   nukeport --help     Show help.
 *   nukeport --version  Show version.
 */

const args = process.argv.slice(2);
const pkg = require('../package.json');

function out(s) {
  process.stdout.write(s + '\n');
}

function showHelp() {
  out('');
  out('  \x1b[1m\x1b[32mnukeport\x1b[0m \x1b[2mv' + pkg.version + '\x1b[0m');
  out('  ' + pkg.description);
  out('');
  out('  \x1b[1mUSAGE\x1b[0m');
  out('    nukeport            Launch the interactive terminal dashboard');
  out('    nukeport ls         List listening ports as plain text and exit');
  out('    nukeport kill <p>   Kill the process listening on port <p>');
  out('    nukeport --help     Show this help');
  out('    nukeport --version  Print version');
  out('');
  out('  \x1b[1mDASHBOARD KEYS\x1b[0m');
  out('    ↑/↓ or j/k   Move selection      Enter / k   Kill selected');
  out('    Tab           Switch panel        f / /       Filter ports');
  out('    r             Refresh now         a           Toggle all/listening');
  out('    c             Copy path           s           Sort column');
  out('    ? or h        Help overlay        q / Esc     Quit');
  out('');
}

(async function main() {
  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    showHelp();
    return;
  }
  if (args.includes('--version') || args.includes('-v') || args[0] === 'version') {
    out(pkg.version);
    return;
  }

  const cmd = args[0];

  // Headless: list ports and exit.
  if (cmd === 'ls' || cmd === 'list') {
    const { printPortsTable } = require('../src/headless');
    await printPortsTable();
    return;
  }

  // Headless: kill by port.
  if (cmd === 'kill' || cmd === 'k') {
    const target = args[1];
    if (!target) {
      out('\x1b[31m✗\x1b[0m Usage: nukeport kill <port|pid>');
      process.exit(1);
    }
    const { killByPortOrPid } = require('../src/headless');
    const ok = await killByPortOrPid(target, args.includes('--force') || args.includes('-f'));
    process.exit(ok ? 0 : 1);
  }

  // Default: launch the GUI.
  try {
    const { launch } = require('../src/app');
    await launch();
  } catch (err) {
    process.stderr.write('\x1b[31mnukeport failed to start:\x1b[0m ' + (err && err.stack || err) + '\n');
    process.exit(1);
  }
})();
