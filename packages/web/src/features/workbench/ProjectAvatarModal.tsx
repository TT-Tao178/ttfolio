/**
 * 项目头像弹窗（可选功能，用户需求 2026-10-29）：为单个项目上传方图，
 * 替换卡片左上的蓝底首字母 Avatar；不上传不影响任何显示。
 * 复用个人头像的 canvas 居中裁剪（cropToSquarePng，256×256 PNG）；
 * 上传走 POST /api/projects/:id/avatar（L1 审计），清除走 DELETE。
 * 用法：条件渲染 + key=项目 id，每次打开全新挂载。
 */
import { App, Avatar, Button, Modal, Space } from 'antd';
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import React, { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError, projectAvatarUrl } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { cropToSquarePng } from '@/features/profile/ProfileModal';

export function ProjectAvatarModal({
  project,
  onClose,
}: {
  project: ProjectSummary;
  onClose: () => void;
}): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const name = project.alias ?? project.diskName;

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
    await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
  };

  const upload = useMutation({
    mutationFn: (dataUrl: string) => api.post(`/api/projects/${project.id}/avatar`, { dataUrl }),
    onSuccess: () => {
      void message.success('项目头像已更新');
      void refresh();
      onClose();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '头像上传失败'),
  });

  const clear = useMutation({
    mutationFn: () => api.del(`/api/projects/${project.id}/avatar`),
    onSuccess: () => {
      void message.success('已恢复默认首字母');
      void refresh();
      onClose();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败'),
  });

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    try {
      upload.mutate(await cropToSquarePng(file));
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '图片处理失败');
    }
  };

  return (
    <Modal title={`项目头像：${name}`} open onCancel={onClose} footer={null} width={380} destroyOnClose>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <Avatar
          size={96}
          src={
            project.hasAvatar === true
              ? `${projectAvatarUrl(project.id, project.avatarV ?? 0)}&t=${Date.now()}`
              : undefined
          }
          style={{ background: 'var(--tt-primary, #1677ff)', fontSize: 36 }}
        >
          {name.charAt(0).toUpperCase()}
        </Avatar>
        <span style={{ fontSize: 12, opacity: 0.65, textAlign: 'center' }}>
          上传一张方图（自动居中裁剪为 256×256）。
          <br />
          不设置则显示项目名首字母；仅存于本地索引库，不影响项目目录。
        </span>
        <Space>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            loading={upload.isPending}
            onClick={() => fileRef.current?.click()}
            data-testid="project-avatar-upload"
          >
            上传图片…
          </Button>
          {project.hasAvatar === true && (
            <Button
              icon={<DeleteOutlined />}
              loading={clear.isPending}
              onClick={() => clear.mutate()}
              data-testid="project-avatar-clear"
            >
              清除头像
            </Button>
          )}
        </Space>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </Modal>
  );
}
