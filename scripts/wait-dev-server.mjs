/**
 * Blocks until something accepts TCP on VITE_DEV_PORT (default 5188).
 * Used so Electron never starts before the Vite dev server is listening.
 */
import net from 'net';

const port = Number(process.env.VITE_DEV_PORT) || 5188;
const host = '127.0.0.1';
const timeoutMs = 120_000;
const pollMs = 200;
const deadline = Date.now() + timeoutMs;

function tryOnce() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host }, () => {
      socket.end();
      resolve();
    });
    socket.once('error', () => {
      socket.destroy();
      reject();
    });
  });
}

async function main() {
  for (;;) {
    if (Date.now() > deadline) {
      console.error(
        `[skyfork] Timeout waiting for dev server at ${host}:${port} (${timeoutMs}ms). Is Vite running?`
      );
      process.exit(1);
    }
    try {
      await tryOnce();
      console.error(`[skyfork] dev server OK ${host}:${port} → starting Electron`);
      process.exit(0);
    } catch {
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

main();
