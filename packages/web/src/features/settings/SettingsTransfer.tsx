/** 设置迁移（FR-13.12 / T-110）：导出设置包 / 导入（跳过已有|覆盖）/ 恢复默认。 */
import { App, Button, Modal, Space } from 'antd';
import { DownloadOutlined, ImportOutlined, UndoOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useRef, useState } from 'react';
import { api, ApiClientError, downloadWithToken } from '@/lib/api';

interface ImportResult {
  settingsApplied: number;
  rulesCreated: number;
  templatesCreated: number;
  docRootsCreated: number;
  skipped: number;
}

export function SettingsTransfer(): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pendingData, setPendingData] = useState<unknown>(null);

  const invalidateAll = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
    await queryClient.invalidateQueries({ queryKey: ['tags'] });
    await queryClient.invalidateQueries({ queryKey: ['collections'] });
  };

  const importRun = useMutation({
    mutationFn: (v: { data: unknown; strategy: 'skip' | 'overwrite' }) =>
      api.post<ImportResult>('/api/settings/import', v),
    onSuccess: async (r) => {
      await invalidateAll();
      void message.success(
        `导入完成：设置 ${r.settingsApplied}、忽略规则 ${r.rulesCreated}、命令模板 ${r.templatesCreated}、文档根 ${r.docRootsCreated}，跳过 ${r.skipped} 项`,
      );
      setPendingData(null);
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '导入失败'),
  });
  const resetRun = useMutation({
    mutationFn: () => api.post('/api/settings/reset-defaults', {}),
    onSuccess: async () => {
      await invalidateAll();
      void message.success('已恢复默认设置（数据类：忽略规则/模板/文档根不动）');
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '恢复默认失败'),
  });

  const doExport = async (): Promise<void> => {
    try {
      await downloadWithToken('/api/settings/export', 'ttfolio-settings.json');
      void message.success('设置包已导出（不含 Token、项目清单与会话数据）');
    } catch {
      void message.error('导出失败');
    }
  };

  const onPickFile = (file: File): boolean => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data: unknown = JSON.parse(String(reader.result));
        const kind = (data as { kind?: unknown } | null)?.kind;
        if (kind !== 'ttfolio-settings') {
          void message.error('不是有效的 ttFolio 设置包');
          return;
        }
        setPendingData(data);
      } catch {
        void message.error('文件不是合法 JSON');
      }
    };
    reader.readAsText(file);
    return false; // 阻止 Upload 自动上传
  };

  const confirmImport = (strategy: 'skip' | 'overwrite'): void => {
    if (pendingData === null) return;
    importRun.mutate({ data: pendingData, strategy });
  };

  return (
    <Space wrap data-testid="settings-transfer">
      <Button icon={<DownloadOutlined />} onClick={() => void doExport()}>
        导出设置包
      </Button>
      <Button icon={<ImportOutlined />} onClick={() => fileRef.current?.click()}>
        导入设置包…
      </Button>
      <Button
        icon={<UndoOutlined />}
        onClick={() => {
          modal.confirm({
            title: '恢复默认设置？',
            content: '外观/监听/配色等设置键回到默认值；忽略规则、命令模板、文档根等数据不动。',
            okText: '恢复默认',
            okButtonProps: { danger: true },
            onOk: () => resetRun.mutateAsync(),
          });
        }}
      >
        恢复默认设置
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) onPickFile(f);
          e.target.value = '';
        }}
      />
      <Modal
        title="导入设置包"
        open={pendingData !== null}
        onCancel={() => setPendingData(null)}
        footer={null}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Button type="primary" block loading={importRun.isPending} onClick={() => confirmImport('skip')}>
            跳过已有项（推荐：保留本机现有配置，只补缺失的）
          </Button>
          <Button block danger loading={importRun.isPending} onClick={() => confirmImport('overwrite')}>
            覆盖本机同名配置
          </Button>
        </Space>
      </Modal>
    </Space>
  );
}
