/**
 * 移动 / 复制目标选择弹窗（第 26 轮落地；第 61 轮随 KNOWN-GAPS #1 任务化改造）。
 * 走 POST /api/fs/move（mode: move|copy，PathGuard 白名单内）——后端为异步任务：
 * 提交成功即返回 taskId，进度与取消在状态栏（FR-4.7）；无可执行项（全部自移动/
 * 跳过）时后端返回 taskId:null，按同步完成提示。
 * 冲突策略：首提交 onConflict:'ask'——后端发现同名目标报 INVALID_NAME，弹三选
 * （覆盖=先删目标旧内容，不可恢复 / 跳过同名项 / 取消）。
 */
import { App, Button, Input, Modal, Space } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';

export function MoveCopyModal({
  projectId,
  items,
  mode,
  onClose,
  onDone,
}: {
  projectId: string;
  items: string[];
  mode: 'move' | 'copy' | null;
  onClose: () => void;
  /** 成功提交后回调：移动/复制会让已展开子层的本地缓存过期，FilesTab 用它强制整树刷新 */
  onDone?: () => void;
}): React.JSX.Element | null {
  const [targetDir, setTargetDir] = useState('');
  const [conflictOpen, setConflictOpen] = useState(false);
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const verb = mode === 'copy' ? '复制' : '移动';

  useEffect(() => {
    if (mode !== null) setTargetDir('');
  }, [mode]);

  const submit = (onConflict: 'ask' | 'skip' | 'overwrite'): void => {
    if (targetDir.trim() === '') return;
    void api
      .post<{ taskId: string | null }>('/api/fs/move', {
        projectId,
        items,
        targetDir: targetDir.trim(),
        mode,
        onConflict,
      })
      .then(async (r) => {
        if (r.taskId === null) {
          void message.success(`${verb}完成`);
        } else {
          void message.info(`${verb}已转入后台执行，可在状态栏查看进度或取消`);
        }
        await queryClient.invalidateQueries({ queryKey: ['tree', projectId] });
        onDone?.();
        onClose();
      })
      .catch((e: unknown) => {
        if (
          e instanceof ApiClientError &&
          e.code === 'INVALID_NAME' &&
          (e.message ?? '').includes('目标已存在')
        ) {
          setConflictOpen(true);
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
    <>
      <Modal title={`${verb} ${items.length} 项到…`} open onCancel={onClose} footer={null} width={560}>
        {/* data-testid 放内层可见元素：Modal 根层是零高包裹层，visible 判定恒 false（round25 教训） */}
        <div data-testid="movecopy-modal">
          <p style={{ opacity: 0.75 }}>
            {items.join('、')}
            <br />
            选择目标目录（目录与文件都会被{verb}；目标已存在同名项时可选择覆盖或跳过）。大目录将在后台执行。
          </p>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              onPressEnter={() => submit('ask')}
              placeholder="粘贴目标目录路径（须为项目内已存在的目录）"
              data-testid="movecopy-input"
            />
            <Button icon={<FolderOpenOutlined />} onClick={() => void pick()} data-testid="movecopy-pick">
              选择目录…
            </Button>
            <Button
              type="primary"
              disabled={targetDir.trim() === ''}
              onClick={() => submit('ask')}
              data-testid="movecopy-ok"
            >
              {verb}
            </Button>
          </Space.Compact>
        </div>
      </Modal>
      <Modal
        title="目标目录存在同名项"
        open={conflictOpen}
        onCancel={() => setConflictOpen(false)}
        width={480}
        footer={
          <>
            <Button onClick={() => setConflictOpen(false)}>取消</Button>
            <Button
              onClick={() => {
                setConflictOpen(false);
                submit('skip');
              }}
            >
              跳过同名项
            </Button>
            <Button
              danger
              type="primary"
              onClick={() => {
                setConflictOpen(false);
                submit('overwrite');
              }}
            >
              覆盖并继续
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          覆盖将<strong>先删除目标目录里的同名内容且无法恢复</strong>；跳过则保留同名项继续{verb}
          其余内容。
        </p>
      </Modal>
    </>
  );
}
