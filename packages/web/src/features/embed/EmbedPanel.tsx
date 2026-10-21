/** 窗口嵌入面板（FR-14.3 / T-102，T0 只读监控）：把外部运行中的窗口以实时画面贴入右侧，
 *  与内容区之间分隔条拖动比例并记忆。只读：不注入任何输入；画面不落盘。
 *  实现：Electron desktopCapturer 列窗口 + 渲染层 getUserMedia（桌面源）→ <video> 直播。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Select, Space, Spin, Tooltip } from 'antd';
import { CloseOutlined, ReloadOutlined, ExperimentOutlined } from '@ant-design/icons';
import { useAppStore } from '@/app/store';
import { useSettings } from '@/app/settings';
import { SEMANTIC } from '@/theme/tokens';

interface EmbedWindowInfo {
  id: string;
  name: string;
  thumbnail: string;
}

interface NativeEmbed {
  windows: () => Promise<{ ok: boolean; error: string | null; windows: EmbedWindowInfo[] }>;
}

function nativeEmbed(): NativeEmbed | null {
  return (window as unknown as { ttfolioNative?: { embed?: NativeEmbed } }).ttfolioNative?.embed ?? null;
}

const MIN_W = 260;
const MAX_W = 900;

export function EmbedPanel(): React.JSX.Element {
  const setEmbedOpen = useAppStore((s) => s.setEmbedOpen);
  const { settings, setSetting } = useSettings();
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

  const native = nativeEmbed();

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

  // 选窗口 → getUserMedia（桌面源）直播；切窗口/卸载时停流（诚实：不持久化画面）
  useEffect(() => {
    if (selected === null || videoRef.current === null) return undefined;
    let cancelled = false;
    const start = async (): Promise<void> => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // Electron 桌面捕获的 legacy 约束（只读使用，不请求音频）
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  }, [selected]);

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
    setEmbedOpen(false);
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
          description="浏览器（Web 模式）无法枚举与捕获系统窗口；请使用安装版。"
        />
        <Button size="small" style={{ marginTop: 8 }} onClick={close}>
          关闭面板
        </Button>
      </div>
    );
  }

  const selectedName = windows.find((w) => w.id === selected)?.name ?? null;
  const missing = selected !== null && windows.length > 0 && selectedName === null;

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
        <Tooltip title="实验性功能：只读监控（不注入输入、画面不落盘）">
          <span style={{ fontSize: 12, fontWeight: 600, display: 'inline-flex', gap: 4 }}>
            <ExperimentOutlined /> 嵌入
          </span>
        </Tooltip>
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
      </div>
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
            }}
          >
            选择一个窗口后，这里显示它的实时画面（约 5–8 fps，只读）。
            <br />
            适合盯 agent 终端、浏览器预览或长任务输出。
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
      <div style={{ padding: '4px 8px', fontSize: 11, opacity: 0.55 }}>
        <Space size={4}>
          <span>只读监控：不注入键盘/鼠标，不写任何文件</span>
          {settings.uiLayout.embedSource !== undefined && selected === settings.uiLayout.embedSource ? (
            <span>· 已记住选择</span>
          ) : null}
        </Space>
      </div>
    </div>
  );
}
