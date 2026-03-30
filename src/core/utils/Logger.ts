import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

export class Logger {
  private logPath: string | null = null;

  constructor(private readonly prefix: string) {}

  init(): void {
    try {
      const logsDir = join(app.getPath('userData'), 'logs');
      mkdirSync(logsDir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      this.logPath = join(logsDir, `${date}.log`);
    } catch {
      this.logPath = null;
    }
  }

  log(message: string): void {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const line = `[${this.prefix}] ${time} ${message}`;

    console.log(line);

    if (this.logPath) {
      try {
        appendFileSync(this.logPath, line + '\n');
      } catch {
        // file write failed — console only
      }
    }
  }

  error(message: string): void {
    this.log(`ERROR: ${message}`);
  }

  warn(message: string): void {
    this.log(`WARN: ${message}`);
  }
}
