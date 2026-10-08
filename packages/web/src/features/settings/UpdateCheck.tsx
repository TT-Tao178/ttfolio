/**
 * 关于卡内的「检查更新」（评审 C10 轻方案前端）：手动检查 GitHub Releases
 * （元数据走 api.github.com，不经被加速器拦截的下载域）+ Token 配置 + 打开下载页。
 * 仓库当前为私有：检查需要能读取本仓库的 GitHub Token（只存本机 settings 表，
 * 接口不回显本体）；仓库转公开后无 Token 也能查。
 */
import { Alert, App as AntdApp, Button, Input, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  GithubOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';

interface UpdateStatus {
  currentVersion: string;
  repo: string;
  releaseUrl: string;
  tokenSet: boolean;
}

interface CheckResult {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  releaseUrl: string;
  assets: string[];
  note?: string | null;
}

export function UpdateCheck(): React.JSX.Element {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const { data: status } = useQuery({
    queryKey: ['update-status'],
    queryFn: () => api.get<UpdateStatus>('/api/update/status'),
  });

  const saveToken = useMutation({
    mutationFn: () => api.post('/api/update/token', { token: token.trim() }),
    onSuccess: () => {
      void message.success('Token 已保存（只存本机数据库，不会回显）');
      setToken('');
      void queryClient.invalidateQueries({ queryKey: ['update-status'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '保存失败'),
  });
  const clearToken = useMutation({
    mutationFn: () => api.post('/api/update/token', { token: '' }),
    onSuccess: () => {
      void message.success('已清除 Token');
      void queryClient.invalidateQueries({ queryKey: ['update-status'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '清除失败'),
  });
  const check = useMutation({
    mutationFn: () => api.get<CheckResult>('/api/update/check'),
    onSuccess: (r) => setResult(r),
    onError: (e) => {
      setResult(null);
      void message.error(e instanceof ApiClientError ? e.message : '检查失败');
    },
  });
  const openRelease = useMutation({
    mutationFn: () => api.post('/api/update/open-release'),
    onSuccess: () => void message.info('已在系统浏览器打开 Releases 页面（若被挡住请 Alt+Tab）'),
  });

  const hasExe = result !== null && result.assets.some((a) => a.endsWith('.exe'));

  return (
    <div
      style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
      data-testid="update-check"
    >
      <Space size={8} wrap>
        <Typography.Text>当前版本：v{status?.currentVersion ?? '…'}</Typography.Text>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={check.isPending}
          onClick={() => check.mutate()}
          data-testid="update-check-btn"
        >
          检查更新
        </Button>
        <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => openRelease.mutate()}>
          打开下载页
        </Button>
      </Space>
      {result !== null &&
        (result.hasUpdate ? (
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message={`发现新版本 v${result.latestVersion}（当前 v${result.currentVersion}）`}
            description={
              <div style={{ fontSize: 12 }}>
                <div>
                  {hasExe
                    ? `安装包：${result.assets.filter((a) => a.endsWith('.exe')).join('、')}`
                    : '该 Release 暂无 .exe 安装包资产（可能只有源码）'}
                </div>
                {result.note != null && <div style={{ opacity: 0.6 }}>{result.note}</div>}
                <Button
                  size="small"
                  type="primary"
                  style={{ marginTop: 6 }}
                  icon={<GithubOutlined />}
                  onClick={() => openRelease.mutate()}
                >
                  前往 Releases 页下载
                </Button>
              </div>
            }
            data-testid="update-result"
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message={
              result.latestVersion === null
                ? 'GitHub 上还没有任何 Release'
                : `已是最新版本（最新 Release：v${result.latestVersion}）`
            }
            data-testid="update-result"
          />
        ))}
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        <div style={{ marginBottom: 4 }}>
          GitHub Token：
          {status === undefined ? (
            <Tag>读取中…</Tag>
          ) : status.tokenSet ? (
            <Tag color="success">已配置</Tag>
          ) : (
            <Tag color="warning">未配置</Tag>
          )}
          <span style={{ opacity: 0.6 }}>
            仓库私有，检查更新需要能读取 {status?.repo ?? '本仓库'} 的 Token；转公开后可留空
          </span>
        </div>
        <Space.Compact style={{ width: '100%', maxWidth: 460 }}>
          <Input.Password
            size="small"
            value={token}
            placeholder="ghp_… / github_pat_…（粘贴后保存，只存本机）"
            onChange={(e) => setToken(e.target.value)}
            onPressEnter={() => {
              if (token.trim() !== '') saveToken.mutate();
            }}
            data-testid="update-token-input"
          />
          <Button
            size="small"
            disabled={token.trim() === ''}
            loading={saveToken.isPending}
            onClick={() => saveToken.mutate()}
          >
            保存
          </Button>
          {status?.tokenSet === true && (
            <Button size="small" loading={clearToken.isPending} onClick={() => clearToken.mutate()}>
              清除
            </Button>
          )}
        </Space.Compact>
      </div>
    </div>
  );
}
