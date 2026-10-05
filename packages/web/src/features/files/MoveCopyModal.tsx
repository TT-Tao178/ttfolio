/**
 * 移动 / 复制目标选择弹窗（第 26 轮，文件树右键菜单的落点）。
 * 走既有 POST /api/fs/move（mode: move|copy，PathGuard 白名单内），不做任何新接口。
 * 冲突策略：首提交 onConflict:'ask'——后端发现同名目标报 INVALID_NAME，
 * 转为「跳过同名项继续？」确认（onConflict:'skip' 重发）；本轮不提供覆盖
 * （后端 move/copy 未实现 overwrite，KNOWN-GAPS #1 的任务化改造时一并补）。
 */
import { App, Button, Input, Modal, Space } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';

export function MoveCopyModal({ projectId, items, mode, onClose, onDone }: {
  projectId: string; items: string[]; mode: 'move' | 'copy' | null; onClose: () => void;
  /** 成功后回调：移动/复制会让已展开子层的本地缓存过期，FilesTab 用它强制整树刷新 */
  onDone?: () => void;
}): React.JSX.Element | null {
  const [targetDir, setTargetDir] = useState('');
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const verb = mode === 'copy' ? '复制' : '移动';

  useEffect(() => {
    if (mode !== null) setTargetDir('');
  }, [mode]);

  const submit = (onConflict: 'ask' | 'skip'): void => {
    if (targetDir.trim() === '') return;
    void api
      .post('/api/fs/move', { projectId, items, targetDir: targetDir.trim(), mode, onConflict })
      .then(async () => {
        void message.success(`${verb}完成`);
        await queryClient.invalidateQueries({ queryKey: ['tree', projectId] });
        onDone?.();
        onClose();
      })
      .catch((e: unknown) => {
        if (e instanceof ApiClientError && e.code === 'INVALID_NAME' && (e.message ?? '').includes('目标已存在')) {
          modal.confirm({
            title: '目标目录存在同名项',
            content: `跳过同名项继续${verb}其余内容？（本轮不提供覆盖，避免误删目标已有文件）`,
            okText: '跳过同名项',
            cancelText: '取消',
            onOk: () => submit('skip')
          });
          return;
        }
        void message.error(e instanceof ApiClientError ? e.message : `${verb}失败`);
      });
  };

  const pick = async (): Promise<void> => {
    try {
      const r = await api.post<{ paths: string[] }>('/api/dialogs/pick-folder');
      const first = r.paths[0];
      if (first !== undefined) setTargetDir(first);
    } catch {
      void message.error('打开系统对话框失败，请手动粘贴路径');
    }
  };

  if (mode === null) return null;
  return (
    <Modal
      title={`${verb} ${items.length} 项到…`}
      open
      onCancel={onClose}
      footer={null}
      width={560}
    >
      {/* data-testid 放内层可见元素：Modal 根层是零高包裹层，visible 判定恒 false（round25 教训） */}
      <div data-testid="movecopy-modal">
        <p style={{ opacity: 0.75 }}>
          {items.join('、')}
          <br />选择目标目录（目录与文件都会被{verb}；目标已存在同名项时可选择跳过）。
        </p>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={targetDir}
            onChange={(e) => setTargetDir(e.target.value)}
            onPressEnter={() => submit('ask')}
            placeholder="粘贴目标目录路径（须为项目内已存在的目录）"
            data-testid="movecopy-input"
          />
          <Button icon={<FolderOpenOutlined />} onClick={() => void pick()} data-testid="movecopy-pick">选择目录…</Button>
          <Button type="primary" disabled={targetDir.trim() === ''} onClick={() => submit('ask')} data-testid="movecopy-ok">
            {verb}
          </Button>
        </Space.Compact>
      </div>
    </Modal>
  );
}
