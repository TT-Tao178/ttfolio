/**
 * 首次启动新手导览（T-120 / P2-3）：一切可选——每一步都可点右上角 × 跳过，
 * 看完/跳过即记入 localStorage，此后不再自动出现；设置→关于可重新查看。
 * 触发条件：无已登记项目 && 未看过（老用户升级后不会被弹）。
 * 用 antd 自带 Tour（5.12+），不自研浮层；视觉跟随主题 token，六主题自适应。
 */
import { Button, Tour, type TourProps } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';

const SEEN_KEY = 'tt-onboarding-seen';

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // 存储不可用（隐私模式等）时绝不反复弹
  }
}

export function OnboardingTour(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const nonce = useAppStore((s) => s.onboardingNonce);
  const lastNonce = useRef(0);
  const { data: projects } = useQuery({
    queryKey: ['projects', 'sidebar'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active' }),
  });

  // 首启自动触发：未看过 && 已登记项目为空（查询就绪后稍等片刻，让界面先稳定）
  useEffect(() => {
    if (seen() || projects === undefined || projects.length > 0) return undefined;
    const t = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(t);
  }, [projects]);

  // 设置→关于「重新查看」：nonce 驱动，无视 seen
  useEffect(() => {
    if (nonce > lastNonce.current) {
      lastNonce.current = nonce;
      setOpen(true);
    }
  }, [nonce]);

  const finish = (): void => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* 存储不可用：仅影响「不再自动出现」的记忆，无功能影响 */
    }
    setOpen(false);
  };

  const bodyTarget = (): HTMLElement => document.body;
  const steps: TourProps['steps'] = [
    {
      title: '欢迎使用 ttFolio',
      target: bodyTarget,
      placement: 'center',
      description: (
        <div style={{ maxWidth: 380 }}>
          <p style={{ margin: '0 0 6px' }}>
            把硬盘上的项目文件夹「登记」进来集中浏览——磁盘上的文件原地不动，本应用只是索引；不联网、不要求注册。
          </p>
          <p style={{ margin: 0, opacity: 0.7 }}>跟着看完约 30 秒；随时可点右上角 × 跳过。</p>
        </div>
      ),
    },
    {
      title: '一切皆标签',
      target: () => document.querySelector('[data-testid="tab-bar"]') ?? bodyTarget(),
      description: '项目、文件、视图都会开成标签页——可并存、可固定，关掉还能恢复；重启后原样回来。',
    },
    {
      title: 'Ctrl+K 全局搜索与命令',
      target: () => document.querySelector('[data-testid="palette-btn"]') ?? bodyTarget(),
      description:
        '项目名 / 文件名 / 文件内容一框直搜；输入 > 或按 Ctrl+Shift+P 切到命令模式，执行命令与改快捷键。',
    },
    {
      title: '登记第一个项目',
      target: () => document.querySelector('[data-testid="dashboard"]') ?? bodyTarget(),
      description: (
        <div>
          <p style={{ margin: '0 0 8px' }}>
            点下方按钮或页面里的「添加项目」：粘贴路径 / 选文件夹 / 父目录批量，登记后自动分析。
            主题切换与「重新查看新手导览」在 设置 → 关于。
          </p>
          <Button
            type="primary"
            onClick={() => {
              finish();
              useAppStore.getState().requestAddProject();
            }}
          >
            登记第一个项目
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Tour
      open={open}
      steps={steps}
      onClose={finish}
      onFinish={finish}
      indicatorsRender={(cur, total) => (
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          {cur + 1} / {total}
        </span>
      )}
    />
  );
}
