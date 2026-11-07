/** 扫描登记卡（FR-16.1 / T-132，2026-11-07 用户点名 A 组）：
 *  设置→数据源与根目录：扫描根目录管理 + 只读扫描出候选 + 勾选登记/加入忽略。
 *  候选只提示不自动登记（登记是显式动作，走既有 POST /api/projects 批量通道）。 */
import { App as AntdApp, Button, Checkbox, Input, Tag, Tooltip } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { useSettings } from '@/app/settings';

interface ScanCandidate {
  dirPath: string;
  matchedManifests: string[];
}

export function ScanCard(): React.JSX.Element {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const { settings, setSetting } = useSettings();
  const roots = (settings.scanRootDirs ?? []).filter((r): r is string => typeof r === 'string');
  const ignorePaths = settings.scanIgnorePaths ?? [];
  const [newRoot, setNewRoot] = useState('');
  const [scanning, setScanning] = useState(false);
  const [candidates, setCandidates] = useState<ScanCandidate[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const addRoot = (): void => {
    const v = newRoot.trim();
    if (v === '') return;
    if (roots.includes(v)) {
      void message.info('该根目录已在列表中');
      return;
    }
    void setSetting('scanRootDirs', [...roots, v]);
    setNewRoot('');
  };

  const scan = async (): Promise<void> => {
    if (roots.length === 0) {
      void message.info('先添加至少一个扫描根目录');
      return;
    }
    setScanning(true);
    try {
      const merged: ScanCandidate[] = [];
      let anyTruncated = false;
      const seen = new Set<string>();
      for (const root of roots) {
        const r = await api.post<{ candidates: ScanCandidate[]; truncated: boolean }>('/api/scan/preview', {
          root,
        });
        for (const c of r.candidates) {
          const key = c.dirPath.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(c);
          }
        }
        anyTruncated = anyTruncated || r.truncated;
      }
      setCandidates(merged);
      setTruncated(anyTruncated);
      setChecked(new Set());
      void message.success(
        `扫描完成：发现 ${merged.length} 个候选${anyTruncated ? '（已达上限，结果截断）' : ''}`,
      );
    } catch (e) {
      void message.error(e instanceof ApiClientError ? e.message : '扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const registerChecked = async (): Promise<void> => {
    const paths = [...checked];
    if (paths.length === 0) return;
    try {
      const r = await api.post<{ added: string[]; skipped: Array<{ path: string; reason: string }> }>(
        '/api/projects',
        { paths },
      );
      void message.success(`已登记 ${r.added.length} 个项目，正在分析…`);
      for (const s of r.skipped) void message.warning(`跳过 ${s.path}：${s.reason}`);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setCandidates((prev) => prev.filter((c) => !checked.has(c.dirPath)));
      setChecked(new Set());
    } catch (e) {
      void message.error(e instanceof ApiClientError ? e.message : '登记失败');
    }
  };

  const ignoreChecked = async (): Promise<void> => {
    const paths = [...checked];
    if (paths.length === 0) return;
    const next = [...new Set([...ignorePaths, ...paths])].slice(0, 500);
    try {
      await api.put('/api/scan/ignore', { paths: next });
      void setSetting('scanIgnorePaths', next);
      setCandidates((prev) => prev.filter((c) => !checked.has(c.dirPath)));
      setChecked(new Set());
    } catch (e) {
      void message.error(e instanceof ApiClientError ? e.message : '忽略失败');
    }
  };

  const removeFromIgnore = async (path: string): Promise<void> => {
    const next = ignorePaths.filter((p) => p !== path);
    try {
      await api.put('/api/scan/ignore', { paths: next });
      void setSetting('scanIgnorePaths', next);
    } catch (e) {
      void message.error(e instanceof ApiClientError ? e.message : '移除失败');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="scan-card">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {roots.length === 0 && <span style={{ fontSize: 12, opacity: 0.6 }}>未配置扫描根目录</span>}
        {roots.map((r) => (
          <Tag
            key={r}
            closable
            onClose={() =>
              void setSetting(
                'scanRootDirs',
                roots.filter((x) => x !== r),
              )
            }
            className="tt-ellipsis"
            style={{ maxWidth: 300 }}
          >
            {r}
          </Tag>
        ))}
        <Input
          size="small"
          style={{ width: 220 }}
          value={newRoot}
          onChange={(e) => setNewRoot(e.target.value)}
          onPressEnter={addRoot}
          placeholder="粘贴根目录路径回车添加"
        />
        <Button size="small" icon={<PlusOutlined />} disabled={newRoot.trim() === ''} onClick={addRoot}>
          添加根目录
        </Button>
        <Tooltip title="只读扫描根目录的子目录（深度 ≤2），发现像项目的未登记文件夹">
          <Button
            size="small"
            type="primary"
            icon={<ReloadOutlined />}
            loading={scanning}
            disabled={roots.length === 0}
            onClick={() => void scan()}
            data-testid="scan-run-btn"
          >
            扫描
          </Button>
        </Tooltip>
      </div>

      {ignorePaths.length > 0 && (
        <div>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
            忽略名单（{ignorePaths.length}，不再提示）：
          </div>
          {ignorePaths.map((p) => (
            <Tag
              key={p}
              closable
              onClose={() => void removeFromIgnore(p)}
              className="tt-ellipsis"
              style={{ maxWidth: 320 }}
            >
              {p}
            </Tag>
          ))}
        </div>
      )}

      {candidates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              size="small"
              type="primary"
              disabled={checked.size === 0}
              onClick={() => void registerChecked()}
            >
              登记所选（{checked.size}）
            </Button>
            <Button size="small" disabled={checked.size === 0} onClick={() => void ignoreChecked()}>
              忽略所选
            </Button>
            {truncated && (
              <span style={{ fontSize: 12, opacity: 0.65 }}>
                已达扫描上限，结果不完整——可缩小根目录或忽略已知项
              </span>
            )}
          </div>
          <div style={{ maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {candidates.map((c) => (
              <div key={c.dirPath} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Checkbox
                  checked={checked.has(c.dirPath)}
                  onChange={(e) => {
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(c.dirPath);
                      else next.delete(c.dirPath);
                      return next;
                    });
                  }}
                />
                <Tooltip title={c.dirPath}>
                  <span className="tt-ellipsis tt-mono" style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
                    {c.dirPath}
                  </span>
                </Tooltip>
                {c.matchedManifests.map((m) => (
                  <Tag key={m} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                    {m}
                  </Tag>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
