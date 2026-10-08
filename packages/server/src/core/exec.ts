/**
 * 外部命令执行（C-21 / FS-13）：永远 executable + args[]，禁止 shell 字符串拼接。
 * 这是 packages/server 内唯一允许 spawn 的模块。
 */
import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  env?: Record<string, string>;
}

export function runCommand(exe: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    const max = opts.maxBuffer ?? 64 * 1024 * 1024;
    let done = false;
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            if (!done) {
              done = true;
              child.kill();
              reject(new Error(`command timeout: ${exe}`));
            }
          }, opts.timeoutMs)
        : null;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < max) stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < max) stderr += chunk;
    });
    child.on('error', (err) => {
      if (!done) {
        done = true;
        if (timer) clearTimeout(timer);
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (!done) {
        done = true;
        if (timer) clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      }
    });
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input, 'utf8');
    } else {
      child.stdin?.end();
    }
  });
}
