/** 项目徽标（2026-11-03 用户拍板）：有自定义头像显示头像图，否则首字母 +
 *  按项目 id 稳定着色（projectBadgeColor）。侧栏 18px / 卡片 24px 共用同一组件，
 *  保证同一项目两处同色不割裂；色板与哈希在 theme/tokens.ts（唯一色值定义处）。 */
import { Avatar } from 'antd';
import type { ProjectSummary } from '@ttfolio/shared';
import { projectBadgeColor } from '@/theme/tokens';
import { projectAvatarUrl } from '@/lib/api';

export function ProjectBadge({
  p,
  size,
}: {
  p: Pick<ProjectSummary, 'id' | 'alias' | 'diskName' | 'hasAvatar' | 'avatarV'>;
  size: number;
}): React.JSX.Element {
  return (
    <Avatar
      style={{
        background: projectBadgeColor(p.id),
        flexShrink: 0,
        fontSize: Math.round(size * 0.46),
      }}
      size={size}
      src={p.hasAvatar === true ? projectAvatarUrl(p.id, p.avatarV ?? 0) : undefined}
    >
      {(p.alias ?? p.diskName).charAt(0).toUpperCase()}
    </Avatar>
  );
}
