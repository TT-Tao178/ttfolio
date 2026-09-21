/**
 * 系统原生对话框（C-24）：Windows 用 PowerShell FolderBrowserDialog / OpenFileDialog，
 * macOS osascript，Linux zenity。只返回路径，不执行其它动作。
 */
import { runCommand } from './exec.js';

const PS_FOLDER_FIXED = [
  'Add-Type -AssemblyName System.Windows.Forms | Out-Null;',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
  "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }"
].join(' ');

const PS_FILE = [
  'Add-Type -AssemblyName System.Windows.Forms | Out-Null;',
  '$d = New-Object System.Windows.Forms.OpenFileDialog;',
  '$d.Multiselect = $true;',
  "$d.CheckFileExists = $true;",
  "if ($d.ShowDialog() -eq 'OK') { $d.FileNames | ForEach-Object { Write-Output $_ } }"
].join(' ');

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
