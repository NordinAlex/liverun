# Architecture

`liverun` is built using a modular architecture to ensure separation of concerns, testability, and ease of contributions.

## Project Structure

The source code is located in the `src/` directory and is organized as follows:

*   **`cli/`**: Contains the entry point for the application. It parses command-line arguments using `commander` and orchestrates the core modules.
*   **`core/`**: The heart of the application.
    *   **`proxy.ts`**: Sets up an HTTP proxy server (using `http-proxy`) that intercepts requests to the target Express app. It intercepts HTML responses to inject the live-reload client script and serves a user-friendly error page when the target app is down.
    *   **`runner.ts`**: Manages the child process of the target Node app. It spawns the process, listens to its output, and handles restarts and crashes gracefully.
    *   **`watcher.ts`**: Uses `chokidar` to monitor the file system for changes in both the backend (server) and frontend (client) directories.
*   **`client/`**: Contains the code that is injected into the browser.
    *   **`inject.ts`**: A WebSocket client script (exported as a string to simplify bundling) that connects back to the `liverun` WebSocket server and listens for `RELOAD` commands.
*   **`utils/`**: Shared utilities across the project.
    *   **`logger.ts`**: Centralized logging logic to ensure a consistent look and feel in the terminal output.
*   **`types/`**: Shared TypeScript interfaces to ensure strong typing across the module boundaries.

## How it works (The Flow)

1.  **Startup**: The user runs `liverun <script>`. The CLI parses the arguments.
2.  **Initialization**: 
    *   The `proxy` is started on the public port (e.g., 3000). It also starts a WebSocket server.
    *   The `runner` starts the target `<script>` on an internal port (e.g., 3001).
    *   The `watcher` starts watching specified directories.
3.  **Proxying**: Requests to `localhost:3000` are proxied to `localhost:3001`. HTML responses have the `inject.ts` script appended to them automatically.
4.  **Live Reload (Client)**: If the `watcher` detects a change in client files (e.g., `.html`, `.css`), it tells the proxy's WebSocket server to broadcast a `RELOAD` message. The injected script in the browser receives this and calls `window.location.reload()`.
5.  **Restart (Server)**: If the `watcher` detects a change in server files (e.g., `.js`, `.ts`), it tells the `runner` to kill and restart the target process. When the process crashes, the proxy catches the connection error and displays a custom HTML error page using the latest terminal output from the runner.
