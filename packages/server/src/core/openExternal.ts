/**
 * 外部打开（FR-10.2/10.3 / C-22/23）：资源管理器 / 终端 / 命令模板。
 * 永远 executable + args[]（shell:false）；占位符只允许 {path}/{file}/{project}/{paths}。
 * 调用方（路由层）负责先做 PathGuard 白名单校验。
 */
import { spawn } from 'node:child_process';
import { AppError } from './errors.js';
import { runCommand } from './exec.js';
import { exists } from './fsx.js';

const ALLOWED_PLACEHOLDERS = new Set(['{path}', '{file}', '{project}', '{paths}']);

export function validateTemplateArgs(args: string[], isBuiltin: boolean): void {
  if (isBuiltin) return;
  const hasPlaceholder = args.some((a) => {
    for (const p of ALLOWED_PLACEHOLDERS) {
      if (a.includes(p)) return true;
    }
    return false;
  });
  if (!hasPlaceholder) {
    throw new AppError('INVALID_NAME', '命令模板参数至少要包含一个占位符：{path} / {file} / {project} / {paths}');
  }
}

function fireAndForget(exe: string, args: string[]): void {
  const child = spawn(exe, args, { shell: false, detached: true, windowsHide: false, stdio: 'ignore' });
  child.on('error', () => {
    /* 打开外部程序失败不阻断服务；错误经返回值渠道已另行提示 */
  });
  child.unref();
}

export async function openExplorer(targetPath: string): Promise<void> {
  if (!exists(targetPath)) throw new AppError('NOT_FOUND', '路径不存在');
  if (process.platform === 'win32') {
    fireAndForget('explorer', [`/select,${targetPath}`]);
    return;
  }
  if (process.platform === 'darwin') {
    fireAndForget('open', ['-R', targetPath]);
    return;
  }
  fireAndForget('xdg-open', [targetPath]);
}

export async function openTerminal(dir: string): Promise<void> {
  if (!exists(dir)) throw new AppError('NOT_FOUND', '目录不存在');
  if (process.platform === 'win32') {
    // 优先 Windows Terminal
    try {
      const r = await runCommand('where', ['wt'], { timeoutMs: 3000 });
      if (r.code === 0 && r.stdout.trim() !== '') {
        fireAndForget('wt', ['-d', dir]);
        return;
      }
    } catch {
      // where 失败继续回退
    }
    const esc = dir.replace(/'/g, "''");
    fireAndForget('powershell', ['-NoExit', '-Command', `Set-Location -LiteralPath '${esc}'`]);
    return;
  }
  if (process.platform === 'darwin') {
    fireAndForget('open', ['-a', 'Terminal', dir]);
    return;
  }
  fireAndForget('x-terminal-emulator', ['--working-directory', dir]);
}

export async function openUrlInBrowser(url: string): Promise<void> {
  // 只接受 https URL（检查更新/打开 Release 页用；防拼接出 file:/smb: 之类被系统处理器接走）
  if (!/^https:\/\//.test(url)) throw new AppError('BAD_REQUEST', '仅允许打开 https 链接');
  if (process.platform === 'win32') {
    fireAndForget('rundll32', ['url.dll,FileProtocolHandler', url]);
    return;
  }
  if (process.platform === 'darwin') {
    fireAndForget('open', [url]);
    return;
  }
  fireAndForget('xdg-open', [url]);
}

export function renderTemplateArgs(args: string[], values: { path: string; file: string; project: string; paths: string }): string[] {
  return args.map((a) =>
    a
      .split('{path}')
      .join(values.path)
      .split('{file}')
      .join(values.file)
      .split('{project}')
      .join(values.project)
      .split('{paths}')
      .join(values.paths)
  );
}

export async function runTemplate(executable: string, args: string[]): Promise<void> {
  const r = await runCommand(executable, args, { timeoutMs: 10000 });
  if (r.code !== 0 && r.code !== 1) {
    // explorer 等程序退出码不标准，只有明显失败才报错
    if (r.stderr.trim() !== '') {
      throw new AppError('IO_ERROR', `外部程序执行失败：${r.stderr.trim().slice(0, 200)}`);
    }
  }
}
