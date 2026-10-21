/** 插件广场（FR-14.1 / T-101）：①内置与已装（启停/卸载/权限/命令/运行）②在线市场（可选，断网降级）。 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  List,
  Modal,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { DownloadOutlined, ReloadOutlined, PlayCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import { api, ApiClientError } from '@/lib/api';
import { subscribeSseEvents } from '@/app/sse';
import { useSettings } from '@/app/settings';
import { SEMANTIC } from '@/theme/tokens';

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  author: string | null;
  kind: 'declarative' | 'script';
  enabled: boolean;
  builtin: boolean;
  installedAt: string;
  dirPath: string | null;
  description: string | null;
  permissions: string[];
  commands: Array<{ id: string; title: string }>;
  cards: Array<{ id: string; title: string; value?: number }>;
}

interface MarketResult {
  online: boolean;
  reason: string | null;
  plugins: Array<Record<string, unknown>>;
}

const PERMISSION_LABELS: Record<string, string> = {
  'projects.read': '读取项目元数据',
  'analysis.trigger': '触发重新分析',
  'panel.output': '向插件页输出',
  'commands.contribute': '贡献命令',
};

export function PluginsPage(): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const [output, setOutput] = useState<string[]>([]);
  const [installOpen, setInstallOpen] = useState(false);
  const [marketUrl, setMarketUrl] = useState('');
  const [market, setMarket] = useState<MarketResult | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);

  const { data: plugins } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.get<PluginInfo[]>('/api/plugins'),
  });
  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['plugins'] });
  }, [queryClient]);

  useEffect(() => {
    const off = subscribeSseEvents((e) => {
      if (e.event === 'plugin.output') {
        setOutput((prev) => {
          const line = String(e.data['line'] ?? '');
          const next = [...prev, line];
          return next.length > 200 ? next.slice(next.length - 200) : next;
        });
      }
      if (e.event === 'plugin.changed') refresh();
    });
    return off;
  }, [refresh]);

  const toggle = async (p: PluginInfo, enabled: boolean): Promise<void> => {
    try {
      await api.patch(`/api/plugins/${p.id}`, { enabled });
      refresh();
      void message.success(enabled ? `已启用 ${p.name}` : `已停用 ${p.name}`);
    } catch (e) {
      void message.error(e instanceof ApiClientError ? e.message : '操作失败');
    }
  };
  const uninstall = (p: PluginInfo): void => {
    modal.confirm({
      title: `卸载「${p.name}」？`,
      content:
        p.kind === 'script' ? '只移除登记，插件目录与脚本文件不受影响。' : '只移除登记，不涉及任何磁盘文件。',
      okText: '卸载',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.del(`/api/plugins/${p.id}`);
          refresh();
          void message.success('已卸载');
        } catch (e) {
          void message.error(e instanceof ApiClientError ? e.message : '卸载失败');
        }
      },
    });
  };
  const run = async (p: PluginInfo): Promise<void> => {
    setOutput([]);
    try {
      const r = await api.post<{ ok: boolean; error: string | null }>(`/api/plugins/${p.id}/run`, {});
      if (r.ok) void message.success('执行完成');
      else void message.error(r.error ?? '执行失败');
    } catch (e) {
      void message.error(e instanceof ApiClientError ? e.message : '执行失败');
    }
  };

  const loadMarket = async (): Promise<void> => {
    if (marketUrl.trim() === '') {
      setMarket({ online: false, reason: '未填写在线市场索引地址（离线为正常状态）', plugins: [] });
      return;
    }
    setMarketLoading(true);
    try {
      const r = await api.get<MarketResult>('/api/plugins/market', { url: marketUrl.trim() });
      setMarket(r);
    } catch (e) {
      setMarket({ online: false, reason: e instanceof ApiClientError ? e.message : '联网失败', plugins: [] });
    } finally {
      setMarketLoading(false);
    }
  };

  const installed = plugins ?? [];
  const builtin = installed.filter((p) => p.builtin);
  const third = installed.filter((p) => !p.builtin);

  const renderPlugin = (p: PluginInfo): React.JSX.Element => (
    <List.Item
      key={p.id}
      actions={[
        p.kind === 'script' ? (
          <Button key="run" size="small" icon={<PlayCircleOutlined />} onClick={() => void run(p)}>
            运行
          </Button>
        ) : null,
        !p.builtin ? (
          <Button
            key="del"
            size="small"
            danger
            type="text"
            icon={<DeleteOutlined />}
            onClick={() => uninstall(p)}
          />
        ) : null,
        <Switch
          key="sw"
          size="small"
          checked={p.enabled}
          onChange={(v) => void toggle(p, v)}
          aria-label={`启用 ${p.name}`}
        />,
      ]}
    >
      <List.Item.Meta
        title={
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <strong>{p.name}</strong>
            <Tag style={{ fontSize: 10 }}>v{p.version}</Tag>
            <Tag color={p.kind === 'script' ? 'orange' : 'blue'} style={{ fontSize: 10 }}>
              {p.kind === 'script' ? '脚本' : '声明式'}
            </Tag>
            {p.builtin && <Tag style={{ fontSize: 10 }}>内置</Tag>}
            {!p.enabled && <Tag style={{ fontSize: 10 }}>已停用</Tag>}
          </span>
        }
        description={
          <div style={{ fontSize: 12 }}>
            <div>
              {p.description ?? '（无描述）'}
              {p.author !== null ? ` · 作者 ${p.author}` : ''}
            </div>
            <div style={{ marginTop: 4 }}>
              权限：
              {p.permissions.length === 0 ? (
                <span style={{ opacity: 0.6 }}>无</span>
              ) : (
                p.permissions.map((x) => (
                  <Tag key={x} style={{ fontSize: 10 }}>
                    {PERMISSION_LABELS[x] ?? x}
                  </Tag>
                ))
              )}
            </div>
            {p.commands.length > 0 && (
              <div style={{ marginTop: 4, opacity: 0.75 }}>
                命令：{p.commands.map((c) => c.title).join('、')}（命令面板可搜）
              </div>
            )}
            {p.cards.map((c) => (
              <div key={c.id} style={{ marginTop: 4 }}>
                信息卡：{c.title} <strong>{c.value ?? '—'}</strong>
              </div>
            ))}
            {p.dirPath !== null && (
              <div style={{ marginTop: 4, opacity: 0.5 }} className="tt-mono">
                目录：{p.dirPath}
              </div>
            )}
          </div>
        }
      />
    </List.Item>
  );

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 16px' }} data-testid="plugins-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          插件广场
        </Typography.Title>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          本地优先：断网时全部本地功能可用，在线市场仅作可选补充
        </span>
        <div style={{ flex: 1 }} />
        <Button
          icon={<DownloadOutlined />}
          onClick={() => setInstallOpen(true)}
          data-testid="plugin-install-btn"
        >
          安装插件…
        </Button>
        <Button icon={<ReloadOutlined />} onClick={refresh} />
      </div>
      <Tabs
        items={[
          {
            key: 'local',
            label: `内置与已装（${installed.length}）`,
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card size="small" title={`内置（${builtin.length}）`}>
                  {builtin.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本版未内置插件" />
                  ) : (
                    <List size="small" dataSource={builtin} renderItem={renderPlugin} />
                  )}
                </Card>
                <Card size="small" title={`本地已装（${third.length}）`}>
                  {third.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="还没有手动安装的插件；可从本地目录（含 plugin.json）或粘贴清单 JSON 安装"
                    />
                  ) : (
                    <List size="small" dataSource={third} renderItem={renderPlugin} />
                  )}
                </Card>
                {output.length > 0 && (
                  <Card
                    size="small"
                    title="插件输出"
                    extra={
                      <Button size="small" onClick={() => setOutput([])}>
                        清空
                      </Button>
                    }
                  >
                    <pre
                      className="tt-mono"
                      style={{
                        fontSize: 12,
                        maxHeight: 240,
                        overflow: 'auto',
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        background: 'transparent',
                      }}
                      data-testid="plugin-output"
                    >
                      {output.join('\n')}
                    </pre>
                  </Card>
                )}
              </Space>
            ),
          },
          {
            key: 'market',
            label: '在线市场（可选）',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    placeholder="在线市场索引 JSON 地址（https://…）；留空则保持离线"
                    value={marketUrl}
                    onChange={(e) => setMarketUrl(e.target.value)}
                    onPressEnter={() => void loadMarket()}
                  />
                  <Button loading={marketLoading} onClick={() => void loadMarket()}>
                    拉取索引
                  </Button>
                </Space.Compact>
                {market !== null &&
                  (market.online ? (
                    market.plugins.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="索引里没有可安装的插件" />
                    ) : (
                      <List
                        size="small"
                        dataSource={market.plugins}
                        renderItem={(item) => {
                          const name = String(item['name'] ?? item['id'] ?? '未命名');
                          const manifest = item['manifest'];
                          return (
                            <List.Item
                              actions={[
                                <Button
                                  key="i"
                                  size="small"
                                  disabled={typeof manifest !== 'object' || manifest === null}
                                  onClick={async () => {
                                    try {
                                      await api.post('/api/plugins/install', { manifest });
                                      refresh();
                                      void message.success(`已安装 ${name}`);
                                    } catch (e) {
                                      void message.error(
                                        e instanceof ApiClientError ? e.message : '安装失败',
                                      );
                                    }
                                  }}
                                >
                                  安装
                                </Button>,
                              ]}
                            >
                              <List.Item.Meta
                                title={name}
                                description={
                                  <span style={{ fontSize: 12 }}>
                                    {String(item['description'] ?? '')}
                                    {typeof manifest !== 'object' && '（该条目未内嵌清单，无法直接安装）'}
                                  </span>
                                }
                              />
                            </List.Item>
                          );
                        }}
                      />
                    )
                  ) : (
                    <Alert
                      type="info"
                      showIcon
                      message="在线市场不可用——已降级为仅本地"
                      description={market.reason ?? '断网或地址不可达；本地插件功能不受影响'}
                    />
                  ))}
                {settings !== undefined && null}
              </Space>
            ),
          },
        ]}
      />
      <InstallPluginModal
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        onInstalled={() => {
          setInstallOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

/** 安装：粘贴清单 JSON（声明式）或选择本地目录（脚本插件）。权限确认后提交。 */
function InstallPluginModal({
  open,
  onClose,
  onInstalled,
}: {
  open: boolean;
  onClose: () => void;
  onInstalled: () => void;
}): React.JSX.Element {
  const { message } = App.useApp();
  const [manifestText, setManifestText] = useState('');
  const [dirPath, setDirPath] = useState('');
  const [busy, setBusy] = useState(false);

  const pickDir = async (): Promise<void> => {
    try {
      void message.info('正在弹出系统对话框；若被其他窗口挡住请按 Alt+Tab', 5);
      const r = await api.post<{ paths: string[] }>('/api/dialogs/pick-folder');
      const dir = r.paths[0];
      if (dir !== undefined) setDirPath(dir);
    } catch {
      void message.error('打开系统对话框失败');
    }
  };

  const install = async (): Promise<void> => {
    setBusy(true);
    try {
      let body: { manifest?: unknown; dirPath?: string };
      if (dirPath.trim() !== '') {
        body = { dirPath: dirPath.trim() };
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(manifestText);
        } catch {
          void message.error('清单不是合法 JSON');
          return;
        }
        body = { manifest: parsed };
      }
      await api.post('/api/plugins/install', body);
      void message.success('已安装（可在上方启用/停用）');
      onInstalled();
    } catch (e) {
      void message.error(e instanceof ApiClientError ? e.message : '安装失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="安装插件"
      open={open}
      onCancel={onClose}
      confirmLoading={busy}
      okText="安装"
      onOk={() => void install()}
      width={640}
      data-testid="plugin-install-modal"
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          message="只安装可信来源的插件"
          description="声明式插件零代码（只贡献命令与信息卡）；脚本插件会在本应用进程内执行，宿主只提供受控 API（读项目元数据/触发分析/输出），不提供文件系统句柄——但同进程脚本不是安全沙箱，请只装自己或可信作者的插件。"
        />
        <div>
          <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>
            方式一：本地插件目录（含 plugin.json）
          </div>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={dirPath}
              onChange={(e) => setDirPath(e.target.value)}
              placeholder="D:\demo\my-plugin"
            />
            <Button onClick={() => void pickDir()}>选择目录…</Button>
          </Space.Compact>
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>
            方式二：粘贴声明式清单 JSON（上面的目录留空时生效）
          </div>
          <Input.TextArea
            rows={8}
            value={manifestText}
            onChange={(e) => setManifestText(e.target.value)}
            placeholder={`{
  "id": "demo.hello",
  "name": "演示插件",
  "version": "1.0.0",
  "kind": "declarative",
  "permissions": ["commands.contribute"],
  "contributes": {
    "commands": [
      { "id": "hi", "title": "演示：打个招呼", "action": { "type": "message", "text": "你好" } }
    ]
  }
}`}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </div>
        <div style={{ fontSize: 12, opacity: 0.55, borderTop: `1px solid ${SEMANTIC.split}`, paddingTop: 8 }}>
          安装时会校验清单与权限白名单；安装动作记审计（L2）。内置插件只能禁用、不能卸载。
        </div>
      </Space>
    </Modal>
  );
}
