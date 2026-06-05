# nodekill

> A beautiful terminal GUI to inspect listening ports, see **which project** owns each one, **kill** processes, and **monitor your system** in real time.

`nodekill` gives you a real-software-feeling dashboard right in your terminal — no Electron, no browser. It scans every listening port, maps it to the owning process **and the project directory it's running from**, and lets you kill a stuck dev server with a single keystroke. A live panel on the side shows CPU, memory, network, load, uptime and battery.

It works on **Windows, macOS and Linux**.

```
┌ nodekill v1.0.0   12 ports   sort:Port   view:listening ───────── myhost · windows  20:14:31 ┐
│ Listening Ports ───────────────────────────────────┐ CPU 23% ───────────────────────────┐
│ Port    PID     Process       Project      CPU  Mem │     ╭╮     ╭─╮                       │
│ 3000    18244   node          my-next-app  1%   2%  │   ╭─╯╰─────╯ ╰──╮                    │
│ 5173    9921    node          vite-shop    0%   1%  │ ──╯              ╰───                │
│ 5432    3120    postgres      —            0%   3%  ├ Memory 41% ─────────────────────────┤
│ 8080    7765    java          api-gateway  4%   8%  │ ████████████████░░░░░░░░░░░░░░░░░░░░ │
│ ...                                                 ├ System ─────────────────────────────┤
├ Details ────────────────────────────────────────────│ Host: myhost   Cores: 16            │
│ node  PID 18244  port 3000 tcp/LISTEN                │ Mem: 6.5 GB / 16 GB                 │
│ Project: my-next-app                                 │ Net: ↓1.2 MB/s ↑320 KB/s            │
│ Location: C:\dev\my-next-app                         │ Up: 2d 4h 11m                       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
  Enter/k kill  K force  f filter  s sort  a all/listen  o open dir  r refresh  ? help  q quit
```

## Install

```bash
npm install -g nodekill
```

Then run:

```bash
nodekill      # launch the dashboard
nk            # short alias
```

Or use it without installing:

```bash
npx nodekill
```

## Features

- **Port → Process → Project mapping.** See not just `PID 18244`, but `node → my-next-app` and the full path `C:\dev\my-next-app`. nodekill resolves the project by reading the process working directory and command line and walking up to the nearest `package.json`.
- **One-keystroke kill.** Select a row and press `Enter` (graceful) or `Shift+K` (force). Cross-platform: `taskkill /T` on Windows, `SIGTERM`/`SIGKILL` on Unix. Killing a process tree also stops its children.
- **Live system monitor.** CPU history chart, memory gauge, network throughput, load average, process count, uptime and battery — refreshing every 1.5s.
- **Filter & sort.** Press `f` to filter by port, PID, process name or project; press `s` to cycle the sort column.
- **Open the project.** Press `o` to open the owning project's folder in your OS file manager.
- **Listening-only or everything.** Press `a` to toggle between just listening sockets and all connections.
- **Mouse support.** Click rows, scroll the detail panel.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `↑` `↓` / `j` `k` | Move selection |
| `Enter` / `k` | Kill selected process (graceful) |
| `Shift+K` | Force kill (SIGKILL / `taskkill /F`) |
| `f` or `/` | Filter |
| `s` | Cycle sort column |
| `a` | Toggle listening-only / all connections |
| `o` | Open project directory |
| `r` | Rescan now |
| `?` / `h` | Help overlay |
| `q` / `Esc` / `Ctrl+C` | Quit |

## Command line (no GUI)

`nodekill` also works headless for scripts and quick one-offs:

```bash
nodekill ls               # print a table of listening ports and exit
nodekill kill 3000        # kill whatever is listening on port 3000
nodekill kill 3000 -f     # force kill
nodekill kill 18244       # numbers that aren't a listening port are treated as PIDs
nodekill --help
```

## How project detection works

For each listening port nodekill finds the owning PID, then tries — in order:

1. The process **current working directory** (`/proc/<pid>/cwd` on Linux, `lsof` on macOS).
2. The first **real filesystem path** found in the process command line (e.g. the script you ran).
3. The process **executable path**.

From that path it walks upward to the nearest `package.json` and reads its `name`. On Windows, reading another process's CWD requires elevated access, so detection there relies on the command line and executable path — which already covers the common `node script.js` / dev-server case.

## Permissions

- Listing ports needs no special privileges.
- Killing a process you don't own may require running your terminal as **Administrator** (Windows) or with `sudo` (Unix). nodekill reports a clear error when permission is denied.

## Requirements

- Node.js **>= 16**
- A terminal that supports ANSI / Unicode (Windows Terminal, iTerm2, most modern terminals)

## License

MIT
