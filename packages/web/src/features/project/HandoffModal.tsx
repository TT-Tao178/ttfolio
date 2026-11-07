/** 交接单弹窗（FR-16.3 / T-134，2026-11-07 用户点名 A 组）：
 *  拉取 GET /api/agent/projects/:id/handoff（Markdown 文本），可切模板
 *  （settings 键 handoff_templates_json 的自定义模板 + 内置默认），
 *  复制到剪贴板或下载 .md。模板编辑器不做（如实：经设置 API 配置）。 */
import { App as AntdApp, Button, Input, Modal, Select } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { downloadWithToken, fetchTextWithToken } from '@/lib/api';
import { useSettings } from '@/app/settings';

export function HandoffModal({
  projectId,
  name,
  onClose,
}: {
  projectId: string;
  name: string;
  onClose: () => void;
}): React.JSX.Element {
  const { message } = AntdApp.useApp();
  const { settings } = useSettings();
  // 自定义模板列表（settings 键；编辑器不做，经设置 API 配置——如实标注）
  const templates = useMemo(
    () => (Array.isArray(settings.handoffTemplates) ? settings.handoffTemplates : []),
    [settings.handoffTemplates],
  );
  const [templateId, setTemplateId] = useState<string>('');
  const [md, setMd] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const q = templateId === '' ? '' : `?template=${encodeURIComponent(templateId)}`;
    void fetchTextWithToken(`/api/agent/projects/${projectId}/handoff${q}`)
      .then((text) => setMd(text))
      .catch(() => {
        void message.error('交接单获取失败');
        setMd('');
      })
      .finally(() => setLoading(false));
  }, [projectId, templateId, message]);

  const download = (): void => {
    void downloadWithToken(
      `/api/agent/projects/${projectId}/handoff${templateId === '' ? '' : `?template=${encodeURIComponent(templateId)}`}`,
      'ttfolio-handoff.md',
    ).catch(() => message.error('下载失败'));
  };

  return (
    <Modal
      title={`交接单：${name}`}
      open
      onCancel={onClose}
      footer={[
        <Button
          key="copy"
          type="primary"
          onClick={() => {
            void navigator.clipboard.writeText(md).then(() => message.success('已复制到剪贴板'));
          }}
        >
          复制 Markdown
        </Button>,
        <Button key="dl" onClick={download} disabled={md === ''}>
          下载 .md
        </Button>,
      ]}
      width={720}
      data-testid="handoff-modal"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {templates.length > 0 && (
          <Select
            style={{ width: 260 }}
            value={templateId}
            onChange={(v) => setTemplateId(v)}
            options={[
              { value: '', label: '内置默认模板' },
              ...templates
                .filter(
                  (t): t is { id: string; name: string; body: string } =>
                    t !== null && typeof t === 'object' && typeof (t as { id?: unknown }).id === 'string',
                )
                .map((t) => ({ value: t.id, label: t.name })),
            ]}
            data-testid="handoff-template-select"
          />
        )}
        {templates.length === 0 && (
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            可经设置接口配置自定义模板（handoff_templates_json，≤10 条）
          </span>
        )}
        <Input.TextArea
          rows={20}
          value={md}
          readOnly
          style={{ fontFamily: 'monospace', fontSize: 12 }}
          data-testid="handoff-text"
        />
        {loading && <span style={{ fontSize: 12, opacity: 0.6 }}>生成中…</span>}
      </div>
    </Modal>
  );
}
