/** 设置页（FR-11.x / FR-2.7 / FR-10.3 / FR-12.x）：外观/数据源/忽略规则/命令模板/监听/数据与备份/关于。 */
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Image,
  Input,
  InputNumber,
  List,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError, downloadWithToken } from '@/lib/api';
import type { CommandTemplate, IgnoreRule, CollectionInfo } from '@ttfolio/shared';
import { fmtBytes } from '@/lib/format';
import { useSettings } from '@/app/settings';
import { CollectionEditModal } from '@/features/workbench/CollectionEditModal';
import { TagHub } from './TagHub';
import { HealthCard } from './HealthCard';
import { UpdateCheck } from './UpdateCheck';
import sponsorAlipay from '@/assets/sponsor/alipay.jpg';
import sponsorWechat from '@/assets/sponsor/wechat.jpg';
import { SEMANTIC } from '@/theme/tokens';
import { sectionDomId, sectionTitle } from './sections';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { cmTheme, cmHighlight } from '@/theme/codemirror';
import { langExtension } from '@/features/files/langExt';
import { useSettingsDark } from '@/features/files/useDark';
import { BUILTIN_COMMANDS, chordFromEvent, effectiveChord } from '@/features/command/registry';

/**
 * 默认架构图目录名输入：改为**受控 + 跟服务端值同步**。
 * 原先用 defaultValue：只在挂载时读一次，而设置是异步到达的（先给 DEFAULT_SETTINGS 占位），
 * 于是显示的是占位默认值、服务端值到了也不更新；且只在按回车时保存，失焦即丢。
 */
function ArchDirInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}): React.JSX.Element {
  const [text, setText] = useState(value);
  React.useEffect(() => {
    setText(value);
  }, [value]);
  const commit = (): void => {
    const next = text.trim();
    if (next !== '' && next !== value) onCommit(next);
  };
  return (
    // AntD 的 Input 与 Switch/InputNumber 一样不透传 data-testid，故用一层 span 承载
    <span data-testid="set-arch-dir">
      <Input
        size="small"
        style={{ width: 160 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onPressEnter={commit}
      />
    </span>
  );
}

/**
 * 分组锚点：侧栏「设置」域点某分组后按 id 滚动到对应卡片。
 * 锚点 div 必须是栅格的直接子元素（包裹卡片），否则滚动定位会落到栅格外。
 */
function SectionAnchor({ id, children }: { id: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div id={sectionDomId(id)} style={{ scrollMarginTop: 8, minWidth: 0 }}>
      {children}
    </div>
  );
}

export function SettingsPage({ anchor = null }: { anchor?: string | null }): React.JSX.Element {
  const dark = useSettingsDark();
  const { settings, setSetting } = useSettings();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [newRule, setNewRule] = useState('');
  const [newTpl, setNewTpl] = useState<{ label: string; executable: string; args: string } | null>(null);
  const [collectionName, setCollectionName] = useState('');

  // 侧栏点了某个设置分组 → 滚到该分组（anchor 变化即滚动；同一分组重复点击也会重新定位）
  React.useEffect(() => {
    if (anchor === null || anchor === '') return;
    const el = document.getElementById(sectionDomId(anchor));
    if (el !== null) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [anchor]);

  const { data: stats } = useQuery({
    queryKey: ['data-stats'],
    queryFn: () =>
      api.get<{
        dbPath: string;
        dbSize: number;
        trashPath: string;
        trashCount: number;
        trashBytes: number;
        backupDir: string;
        backups: Array<{ name: string; size: number }>;
        logDir: string;
        logSize: number;
      }>('/api/data-stats'),
  });
  const { data: rules } = useQuery({
    queryKey: ['ignore-rules'],
    queryFn: () => api.get<IgnoreRule[]>('/api/ignore-rules'),
  });
  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<CommandTemplate[]>('/api/command-templates'),
  });
  const { data: docRoots } = useQuery({
    queryKey: ['doc-roots'],
    queryFn: () => api.get<Array<{ id: string; label: string | null; path: string }>>('/api/doc-roots'),
  });
  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionInfo[]>('/api/collections'),
  });
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () =>
      api.get<{ version: string; port: number; userContentPort: number; dataDir: string; dbPath: string }>(
        '/api/health',
      ),
  });

  const invalidate = (): void => void queryClient.invalidateQueries();

  const backup = useMutation({
    mutationFn: () => api.post('/api/backup'),
    onSuccess: () => {
      void message.success('备份完成');
      invalidate();
    },
  });
  const resetLib = useMutation({
    mutationFn: () => api.post('/api/library/reset', { confirm: true, confirmText: '清空索引库' }),
    onSuccess: () => {
      void message.success('索引库已清空（项目文件未动）。请刷新页面重新登记。');
      invalidate();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '失败'),
  });

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }} data-testid="settings-page">
      {/* 对齐原型设置屏：页头 + 分组卡片栅格（不再是 860px 单列 Divider 流，右侧大片留白） */}
      <Typography.Title level={4} style={{ margin: 0 }}>
        设置
      </Typography.Title>
      <div style={{ fontSize: 12, color: SEMANTIC.textTertiary, marginTop: 2 }}>
        顶栏刻意不放路径与重扫 —— 数据源相关的都收在这里；点左侧分组名可滚动定位。
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          alignItems: 'stretch',
          marginTop: 12,
        }}
      >
        <SectionAnchor id="appearance">
          <Card size="small" title={sectionTitle('appearance')}>
            <Form layout="inline" labelWrap>
              <Form.Item label="主题">
                <Segmented
                  data-testid="set-theme"
                  value={settings.theme}
                  onChange={(v) => setSetting('theme', v)}
                  options={[
                    { label: '浅色（默认）', value: 'light' },
                    { label: '深色', value: 'dark' },
                    { label: '电红色发光', value: 'oled' },
                    { label: '赛博朋克', value: 'cyberpunk' },
                    { label: '极简手绘', value: 'sketch' },
                    { label: '跟随系统', value: 'system' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="密度">
                <Segmented
                  data-testid="set-density"
                  value={settings.density}
                  onChange={(v) => setSetting('density', v)}
                  options={[
                    { label: '紧凑', value: 'small' },
                    { label: '标准', value: 'middle' },
                    { label: '舒适', value: 'large' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="代码配色">
                <Segmented
                  data-testid="set-syntax-scheme"
                  value={settings.syntaxScheme}
                  onChange={(v) => setSetting('syntaxScheme', v)}
                  options={[
                    { label: '经典（默认）', value: 'classic' },
                    { label: '暖纸', value: 'warm' },
                    { label: '高对比霓虹', value: 'neon' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="项目页默认落点">
                <Select
                  data-testid="set-default-tab"
                  value={settings.defaultProjectTab}
                  onChange={(v) => setSetting('defaultProjectTab', v)}
                  style={{ width: 120 }}
                  options={[
                    { value: 'files', label: '文件' },
                    { value: 'overview', label: '概览' },
                  ]}
                />
              </Form.Item>
            </Form>
            <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 0 }}>
              卡片列数自适应窗口宽度；代码配色独立于主题（编辑器 / 文档代码块 /
              动态视图三处一致）；快捷键表见「?」帮助（Ctrl+, 打开本页）。
            </p>
            <SchemePreview dark={dark} scheme={settings.syntaxScheme} />
          </Card>
        </SectionAnchor>

        <SectionAnchor id="datasource">
          <Card size="small" title={sectionTitle('datasource')}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="文档根">
                {(docRoots ?? []).length === 0 ? '未配置' : ''}
                {(docRoots ?? []).map((r) => (
                  <Tag
                    key={r.id}
                    closable
                    onClose={() => {
                      void api.del(`/api/doc-roots/${r.id}`).then(invalidate);
                    }}
                    className="tt-ellipsis"
                    style={{ maxWidth: 300 }}
                  >
                    {r.label ?? r.path}
                  </Tag>
                ))}
                <Button
                  size="small"
                  style={{ marginLeft: 6 }}
                  onClick={() => {
                    void message.info('正在弹出系统对话框；若被其他窗口挡住，请按 Alt+Tab 查看', 5);
                    void api
                      .post('/api/dialogs/pick-folder')
                      .then((r) => {
                        const p = (r as { paths: string[] }).paths[0];
                        if (p !== undefined) void api.post('/api/doc-roots', { path: p }).then(invalidate);
                      })
                      .catch(() => {
                        void message.error('打开系统对话框失败，请手动登记路径');
                      });
                  }}
                >
                  添加文档根
                </Button>
              </Descriptions.Item>
              <Descriptions.Item label="默认架构图目录名">
                <ArchDirInput
                  value={settings.defaultArchDirName}
                  onCommit={(v) => setSetting('defaultArchDirName', v)}
                />
              </Descriptions.Item>
              <Descriptions.Item label="扫描根目录（预留，不实现自动扫描）">
                <Input
                  size="small"
                  disabled
                  placeholder="当前版本只支持手动添加项目"
                  style={{ width: 300 }}
                />
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </SectionAnchor>

        <SectionAnchor id="collections">
          <Card size="small" title={sectionTitle('collections')}>
            <CollectionsCard
              collections={collections ?? []}
              name={collectionName}
              setName={setCollectionName}
              onChange={invalidate}
            />
          </Card>
        </SectionAnchor>

        <SectionAnchor id="tags">
          <Card size="small" title={sectionTitle('tags')}>
            <TagHub />
          </Card>
        </SectionAnchor>

        <SectionAnchor id="ignore">
          <Card size="small" title={sectionTitle('ignore')}>
            <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
              <Input
                value={newRule}
                onChange={(e) => setNewRule(e.target.value)}
                placeholder="新增规则，如 *.bak 或 temp-dir"
              />
              <Button
                type="primary"
                onClick={() => {
                  if (newRule.trim() === '') return;
                  void api.post('/api/ignore-rules', { pattern: newRule.trim(), mode: 'hide' }).then(() => {
                    setNewRule('');
                    invalidate();
                  });
                }}
              >
                添加
              </Button>
            </Space.Compact>
            <div
              style={{
                maxHeight: 220,
                overflow: 'auto',
                border: `1px solid ${SEMANTIC.split}`,
                borderRadius: 6,
                padding: 8,
              }}
            >
              {(rules ?? []).map((r) => (
                <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '1px 0' }}>
                  <span className="tt-mono" style={{ flex: 1, fontSize: 12 }}>
                    {r.pattern}
                  </span>
                  <Tag>{r.mode === 'hide' ? '隐藏' : '仅统计时忽略'}</Tag>
                  {r.isBuiltin && <Tag>内置</Tag>}
                  <Switch
                    size="small"
                    checked={r.enabled}
                    onChange={(v) =>
                      void api.patch(`/api/ignore-rules/${r.id}`, { enabled: v }).then(invalidate)
                    }
                  />
                  {!r.isBuiltin && (
                    <Button
                      size="small"
                      type="text"
                      danger
                      onClick={() => void api.del(`/api/ignore-rules/${r.id}`).then(invalidate)}
                    >
                      删除
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </SectionAnchor>

        <SectionAnchor id="templates">
          <Card size="small" title={sectionTitle('templates')}>
            <List
              size="small"
              dataSource={templates ?? []}
              renderItem={(t) => (
                <List.Item style={{ padding: '3px 0' }}>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', width: '100%' }}>
                    <strong style={{ width: 130 }}>{t.label}</strong>
                    <span className="tt-mono tt-ellipsis" style={{ fontSize: 12, flex: 1 }}>
                      {t.executable} {t.argsJson.join(' ')}
                    </span>
                    {t.isBuiltin && <Tag>内置</Tag>}
                    <Switch
                      size="small"
                      checked={t.enabled}
                      onChange={(v) =>
                        void api.patch(`/api/command-templates/${t.id}`, { enabled: v }).then(invalidate)
                      }
                    />
                  </span>
                </List.Item>
              )}
            />
            <Button
              size="small"
              style={{ marginTop: 6 }}
              onClick={() => setNewTpl({ label: '', executable: '', args: '{path}' })}
            >
              新增模板…
            </Button>
            <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 0 }}>
              模板必须包含占位符 {'{path}'} / {'{file}'} / {'{project}'} / {'{paths}'} 之一；以「可执行文件 +
              参数数组」执行，禁止 shell 拼接。语义：{'{path}'}=目标路径、{'{file}'}
              =文件名（目标为目录时为空）、
              {'{project}'}=项目目录名、{'{paths}'}=路径（多路径预留）。
            </p>
          </Card>
        </SectionAnchor>

        <SectionAnchor id="shortcuts">
          <Card size="small" title={sectionTitle('shortcuts')}>
            <p style={{ fontSize: 12, opacity: 0.65, marginTop: 0 }}>
              快捷键由命令注册表生成，「?」帮助同步更新。至少要带一个修饰键（Ctrl/Shift/Alt），
              避免抢普通输入；改绑与其它命令冲突时会提示。保存/搜索/切页签均可改。
            </p>
            <KeybindingsCard />
          </Card>
        </SectionAnchor>

        <SectionAnchor id="watch">
          <Card size="small" title={sectionTitle('watch')}>
            <Form layout="inline">
              <Form.Item label="启用监听">
                {/* AntD 的 Switch / InputNumber 不透传 data-testid，故用一层 span 承载，便于自动化定位
                    （此前用 .ant-switch 下标定位，撞上前面 51 条忽略规则的开关，点错了目标） */}
                <span data-testid="set-watch">
                  <Switch checked={settings.watchEnabled} onChange={(v) => setSetting('watchEnabled', v)} />
                </span>
              </Form.Item>
              <Form.Item label="写入稳定窗口 (ms)">
                <span data-testid="set-watch-stability">
                  <InputNumber
                    value={settings.watchStabilityMs}
                    min={100}
                    max={3000}
                    step={100}
                    onChange={(v) => setSetting('watchStabilityMs', v)}
                  />
                </span>
              </Form.Item>
              <Form.Item label="自动保存（防抖 2s，默认关）">
                <span data-testid="set-autosave">
                  <Switch checked={settings.autoSave} onChange={(v) => setSetting('autoSave', v)} />
                </span>
              </Form.Item>
            </Form>
          </Card>
        </SectionAnchor>

        <SectionAnchor id="data">
          <Card size="small" title={sectionTitle('data')}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="索引库">
                {stats?.dbPath ?? '—'}（{fmtBytes(stats?.dbSize ?? 0)}）
              </Descriptions.Item>
              <Descriptions.Item label="回收站">
                {stats?.trashPath ?? '—'}（{stats?.trashCount ?? 0} 条 / {fmtBytes(stats?.trashBytes ?? 0)}）
              </Descriptions.Item>
              <Descriptions.Item label="备份目录">{stats?.backupDir ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="日志目录">
                <Space wrap>
                  <span className="tt-ellipsis" style={{ maxWidth: 380 }}>
                    {stats?.logDir ?? '—'}
                  </span>
                  {/* FR-11.6：打开日志目录。路径由服务端决定（应用数据目录下的 logs/），前端只发一个开关值，
                      客户端无法借这个入口打开任意路径（C-22/C-23 的白名单边界不放松）。 */}
                  <Button
                    size="small"
                    data-testid="open-logs"
                    onClick={() => {
                      void api
                        .post('/api/open', { target: 'logs' })
                        .then(() => void message.success('已用资源管理器打开日志目录'))
                        .catch(
                          (e: unknown) =>
                            void message.error(e instanceof ApiClientError ? e.message : '打开日志目录失败'),
                        );
                    }}
                  >
                    打开日志
                  </Button>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="导出清单">
                <Space>
                  <Button
                    size="small"
                    data-testid="export-json"
                    onClick={() => {
                      void downloadWithToken('/api/export/projects.json', 'ttfolio-projects.json')
                        .then(() => message.success('已导出 JSON'))
                        .catch(
                          (e: unknown) =>
                            void message.error(e instanceof ApiClientError ? e.message : '导出失败'),
                        );
                    }}
                  >
                    JSON
                  </Button>
                  <Button
                    size="small"
                    data-testid="export-csv"
                    onClick={() => {
                      void downloadWithToken('/api/export/projects.csv', 'ttfolio-projects.csv')
                        .then(() => message.success('已导出 CSV'))
                        .catch(
                          (e: unknown) =>
                            void message.error(e instanceof ApiClientError ? e.message : '导出失败'),
                        );
                    }}
                  >
                    CSV
                  </Button>
                </Space>
              </Descriptions.Item>
            </Descriptions>
            <Space style={{ marginTop: 8 }} wrap>
              <Button type="primary" onClick={() => backup.mutate()}>
                立即备份
              </Button>
              <Button onClick={() => void api.post('/api/trash/purge-old').then(invalidate)}>
                清理超期回收站
              </Button>
              <Button
                danger
                onClick={() =>
                  modal.confirm({
                    title: '清空索引库？',
                    content:
                      '将删除：全部登记、分析数据、清单、会话标签、挂载关系、内容索引（约 xx MB）。不会删除：你磁盘上的任何项目文件。清空后需重新登记项目。',
                    okText: '我已了解，清空索引库',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: () => resetLib.mutate(),
                  })
                }
              >
                清空索引库（不删项目文件）
              </Button>
            </Space>
            {(stats?.backups ?? []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                <strong>备份列表</strong>
                <List
                  size="small"
                  dataSource={(stats?.backups ?? []).slice(0, 10)}
                  renderItem={(b) => (
                    <List.Item style={{ padding: '2px 0' }}>
                      <span className="tt-mono" style={{ fontSize: 12, flex: 1 }}>
                        {b.name}
                      </span>
                      <span style={{ fontSize: 12, opacity: 0.6 }}>{fmtBytes(b.size)}</span>
                      <Button
                        size="small"
                        onClick={() =>
                          void api
                            .post('/api/restore', { file: b.name, confirm: true })
                            .then(() => message.success('已恢复，请刷新页面'))
                            .catch(
                              (e: unknown) =>
                                void message.error(e instanceof ApiClientError ? e.message : '恢复失败'),
                            )
                        }
                      >
                        从此备份恢复
                      </Button>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Card>
        </SectionAnchor>

        <SectionAnchor id="health">
          <Card size="small" title={sectionTitle('health')}>
            <HealthCard />
          </Card>
        </SectionAnchor>

        <SectionAnchor id="about">
          <Card size="small" title={sectionTitle('about')}>
            <Alert
              type="info"
              message={`ttFolio · TT项目管理工作台 v${health?.version ?? '0.1.0'}`}
              description={
                <div style={{ fontSize: 12 }}>
                  <div>
                    应用端口：{health?.port}（仅监听 127.0.0.1）· 用户内容端口：{health?.userContentPort}
                    （只读）
                  </div>
                  <div>运行模式：Web（浏览器访问本地服务）</div>
                  <div>数据目录：{health?.dataDir}</div>
                  <div style={{ opacity: 0.6 }}>日志文件：logs/ttfolio.log（滚动保留 7 个 × 10MB）</div>
                </div>
              }
            />
            {/* 手动检查更新（api.github.com 元数据 + 引导手动下载，评审 C10 轻方案） */}
            <UpdateCheck />
            {/* Agent 接入说明（FR-13.1）：让外部 agent 的发现路径显式可查 */}
            <div
              style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${SEMANTIC.split}` }}
              data-testid="agent-access"
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Agent 接入</div>
              <p style={{ fontSize: 12, opacity: 0.75, margin: '0 0 8px' }}>
                外部 agent（如编码助手）可经本地接口发现并读取项目：服务地址与 token 记录在数据目录
                runtime.json（含 agent 发现段）；读取项目清单与上下文无需额外配置；执行操作时请求头带
                <code>x-ttfolio-actor: 名字</code> 即可在审计日志中与本人操作区分。所有接口仅监听 127.0.0.1
                且必须携带 token，不会暴露到局域网。
              </p>
              <pre
                style={{
                  fontSize: 12,
                  margin: 0,
                  padding: '10px 12px',
                  background: SEMANTIC.split,
                  borderRadius: 8,
                  overflowX: 'auto',
                  lineHeight: 1.7,
                }}
              >
                {`# 1) 发现服务（端口与 token 见数据目录 runtime.json）
curl -H "x-ttfolio-token: <token>" http://127.0.0.1:7717/api/agent/manifest

# 2) 读取某项目的上下文包（项目 id 取自 manifest）
curl -H "x-ttfolio-token: <token>" \\
  http://127.0.0.1:7717/api/agent/projects/<项目id>/context

# 3) 受控操作示例（登记示例目录；声明 actor 便于审计区分）
curl -X POST -H "x-ttfolio-token: <token>" -H "x-ttfolio-actor: my-agent" \\
  -H "Content-Type: application/json" \\
  -d "{\\"paths\\": [\\"D:\\\\demo\\\\my-project\\"]}" \\
  http://127.0.0.1:7717/api/projects`}
              </pre>
            </div>
            {/* 支持作者（用户需求）：自愿请喝一杯，完全自愿，不影响任何功能 */}
            <div
              style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${SEMANTIC.split}` }}
              data-testid="sponsor"
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>支持作者</div>
              <p style={{ fontSize: 12, opacity: 0.75, margin: '0 0 12px' }}>
                如果 ttFolio 对你有帮助，欢迎请作者喝杯水，赞助完全自愿，不影响任何功能。
              </p>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <figure style={{ margin: 0, textAlign: 'center' }}>
                  <div
                    style={{
                      width: 260,
                      height: 260,
                      padding: 10,
                      background: '#ffffff',
                      borderRadius: 10,
                      border: `1px solid ${SEMANTIC.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {/* 体检轮用户反馈：码图太小扫不出——260 容器 + antd Image 点击查看全屏大图 */}
                    <Image
                      src={sponsorAlipay}
                      alt="支付宝收款码"
                      width={190}
                      preview={{
                        imageRender: (originalNode) => (
                          <div style={{ background: '#fff', padding: 24, borderRadius: 12 }}>
                            {originalNode}
                          </div>
                        ),
                      }}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  </div>
                  <figcaption style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>支付宝</figcaption>
                </figure>
                <figure style={{ margin: 0, textAlign: 'center' }}>
                  <div
                    style={{
                      width: 260,
                      height: 260,
                      padding: 10,
                      background: '#ffffff',
                      borderRadius: 10,
                      border: `1px solid ${SEMANTIC.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Image
                      src={sponsorWechat}
                      alt="微信收款码"
                      width={190}
                      preview={{
                        imageRender: (originalNode) => (
                          <div style={{ background: '#fff', padding: 24, borderRadius: 12 }}>
                            {originalNode}
                          </div>
                        ),
                      }}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  </div>
                  <figcaption style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>微信</figcaption>
                </figure>
              </div>
            </div>
          </Card>
        </SectionAnchor>
      </div>
      <NewTemplateModal state={newTpl} onClose={() => setNewTpl(null)} onChange={invalidate} />
    </div>
  );
}

function CollectionsCard({
  collections,
  name,
  setName,
  onChange,
}: {
  collections: CollectionInfo[];
  name: string;
  setName: (v: string) => void;
  onChange: () => void;
}): React.JSX.Element {
  // 删除集合是级联操作（collection_members ON DELETE CASCADE，成员关系一并清掉），
  // 必须二次确认；编辑（重命名/备注）走 PATCH——评审发现两者此前均缺失（× 直删、无法改名）
  const { modal } = App.useApp();
  const [editing, setEditing] = useState<CollectionInfo | null>(null);
  return (
    <div>
      <Space.Compact style={{ width: '100%', margin: '6px 0' }}>
        <Input
          size="small"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新建集合名称"
        />
        <Button
          size="small"
          onClick={() => {
            if (name.trim() === '') return;
            void api.post('/api/collections', { name: name.trim() }).then(() => {
              setName('');
              onChange();
            });
          }}
        >
          创建
        </Button>
      </Space.Compact>
      {(collections ?? []).map((c) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
          <span className="tt-ellipsis" style={{ flex: 1, minWidth: 0 }}>
            {c.name}（{c.memberCount}）
            {c.note !== null && <span style={{ opacity: 0.5, fontSize: 12 }}> · {c.note}</span>}
          </span>
          <Button size="small" onClick={() => setEditing(c)}>
            编辑
          </Button>
          <Button
            size="small"
            danger
            onClick={() =>
              modal.confirm({
                title: `删除集合「${c.name}」？`,
                content: `集合下 ${c.memberCount} 个项目的归属关系将一并移除；项目本身与磁盘文件不受影响，之后可重新归属。`,
                okText: '删除集合',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: () => void api.del(`/api/collections/${c.id}`).then(onChange),
              })
            }
          >
            删除
          </Button>
        </div>
      ))}
      <CollectionEditModal collection={editing} onClose={() => setEditing(null)} />
      <p style={{ fontSize: 12, opacity: 0.6 }}>集合预留「多根打开」能力，当前仅作分组。</p>
    </div>
  );
}

function NewTemplateModal({
  state,
  onClose,
  onChange,
}: {
  state: { label: string; executable: string; args: string } | null;
  onClose: () => void;
  onChange: () => void;
}): React.JSX.Element | null {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  if (state === null) return null;
  return (
    <Modal
      title="新增命令模板"
      open
      onCancel={onClose}
      onOk={() => {
        void form
          .validateFields()
          .then((v) => {
            const args = String(v.args)
              .split(/\s+/)
              .filter((x: string) => x !== '');
            return api.post('/api/command-templates', {
              label: v.label,
              executable: v.executable,
              argsJson: args,
              needsConfirm: true,
            });
          })
          .then(() => {
            void message.success('模板已保存');
            onChange();
            onClose();
            form.resetFields();
          })
          .catch(
            (e: unknown) =>
              void message.error(e instanceof ApiClientError ? e.message : '保存失败（占位符不能少）'),
          );
      }}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="label" label="名称" rules={[{ required: true }]}>
          <Input placeholder="如 VS Code" />
        </Form.Item>
        <Form.Item name="executable" label="可执行文件" rules={[{ required: true }]}>
          <Input placeholder="如 code" />
        </Form.Item>
        <Form.Item name="args" label="参数（空格分隔；必须含 {path} 等占位符）" rules={[{ required: true }]}>
          <Input placeholder="{path}" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** 代码配色实时代码预览（FR-13.4）：切方案即时重渲染，覆盖七类 token 的示例。 */
const SCHEME_SAMPLE = [
  '// 注释：代码配色预览（编辑器 / 文档 / 动态视图三处一致）',
  "import { helper } from './utils';",
  '',
  'const limit: number = 42;',
  'export function calc(items: string[]): boolean {',
  '  let total = 0;',
  '  for (const it of items) {',
  '    total += helper(it) ?? 0;',
  '  }',
  '  return total < limit;',
  '}',
  '',
  '<div className="demo">tag</div>',
].join('\n');

function SchemePreview({ dark, scheme }: { dark: boolean; scheme: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hostRef.current === null) return undefined;
    const view = new EditorView({
      doc: SCHEME_SAMPLE,
      extensions: [
        langExtension('sample.ts'),
        cmTheme(dark),
        cmHighlight(dark, scheme),
        EditorView.lineWrapping,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
      ],
      parent: hostRef.current,
    });
    return () => view.destroy();
  }, [dark, scheme]);
  return (
    <div
      ref={hostRef}
      className="tt-mono"
      style={{
        border: `1px solid ${SEMANTIC.border}`,
        borderRadius: 6,
        marginTop: 8,
        maxHeight: 220,
        overflow: 'auto',
        fontSize: 12,
      }}
      data-testid="scheme-preview"
    />
  );
}

/** 快捷键改绑（FR-11.4 / FR-13.6）：注册表里的 keyEditable 命令逐条可改绑/恢复默认。 */
function KeybindingsCard(): React.JSX.Element {
  const { settings, setSetting } = useSettings();
  const { message } = App.useApp();
  const [capturing, setCapturing] = useState<string | null>(null);

  useEffect(() => {
    if (capturing === null) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const chord = chordFromEvent(e);
      if (chord === null) {
        void message.info('需要带修饰键（Ctrl/Shift/Alt），Esc 取消');
        return;
      }
      const conflict = editableCommands.find(
        (c) =>
          c.id !== capturing &&
          effectiveChord(c, settings.keybindings)?.toLowerCase() === chord.toLowerCase(),
      );
      if (conflict !== undefined) {
        void message.warning(`与「${conflict.title}」冲突，请换一个组合`);
        return;
      }
      setSetting('keybindings', { ...settings.keybindings, [capturing]: chord });
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, settings.keybindings, setSetting, message]);

  return (
    <div>
      {editableCommands.map((c) => {
        const chord = effectiveChord(c, settings.keybindings);
        const isCustom = settings.keybindings[c.id] !== undefined;
        return (
          <div
            key={c.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '6px 0',
              borderBottom: `1px solid ${SEMANTIC.split}`,
            }}
          >
            <span style={{ flex: 1, fontSize: 13 }}>
              {c.title}
              {isCustom && (
                <Tag style={{ marginLeft: 8 }} color="blue">
                  已改绑
                </Tag>
              )}
            </span>
            <Tag className="tt-mono" style={{ margin: 0 }}>
              {capturing === c.id ? '按下新组合…' : (chord ?? '未绑定')}
            </Tag>
            <Button
              size="small"
              onClick={() => setCapturing(capturing === c.id ? null : c.id)}
              data-testid={`kb-edit-${c.id}`}
            >
              {capturing === c.id ? '取消' : '改绑'}
            </Button>
            <Button
              size="small"
              disabled={!isCustom}
              onClick={() => {
                const next = { ...settings.keybindings };
                delete next[c.id];
                setSetting('keybindings', next);
              }}
            >
              恢复默认
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/** 可改绑命令（注册表单一来源；editor.save 由编辑器响应广播事件）。 */
const editableCommands = BUILTIN_COMMANDS.filter((c) => c.keyEditable === true);
