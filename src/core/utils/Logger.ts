import { mkdirSync, createWriteStream, type WriteStream } from 'fs';
import { join } from 'path';
import { app } from 'electron';

export class Logger {
  private logStream: WriteStream | null = null;
  private consoleAvailable = true;

  constructor(private readonly prefix: string) {}

  init(): void {
    try {
      const logsDir = join(app.getPath('userData'), 'logs');
      mkdirSync(logsDir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const logPath = join(logsDir, `${date}.log`);
      this.logStream = createWriteStream(logPath, { flags: 'a' });
      this.logStream.on('error', () => {
        this.logStream = null;
      });
    } catch {
      this.logStream = null;
    }
  }

  log(message: string): void {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const line = `[${this.prefix}] ${time} ${message}`;

    if (this.consoleAvailable) {
      try {
        console.log(line);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
          this.consoleAvailable = false;
        } else {
          throw error;
        }
      }
    }

    if (this.logStream) {
      this.logStream.write(line + '\n');
    }
  }

  error(message: string): void {
    this.log(`ERROR: ${message}`);
  }

  warn(message: string): void {
    this.log(`WARN: ${message}`);
  }

  dispose(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}
