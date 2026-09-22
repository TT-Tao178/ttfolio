/**
 * 系统原生对话框（C-24）：Windows 用 PowerShell FolderBrowserDialog / OpenFileDialog，
 * macOS osascript，Linux zenity。只返回路径，不执行其它动作。
 */
import { runCommand } from './exec.js';

/**
 * 前台焦点尽力修复：服务进程是后台进程，直接 ShowDialog() 的对话框没有前台激活权限，
 * Windows 会把它压到活动窗口（浏览器）后面且不闪任务栏——用户看到"点了没反应"。
 * 教科书修法是 AttachThreadInput 临时附加到当前前台线程后 SetForegroundWindow(owner)，
 * 让 owner 成为合法前台窗口，ShowDialog(owner) 的对话框继承前台权。
 * 实测（Win11 26200）部分场景仍会被压后——前端因此配了「立即提示 + Alt+Tab 指引」兜底，
 * 两侧合起来保证用户永远知道对话框已弹出。
 */
const PS_FG_HELPER = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgHelper {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
`.trim();

const PS_DIALOG_OWNER = [
  'Add-Type -AssemblyName System.Drawing | Out-Null;',
  "$owner = New-Object System.Windows.Forms.Form;",
  "$owner.StartPosition = 'Manual';",
  '$owner.Location = New-Object System.Drawing.Point(-32000, -32000);',
  '$owner.ShowInTaskbar = $false;',
  '[void]$owner.Show();',
  PS_FG_HELPER,
  '$fg = [FgHelper]::GetForegroundWindow();',
  '$fgThread = [FgHelper]::GetWindowThreadProcessId($fg, [IntPtr]::Zero);',
  '$myThread = [FgHelper]::GetCurrentThreadId();',
  'if ($fgThread -ne 0 -and $fgThread -ne $myThread) { [void][FgHelper]::AttachThreadInput($myThread, $fgThread, $true); [void][FgHelper]::SetForegroundWindow($owner.Handle); [void][FgHelper]::AttachThreadInput($myThread, $fgThread, $false); }'
].join('\n');

const PS_FOLDER_FIXED = [
  'Add-Type -AssemblyName System.Windows.Forms | Out-Null;',
  PS_DIALOG_OWNER,
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
  "if ($d.ShowDialog($owner) -eq 'OK') { Write-Output $d.SelectedPath }",
  '$owner.Dispose()'
].join('\n');

const PS_FILE = [
  'Add-Type -AssemblyName System.Windows.Forms | Out-Null;',
  PS_DIALOG_OWNER,
  '$d = New-Object System.Windows.Forms.OpenFileDialog;',
  '$d.Multiselect = $true;',
  "$d.CheckFileExists = $true;",
  "if ($d.ShowDialog($owner) -eq 'OK') { $d.FileNames | ForEach-Object { Write-Output $_ } }",
  '$owner.Dispose()'
].join('\n');

export async function pickFolder(timeoutMs = 300000): Promise<string[]> {
  if (process.platform === 'win32') {
    const r = await runCommand('powershell', ['-NoProfile', '-STA', '-Command', PS_FOLDER_FIXED], { timeoutMs });
    return parseLines(r.stdout);
  }
  if (process.platform === 'darwin') {
    const r = await runCommand(
      'osascript',
      ['-e', 'POSIX path of (choose folder)'],
      { timeoutMs }
    );
    return parseLines(r.stdout);
  }
  const r = await runCommand('zenity', ['--file-selection', '--directory'], { timeoutMs });
  return parseLines(r.stdout);
}

export async function pickFile(timeoutMs = 300000): Promise<string[]> {
  if (process.platform === 'win32') {
    const r = await runCommand('powershell', ['-NoProfile', '-STA', '-Command', PS_FILE], { timeoutMs });
    return parseLines(r.stdout);
  }
  if (process.platform === 'darwin') {
    const r = await runCommand('osascript', ['-e', 'POSIX path of (choose file)'], { timeoutMs });
    return parseLines(r.stdout);
  }
  const r = await runCommand('zenity', ['--file-selection', '--multiple'], { timeoutMs });
  return parseLines(r.stdout);
}

function parseLines(out: string): string[] {
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
}
