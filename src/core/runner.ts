import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import { RunnerOptions } from '../types';
import { logger } from '../utils/logger';

export function startRunner({ script, port, onReady, onCrash }: RunnerOptions) {
  let child: ChildProcess | null = null;
  let isRestarting = false;
  let isReady = false;

  const waitForPort = (processToWatch: ChildProcess | null) => {
    if (!processToWatch || processToWatch.exitCode !== null) return;
    
    const socket = new net.Socket();
    socket.on('connect', () => {
      socket.destroy();
      if (!isReady && onReady) {
        isReady = true;
        onReady();
      }
    });
    socket.on('error', () => {
      setTimeout(() => {
        if (child === processToWatch) {
          waitForPort(processToWatch);
        }
      }, 100);
    });
    socket.connect(port, '127.0.0.1');
  };

  let lastErrorOutput = '';

  const spawnProcess = () => {
    isReady = false;
    lastErrorOutput = '';
    
    child = spawn('node', [script], {
      stdio: ['inherit', 'inherit', 'pipe'],
      env: {
        ...process.env,
        PORT: port.toString(), // pass the internal port
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
      lastErrorOutput += data.toString();
      if (lastErrorOutput.length > 10000) {
        lastErrorOutput = lastErrorOutput.slice(-10000);
      }
    });

    waitForPort(child);

    child.on('error', (err: Error) => {
      logger.error(`Failed to start server process: ${err.message}`);
      lastErrorOutput += `Failed to start server process: ${err.message}\n`;
    });

    child.on('exit', (code: number | null) => {
      isReady = false;
      if (!isRestarting) {
        if (code !== null && code !== 0) {
          logger.error(`Server crashed with code ${code}. Waiting for file changes before restarting...`);
          if (onCrash) {
            // Give some time for stderr to be read before we reload
            setTimeout(onCrash, 100);
          }
        }
        child = null; // The process is dead, set child to null
      }
    });
  };

  const restart = () => {
    if (isRestarting) return;
    isRestarting = true;
    
    if (child) {
      child.once('exit', () => {
        isRestarting = false;
        spawnProcess();
      });
      // Kill child process gracefully
      child.kill('SIGTERM');
    } else {
      isRestarting = false;
      spawnProcess();
    }
  };

  spawnProcess();

  return { restart, getLastError: () => lastErrorOutput };
}
