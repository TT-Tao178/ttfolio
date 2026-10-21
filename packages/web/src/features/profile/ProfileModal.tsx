/** 个人主页（FR-13.7 / T-103）：本地单人身份卡弹窗。
 * 头像点击选择本地图片，渲染层 canvas 裁切缩放为 256×256 PNG 后提交；
 * 服务端写数据目录 avatar.png。用户名上限 30 字；保存即全局生效。 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Input, Modal, Tag } from 'antd';
import { CameraOutlined, DeleteOutlined } from '@ant-design/icons';
import { api, ApiClientError, avatarUrl } from '@/lib/api';
import type { ProfileInfo } from '@ttfolio/shared';
import { SEMANTIC } from '@/theme/tokens';

const AVATAR_STORE_PX = 256;

/** 图片文件 → 256×256 居中裁切的 PNG dataURL（cover 语义）。 */
export async function cropToSquarePng(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => reject(new Error('读取图片失败'));
    fr.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('图片无法解码'));
    img.src = dataUrl;
  });
  const side = Math.min(img.naturalWidth || 1, img.naturalHeight || 1);
  const sx = ((img.naturalWidth || side) - side) / 2;
  const sy = ((img.naturalHeight || side) - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_STORE_PX;
  canvas.height = AVATAR_STORE_PX;
  const ctx2d = canvas.getContext('2d');
  if (ctx2d === null) throw new Error('画布不可用');
  ctx2d.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_STORE_PX, AVATAR_STORE_PX);
  return canvas.toDataURL('image/png');
}

export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<ProfileInfo>('/api/profile'),
    enabled: open,
  });

  useEffect(() => {
    if (open) setName(profile?.name ?? '');
  }, [open, profile?.name]);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
  };

  const saveName = useMutation({
    mutationFn: (next: string) => api.patch<{ name: string | null }>('/api/profile', { name: next }),
    onSuccess: () => {
      void message.success('已保存');
      refresh();
      onClose();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '保存失败'),
  });

  const uploadAvatar = useMutation({
    mutationFn: (dataUrl: string) => api.post('/api/profile/avatar', { dataUrl }),
    onSuccess: () => {
      void message.success('头像已更新');
      refresh();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '头像上传失败'),
  });

  const clearAvatar = useMutation({
    mutationFn: () => api.del('/api/profile/avatar'),
    onSuccess: () => {
      void message.success('已恢复默认头像');
      refresh();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败'),
  });

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    try {
      uploadAvatar.mutate(await cropToSquarePng(file));
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '图片处理失败');
    }
  };

  const displayName = profile?.name ?? '本机用户';
  const initial = (profile?.name ?? '').trim().charAt(0).toUpperCase() || '我';

  return (
    <Modal title="个人主页" open={open} onCancel={onClose} footer={null} width={420} destroyOnClose>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
          }}
          title="点击更换头像"
          style={{
            width: 128,
            height: 128,
            borderRadius: '50%',
            overflow: 'hidden',
            cursor: 'pointer',
            position: 'relative',
            background: SEMANTIC.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,.95)',
            fontSize: 44,
            fontWeight: 600,
            border: `1px solid ${SEMANTIC.border}`,
          }}
          data-testid="profile-avatar"
        >
          {profile?.hasAvatar === true ? (
            <img src={avatarUrl()} alt="头像" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            initial
          )}
          <span
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: SEMANTIC.containerBg,
              color: SEMANTIC.text,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              border: `1px solid ${SEMANTIC.border}`,
            }}
          >
            <CameraOutlined />
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          data-testid="profile-avatar-input"
          onChange={(e) => {
            void pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div style={{ fontSize: 12, opacity: 0.6 }}>点击头像更换（自动裁切缩放，仅存本机）</div>

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          showCount
          placeholder="你的名字（留空显示「本机用户」）"
          style={{ maxWidth: 300 }}
          data-testid="profile-name"
        />

        <div style={{ display: 'flex', gap: 12, fontSize: 12, opacity: 0.75 }}>
          <span>登记项目 {profile?.projectCount ?? 0}</span>
          <span>· 使用 {profile?.usedDays ?? 1} 天</span>
          <span>· v{profile?.version ?? '—'}</span>
        </div>

        <Tag color="blue">{displayName}</Tag>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <Button
            type="primary"
            loading={saveName.isPending}
            onClick={() => saveName.mutate(name)}
            data-testid="profile-save"
          >
            保存
          </Button>
          {profile?.hasAvatar === true && (
            <Button
              icon={<DeleteOutlined />}
              loading={clearAvatar.isPending}
              onClick={() => clearAvatar.mutate()}
            >
              移除头像
            </Button>
          )}
        </div>
        <div style={{ fontSize: 12, opacity: 0.55, textAlign: 'center' }}>
          保存后，你在此软件中的操作在审计日志与资源仓库里会显示这个名字（agent 另有自己的身份）。
        </div>
      </div>
    </Modal>
  );
}
