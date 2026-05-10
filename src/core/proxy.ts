import http from 'http';
import httpProxy from 'http-proxy';
import { WebSocketServer, WebSocket } from 'ws';
import { injectScriptContent } from '../client/inject';
import { ProxyOptions } from '../types';
import { logger } from '../utils/logger';

// Extend WebSocketServer to include our custom broadcast method
export interface WatchReloadWebSocketServer extends WebSocketServer {
  broadcastReload: () => void;
  closeProxy: () => void;
  updateTargetPort: (newPort: number) => void;
}

export function startProxy({ proxyPort, targetPort, getLastError }: ProxyOptions): WatchReloadWebSocketServer {
  let currentTargetPort = targetPort;
  let isClosing = false;

  const proxy = httpProxy.createProxyServer({
    target: `http://localhost:${currentTargetPort}`,
    ws: true,
  });

  // Force backend to send uncompressed responses so we can modify HTML
  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.removeHeader('accept-encoding');
  });

  // Handle errors to avoid crashing the proxy
  proxy.on('error', (err: any, req, resOrSocket: any) => {
    // Don't process errors during shutdown
    if (isClosing) return;

    // Do not log expected network errors since they happen naturally during restart
    if (!['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(err.code)) {
      logger.error(`Proxy error: ${err.message}`);
    }

    // If it is an HTTP response (res)
    if (resOrSocket && resOrSocket.writeHead && !resOrSocket.headersSent) {
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
            const firstLine = errorOutput.split('\n').find(l => l.trim().length > 0);
            if (firstLine) errorTitle = firstLine;
          }
        } else if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(err.code)) {
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
        resOrSocket.writeHead(500, { 'Content-Type': 'text/html' });
        resOrSocket.end(html);
      } catch (writeErr) {
        // Response may have already been partially sent, safely ignore
        try { resOrSocket.end(); } catch (e) {}
      }
    }
    // If it is a WebSocket (socket)
    else if (resOrSocket && resOrSocket.destroy) {
      try { resOrSocket.destroy(); } catch (e) {}
    }
  });

  // Inject script into HTML
  proxy.on('proxyRes', (proxyRes, req, res: any) => {
    // Only intercept HTML responses
    const contentType = proxyRes.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      const _write = res.write;
      const _end = res.end;
      const _writeHead = res.writeHead;

      let body = '';

      // We need to disable content-length since we are modifying the body
      res.writeHead = function (...args: any[]) {
        res.removeHeader('content-length');
        return _writeHead.apply(res, args);
      };

      proxyRes.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });

      // Avoid writing directly until end
      res.write = function () {
        return true;
      };

      res.end = function (chunk?: any, encoding?: any, cb?: any) {
        try {
          if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
            body += chunk.toString('utf8');
          }

          // Inject script right before </body> or at the end if no </body>
          const commentTag = `\n<!-- Inject by liverun -->\n`;
          const injectTag = `\n<script id="liverun-script">\n${injectScriptContent}\n</script>\n`;

          if (body.includes('</body>')) {
            body = body.replace('</body>', `${commentTag}${injectTag}</body>`);
          } else {
            body += injectTag;
          }

          _write.call(res, body);
          _end.call(res, cb);
        } catch (e) {
          // If writing fails (e.g. connection reset), try to end gracefully
          try { _end.call(res); } catch (endErr) {}
        }
      };
    }
  });

  const server = http.createServer((req, res) => {
    // Dynamically route to the current target port
    proxy.web(req, res, { target: `http://localhost:${currentTargetPort}` });
  });

  // Handle proxy server errors (e.g. EADDRINUSE, EACCES)
  server.on('error', (err: any) => {
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

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/_live_dev_ws') return; // handled by WS server below
    try {
      proxy.ws(req, socket as any, head, { target: `http://localhost:${currentTargetPort}` });
    } catch (e) {
      // WebSocket upgrade failed — destroy the socket safely
      try { (socket as any).destroy(); } catch (destroyErr) {}
    }
  });

  // Handle unexpected socket errors to prevent crashing the proxy
  server.on('clientError', (err: any, socket: any) => {
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
  const wss = new WebSocketServer({ server, path: '/_live_dev_ws' }) as WatchReloadWebSocketServer;

  wss.on('error', (err) => {
    logger.error(`WebSocket server error: ${err.message}`);
  });

  wss.broadcastReload = () => {
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

  wss.closeProxy = () => {
    if (isClosing) return;
    isClosing = true;

    try { wss.close(); } catch (e) {}
    try { server.close(); } catch (e) {}
    try { proxy.close(); } catch (e) {}
  };

  // Allow updating the target port dynamically
  wss.updateTargetPort = (newPort: number) => {
    currentTargetPort = newPort;
    logger.info(`Proxy target updated to port ${newPort}`);
  };

  return wss;
}
