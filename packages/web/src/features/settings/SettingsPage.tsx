/** 设置页（FR-11.x / FR-2.7 / FR-10.3 / FR-12.x）：外观/数据源/忽略规则/命令模板/监听/数据与备份/关于。 */
import {
  Alert, App, Button, Descriptions, Divider, Form, Input, InputNumber, List, Modal, Segmented, Select, Space, Switch, Tag
} from 'antd';
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { CommandTemplate, IgnoreRule, CollectionInfo } from '@ttfolio/shared';
import { fmtBytes } from '@/lib/format';
import { useSettings } from '@/app/settings';
import { SEMANTIC } from '@/theme/tokens';

export function SettingsPage(): React.JSX.Element {
  const { settings, setSetting } = useSettings();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [newRule, setNewRule] = useState('');
  const [newTpl, setNewTpl] = useState<{ label: string; executable: string; args: string } | null>(null);
  const [collectionName, setCollectionName] = useState('');

  const { data: stats } = useQuery({ queryKey: ['data-stats'], queryFn: () => api.get<{ dbPath: string; dbSize: number; trashPath: string; trashCount: number; trashBytes: number; backupDir: string; backups: Array<{ name: string; size: number }>; logDir: string; logSize: number }>('/api/data-stats') });
  const { data: rules } = useQuery({ queryKey: ['ignore-rules'], queryFn: () => api.get<IgnoreRule[]>('/api/ignore-rules') });
  const { data: templates } = useQuery({ queryKey: ['templates'], queryFn: () => api.get<CommandTemplate[]>('/api/command-templates') });
  const { data: docRoots } = useQuery({ queryKey: ['doc-roots'], queryFn: () => api.get<Array<{ id: string; label: string | null; path: string }>>('/api/doc-roots') });
  const { data: collections } = useQuery({ queryKey: ['collections'], queryFn: () => api.get<CollectionInfo[]>('/api/collections') });
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ version: string; port: number; userContentPort: number; dataDir: string; dbPath: string }>('/api/health') });

  const invalidate = (): void => void queryClient.invalidateQueries();

  const backup = useMutation({
    mutationFn: () => api.post('/api/backup'),
    onSuccess: () => {
      void message.success('备份完成');
      invalidate();
    }
  });
  const resetLib = useMutation({
    mutationFn: () => api.post('/api/library/reset', { confirm: true, confirmText: '清空索引库' }),
    onSuccess: () => {
      void message.success('索引库已清空（项目文件未动）。请刷新页面重新登记。');
      invalidate();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '失败')
  });

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto', maxWidth: 860 }} data-testid="settings-page">
      <Divider orientation="left">外观（FR-11.3）</Divider>
      <Form layout="inline" labelWrap>
        <Form.Item label="主题">
          <Segmented
            value={settings.theme}
            onChange={(v) => setSetting('theme', v)}
            options={[{ label: '浅色（默认）', value: 'light' }, { label: '深色', value: 'dark' }, { label: '跟随系统', value: 'system' }]}
          />
        </Form.Item>
        <Form.Item label="密度">
          <Segmented
            value={settings.density}
            onChange={(v) => setSetting('density', v)}
            options={[{ label: '紧凑', value: 'small' }, { label: '标准', value: 'middle' }, { label: '舒适', value: 'large' }]}
          />
        </Form.Item>
        <Form.Item label="项目页默认落点">
          <Select value={settings.defaultProjectTab} onChange={(v) => setSetting('default_project_tab', v)} style={{ width: 120 }}
            options={[{ value: 'files', label: '文件' }, { value: 'overview', label: '概览' }]} />
        </Form.Item>
      </Form>
      <p style={{ fontSize: 12, opacity: 0.6 }}>卡片列数自适应窗口宽度；快捷键表见「?」帮助（Ctrl+, 打开本页）。</p>

      <Divider orientation="left">数据源与根目录（FR-11.1 / FR-6.2）</Divider>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="文档根">
          {(docRoots ?? []).length === 0 ? '未配置' : ''}
          {(docRoots ?? []).map((r) => (
            <Tag key={r.id} closable onClose={() => { void api.del(`/api/doc-roots/${r.id}`).then(invalidate); }} className="tt-ellipsis" style={{ maxWidth: 420 }}>{r.label ?? r.path}</Tag>
          ))}
          <Button size="small" style={{ marginLeft: 6 }} onClick={() => void api.post('/api/dialogs/pick-folder').then((r) => {
            const p = (r as { paths: string[] }).paths[0];
            if (p !== undefined) void api.post('/api/doc-roots', { path: p }).then(invalidate);
          })}>
            添加文档根
          </Button>
        </Descriptions.Item>
        <Descriptions.Item label="默认架构图目录名">
          <Input
            size="small"
            style={{ width: 160 }}
            defaultValue={settings.defaultArchDirName}
            onPressEnter={(e) => setSetting('default_arch_dir_name', (e.target as HTMLInputElement).value)}
          />
        </Descriptions.Item>
        <Descriptions.Item label="扫描根目录（FR-12.6 预留，不实现自动扫描）">
          <Input size="small" disabled placeholder="当前版本只支持手动添加项目" style={{ width: 300 }} />
        </Descriptions.Item>
      </Descriptions>
      <CollectionsCard collections={collections ?? []} name={collectionName} setName={setCollectionName} onChange={invalidate} />

      <Divider orientation="left">忽略规则（FR-3.7）</Divider>
      <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
        <Input value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder="新增规则，如 *.bak 或 temp-dir" />
        <Button type="primary" onClick={() => {
          if (newRule.trim() === '') return;
          void api.post('/api/ignore-rules', { pattern: newRule.trim(), mode: 'hide' }).then(() => {
            setNewRule('');
            invalidate();
          });
        }}>添加</Button>
      </Space.Compact>
      <div style={{ maxHeight: 220, overflow: 'auto', border: `1px solid ${SEMANTIC.split}`, borderRadius: 6, padding: 8 }}>
        {(rules ?? []).map((r) => (
          <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '1px 0' }}>
            <span className="tt-mono" style={{ flex: 1, fontSize: 12 }}>{r.pattern}</span>
            <Tag>{r.mode === 'hide' ? '隐藏' : '仅统计时忽略'}</Tag>
            {r.isBuiltin && <Tag>内置</Tag>}
            <Switch size="small" checked={r.enabled} onChange={(v) => void api.patch(`/api/ignore-rules/${r.id}`, { enabled: v }).then(invalidate)} />
            {!r.isBuiltin && <Button size="small" type="text" danger onClick={() => void api.del(`/api/ignore-rules/${r.id}`).then(invalidate)}>删除</Button>}
          </div>
        ))}
      </div>

      <Divider orientation="left">命令模板（FR-10.3，可扩展打开方式）</Divider>
      <List
        size="small"
        dataSource={templates ?? []}
        renderItem={(t) => (
          <List.Item style={{ padding: '3px 0' }}>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', width: '100%' }}>
              <strong style={{ width: 130 }}>{t.label}</strong>
              <span className="tt-mono tt-ellipsis" style={{ fontSize: 12, flex: 1 }}>{t.executable} {t.argsJson.join(' ')}</span>
              {t.isBuiltin && <Tag>内置</Tag>}
              <Switch size="small" checked={t.enabled} onChange={(v) => void api.patch(`/api/command-templates/${t.id}`, { enabled: v }).then(invalidate)} />
            </span>
          </List.Item>
        )}
      />
      <Button size="small" style={{ marginTop: 6 }} onClick={() => setNewTpl({ label: '', executable: '', args: '{path}' })}>新增模板…</Button>
      <p style={{ fontSize: 12, opacity: 0.6 }}>
        模板必须包含占位符 {'{path}'} / {'{file}'} / {'{project}'} / {'{paths}'} 之一；以「可执行文件 + 参数数组」执行，禁止 shell 拼接。
      </p>

      <Divider orientation="left">文件监听（FR-11.2）</Divider>
      <Form layout="inline">
        <Form.Item label="启用监听"><Switch checked={settings.watchEnabled} onChange={(v) => setSetting('watch_enabled', v)} /></Form.Item>
        <Form.Item label="写入稳定窗口 (ms)">
          <InputNumber value={settings.watchStabilityMs} min={100} max={3000} step={100} onChange={(v) => setSetting('watch_stability_ms', v)} />
        </Form.Item>
        <Form.Item label="自动保存（防抖 2s，默认关）">
          <Switch checked={settings.autoSave} onChange={(v) => setSetting('auto_save', v)} />
        </Form.Item>
      </Form>

      <Divider orientation="left">数据与备份（FR-11.5）</Divider>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="索引库">{stats?.dbPath ?? '—'}（{fmtBytes(stats?.dbSize ?? 0)}）</Descriptions.Item>
        <Descriptions.Item label="回收站">{stats?.trashPath ?? '—'}（{stats?.trashCount ?? 0} 条 / {fmtBytes(stats?.trashBytes ?? 0)}）</Descriptions.Item>
        <Descriptions.Item label="备份目录">{stats?.backupDir ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="日志目录">{stats?.logDir ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="导出清单">
          <Space>
            <Button size="small" onClick={() => window.open(`/api/export/projects.json`, '_blank')}>JSON</Button>
            <Button size="small" onClick={() => window.open(`/api/export/projects.csv`, '_blank')}>CSV</Button>
          </Space>
        </Descriptions.Item>
      </Descriptions>
      <Space style={{ marginTop: 8 }} wrap>
        <Button type="primary" onClick={() => backup.mutate()}>立即备份</Button>
        <Button onClick={() => void api.post('/api/trash/purge-old').then(invalidate)}>清理超期回收站</Button>
        <Button
          danger
          onClick={() =>
            modal.confirm({
              title: '清空索引库？',
              content: '将删除：全部登记、分析数据、清单、会话标签、挂载关系、内容索引（约 xx MB）。不会删除：你磁盘上的任何项目文件。清空后需重新登记项目。',
              okText: '我已了解，清空索引库',
              okButtonProps: { danger: true },
              cancelText: '取消',
              onOk: () => resetLib.mutate()
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
                <span className="tt-mono" style={{ fontSize: 12, flex: 1 }}>{b.name}</span>
                <span style={{ fontSize: 12, opacity: 0.6 }}>{fmtBytes(b.size)}</span>
                <Button size="small" onClick={() => void api.post('/api/restore', { file: b.name, confirm: true }).then(() => message.success('已恢复，请刷新页面')).catch((e: unknown) => void message.error(e instanceof ApiClientError ? e.message : '恢复失败'))}>
                  从此备份恢复
                </Button>
              </List.Item>
            )}
          />
        </div>
      )}

      <Divider orientation="left">关于（FR-11.6）</Divider>
      <Alert
        type="info"
        message={`ttFolio · tt项目仓库 v${health?.version ?? '0.1.0'}`}
        description={
          <div style={{ fontSize: 12 }}>
            <div>应用端口：{health?.port}（仅监听 127.0.0.1）· 用户内容端口：{health?.userContentPort}（只读）</div>
            <div>运行模式：Web（浏览器访问本地服务）</div>
            <div>数据目录：{health?.dataDir}</div>
            <div style={{ opacity: 0.6 }}>日志文件：logs/ttfolio.log（滚动保留 7 个 × 10MB）</div>
          </div>
        }
      />
      <NewTemplateModal state={newTpl} onClose={() => setNewTpl(null)} onChange={invalidate} />
    </div>
  );
}

function CollectionsCard({ collections, name, setName, onChange }: {
  collections: CollectionInfo[]; name: string; setName: (v: string) => void; onChange: () => void;
}): React.JSX.Element {
  return (
    <div style={{ marginTop: 8 }}>
      <strong>集合（工作集，FR-2.7）</strong>
      <Space.Compact style={{ width: '100%', margin: '6px 0' }}>
        <Input size="small" value={name} onChange={(e) => setName(e.target.value)} placeholder="新建集合名称" />
        <Button size="small" onClick={() => {
          if (name.trim() === '') return;
          void api.post('/api/collections', { name: name.trim() }).then(() => {
            setName('');
            onChange();
          });
        }}>创建</Button>
      </Space.Compact>
      {(collections ?? []).map((c) => (
        <Tag key={c.id} closable onClose={() => void api.del(`/api/collections/${c.id}`).then(onChange)}>
          {c.name}（{c.memberCount}）
        </Tag>
      ))}
      <p style={{ fontSize: 12, opacity: 0.6 }}>集合预留「多根打开」能力（FR-12.3），当前仅作分组。</p>
    </div>
  );
}

function NewTemplateModal({ state, onClose, onChange }: {
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
            const args = String(v.args).split(/\s+/).filter((x: string) => x !== '');
            return api.post('/api/command-templates', { label: v.label, executable: v.executable, argsJson: args, needsConfirm: true });
          })
          .then(() => {
            void message.success('模板已保存');
            onChange();
            onClose();
            form.resetFields();
          })
          .catch((e: unknown) => void message.error(e instanceof ApiClientError ? e.message : '保存失败（占位符不能少）'));
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
