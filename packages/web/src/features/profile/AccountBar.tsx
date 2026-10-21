/** 侧栏底部账户条（FR-13.7 / T-103）：头像圆 24px + 用户名，hover 高亮，点击开个人主页。
 * 侧栏宽度不足以展示文字时退化为纯头像圆（不折行、不挤占菜单）。 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, avatarUrl } from '@/lib/api';
import type { ProfileInfo } from '@ttfolio/shared';
import { SEMANTIC } from '@/theme/tokens';
import { ProfileModal } from './ProfileModal';

/** 低于该宽度只显示头像圆（232 默认宽 - 内边距后仍可展示名字）。 */
const NAME_MIN_WIDTH = 150;

export function AccountBar(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(999);
  const [open, setOpen] = useState(false);
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<ProfileInfo>('/api/profile'),
  });

  useEffect(() => {
    const el = hostRef.current;
    if (el === null) return undefined;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const name = profile?.name ?? '本机用户';
  const initial = (profile?.name ?? '').trim().charAt(0).toUpperCase() || '我';
  const compact = width < NAME_MIN_WIDTH;

  return (
    <div ref={hostRef} style={{ borderTop: `1px solid ${SEMANTIC.split}`, padding: 6 }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen(true);
        }}
        title={compact ? `${name}（点击打开个人主页）` : '个人主页'}
        data-testid="account-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 6px',
          borderRadius: 8,
          cursor: 'pointer',
          justifyContent: compact ? 'center' : 'flex-start',
          transition: 'background .15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = SEMANTIC.primaryBg;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            flexShrink: 0,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: SEMANTIC.primary,
            color: 'rgba(255,255,255,.95)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {profile?.hasAvatar === true ? (
            <img src={avatarUrl()} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            initial
          )}
        </span>
        {!compact && (
          <span
            className="tt-ellipsis"
            style={{ fontSize: 13, minWidth: 0, flex: 1 }}
            data-testid="account-name"
          >
            {name}
          </span>
        )}
      </div>
      <ProfileModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
