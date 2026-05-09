export const injectScriptContent = `(function() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + window.location.host + '/_live_dev_ws';
  
  let ws;
  let reconnectAttempts = 0;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[liverun] Connected to live reload server');
      if (reconnectAttempts > 0) {
        // If we reconnected, the server might have restarted, so reload the page
        window.location.reload();
      }
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'RELOAD') {
          console.log('[liverun] Reloading page...');
          window.location.reload();
        }
      } catch (e) {
        console.error('[liverun] Error parsing message', e);
      }
    };

    ws.onclose = () => {
      // Reconnect logic with exponential backoff
      const delay = Math.min(1000 * (2 ** reconnectAttempts), 10000);
      reconnectAttempts++;
      setTimeout(connect, delay);
    };
  }

  connect();
})();`;
