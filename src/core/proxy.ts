import http from 'http';
import net from 'net';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import type { RequestHandler } from 'http-proxy-middleware';
import { WebSocketServer, WebSocket } from 'ws';
import { injectScriptContent } from '../client/inject.js';
import type { ProxyOptions, ProxyResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function startProxy({ proxyPort, targetPort, getLastError }: ProxyOptions): ProxyResult {
  let currentTargetPort = targetPort;
  let isClosing = false;

  // Create proxy middleware with dynamic target routing and response interception
  const proxyMiddleware: RequestHandler = createProxyMiddleware({
    target: `http://127.0.0.1:${currentTargetPort}`,
    changeOrigin: false,

    // Dynamically route to the current target port (supports hot port changes)
    router: () => `http://127.0.0.1:${currentTargetPort}`,

    // We handle the response ourselves so we can inject the reload script into HTML
    selfHandleResponse: true,

    // Subscribe to httpxy events
    on: {
      // Force backend to send uncompressed responses so we can modify HTML
      proxyReq: (proxyReq) => {
        proxyReq.removeHeader('accept-encoding');
      },

      // Intercept HTML responses and inject the live reload script
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        const contentType = proxyRes.headers['content-type'] || '';

        // Only modify HTML responses
        if (!contentType.includes('text/html')) {
          return responseBuffer;
        }

        let body = responseBuffer.toString('utf8');

        // Inject script right before </body> or at the end if no </body>
        const commentTag = `\n<!-- Inject by liverun -->\n`;
        const injectTag = `\n<script id="liverun-script">\n${injectScriptContent}\n</script>\n`;

        if (body.includes('</body>')) {
          body = body.replace('</body>', `${commentTag}${injectTag}</body>`);
        } else {
          body += injectTag;
        }

        return body;
      }),

      // Handle proxy errors without crashing
      error: (err: NodeJS.ErrnoException, req, resOrSocket) => {
        // Don't process errors during shutdown
        if (isClosing) return;

        // Do not log expected network errors since they happen naturally during restart
        if (!['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(err.code || '')) {
          logger.error(`Proxy error: ${err.message}`);
        }

        const res = resOrSocket as http.ServerResponse;

        // If it is an HTTP response (res) and headers haven't been sent
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          try {
            // Get the latest error and remove ANSI color codes
            const errorOutput = getLastError
              ? getLastError().replace(/\x1b\[[0-9;]*m/g, '')
              : '';

            // Extract only the error title (e.g. "ReferenceError: x is not defined")
            let errorTitle = err.message;
            if (errorOutput) {
              const match = errorOutput.match(/^[a-zA-Z]*Error:.*$/m);
              if (match) {
                errorTitle = match[0];
              } else {
                // Fallback to first line if it's an unknown error format
                const firstLine = errorOutput.split('\n').find((l: string) => l.trim().length > 0);
                if (firstLine) errorTitle = firstLine;
              }
            } else if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(err.code || '')) {
              errorTitle = `Server disconnected (${err.code})`;
            }

            let errorHtmlBlock = '';
            if (errorOutput) {
              errorHtmlBlock = `
                <div class="error-log">
                  <pre><code>${errorOutput.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
                </div>
              `;
            }

            const html = `
              <!DOCTYPE html>
              <html>
              <head>
                <title>Server Error</title>
                <style>
                  body { font-family: system-ui, sans-serif; padding: 2rem; background: #fee2e2; color: #991b1b; }
                  .container { background: #fca5a5; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; margin: 0 auto; border: 1px solid #ef4444; }
                  .error-log { background: #1f2937; color: #f87171; padding: 1rem; border-radius: 4px; overflow-x: auto; margin-top: 1rem; }
                  pre { margin: 0; white-space: pre-wrap; font-family: monospace; }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>Server is unavailable</h1>
                  <h2>${errorTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h2>
                  <p>More details below:</p>
                  ${errorHtmlBlock}
                  <p style="margin-top: 1rem;"><em>This page will automatically reload when the server recovers.</em></p>
                </div>
                <script id="liverun-script">${injectScriptContent}</script>
              </body>
              </html>
            `;
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(html);
          } catch (writeErr) {
            // Response may have already been partially sent, safely ignore
            try { res.end(); } catch (e) {}
          }
        }
        // If it is a WebSocket (socket)
        else if (resOrSocket && typeof (resOrSocket as any).destroy === 'function') {
          try { (resOrSocket as any).destroy(); } catch (e) {}
        }
      },
    },
  });

  const server = http.createServer((req, res) => {
    proxyMiddleware(req, res, (err?: unknown) => {
      // Fallback if proxy middleware calls next() with an error
      if (err && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
      }
    });
  });

  // Handle WebSocket upgrades for the app's own WebSocket connections
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/_live_dev_ws') return; // handled by our WSS below
    try {
      proxyMiddleware.upgrade!(req, socket as net.Socket, head);
    } catch (e) {
      // WebSocket upgrade failed — destroy the socket safely
      try { socket.destroy(); } catch (destroyErr) {}
    }
  });

  // Handle proxy server errors (e.g. EADDRINUSE, EACCES)
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Proxy port ${proxyPort} is already in use. Cannot start liverun.`);
      process.exit(1);
    } else if (err.code === 'EACCES') {
      logger.error(`Permission denied: cannot bind to port ${proxyPort}. Try using a port above 1024.`);
      process.exit(1);
    } else {
      logger.error(`Proxy server error: ${err.message}`);
    }
  });

  // Handle unexpected socket errors to prevent crashing the proxy
  server.on('clientError', (_err: Error, socket: any) => {
    if (socket.writable) {
      try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) {}
    }
  });

  server.listen(proxyPort, () => {
    logger.system(`-> port: ${proxyPort}`);
    console.log(`\x1b[35m[liverun] -> Local: http://localhost:${proxyPort}\x1b[0m`);
    console.log(' ');
  });

  // Setup WebSocket Server for auto-refresh
  const wss = new WebSocketServer({ server, path: '/_live_dev_ws' });

  wss.on('error', (err) => {
    logger.error(`WebSocket server error: ${err.message}`);
  });

  const broadcastReload = () => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify({ type: 'RELOAD' }));
        } catch (e) {
          // Client might have disconnected between readyState check and send
        }
      }
    });
  };

  const closeProxy = () => {
    if (isClosing) return;
    isClosing = true;

    try { wss.close(); } catch (e) {}
    try { server.close(); } catch (e) {}
  };

  // Allow updating the target port dynamically
  const updateTargetPort = (newPort: number) => {
    currentTargetPort = newPort;
    logger.info(`Proxy target updated to port ${newPort}`);
  };

  return { broadcastReload, closeProxy, updateTargetPort };
}
