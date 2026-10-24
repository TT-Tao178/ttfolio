/**
 * 窗口寄宿（T-131 / FR-14.3 T1）：把外部 Win32 顶层窗口重挂进 ttFolio 面板，变成可直接操作
 * 的原生窗口——键盘/鼠标/输入法/滚轮原生直达，零转发代码。
 *
 * 设计依据：《ttFolio窗口寄宿设计-T-131-2026-10-24.md》§1/§3/§6 + §2 的路线 C。
 * Phase 0 spike 七项全过；Phase 1 真机探针又推翻了设计 §1 的一个前提，据此做了唯一一处架构偏离：
 *
 *   **容器不是 Electron 窗口的子窗口，而是「归属于 Electron 窗口的顶层弹出窗口」（route C）。**
 *   原因（真机像素取证）：Electron 44 的 Chromium 合成层（DComp）会整片盖住客户区内的原生
 *   WS_CHILD 子窗口——窗口本身 IsWindowVisible=1、几何正确，屏幕上却是页面颜色；给宿主窗口
 *   加 WS_CLIPCHILDREN 也无效（该样式只影响 BeginPaint 的裁剪区，管不住合成层）。改成
 *   WS_POPUP + hWndParent=owner 的**归属窗口**后，DWM 保证它压在 owner 之上，实测像素正确。
 *   副作用（均已验或已知）：它随 owner 最小化/销毁；不进 Alt+Tab（WS_EX_TOOLWINDOW）；
 *   要自己跟着 owner 移动（main.cjs 在 move/resize 时重算矩形）；始终压在 owner 之上 →
 *   浮层守卫（隐藏 + poster）从"优化"变成"必需"。
 *
 * 三条铁律（spike 用段错误换来的，改代码前先读）：
 *  ① intptr_t 句柄参数一律传 Number——传 BigInt 直接段错误；int64_t 返回一律 Number() 收敛。
 *  ② 一切「先写后读」的缓冲（RECT/WINDOWPLACEMENT/GUID/字符串）用 Node Buffer 按 void* 传，
 *     字段用 xLE 手工读写。koffi.decode 的 str16/数组/struct 指针返回的是拷贝或 null，写不进去。
 *  ③ 函数指针调用用 koffi.call(ptr, proto, args)，proto 名必须全局唯一（重名抛 Duplicate type name）。
 *
 * 线程模型：全部同步调用都在 Electron 主线程执行（设计 P0-1：koffi 回调不能在自建原生线程里跑 JS）。
 * DPI 只允许在 CreateWindowEx 前后成对切换并立即还原（设计 P0-2 / §3.1）。
 *
 * 依赖注入（不直接 require('electron')）：屏幕工作区、宿主是否最小化、抓帧、事件回传都由
 * 调用方注入——这样本模块可以在纯 Node 里跑冒烟（Electron 专属能力集中放在 main.cjs）。
 */
'use strict';

const koffi = require('koffi');

// ---- Win32 常量 ----
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_VISIBLE = 0x10000000;
const WS_CAPTION = 0x00c00000;
const WS_THICKFRAME = 0x00040000;
const WS_SYSMENU = 0x00080000;
const WS_CLIPCHILDREN = 0x02000000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;
/** WS_EX_APPWINDOW：强制顶层窗口出现在任务栏（容器靠它当任务栏条目）。 */
const WS_EX_APPWINDOW = 0x00040000;

const WM_GETICON = 0x007f;
const WM_SETICON = 0x0080;
const GCLP_HICON = -14;

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW = 0x0040;

const SW_HIDE = 0;
const SW_SHOW = 5;
const SW_SHOWMAXIMIZED = 3;
const SW_RESTORE = 9;
const SC_RESTORE = 0xf120;
const SC_MAXIMIZE = 0xf030;
const WM_SYSCOMMAND = 0x0112;
const SMTO_ABORTIFHUNG = 0x0002;

/** RedrawWindow 标志：失效 + 子窗口一起 + 立即重画 + 边框。 */
const RDW_INVALIDATE = 0x0001;
const RDW_ALLCHILDREN = 0x0080;
const RDW_UPDATENOW = 0x0100;
const RDW_FRAME = 0x0400;

const GA_PARENT = 1;

/** 入子窗口时要剥掉的原顶层样式（不自拼 WS_OVERLAPPEDWINDOW，分离时按原值整份还原）。 */
const STYLE_STRIP =
  (WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX) >>> 0;
/** 同理剥掉 WS_EX_APPWINDOW(0x40000) 与 WS_EX_TOOLWINDOW 无关的 WS_EX_TOPMOST(0x8)。 */
const EXSTYLE_STRIP = (0x00040000 | 0x00000008) >>> 0;

const POLL_MS = 1000;

/**
 * 结构性不支持的窗口类别（设计 §3.7）：入口处如实拒绝并回落监控模式，
 * 而不是塞进去得到一个黑块。WinUI3 / UWP 的真窗口不在我们枚举到的这个 HWND 上。
 */
const DENY_CLASSES = {
  ApplicationFrameWindow: 'UWP 应用（如计算器/设置）的窗口由系统宿主承载，暂不支持寄宿',
  'Windows.UI.Core.CoreWindow': 'UWP 应用（如计算器/设置）的窗口由系统宿主承载，暂不支持寄宿',
  CASCADIA_HOSTING_WINDOW_CLASS: 'Windows Terminal 使用 WinUI3，暂不支持寄宿（可改用 ttFolio 内置终端）',
  WinUIDesktopWin32WindowClass: '该程序使用 WinUI3，暂不支持寄宿',
};

// ---- koffi 绑定 ----
let d = null;
let ffiError = null;

function buildTable() {
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const shell32 = koffi.load('shell32.dll');
  return {
    IsWindow: user32.func('int32_t IsWindow(intptr_t)'),
    IsChild: user32.func('int32_t IsChild(intptr_t parent, intptr_t child)'),
    IsZoomed: user32.func('int32_t IsZoomed(intptr_t)'),
    IsIconic: user32.func('int32_t IsIconic(intptr_t)'),
    GetClassNameW: user32.func('int32_t GetClassNameW(intptr_t, void *buf, int32_t max)'),
    GetWindowTextW: user32.func('int32_t GetWindowTextW(intptr_t, void *buf, int32_t max)'),
    SetWindowTextW: user32.func('int32_t SetWindowTextW(intptr_t, str16)'),
    GetWindowRect: user32.func('int32_t GetWindowRect(intptr_t, void *rc)'),
    CreateWindowExW: user32.func(
      'intptr_t CreateWindowExW(uint32_t ex, str16 cls, str16 name, uint32_t style, int32_t x, int32_t y, int32_t w, int32_t h, intptr_t parent, intptr_t menu, intptr_t inst, intptr_t param)',
    ),
    DestroyWindow: user32.func('int32_t DestroyWindow(intptr_t)'),
    ShowWindow: user32.func('int32_t ShowWindow(intptr_t, int32_t)'),
    SetParent: user32.func('intptr_t SetParent(intptr_t child, intptr_t parent)'),
    GetAncestor: user32.func('intptr_t GetAncestor(intptr_t, uint32_t)'),
    GetWindowLongPtrW: user32.func('int64_t GetWindowLongPtrW(intptr_t, int32_t)'),
    SetWindowLongPtrW: user32.func('int64_t SetWindowLongPtrW(intptr_t, int32_t, int64_t)'),
    GetClassLongPtrW: user32.func('int64_t GetClassLongPtrW(intptr_t, int32_t)'),
    SendMessageW: user32.func('int64_t SendMessageW(intptr_t, uint32_t, intptr_t, intptr_t)'),
    SetWindowPos: user32.func(
      'int32_t SetWindowPos(intptr_t, intptr_t, int32_t, int32_t, int32_t, int32_t, uint32_t)',
    ),
    RedrawWindow: user32.func('int32_t RedrawWindow(intptr_t, void *rect, intptr_t rgn, uint32_t flags)'),
    GetWindowPlacement: user32.func('int32_t GetWindowPlacement(intptr_t, void *wp)'),
    SetWindowPlacement: user32.func('int32_t SetWindowPlacement(intptr_t, void *wp)'),
    GetWindowDpiAwarenessContext: user32.func('intptr_t GetWindowDpiAwarenessContext(intptr_t)'),
    GetDpiForWindow: user32.func('uint32_t GetDpiForWindow(intptr_t)'),
    SetThreadDpiAwarenessContext: user32.func('intptr_t SetThreadDpiAwarenessContext(intptr_t)'),
    SetThreadDpiHostingBehavior: user32.func('int32_t SetThreadDpiHostingBehavior(int32_t)'),
    GetGUIThreadInfo: user32.func('int32_t GetGUIThreadInfo(uint32_t tid, void *info)'),
    GetWindowThreadProcessId: user32.func('uint32_t GetWindowThreadProcessId(intptr_t, void *pid)'),
    SendMessageTimeoutW: user32.func(
      'intptr_t SendMessageTimeoutW(intptr_t, uint32_t, intptr_t, intptr_t, uint32_t, uint32_t, void *result)',
    ),
    SHGetPropertyStoreForWindow: shell32.func(
      'int32_t SHGetPropertyStoreForWindow(intptr_t hwnd, void *riid, void **ppv)',
    ),
    OpenProcess: kernel32.func('intptr_t OpenProcess(uint32_t access, int32_t inherit, uint32_t pid)'),
    QueryFullProcessImageNameW: kernel32.func(
      'int32_t QueryFullProcessImageNameW(intptr_t proc, uint32_t flags, void *buf, void *size)',
    ),
    CloseHandle: kernel32.func('int32_t CloseHandle(intptr_t handle)'),
    GetCurrentThreadId: kernel32.func('uint32_t GetCurrentThreadId()'),
  };
}

try {
  d = buildTable();
} catch (err) {
  // 非 Windows / 缺 koffi 原生库：模块可加载，功能如实不可用（同 node-pty 姿势，绝不拖垮启动）
  ffiError = err instanceof Error ? err : new Error(String(err));
}

// ---- 依赖注入 ----
let hooks = {
  /** 事件回传（主进程转发给渲染层）；同步调用，异常吞掉不影响状态机 */
  onEvent: () => {},
  /** 当前全部显示器工作区（物理像素，screen.getAllDisplays().map(d => d.workArea)） */
  getWorkAreas: () => [],
  /** 宿主 BrowserWindow 是否最小化（最小化时统一隐藏，避免留下永久隐藏或永久可见的窗口） */
  isHostMinimized: () => false,
};

function init(next) {
  hooks = { ...hooks, ...next };
}

function unavailableReason() {
  if (d === null) return `窗口寄宿组件不可用：${ffiError === null ? '未知原因' : ffiError.message}`;
  return null;
}

function available() {
  return d !== null;
}

// ---- 小工具 ----
function isWindow(hwnd) {
  try {
    return hwnd !== 0 && d.IsWindow(hwnd) === 1;
  } catch {
    return false;
  }
}

function isZoomed(hwnd) {
  try {
    return d.IsZoomed(hwnd) === 1;
  } catch {
    return false;
  }
}

function isIconic(hwnd) {
  try {
    return d.IsIconic(hwnd) === 1;
  } catch {
    return false;
  }
}

function classNameOf(hwnd) {
  try {
    const buf = Buffer.alloc(512);
    const len = d.GetClassNameW(hwnd, buf, 256);
    return buf.toString('utf16le', 0, Math.max(0, len) * 2);
  } catch {
    return '';
  }
}

function titleOf(hwnd) {
  try {
    const buf = Buffer.alloc(1024);
    const len = d.GetWindowTextW(hwnd, buf, 512);
    return buf.toString('utf16le', 0, Math.max(0, len) * 2);
  } catch {
    return '';
  }
}

/**
 * 从 desktopCapturer 的 source id 解析 HWND：`window:<hwnd>:<n>` 取第二段。
 * Windows 上该段就是 HWND（Phase 0 S1 已抽检对照窗口标题），用户句柄实际只有 32 位有效，
 * Number 不丢精度。解析失败返回 null（调用方如实报错，不猜）。
 */
function parseSourceId(sourceId) {
  if (typeof sourceId !== 'string') return null;
  const parts = sourceId.split(':');
  if (parts.length < 2 || parts[0] !== 'window') return null;
  const hwnd = Number(parts[1]);
  return Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : null;
}

function normalizeRect(rect) {
  if (rect === null || typeof rect !== 'object') return null;
  const x = Math.round(Number(rect.x));
  const y = Math.round(Number(rect.y));
  const width = Math.round(Number(rect.width));
  const height = Math.round(Number(rect.height));
  if (![x, y, width, height].every((v) => Number.isFinite(v))) return null;
  if (width < 40 || height < 40) return null; // 面板折叠/未布局的瞬间直接忽略，不塞 0 尺寸窗口
  return { x, y, width, height };
}

function emit(payload) {
  try {
    hooks.onEvent(payload);
  } catch {
    /* 事件回传失败不影响状态机 */
  }
}

function fail(error, code = 'error') {
  return { ok: false, error, code };
}

// ---- 任务栏 ----
/**
 * 任务栏按钮：**加在容器上**（容器是真正的顶层窗口），不是加在被嵌窗口上。
 *
 * v0.5.0 的错法：对被重挂成子窗口的目标 `AddTab` 返回 S_OK，但任务栏根本不出现按钮
 * （用户实测「窗口嵌进来之后任务栏就找不到它了」）。WS_CHILD 窗口没有任务栏条目，AddTab 也
 * 变不出来。v0.5.1 先试过给容器加 WS_EX_APPWINDOW —— UIA 实测同样无效：**有属主的窗口
 * 不进任务栏**，ex-style 强不了。所以走回 AddTab，但对象换成容器；容器里装着被嵌窗口，
 * 任务栏悬停预览自然就是实时画面。
 */
/**
 * 标题/图标/任务栏身份都镜像到容器。
 *
 * 任务栏身份为什么要单独设（v0.5.1 实测）：容器属于 ttFolio 进程，默认会被任务栏并入
 * ttFolio 那一个按钮（"… - 2 个运行窗口"），用户还是「找不到那个窗口」。给容器设目标进程
 * 的 AppUserModelID（PKEY_AppUserModel_ID）之后，它会以对方程序的身份单独出现在任务栏，
 * 标题是目标标题、缩略图是实时画面。
 */
function applyTaskbarIdentity(container, hwnd, title) {
  try {
    // 标题镜像：任务栏/Alt+Tab 悬停显示的是目标的标题
    if (title !== '') d.SetWindowTextW(container, title);
    // 图标镜像：优先窗口自己的图标，退而取窗口类的图标
    const icon =
      Number(d.SendMessageW(hwnd, WM_GETICON, 1 /* ICON_BIG */, 0)) ||
      Number(d.SendMessageW(hwnd, WM_GETICON, 0, 0));
    const cls = icon !== 0 ? icon : Number(d.GetClassLongPtrW(hwnd, GCLP_HICON));
    if (cls !== 0) d.SendMessageW(container, WM_SETICON, 1 /* ICON_BIG */, cls);
    // 任务栏身份：用目标 exe 路径当 AppID，让容器**独立**成一个任务栏按钮（否则会被并进
    // ttFolio 那一个按钮里，用户还是找不到）。尝试抄目标自带 AppID 的路径会走
    // IPropertyStore::GetValue，koffi 下读 PROPVARIANT 指针直接把主进程打崩了（实测），
    // 不做——独立按钮 + 悬停标题 + 实时缩略图已经够用。
    const appId = exePathOf(hwnd);
    if (appId !== '') setWindowAppId(container, appId);
  } catch {
    /* 标题/图标/AppID 镜像失败不影响功能 */
  }
}

/** 目标窗口所属进程的可执行文件全路径（拿不到就返回空串）。 */
function exePathOf(hwnd) {
  try {
    const pid = Buffer.alloc(8);
    d.GetWindowThreadProcessId(hwnd, pid);
    const handle = Number(
      d.OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, 0, pid.readUInt32LE(0)),
    );
    if (handle === 0) return '';
    try {
      const buf = Buffer.alloc(2048);
      const size = Buffer.alloc(4);
      size.writeUInt32LE(1024, 0);
      if (d.QueryFullProcessImageNameW(handle, 0, buf, size) === 0) return '';
      const n = size.readUInt32LE(0);
      return buf.toString('utf16le', 0, Math.max(0, n) * 2);
    } finally {
      d.CloseHandle(handle);
    }
  } catch {
    return '';
  }
}

/** GUID 小端 16 字节（koffi 封送 COM 结构体靠手工拼，见文件头铁律②）。 */
function guidBuf(d1, d2, d3, tail) {
  const b = Buffer.alloc(16);
  b.writeUInt32LE(d1, 0);
  b.writeUInt16LE(d2, 4);
  b.writeUInt16LE(d3, 6);
  for (let i = 0; i < 8; i++) b[8 + i] = tail[i];
  return b;
}

/** PKEY_AppUserModel_ID = {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, pid 5 */
function appIdPropertyKey() {
  const key = Buffer.alloc(20);
  guidBuf(0x9f4c2855, 0x9f79, 0x4b39, [0xa8, 0xd0, 0xe1, 0xd4, 0x2d, 0xe1, 0xd5, 0xf3]).copy(key, 0);
  key.writeUInt32LE(5, 16);
  return key;
}

/**
 * 给窗口设 AppUserModelID：SHGetPropertyStoreForWindow + IPropertyStore::SetValue(PKEY_AppUserModel_ID)。
 * PROPVARIANT 手工拼（VT_LPWSTR=31，x64 下指针在偏移 8）；SetValue 会自己拷贝字符串，
 * 所以临时 Buffer 只在调用期间有效即可。
 */
function setWindowAppId(hwnd, appId) {
  try {
    const store = koffi.alloc('void *', 1);
    const iid = guidBuf(0x886d8eeb, 0x8cf2, 0x4446, [0x8d, 0x02, 0xcd, 0xba, 0x1d, 0xbd, 0xcf, 0x99]);
    const hr = d.SHGetPropertyStoreForWindow(hwnd, iid, store);
    if (hr !== 0) return false;
    const obj = koffi.decode(store, 'void *');
    const vt = koffi.decode(obj, 'void **');
    const key = appIdPropertyKey();
    const value = Buffer.alloc(32);
    value.writeUInt16LE(31, 0); // VT_LPWSTR
    const text = Buffer.from(`${appId}\u0000`, 'utf16le');
    value.writeBigUInt64LE(BigInt(koffi.address(text)), 8);
    const setValue = koffi.proto('int32_t t131_ps_set_value(void *self, void *key, void *value)');
    const commit = koffi.proto('int32_t t131_ps_commit(void *self)');
    const hrSet = koffi.call(koffi.decode(vt, 48, 'void *'), setValue, obj, key, value);
    const hrCommit = koffi.call(koffi.decode(vt, 56, 'void *'), commit, obj);
    return hrSet === 0 && hrCommit === 0;
  } catch {
    return false;
  }
}

// ---- 状态 ----
/**
 * 单槽（Phase 1 范围：多槽标签页不做）。字段意涵：
 *  - attached：SetParent 成功且目标仍被我们托管
 *  - desiredVisible：渲染层"面板该显示画面"的意愿（浮层打开时为 false）
 *  - visible：推导结果，唯一决定 ShowWindow 的值
 */
let session = null;
let pollTimer = null;
let visibleGen = 0;

function getState() {
  if (session === null) return { attached: false };
  return {
    attached: session.attached,
    hwnd: session.hwnd,
    container: session.container,
    title: session.title,
    className: session.className,
    visible: session.visible,
    focused: session.focused,
    taskbar: session.taskbar,
  };
}

function isAttached() {
  return session !== null && session.attached;
}

// ---- attach / detach ----

/**
 * 把 sourceId 指向的窗口嵌进 ttFolio 面板区域。
 *
 * rect 是**屏幕物理像素**矩形（由 main.cjs 用 screen.dipToScreenRect 换算）。
 * 为什么是屏幕坐标而不是宿主客户区坐标：容器用的是「归属于宿主窗口的顶层弹出窗口」
 * （见 §架构说明），它是屏幕坐标定位的，不是子窗口。
 */
function attach(electronHwnd, sourceId, rect) {
  const why = unavailableReason();
  if (why !== null) return fail(why, 'unavailable');
  const host = Number(electronHwnd);
  const box = normalizeRect(rect);
  if (!isWindow(host)) return fail('宿主窗口句柄无效', 'host');
  if (box === null) return fail('面板尺寸无效（可能尚未布局）', 'rect');
  const hwnd = parseSourceId(sourceId);
  if (hwnd === null) return fail('无法从窗口标识解析 HWND（该版本窗口枚举格式异常）', 'parse');
  if (!isWindow(hwnd)) return fail('目标窗口不存在或已关闭', 'closed');
  if (hwnd === host) return fail('不能嵌入 ttFolio 自身窗口', 'self');

  // 幂等：同一宿主同一目标只改矩形
  if (session !== null && session.attached && session.hwnd === hwnd) {
    resize(box);
    return { ok: true, info: getState() };
  }
  if (session !== null) detach();

  const className = classNameOf(hwnd);
  const denied = DENY_CLASSES[className];
  if (denied !== undefined) return fail(denied, 'unsupported');

  // 关键（v0.5.1 修）：最大化/最小化的窗口**不能**直接重挂。
  // 实测：把最大化的 Chrome 直接塞进容器，内容区整片空白（白/黑屏），且分离后窗口会变成
  // 「最大化标志 + 容器尺寸」的畸形状态（用户报的"还原有 bug"）。正确姿势是先还原成正常
  // 尺寸再重挂，分离时按原 WINDOWPLACEMENT 还原，需要的话再最大化回去。
  const wasZoomed = isZoomed(hwnd);
  if (wasZoomed || isIconic(hwnd)) {
    sysCommand(hwnd, SC_RESTORE);
  }

  const s = {
    hwnd,
    host,
    sourceId: String(sourceId),
    title: titleOf(hwnd) || '（无标题窗口）',
    className,
    container: 0,
    origStyle: 0,
    origExStyle: 0,
    placement: Buffer.alloc(48),
    rect: box,
    attached: false,
    desiredVisible: true,
    visible: false,
    focused: false,
    taskbar: false,
    wasZoomed,
  };

  // DPI 状态窗口法（设计 §3.1）：容器必须与目标的感知上下文一致，否则 SetParent 行为未定义。
  // 成对切换 → 建窗口 → 立即还原，期间 JS 不重入、Chromium 消息循环也插不进来。
  // 容器是**归属于宿主窗口的顶层弹出窗口**（WS_POPUP + hWndParent=owner），不是 WS_CHILD：
  // Electron 的合成层（DComp）会整片盖住客户区里的原生子窗口，真机探针实测子窗口方案像素全白；
  // 归属性弹出窗口由 DWM 保证压在 owner 之上、随 owner 最小化，实测渲染正确。
  // ex-style 用 WS_EX_APPWINDOW：让这个顶层容器自己出现在任务栏（被嵌窗口成了子窗口后
  // 没有任务栏条目，ITaskbarList::AddTab 也变不出来——v0.5.0 实测 S_OK 但按钮不出现）。
  let container = 0;
  try {
    const oldHosting = d.SetThreadDpiHostingBehavior(2 /* MIXED */);
    const targetCtx = d.GetWindowDpiAwarenessContext(hwnd);
    const oldCtx = targetCtx !== 0 ? d.SetThreadDpiAwarenessContext(targetCtx) : 0;
    try {
      container = d.CreateWindowExW(
        WS_EX_APPWINDOW,
        'STATIC',
        'ttfolio-embed-slot',
        (WS_POPUP | WS_VISIBLE | WS_CLIPCHILDREN) >>> 0,
        box.x,
        box.y,
        box.width,
        box.height,
        host,
        0,
        0,
        0,
      );
    } finally {
      if (oldCtx !== 0) d.SetThreadDpiAwarenessContext(oldCtx);
      d.SetThreadDpiHostingBehavior(oldHosting);
    }
  } catch (err) {
    return fail(`创建寄宿容器失败：${errMsg(err)}`, 'container');
  }
  if (container === 0) return fail('创建寄宿容器失败（CreateWindowEx 返回 0）', 'container');
  s.container = container;

  // 保存原样式/位置（分离时整份还原，不自拼近似值）
  s.origStyle = Number(d.GetWindowLongPtrW(hwnd, GWL_STYLE)) >>> 0;
  s.origExStyle = Number(d.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) >>> 0;
  s.placement.writeUInt32LE(44, 0);
  d.GetWindowPlacement(hwnd, s.placement);

  try {
    d.SetParent(hwnd, container);
    const parentNow = d.GetAncestor(hwnd, GA_PARENT);
    if (parentNow !== container) {
      // 典型原因：目标以管理员权限运行，UIPI 拦死跨完整性级别的窗口重挂
      throw new Error(
        parentNow === 0
          ? '系统拒绝了窗口重挂（目标可能以管理员权限运行）'
          : '系统拒绝了窗口重挂（窗口受保护）',
      );
    }
    const st = Number(d.GetWindowLongPtrW(hwnd, GWL_STYLE)) >>> 0;
    const ex = Number(d.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) >>> 0;
    d.SetWindowLongPtrW(hwnd, GWL_STYLE, (st & ~STYLE_STRIP) | WS_CHILD | 0);
    d.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex & ~EXSTYLE_STRIP) | 0);
    d.SetWindowPos(
      hwnd,
      0,
      0,
      0,
      box.width,
      box.height,
      SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOZORDER | SWP_NOACTIVATE,
    );
    d.ShowWindow(hwnd, SW_SHOW);
    // 重挂会打断 Chromium 的合成输出（浏览器尤其明显）：立刻整窗重画一次，
    // 否则可能停在空白/灰底，直到用户去动一下窗口才恢复。
    d.RedrawWindow(hwnd, null, 0, RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_UPDATENOW | RDW_FRAME);
  } catch (err) {
    // 半途失败：原地回滚，绝不留下"样式被改、父窗口还被挂着"的残局
    rollback(s);
    return fail(errMsg(err), 'attach');
  }

  s.attached = true;
  session = s;
  applyTaskbarIdentity(container, hwnd, s.title);
  // 任务栏条目由系统自动给（容器是顶层窗口 + WS_EX_APPWINDOW + 独立 AppID），不需要 AddTab
  s.taskbar = true;
  applyVisibility();
  startPoll();
  emit({ type: 'attached', info: publicInfo(s) });
  return { ok: true, info: publicInfo(s) };
}

function errMsg(err) {
  return err instanceof Error ? err.message : String(err);
}

function publicInfo(s) {
  return {
    hwnd: s.hwnd,
    title: s.title,
    className: s.className,
    dpi: safeDpi(s.container),
    taskbar: s.taskbar,
  };
}

function safeDpi(hwnd) {
  try {
    return d.GetDpiForWindow(hwnd);
  } catch {
    return 0;
  }
}

/** 同步让目标窗口切换窗口状态（SW_RESTORE / SW_MAXIMIZE 用 ShowWindow 是异步投递的，
 *  紧接着 SetParent 会读到旧状态——SendMessageTimeout 让它当场生效，且带超时保护不卡主线程）。 */
function sysCommand(hwnd, cmd) {
  try {
    const res = Buffer.alloc(8);
    d.SendMessageTimeoutW(hwnd, WM_SYSCOMMAND, cmd, 0, SMTO_ABORTIFHUNG, 400, res);
  } catch {
    /* 目标无响应：继续走后面的流程，最坏是画面晚一帧刷新 */
  }
}

/** 分离：删任务栏条目 → 归还顶层 → 整份还原样式/位置 → 销毁容器（幂等）。 */
function detach() {
  const s = session;
  if (s === null) return { ok: true, detached: false };
  session = null;
  stopPoll();
  visibleGen++;
  if (d !== null) {
    restoreWindow(s);
    try {
      if (isWindow(s.container)) d.DestroyWindow(s.container);
    } catch {
      /* 已销毁 */
    }
  }
  emit({ type: 'detached', hwnd: s.hwnd, title: s.title });
  return { ok: true, detached: true };
}

/** attach 半途失败时的原地回滚（不 emit detached：渲染层收到的是 attach 失败）。 */
function rollback(s) {
  try {
    d.SetParent(s.hwnd, 0);
    if (s.origStyle !== 0) d.SetWindowLongPtrW(s.hwnd, GWL_STYLE, s.origStyle | 0);
    if (s.origExStyle !== 0) d.SetWindowLongPtrW(s.hwnd, GWL_EXSTYLE, s.origExStyle | 0);
    d.SetWindowPos(s.hwnd, 0, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER);
    if (isWindow(s.container)) d.DestroyWindow(s.container);
  } catch {
    /* 回滚尽力而为 */
  }
}

function restoreWindow(s) {
  try {
    if (!isWindow(s.hwnd)) return;
    d.SetParent(s.hwnd, 0);
    if (s.origStyle !== 0) d.SetWindowLongPtrW(s.hwnd, GWL_STYLE, s.origStyle | 0);
    if (s.origExStyle !== 0) d.SetWindowLongPtrW(s.hwnd, GWL_EXSTYLE, s.origExStyle | 0);
    s.placement.writeUInt32LE(44, 0);
    // 还原成什么状态由 showCmd 决定：原来最大化就写 SW_SHOWMAXIMIZED（走 SetWindowPlacement
    // 才是可靠的路径；先前用 ShowWindow(SW_MAXIMIZE) 补救，实测时灵时不灵）。
    s.placement.writeUInt32LE(s.wasZoomed ? SW_SHOWMAXIMIZED : 1 /* SW_SHOWNORMAL */, 8);
    d.SetWindowPlacement(s.hwnd, s.placement);
    d.SetWindowPos(
      s.hwnd,
      0,
      0,
      0,
      0,
      0,
      SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
    );
    d.ShowWindow(s.hwnd, SW_SHOW);
    ensureOnScreen(s.hwnd);
    // 重挂会打断 Chromium 的合成输出：强制整窗重画一遍，避免留在"灰底死画面"
    d.RedrawWindow(s.hwnd, null, 0, RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_UPDATENOW | RDW_FRAME);
  } catch {
    /* 目标可能已退出：还原失败不抛，避免把退出流程拖死 */
  }
}

/** 原屏被拔后不要恢复到不存在的坐标（复用 main.cjs loadWindowState 的同一条判定）。 */
function ensureOnScreen(hwnd) {
  try {
    const areas = hooks.getWorkAreas();
    if (!Array.isArray(areas) || areas.length === 0) return;
    const rc = Buffer.alloc(16);
    if (d.GetWindowRect(hwnd, rc) === 0) return;
    const x = rc.readInt32LE(0);
    const y = rc.readInt32LE(4);
    const w = rc.readInt32LE(8) - x;
    const h = rc.readInt32LE(12) - y;
    const visible = areas.some((a) => x < a.x + a.width && x + w > a.x && y < a.y + a.height && y + h > a.y);
    if (visible) return;
    const a = areas[0];
    d.SetWindowPos(
      hwnd,
      0,
      Math.round(a.x + (a.width - w) / 2),
      Math.round(a.y + (a.height - h) / 2),
      0,
      0,
      SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
    );
  } catch {
    /* 摆位失败不阻断分离 */
  }
}

// ---- 布局与可见性 ----

function resize(rect) {
  if (session === null) return { ok: false, error: '未寄宿' };
  const box = normalizeRect(rect);
  if (box === null) return { ok: false, error: '矩形无效' };
  session.rect = box;
  if (!isWindow(session.container)) return { ok: false, error: '容器已失效' };
  try {
    d.SetWindowPos(session.container, 0, box.x, box.y, box.width, box.height, SWP_NOZORDER | SWP_NOACTIVATE);
    // 容器尺寸变化后子窗口按容器客户区铺满（比让应用自己跟手更稳）
    d.SetWindowPos(session.hwnd, 0, 0, 0, box.width, box.height, SWP_NOZORDER | SWP_NOACTIVATE);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * 可见性只有一个推导函数（设计 §3.5 P2 修正）：attached && desiredVisible && 宿主未最小化。
 * 绝不允许"计数 +1 就 ShowWindow"的散写——那会让"最小化 + 浮层打开 + 切模式"组合出永久隐藏窗口。
 */
function computeVisible(s) {
  return s.attached && s.desiredVisible && !hooks.isHostMinimized();
}

function applyVisibility() {
  const s = session;
  if (s === null) return;
  const next = computeVisible(s);
  if (next === s.visible) return;
  s.visible = next;
  try {
    if (next) {
      d.ShowWindow(s.container, SW_SHOW);
      d.SetWindowPos(
        s.container,
        0,
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW,
      );
    } else {
      d.ShowWindow(s.container, SW_HIDE);
    }
  } catch {
    /* 容器已失效：交给轮询兜底 */
  }
  emit({ type: 'visibility', visible: next });
}

function setVisible(v) {
  if (session === null) return { ok: false, error: '未寄宿' };
  session.desiredVisible = v === true;
  applyVisibility();
  return { ok: true, visible: session.visible };
}

/** 主进程在最小化/还原/跨屏 DPI 变化时调用：重新推导可见性并重算矩形。 */
function refresh() {
  if (session === null) return { ok: true };
  applyVisibility();
  return { ok: true, visible: session.visible };
}

// ---- 失效监测 / 焦点提示 ----

function startPoll() {
  stopPoll();
  pollTimer = setInterval(tick, POLL_MS);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
}

function stopPoll() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function tick() {
  const s = session;
  if (s === null) return;
  try {
    if (!isWindow(s.hwnd)) {
      // 窗口被关掉（含 Alt+F4）：容器随之销毁，我们只负责状态收尾
      session = null;
      stopPoll();
      try {
        if (isWindow(s.container)) d.DestroyWindow(s.container);
      } catch {
        /* 忽略 */
      }
      emit({ type: 'invalid', hwnd: s.hwnd, title: s.title, reason: '被嵌窗口已关闭' });
      return;
    }
    if (d.GetAncestor(s.hwnd, GA_PARENT) !== s.container) {
      // 程序自己改回顶层（设计 §3.8「被嵌程序的反抗」）：不与之对抗，如实转已分离
      session = null;
      stopPoll();
      try {
        if (isWindow(s.container)) d.DestroyWindow(s.container);
      } catch {
        /* 忽略 */
      }
      emit({ type: 'invalid', hwnd: s.hwnd, title: s.title, reason: '窗口已自行脱离面板' });
      return;
    }
    const focused = focusInside(s);
    if (focused !== s.focused) {
      s.focused = focused;
      emit({ type: 'focus', hwnd: s.hwnd, focused });
    }
  } catch {
    /* 单次轮询失败继续下一轮 */
  }
}

/**
 * 焦点是否在寄宿窗口内。寄宿窗口已是子窗口，GetForegroundWindow 拿到的是宿主顶层窗口，
 * 所以只能问 GUI 线程的 hwndFocus 再判断是否落在容器子树里。
 */
/**
 * 焦点是否在寄宿窗口内。容器是顶层归属窗口，点进去后前台窗口会是容器本身；焦点则在被嵌
 * 程序自己的线程里，所以两条都判：前台窗口是容器，或 GUI 线程焦点落在容器子树内。
 */
function focusInside(s) {
  try {
    const foreground = d.GetForegroundWindow();
    if (foreground === s.container) return true;
    const gti = Buffer.alloc(72);
    gti.writeUInt32LE(72, 0);
    if (d.GetGUIThreadInfo(0, gti) === 0) return false;
    const focus = Number(gti.readBigUInt64LE(8));
    if (focus === 0) return false;
    return focus === s.hwnd || d.IsChild(s.container, focus) === 1;
  } catch {
    return false;
  }
}

/** 退出兜底：与 win.on('close') 共用，必须幂等（两条路径都会触发）。 */
function detachAll() {
  if (session !== null) detach();
}

module.exports = {
  init,
  available,
  unavailableReason,
  attach,
  detach,
  detachAll,
  resize,
  setVisible,
  refresh,
  isAttached,
  getState,
  // 纯函数导出：冒烟脚本直接验证解析口径
  parseSourceId,
};
