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
const WS_EX_TOOLWINDOW = 0x00000080;

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
  const ole32 = koffi.load('ole32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  return {
    IsWindow: user32.func('int32_t IsWindow(intptr_t)'),
    IsChild: user32.func('int32_t IsChild(intptr_t parent, intptr_t child)'),
    GetClassNameW: user32.func('int32_t GetClassNameW(intptr_t, void *buf, int32_t max)'),
    GetWindowTextW: user32.func('int32_t GetWindowTextW(intptr_t, void *buf, int32_t max)'),
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
    SetWindowPos: user32.func(
      'int32_t SetWindowPos(intptr_t, intptr_t, int32_t, int32_t, int32_t, int32_t, uint32_t)',
    ),
    GetWindowPlacement: user32.func('int32_t GetWindowPlacement(intptr_t, void *wp)'),
    SetWindowPlacement: user32.func('int32_t SetWindowPlacement(intptr_t, void *wp)'),
    GetWindowDpiAwarenessContext: user32.func('intptr_t GetWindowDpiAwarenessContext(intptr_t)'),
    GetDpiForWindow: user32.func('uint32_t GetDpiForWindow(intptr_t)'),
    SetThreadDpiAwarenessContext: user32.func('intptr_t SetThreadDpiAwarenessContext(intptr_t)'),
    SetThreadDpiHostingBehavior: user32.func('int32_t SetThreadDpiHostingBehavior(int32_t)'),
    GetGUIThreadInfo: user32.func('int32_t GetGUIThreadInfo(uint32_t tid, void *info)'),
    CoInitializeEx: ole32.func('int32_t CoInitializeEx(intptr_t, uint32_t)'),
    CoCreateInstance: ole32.func(
      'int32_t CoCreateInstance(void *clsid, intptr_t outer, uint32_t ctx, void *iid, void **ppv)',
    ),
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

// ---- COM：ITaskbarList（任务栏保留，Phase 0 S6 已验 AddTab=S_OK）----
let taskbar = null;
let taskbarError = null;

function initTaskbar() {
  if (taskbar !== null || taskbarError !== null) return taskbarError;
  try {
    // STA。Electron 主线程可能已被别处初始化成 MTA，RPC_E_CHANGED_MODE(0x80010106) 不算失败
    const hrCo = d.CoInitializeEx(0, 2);
    // 0=S_OK，1=S_FALSE（同模式已初始化，正常），0x80010106=RPC_E_CHANGED_MODE（别处已把线程
    // 初始化成 MTA，进程内 STA 对象仍可创建）。这三种都继续；其余如实报错。
    // 注意：只认 0 会漏掉 S_FALSE——Electron 主线程进 whenReady 时已是 STA，必然返回 S_FALSE。
    const coOk = hrCo === 0 || hrCo >>> 0 === 1 || hrCo >>> 0 === 0x80010106;
    if (!coOk) {
      throw new Error(`CoInitializeEx=0x${(hrCo >>> 0).toString(16)}`);
    }
    const clsid = guidBuf(0x56fdf344, 0xfd6d, 0x11d0, [0x95, 0x8a, 0x00, 0x60, 0x97, 0xc9, 0xa0, 0x90]);
    const iid = guidBuf(0x56fdf342, 0xfd6d, 0x11d0, [0x95, 0x8a, 0x00, 0x60, 0x97, 0xc9, 0xa0, 0x90]);
    const ppv = koffi.alloc('void *', 1);
    const hr = d.CoCreateInstance(clsid, 0, 1 /* CLSCTX_INPROC_SERVER */, iid, ppv);
    if (hr !== 0) throw new Error(`CoCreateInstance=0x${(hr >>> 0).toString(16)}`);
    const obj = koffi.decode(ppv, 'void *');
    const vt = koffi.decode(obj, 'void **');
    const hrInitProto = koffi.proto('int32_t t131_hr_init(void *self)');
    const hrInit = koffi.call(koffi.decode(vt, 24, 'void *'), hrInitProto, obj);
    if (hrInit !== 0) throw new Error(`HrInit=0x${(hrInit >>> 0).toString(16)}`);
    const addProto = koffi.proto('int32_t t131_add_tab(void *self, intptr_t hwnd)');
    const delProto = koffi.proto('int32_t t131_del_tab(void *self, intptr_t hwnd)');
    taskbar = {
      add: (hwnd) => koffi.call(koffi.decode(vt, 32, 'void *'), addProto, obj, hwnd),
      del: (hwnd) => koffi.call(koffi.decode(vt, 40, 'void *'), delProto, obj, hwnd),
    };
    return null;
  } catch (err) {
    taskbarError = err instanceof Error ? err : new Error(String(err));
    return taskbarError;
  }
}

function guidBuf(d1, d2, d3, tail) {
  const b = Buffer.alloc(16);
  b.writeUInt32LE(d1, 0);
  b.writeUInt16LE(d2, 4);
  b.writeUInt16LE(d3, 6);
  for (let i = 0; i < 8; i++) b[8 + i] = tail[i];
  return b;
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
  };

  // DPI 状态窗口法（设计 §3.1）：容器必须与目标的感知上下文一致，否则 SetParent 行为未定义。
  // 成对切换 → 建窗口 → 立即还原，期间 JS 不重入、Chromium 消息循环也插不进来。
  // 容器是**归属于宿主窗口的顶层弹出窗口**（WS_POPUP + hWndParent=owner），不是 WS_CHILD：
  // Electron 的合成层（DComp）会整片盖住客户区里的原生子窗口，真机探针实测子窗口方案像素全白；
  // 归属性弹出窗口由 DWM 保证压在 owner 之上、随 owner 最小化、不进 Alt+Tab，实测渲染正确。
  let container = 0;
  try {
    const oldHosting = d.SetThreadDpiHostingBehavior(2 /* MIXED */);
    const targetCtx = d.GetWindowDpiAwarenessContext(hwnd);
    const oldCtx = targetCtx !== 0 ? d.SetThreadDpiAwarenessContext(targetCtx) : 0;
    try {
      container = d.CreateWindowExW(
        WS_EX_TOOLWINDOW,
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
  } catch (err) {
    // 半途失败：原地回滚，绝不留下"样式被改、父窗口还被挂着"的残局
    rollback(s);
    return fail(errMsg(err), 'attach');
  }

  s.attached = true;
  session = s;
  s.taskbar = addTaskbarTab(hwnd);
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

function addTaskbarTab(hwnd) {
  const err = initTaskbar();
  if (err !== null || taskbar === null) return false;
  try {
    return taskbar.add(hwnd) === 0;
  } catch {
    return false;
  }
}

function removeTaskbarTab(hwnd) {
  if (taskbar === null) return;
  try {
    taskbar.del(hwnd);
  } catch {
    /* 忽略 */
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
    removeTaskbarTab(s.hwnd);
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
