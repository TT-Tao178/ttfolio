/** 窗口嵌入面板（FR-14.3）：两条并列链路，互不影响（T-131 决策 4）。
 *  · 监控（画面）= T-102 的只读直播：desktopCapturer 枚举 + getUserMedia → <video>，画面不落盘。
 *  · 寄宿（可操作）= T-131 真嵌入：主进程 SetParent 把目标窗口变成原生子窗口，
 *    键盘/鼠标/输入法原生直达，零转发。失败与失效一律如实提示并回落监控模式。
 *  寄宿状态零持久化（决策 3）：重启后回到监控，不记忆上次寄宿的窗口。
 *  空域（原生窗口不参与 CSS 层叠）由浮层守卫处理：浮层压到寄宿区上时隐藏原生窗口、
 *  用 poster 静帧顶住，浮层收起即恢复。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App as AntdApp, Button, Modal, Segmented, Select, Space, Spin, Tooltip } from 'antd';
import {
  CloseOutlined,
  DisconnectOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useAppStore } from '@/app/store';
import { useSettings } from '@/app/settings';
import { SEMANTIC } from '@/theme/tokens';
import { deriveHostVisible } from './embedHostView';
import { useNativeOverlayGuard } from './useNativeOverlayGuard';

interface EmbedWindowInfo {
  id: string;
  name: string;
  thumbnail: string;
}

interface HostRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HostInfo {
  hwnd: number;
  title: string;
  className: string;
  dpi: number;
  taskbar: boolean;
}

type HostEvent =
  | { type: 'attached'; info: HostInfo }
  | { type: 'detached'; hwnd: number; title: string }
  | { type: 'visibility'; visible: boolean }
  | { type: 'focus'; hwnd: number; focused: boolean }
  | { type: 'invalid'; hwnd: number; title: string; reason: string };

interface NativeHost {
  attach: (
    sourceId: string,
    rect: HostRect,
  ) => Promise<{ ok: boolean; error?: string; code?: string; info?: HostInfo }>;
  snapshot: (sourceId: string, rect: HostRect) => Promise<{ ok: boolean; dataUrl: string | null }>;
  detach: () => Promise<{ ok: boolean; detached?: boolean }>;
  resize: (rect: HostRect) => void;
  setVisible: (visible: boolean) => void;
  onEvent: (cb: (e: HostEvent) => void) => () => void;
  /** 以管理员身份重启（默认不调用；仅在管理员窗口接管失败时由用户显式点击） */
  relaunchAsAdmin?: () => Promise<{ ok: boolean; error?: string }>;
  onRetryRequest?: (cb: () => void) => () => void;
}

interface NativeEmbed {
  windows: () => Promise<{ ok: boolean; error: string | null; windows: EmbedWindowInfo[] }>;
  host?: NativeHost;
}

function nativeEmbed(): NativeEmbed | null {
  return (window as unknown as { ttfolioNative?: { embed?: NativeEmbed } }).ttfolioNative?.embed ?? null;
}

const MIN_W = 260;
const MAX_W = 900;
const ALT_F4_TIP_KEY = 'ttfolio.embed.altF4TipSeen';

function altF4TipSeen(): boolean {
  try {
    return window.localStorage.getItem(ALT_F4_TIP_KEY) === '1';
  } catch {
    return true; // 存储不可用时不反复弹窗
  }
}

function markAltF4TipSeen(): void {
  try {
    window.localStorage.setItem(ALT_F4_TIP_KEY, '1');
  } catch {
    /* 忽略 */
  }
}

/** 面板矩形（CSS px，相对页面视口）——主进程负责 DIP→物理像素换算。 */
function viewportRect(el: HTMLElement): HostRect {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

type Mode = 'monitor' | 'host';
type HostStatus = 'idle' | 'attaching' | 'attached' | 'failed' | 'invalid';

const STATUS_DOT: Record<HostStatus, string> = {
  idle: SEMANTIC.textTertiary,
  attaching: SEMANTIC.warning,
  attached: SEMANTIC.success,
  failed: SEMANTIC.error,
  invalid: SEMANTIC.error,
};

const STATUS_TEXT: Record<HostStatus, string> = {
  idle: '未接管',
  attaching: '正在接管…',
  attached: '寄宿中',
  failed: '接管失败',
  invalid: '已分离',
};

export function EmbedPanel(): React.JSX.Element {
  const setEmbedOpen = useAppStore((s) => s.setEmbedOpen);
  const nativeOverlayCount = useAppStore((s) => s.nativeOverlayCount);
  const embedRetryNonce = useAppStore((s) => s.embedRetryNonce);
  const { settings, setSetting } = useSettings();
  const { message } = AntdApp.useApp();
  const [windows, setWindows] = useState<EmbedWindowInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(settings.uiLayout.embedSource ?? null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [width, setWidth] = useState(() => {
    const w = settings.uiLayout.embedWidth;
    return typeof w === 'number' && w >= MIN_W ? Math.min(MAX_W, w) : 420;
  });

  const [mode, setMode] = useState<Mode>('monitor');
  const [status, setStatus] = useState<HostStatus>('idle');
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  /** 失败类别（'elevated' = 管理员窗口，可提供提权重启入口） */
  const [hostErrorCode, setHostErrorCode] = useState<string | null>(null);
  const [elevateOpen, setElevateOpen] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [attachNonce, setAttachNonce] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const native = nativeEmbed();
  const hostApi = native?.host ?? null;

  // message 放进依赖会让 attach effect 反复重跑（上下文对象身份可能变），统一走 ref
  const messageRef = useRef(message);
  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  const refresh = useCallback(async (): Promise<void> => {
    if (native === null) return;
    setLoading(true);
    try {
      const r = await native.windows();
      if (r.ok) {
        setWindows(r.windows);
        setError(null);
      } else {
        setError(r.error ?? '无法枚举窗口');
      }
    } finally {
      setLoading(false);
    }
  }, [native]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 主进程事件（宿主持久状态只以主进程为准：已分离/失效/焦点都从这边推过来）
  useEffect(() => {
    if (hostApi === null) return undefined;
    const off = hostApi.onEvent((e) => {
      if (e.type === 'attached') {
        setHostInfo(e.info);
      } else if (e.type === 'focus') {
        setFocused(e.focused);
      } else if (e.type === 'invalid') {
        setFocused(false);
        setStatus('invalid');
        setHostError(e.reason);
        void messageRef.current.warning(e.reason);
        void refresh();
      }
    });
    return () => {
      off();
    };
  }, [hostApi, refresh]);

  // 进入寄宿：接管选中窗口；离开寄宿/换窗口/关面板时先还原（互转必先停对方资源）
  useEffect(() => {
    if (mode !== 'host' || hostApi === null) return undefined;
    const el = hostRef.current;
    if (el === null || selected === null) return undefined;
    let cancelled = false;
    setStatus('attaching');
    setHostError(null);
    const rect = viewportRect(el);
    // poster 必须在 attach 之前抓：窗口一被重挂，系统枚举就看不到它了（主进程注释里有取证）
    void hostApi
      .snapshot(selected, rect)
      .then((s) => {
        if (!cancelled && s.ok && s.dataUrl !== null) setPoster(s.dataUrl);
      })
      .catch(() => {
        /* 抓不到就显示占位，不影响接管 */
      });
    void hostApi
      .attach(selected, rect)
      .then((r) => {
        if (cancelled) return;
        if (r.ok !== true || r.info === undefined) {
          const reason = r.error ?? '未知原因';
          setStatus('failed');
          setHostError(reason);
          setHostErrorCode(r.code ?? null);
          setHostInfo(null);
          // 如实提示并回落监控模式（设计 §3.7 降级链）
          setMode('monitor');
          void messageRef.current.error(`窗口寄宿失败：${reason}（已回到监控模式）`, 6);
          return;
        }
        setHostInfo(r.info);
        setStatus('attached');
        if (!altF4TipSeen()) {
          markAltF4TipSeen();
          setTipOpen(true);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const reason = e instanceof Error ? e.message : String(e);
        setStatus('failed');
        setHostError(reason);
        setMode('monitor');
        void messageRef.current.error(`窗口寄宿失败：${reason}（已回到监控模式）`, 6);
      });
    return () => {
      cancelled = true;
      setFocused(false);
      setStatus('idle');
      setHostInfo(null);
      void hostApi.detach();
    };
  }, [mode, selected, hostApi, attachNonce]);

  // 提权重启回来的那次：直接进寄宿模式接着接管（用户已经点过确认，不该让他再点一遍）
  useEffect(() => {
    if (embedRetryNonce <= 0) return;
    setHostError(null);
    setHostErrorCode(null);
    setMode('host');
  }, [embedRetryNonce]);

  // 面板矩形变化（拖宽/窗口缩放）→ rAF 节流后重算原生窗口位置
  useEffect(() => {
    if (mode !== 'host' || status !== 'attached' || hostApi === null) return undefined;
    const el = hostRef.current;
    if (el === null) return undefined;
    let raf = 0;
    const send = (): void => {
      raf = 0;
      hostApi.resize(viewportRect(el));
    };
    const ro = new ResizeObserver(() => {
      if (raf === 0) raf = window.requestAnimationFrame(send);
    });
    ro.observe(el);
    send();
    return () => {
      ro.disconnect();
      if (raf !== 0) window.cancelAnimationFrame(raf);
    };
  }, [mode, status, hostApi]);

  // 空域守卫：浮层压到寄宿区上 → 让位给浮层；收起即恢复（可见性由主进程统一推导）
  useNativeOverlayGuard(mode === 'host' && status === 'attached', hostRef);
  useEffect(() => {
    if (hostApi === null || mode !== 'host' || status !== 'attached') return;
    hostApi.setVisible(
      deriveHostVisible({ attached: true, overlayCount: nativeOverlayCount, panelOpen: true }),
    );
  }, [nativeOverlayCount, mode, status, hostApi]);

  // 监控模式的直播流：只在监控模式拉流；切寄宿时先把流停掉（互转先停对方资源）
  useEffect(() => {
    if (mode !== 'monitor' || selected === null || videoRef.current === null) return undefined;
    let cancelled = false;
    const start = async (): Promise<void> => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // Electron 桌面捕获的 legacy 约束（只读使用，不请求音频）

            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: selected,
              maxWidth: 1280,
              maxHeight: 800,
              maxFrameRate: 8,
            },
          } as MediaTrackConstraints,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current !== null) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        setError(null);
      } catch (e) {
        setError(`无法捕获该窗口（可能受保护或已关闭）：${e instanceof Error ? e.message : String(e)}`);
      }
    };
    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [mode, selected]);

  // 宽度拖动：左缘 handle，落库 ui_layout_json.embedWidth（C-29）
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const d = dragRef.current;
      if (d === null) return;
      const w = Math.max(MIN_W, Math.min(MAX_W, d.startW + (d.startX - e.clientX)));
      setWidth(w);
    };
    const onUp = (): void => {
      if (dragRef.current === null) return;
      dragRef.current = null;
      setSetting('uiLayout', { ...settings.uiLayout, embedWidth: width });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [width, settings.uiLayout, setSetting]);

  const close = (): void => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void hostApi?.detach();
    setEmbedOpen(false);
  };

  const detachNow = (): void => {
    void hostApi?.detach();
    setFocused(false);
    setStatus('idle');
    setHostInfo(null);
    setPoster(null);
  };

  /** 管理员窗口的显式入口：确认后提权重启（默认不开启，只有用户点按钮才走这里） */
  const elevateAndRetry = (): void => {
    setElevateOpen(false);
    const fn = hostApi?.relaunchAsAdmin;
    if (fn === undefined) {
      void messageRef.current.warning('当前版本不支持提权重启');
      return;
    }
    void fn()
      .then((r) => {
        if (r.ok !== true) void messageRef.current.warning(r.error ?? '提权重启失败');
        else void messageRef.current.info('正在以管理员身份重启…', 4);
      })
      .catch((e: unknown) => {
        void messageRef.current.warning(e instanceof Error ? e.message : String(e));
      });
  };

  if (native === null) {
    return (
      <div
        style={{
          width,
          flexShrink: 0,
          borderLeft: `1px solid ${SEMANTIC.split}`,
          padding: 12,
        }}
      >
        <Alert
          type="info"
          showIcon
          message="窗口嵌入需要桌面版"
          description="浏览器（Web 模式）既无法枚举系统窗口，也无法把窗口嵌进页面；请使用安装版。"
        />
        <Button size="small" style={{ marginTop: 8 }} onClick={close}>
          关闭面板
        </Button>
      </div>
    );
  }

  const selectedName = windows.find((w) => w.id === selected)?.name ?? null;
  const missing = selected !== null && windows.length > 0 && selectedName === null;
  const hostReady = hostApi !== null;
  const blockedByOverlay = mode === 'host' && status === 'attached' && nativeOverlayCount > 0;

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        borderLeft: `1px solid ${SEMANTIC.split}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        position: 'relative',
      }}
      data-testid="embed-panel"
    >
      {/* 左缘拖动把手 */}
      <div
        onMouseDown={(e) => {
          dragRef.current = { startX: e.clientX, startW: width };
        }}
        style={{
          position: 'absolute',
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: 'col-resize',
          zIndex: 10,
        }}
        title="拖动调整面板宽度"
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          borderBottom: `1px solid ${SEMANTIC.split}`,
          flexWrap: 'wrap',
        }}
      >
        <Tooltip
          title={
            mode === 'host'
              ? '把窗口真嵌进面板：键盘、鼠标、输入法原生直达'
              : '只读监控：不注入输入、画面不落盘'
          }
        >
          <span
            style={{ fontSize: 12, fontWeight: 600, display: 'inline-flex', gap: 4, whiteSpace: 'nowrap' }}
          >
            <ExperimentOutlined /> 嵌入
          </span>
        </Tooltip>
        <Segmented
          size="small"
          value={mode}
          onChange={(v) => {
            const next = v as Mode;
            if (next === mode) return;
            if (next === 'host') {
              setHostError(null);
              setHostErrorCode(null);
            }
            setMode(next);
          }}
          options={[
            { label: '监控', value: 'monitor' },
            {
              label: '寄宿',
              value: 'host',
              disabled: !hostReady,
            },
          ]}
          data-testid="embed-mode"
        />
        <div style={{ flex: 1 }} />
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void refresh()}
        />
        <Button size="small" type="text" icon={<CloseOutlined />} onClick={close} />
      </div>

      <div style={{ padding: 8, borderBottom: `1px solid ${SEMANTIC.split}` }}>
        <Select
          size="small"
          style={{ width: '100%' }}
          placeholder="选择要嵌入的窗口"
          value={selected ?? undefined}
          onChange={(v) => {
            setSelected(v);
            setSetting('uiLayout', { ...settings.uiLayout, embedSource: v });
          }}
          showSearch
          optionFilterProp="label"
          options={windows.map((w) => ({ value: w.id, label: w.name }))}
          data-testid="embed-window-select"
        />
        {missing && (
          <div style={{ fontSize: 12, color: SEMANTIC.warning, marginTop: 6 }}>
            上次选择的窗口已不存在（可能已关闭）——请重新选择。
          </div>
        )}
        {!hostReady && (
          <div style={{ fontSize: 11, color: SEMANTIC.textTertiary, marginTop: 6 }}>
            当前版本未提供寄宿组件，仅可使用监控模式。
          </div>
        )}
        {hostError !== null && mode === 'monitor' && (
          <div style={{ fontSize: 11, color: SEMANTIC.warning, marginTop: 6, lineHeight: 1.6 }}>
            上次寄宿失败：{hostError}
            {hostErrorCode === 'elevated' && hostApi?.relaunchAsAdmin !== undefined ? (
              <div style={{ marginTop: 6 }}>
                <Button size="small" danger type="text" onClick={() => setElevateOpen(true)}>
                  以管理员身份重启后再试…
                </Button>
              </div>
            ) : (
              <div style={{ marginTop: 4 }}>（已回到监控模式）</div>
            )}
          </div>
        )}
      </div>

      {mode === 'host' && (
        <div style={{ borderBottom: `1px solid ${SEMANTIC.split}`, background: SEMANTIC.containerBg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 0' }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: STATUS_DOT[status],
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: SEMANTIC.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: '0 1 auto',
              }}
            >
              {hostInfo?.title ?? selectedName ?? '尚未接管窗口'}
            </span>
            <span style={{ fontSize: 11, color: SEMANTIC.textTertiary, whiteSpace: 'nowrap' }}>
              {STATUS_TEXT[status]}
            </span>
            <div style={{ flex: 1 }} />
            {status === 'attached' ? (
              <Button size="small" icon={<DisconnectOutlined />} onClick={detachNow}>
                分离
              </Button>
            ) : (
              <Button
                size="small"
                type="primary"
                ghost
                disabled={selected === null}
                onClick={() => setAttachNonce((n) => n + 1)}
              >
                接管
              </Button>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px 6px',
              fontSize: 11,
              lineHeight: 1.5,
              color: focused ? SEMANTIC.primary : SEMANTIC.textTertiary,
            }}
          >
            {focused ? (
              <>
                <ThunderboltOutlined /> 已接管输入：点面板外回到 ttFolio
              </>
            ) : (
              <>被嵌窗口获得焦点时 ttFolio 快捷键暂不可用</>
            )}
          </div>
        </div>
      )}

      {mode === 'host' ? (
        <div
          ref={hostRef}
          style={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            overflow: 'hidden',
            background: SEMANTIC.layoutBg,
          }}
          data-testid="embed-host-area"
        >
          {status !== 'attached' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}
            >
              {status === 'attaching' ? (
                <Space direction="vertical" align="center" size={10}>
                  <Spin size="small" />
                  <span style={{ fontSize: 12, color: SEMANTIC.textTertiary }}>正在接管窗口…</span>
                </Space>
              ) : status === 'failed' || status === 'invalid' ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ width: '100%' }}
                  message={status === 'invalid' ? '已分离' : '接管失败'}
                  description={hostError ?? '目标窗口不可用'}
                  action={
                    <Button size="small" onClick={() => setMode('monitor')}>
                      回到监控
                    </Button>
                  }
                />
              ) : (
                <div style={{ textAlign: 'center', lineHeight: 1.9 }}>
                  <div style={{ fontSize: 12, color: SEMANTIC.textSecondary }}>
                    选择窗口后这里会变成<b>真实窗口</b>：可以直接点击、打字、滚动。
                  </div>
                  <div style={{ fontSize: 11, color: SEMANTIC.textTertiary, marginTop: 6 }}>
                    经典 Win32 程序（记事本 / Notepad++ / VS Code / cmd）支持最好；
                    <br />
                    Win11 记事本、计算器这类 WinUI3 / UWP 程序会失败并回到监控。
                  </div>
                </div>
              )}
            </div>
          )}
          {blockedByOverlay &&
            (poster !== null ? (
              <img
                src={poster}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: SEMANTIC.layoutBg,
                }}
              />
            ) : (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  color: SEMANTIC.textTertiary,
                }}
              >
                浮层打开中，寄宿画面暂隐
              </div>
            ))}
          {blockedByOverlay && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                padding: '2px 8px',
                borderRadius: 10,
                fontSize: 10,
                color: SEMANTIC.textSecondary,
                background: SEMANTIC.containerBg,
                border: `1px solid ${SEMANTIC.split}`,
              }}
            >
              浮层打开中 · 画面暂隐
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, background: '#000', position: 'relative', overflow: 'hidden' }}>
          {selected === null ? (
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.55)',
                fontSize: 12,
                padding: 16,
                textAlign: 'center',
                lineHeight: 1.8,
              }}
            >
              选择一个窗口后，这里显示它的实时画面（约 5–8 fps，只读）。
              <br />
              需要直接操作它，切到「寄宿」。
            </div>
          ) : error !== null ? (
            <div style={{ padding: 12 }}>
              <Alert type="warning" showIcon message="捕获失败" description={error} />
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                muted
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                data-testid="embed-video"
              />
              {loading && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Spin />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ padding: '4px 8px', fontSize: 11, opacity: 0.55, lineHeight: 1.6 }}>
        {mode === 'host' ? (
          <span>寄宿为真嵌入：窗口归 ttFolio 托管，异常退出时会一起结束（正常退出自动还原）</span>
        ) : (
          <Space size={4}>
            <span>只读监控：不注入键盘/鼠标，不写任何文件</span>
            {settings.uiLayout.embedSource !== undefined && selected === settings.uiLayout.embedSource ? (
              <span>· 已记住选择</span>
            ) : null}
          </Space>
        )}
      </div>

      <Modal
        open={elevateOpen}
        title="以管理员身份重启 ttFolio？"
        okText="继续重启"
        cancelText="算了"
        okButtonProps={{ danger: true }}
        onOk={elevateAndRetry}
        onCancel={() => setElevateOpen(false)}
        width={460}
      >
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          <p style={{ marginTop: 0 }}>
            那个窗口以管理员权限运行，权限比 ttFolio 高，Windows 不允许普通权限的进程接管它的窗口。 让 ttFolio
            也以管理员身份运行，就能寄宿它了。
          </p>
          <p style={{ marginBottom: 4 }}>但这有代价，确认之前请先看清楚：</p>
          <ul style={{ paddingLeft: 20, marginTop: 0 }}>
            <li>
              <b>整个 ttFolio 都会在管理员权限下运行</b>
              ——包括插件脚本与所有文件操作。只在你信任这一步时使用。
            </li>
            <li>
              <b>拖拽登记会失效</b>：Windows 禁止从资源管理器往管理员权限的窗口拖文件。
            </li>
            <li>
              <b>之后每次启动都会弹一次 UAC</b>（这次也会），日常使用没必要一直提权。
            </li>
          </ul>
          <p style={{ marginBottom: 0, opacity: 0.75 }}>
            不重启也不影响别的功能——这个窗口继续用「监控」模式只读看它就好。
          </p>
        </div>
      </Modal>

      <Modal
        open={tipOpen}
        title="寄宿后的两个注意点"
        okText="知道了"
        onOk={() => setTipOpen(false)}
        onCancel={() => setTipOpen(false)}
        width={420}
      >
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          <p style={{ marginTop: 0 }}>
            <b>Alt+F4 会关闭被嵌的那个程序。</b>
            系统把关闭消息投给当前焦点窗口，而焦点在寄宿画面里——ttFolio 不装全局钩子拦截。
            如果那个窗口正跑着任务，会直接结束。想暂时离开请点面板上的「分离」。
          </p>
          <p style={{ marginBottom: 0 }}>
            <b>焦点在寄宿画面时，ttFolio 的快捷键暂时不可用</b>
            （Ctrl+K、Ctrl+` 等都要交还给被嵌窗口）。点面板以外区域即可拿回。
          </p>
        </div>
      </Modal>
    </div>
  );
}
