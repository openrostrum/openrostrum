import fs from "node:fs";
import path from "node:path";

/**
 * Run logging. Everything goes to stdout AND to <runDir>/run.log, so progress
 * is followable with `tail -f` no matter how the process was launched (piping
 * stdout through tail/less buffers it; the file does not).
 */
let stream: fs.WriteStream | undefined;

export function initLog(runDir: string): string {
  const file = path.join(runDir, "run.log");
  stream = fs.createWriteStream(file, { flags: "a" });
  return file;
}

export function log(message: string): void {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
  console.log(line);
  stream?.write(line + "\n");
}

export function closeLog(): void {
  stream?.end();
  stream = undefined;
}
