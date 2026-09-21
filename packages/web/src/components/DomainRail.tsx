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
          width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
          background: active ? 'rgba(22,119,255,0.12)' : 'transparent',
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
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: '8px 4px', borderRight: '1px solid rgba(128,128,128,.15)'
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
