# Architecture

`liverun` is built using a modular TypeScript architecture to ensure separation of concerns, testability, and ease of contributions.

## Project Structure

The source code is located in the `src/` directory and is organized as follows:

```
src/
├── cli/
│   └── index.ts          # Entry point – parses CLI args, orchestrates core modules
├── core/
│   ├── proxy.ts          # HTTP reverse proxy + WebSocket server + error overlay
│   ├── runner.ts         # Child process manager (spawn, restart, port hook, kill)
│   └── watcher.ts        # File system watcher (chokidar) for server + client dirs
├── client/
│   └── inject.ts         # Browser-side WebSocket script (exported as string)
├── types/
│   └── index.ts          # Shared TypeScript interfaces for all modules
└── utils/
    └── logger.ts         # Colour-coded terminal logging
```

### Module Descriptions

*   **`cli/index.ts`** — Entry point. Uses `commander` to parse arguments (`--port`, `--watch-server`, `--watch-client`). Detects the port from the user's source code, handles port conflicts with an interactive prompt, and wires the three core modules together. Manages graceful shutdown on `SIGINT`/`SIGTERM`.

*   **`core/proxy.ts`** — Creates an HTTP server using `http-proxy-middleware` (v4) as a reverse proxy. Intercepts HTML responses with `responseInterceptor` to inject the live-reload WebSocket client before `</body>`. Serves a styled error overlay page when the backend is unreachable. Manages a `WebSocketServer` on the `/_live_dev_ws` path for browser reload signals. Supports dynamic port re-targeting (hot port changes).

*   **`core/runner.ts`** — Spawns the user's script as a child process with a `--require` preload hook. The preload hook intercepts `net.Server.prototype.listen()` to redirect the app to an internal port, regardless of what port is hardcoded. Communicates port information back to the parent via IPC messages. Implements graceful restart with SIGTERM → SIGKILL escalation on a 5-second timeout. Collects stderr output for the error overlay.

*   **`core/watcher.ts`** — Wraps `chokidar` to watch two sets of directories independently. Server-side file changes (`.js`, `.ts`, `.json`) trigger `onServerChange`. Client-side changes trigger `onClientChange`. Both callbacks are debounced (200ms) in the CLI layer.

*   **`client/inject.ts`** — A self-executing IIFE (exported as a string constant) that opens a WebSocket to `/_live_dev_ws`. On receiving a `RELOAD` message, it calls `window.location.reload()`. Implements reconnection with exponential backoff (max 10s). Automatically reloads the page on reconnect (covers server restarts).

*   **`types/index.ts`** — Central type definitions for `ProxyOptions`, `ProxyResult`, `RunnerOptions`, `RunnerResult`, `WatcherOptions`, `WatcherResult`, `CliOptions`, and `Logger`.

*   **`utils/logger.ts`** — Thin wrapper around `console.log/warn/error` with ANSI colour codes and a `[liverun]` prefix.

## How it works (The Flow)

```
           ┌──────────────────────────┐
           │  User's browser          │
           │  localhost:3000           │
           └────────┬─────────────────┘
                    │  HTTP + WS
                    ▼
           ┌──────────────────────────┐
           │  Proxy Server (proxy.ts) │
           │  port 3000               │
           │  ┌────────────────────┐  │
           │  │ WebSocket Server   │  │
           │  │ /_live_dev_ws      │  │
           │  └────────────────────┘  │
           └────────┬─────────────────┘
                    │  Proxy pass
                    ▼
           ┌──────────────────────────┐
           │  User's Express App      │
           │  (spawned by runner.ts)  │
           │  internal port 3001      │
           └──────────────────────────┘

           ┌──────────────────────────┐
           │  Watcher (watcher.ts)    │
           │  chokidar                │
           │  server dirs → restart   │
           │  client dirs → reload    │
           └──────────────────────────┘
```

1.  **Startup** — The user runs `liverun <script>`. The CLI parses the arguments and detects the port from the script's source code.
2.  **Port check** — If the detected port is in use, the user is prompted to select another.
3.  **Initialization** —
    *   The **proxy** is started on the public port (e.g., 3000). It also starts a WebSocket server on `/_live_dev_ws`.
    *   The **runner** spawns the target script with a preload hook (`--require`) that intercepts `net.Server.listen()` and redirects it to an internal port (e.g., 3001).
    *   The **watcher** starts watching the specified directories with `chokidar`.
4.  **Proxying** — Requests to `localhost:3000` are proxied to `localhost:3001`. HTML responses have the `inject.ts` script appended before `</body>`.
5.  **Live Reload (Client)** — If the watcher detects a change in client files (HTML, CSS, etc.), it tells the proxy's WebSocket server to broadcast a `RELOAD` message. The injected script in the browser receives this and calls `window.location.reload()`.
6.  **Restart (Server)** — If the watcher detects a change in server files (`.js`, `.ts`, `.json`), it tells the runner to gracefully kill and restart the target process. Events are debounced at 200ms.
7.  **Error Overlay** — If the server crashes or is unreachable, the proxy catches the connection error and serves a styled HTML error page showing the latest stderr output. The page includes the live-reload script, so it auto-reloads when the server recovers.

## Build & Test

```bash
npm run dev      # Watch mode — tsup rebuilds on source changes
npm run build    # Production build — outputs to dist/
npm test         # Run tests with Vitest
```

## CI/CD Pipeline

Pushes to `main` that touch `src/` or `package.json` trigger the GitHub Actions pipeline:

```
Build → Test → Publish (OIDC) → GitHub Release
```

Publishing uses **OIDC trusted publishing** — no long-lived npm tokens. See `.github/workflows/publish.yml` for details.
