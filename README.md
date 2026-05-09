<p align="center">
  <a href="https://nordinalex.github.io/liverun"><img src="https://raw.githubusercontent.com/NordinAlex/liverun/refs/heads/main/website/images/logo-full.png" alt="liverun Logo"></a>
</p>

# liverun 🚀

**LIVE CODE. RUN INSTANTLY.**

[![npm version](https://badge.fury.io/js/liverun.svg)](https://badge.fury.io/js/liverun)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A **zero-configuration** hot reloading tool designed to supercharge your Express.js and Node.js development.

Get the blazing-fast, modern developer experience of frameworks like Next.js or Vite, without the added complexity. `liverun` seamlessly restarts your server when backend files change and instantly refreshes your browser when frontend assets are modified—keeping you perfectly in the flow.

## Features ✨

- **Zero Configuration:** No need to modify your Express app or add custom middleware.
- **Backend Hot Restart:** Automatically restarts your Node process when server-side files (e.g., `.js`, `.ts`) change.
- **Frontend Auto-Refresh:** Instantly reloads the browser when client-side assets (e.g., HTML, CSS, client-side JS) change.
- **Seamless Injection:** Uses a lightweight reverse proxy to dynamically inject the live-reload script into HTML responses.

## Installation 📦

Install the package as a dev dependency in your project:

```bash
npm install --save-dev liverun
```

## Usage 💻

Simply replace `node` with `liverun` when starting your server script:

```bash
npx liverun server.js
```

### In your `package.json`

The best way to use it is to add it as your `dev` script in `package.json`:

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "liverun server.js"
  }
}
```

Then run:

```bash
npm run dev
```

## How it works ⚙️

When you run `liverun`, it wraps your application:

1. It spins up a **Proxy Server** on port `3000` (by default).
2. It spawns your actual Express app on an internal port (e.g., `3001`).
3. As traffic flows through the proxy, it watches for HTML responses and injects a tiny WebSocket client script right before the `</body>` tag.
4. When `chokidar` detects frontend changes, it broadcasts a signal over WebSockets to refresh the browser. When backend files change, it safely restarts the child Node process.

## CLI Options 🛠️

You can customize the ports and the directories that are being watched:

```bash
Usage: liverun [options] <script>

Arguments:
  script                            The express server script to run (e.g. server.js)

Options:
  -V, --version                     output the version number
  -p, --port <number>               Port for the live-dev proxy to listen on (default: "3000")
  -s, --watch-server <directories>  Comma separated directories to watch for server restart (default: ".,src,routes,models,controllers")
  -c, --watch-client <directories>  Comma separated directories to watch for client refresh (default: "public,views")
  -h, --help                        display help for command
```

### Example: Custom Watch Directories

If your backend is in `api/` and frontend is in `static/`:

```bash
npx liverun -s api,config -c static,templates server.js
```

## License 📄

MIT License. See [LICENSE](LICENSE) for details.
