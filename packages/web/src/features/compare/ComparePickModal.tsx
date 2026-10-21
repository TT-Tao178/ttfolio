/** 选择对比目标（FR-13.9 / T-106b）：项目下拉 + 项目相对路径（文件树右键可复制）。 */
import { App, Form, Input, Modal, Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { api } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { encodeCompareSpec } from './compareShared';

function nameOf(p: string): string {
  const s = p.split(/[\\/]/);
  return s[s.length - 1] ?? p;
}

export function ComparePickModal({
  projectId,
  basePath,
  onClose,
}: {
  projectId: string;
  basePath: string;
  onClose: () => void;
}): React.JSX.Element {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [targetProject, setTargetProject] = useState<string>(projectId);
  const { data: projects } = useQuery({
    queryKey: ['projects', 'compare-pick'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active' }),
  });

  const submit = (): void => {
    const v = (form.getFieldValue('path') as string | undefined)?.trim() ?? '';
    if (v === '') {
      void message.warning('请填写对方文件的项目相对路径（文件树右键可复制）');
      return;
    }
    useAppStore.getState().openTab(
      {
        kind: 'compare',
        projectId: null,
        targetPath: encodeCompareSpec({
          left: { projectId, path: basePath },
          right: { projectId: targetProject, path: v },
        }),
        subTab: null,
        scroll: 0,
      },
      `对比 ${nameOf(basePath)} ↔ ${nameOf(v)}`,
    );
    onClose();
  };

  return (
    <Modal
      title={`与其他文件对比：${nameOf(basePath)}`}
      open
      onCancel={onClose}
      onOk={submit}
      okText="对比"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item label="对方文件所在项目" style={{ marginBottom: 12 }}>
          <Select
            value={targetProject}
            onChange={setTargetProject}
            showSearch
            optionFilterProp="label"
            options={(projects ?? []).map((p) => ({ value: p.id, label: p.alias ?? p.diskName }))}
          />
        </Form.Item>
        <Form.Item label="对方文件的项目相对路径" required style={{ marginBottom: 0 }}>
          <Input
            placeholder="如 src/index.ts（文件树右键「复制相对路径」）"
            allowClear
            onPressEnter={submit}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
