/**
 * 自绘安装器原型（T-154 第一步）：只做窗口与状态机，还没接真实文件安装。
 * 目标：先证明"设计稿能 1:1 变成真窗口"，再往里填安装逻辑。
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

/**
 * 任务栏图标（2026-11-20）：Electron 默认会用自带的原子图标，必须两件事一起做——
 *   ① 窗口指定 icon（任务栏优先用窗口图标）；
 *   ② 设置独立的 AppUserModelID（否则 Windows 会把安装器和其它 Electron 应用归成一组，
 *      显示的是 exe 内置图标或原子图标）。
 * 打包成 exe 时还要保证 exe 本身嵌了图标（builder 的 win.icon），三处一致才不会来回跳。
 */
app.setAppUserModelId('com.tttao.ttfolio.installer');

function createWindow() {
  const win = new BrowserWindow({
    width: 620,
    height: 330,
    frame: false,
    roundedCorners: true,
    backgroundColor: '#F6FAFF',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    resizable: false,
    maximizable: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}

ipcMain.on('inst:action', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win === null) return;
  if (action === 'close') win.close();
  if (action === 'minimize') win.minimize();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
