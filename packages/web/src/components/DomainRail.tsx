/** 域条（3.2）：项目/Git/架构图/文档/搜索/设置。 */
import { Tooltip } from 'antd';
import {
  AppstoreOutlined, BranchesOutlined, ApartmentOutlined, BookOutlined, SearchOutlined, SettingOutlined
} from '@ant-design/icons';
import React from 'react';
import { useAppStore, type Domain } from '@/app/store';
import { SEMANTIC } from '@/theme/tokens';

const DOMAINS: Array<{ key: Domain; icon: React.JSX.Element; label: string }> = [
  { key: 'projects', icon: <AppstoreOutlined />, label: '项目' },
  { key: 'git', icon: <BranchesOutlined />, label: 'Git' },
  { key: 'archives', icon: <ApartmentOutlined />, label: '架构图' },
  { key: 'docs', icon: <BookOutlined />, label: '文档' },
  { key: 'search', icon: <SearchOutlined />, label: '搜索' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' }
];

function RailButton({ active, onClick, label, children }: {
  active: boolean; onClick: () => void; label: string; children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip title={label} placement="right">
      <div
        onClick={onClick}
        aria-label={label}
        style={{
          // 尺寸对齐《界面原型-AntD.html》#rail .d：40×40、圆角 8、字号 17
          width: 40, height: 40, borderRadius: 8, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
          background: active ? SEMANTIC.primaryBg : 'transparent',
          color: active ? SEMANTIC.primary : 'inherit'
        }}
      >
        {children}
      </div>
    </Tooltip>
  );
}

export function DomainRail(): React.JSX.Element {
  const { domain, setDomain, sidebarCollapsed, setSidebar } = useAppStore();
  return (
    <div
      style={{
        // 宽度/padding/gap 对齐原型 #body 第一列（56px）与 #rail（padding 12px 0, gap 4）
        width: 56, flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: '12px 0', borderRight: `1px solid ${SEMANTIC.split}`
      }}
    >
      {DOMAINS.map((d) => (
        <RailButton
          key={d.key}
          active={domain === d.key && !sidebarCollapsed}
          onClick={() => {
            if (domain === d.key) {
              setSidebar(!sidebarCollapsed);
            } else {
              setDomain(d.key);
              setSidebar(false);
              // 设置域的内容就是设置页本身（不像项目域是标签驱动的），
              // 只切域会出现"点了设置但右边没反应"；这里补上：已有设置标签就切过去，没有就开一个。
              if (d.key === 'settings') {
                const st = useAppStore.getState();
                const existing = st.tabs.find((t) => t.kind === 'settings');
                if (existing !== undefined) st.activateTab(existing.id);
                else st.openTab({ kind: 'settings', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '设置');
              }
            }
          }}
          label={d.label}
        >
          {d.icon}
        </RailButton>
      ))}
    </div>
  );
}
