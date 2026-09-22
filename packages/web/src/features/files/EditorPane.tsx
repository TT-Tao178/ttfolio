/** 编辑器（FR-4.3/4.4/4.8）：CodeMirror 6 + 未保存圆点 + Ctrl+S + 冲突三选一 + 草稿 1s 防抖 + 外部修改提示。 */
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { Alert, Button, Modal, Space, Tag, App } from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError, rawUrl } from '@/lib/api';
import type { DiskVersionInfo, FileContent } from '@ttfolio/shared';
import { DRAFT_DEBOUNCE_MS } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { langExtension } from './langExt';
import { cmTheme, cmHighlight } from '@/theme/codemirror';
import { SEMANTIC } from '@/theme/tokens';
import { useSettingsDark } from './useDark';

interface Props {
  projectId: string;
  path: string;
}

interface ConflictState {
  disk: DiskVersionInfo;
}

export function EditorPane({ projectId, path }: Props): React.JSX.Element {
  const dark = useSettingsDark();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const draftKey = `${projectId}|${path}`;
  const pathKey = `${projectId}:${path}`.toLowerCase();

  const [value, setValue] = useState<string>('');
  const [base, setBase] = useState<{ mtime: string; size: number; hash: string; encoding: FileContent['encoding']; eol: FileContent['eol'] } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [externalChanged, setExternalChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: file, error } = useQuery({
    queryKey: ['file', projectId, path],
    queryFn: () => api.get<FileContent>('/api/fs/file', { projectId, path })
  });

  const { data: draft } = useQuery({
    queryKey: ['draft', pathKey],
    queryFn: () =>
      api.get<{ content: string; updatedAt: string } | null>('/api/drafts', { scope: 'project_file', pathKey }),
    enabled: file !== undefined
  });

  // 初始载入：磁盘内容 + 草稿恢复
  useEffect(() => {
    if (file === undefined) return;
    let content = file.content;
    if (draft !== null && draft !== undefined && draft.content !== '' && draft.content !== file.content) {
      content = draft.content;
      setDirty(true);
      void message.info('已恢复未保存的草稿');
    }
    setValue(content);
    setBase({ mtime: file.mtime, size: file.size, hash: file.hash, encoding: file.encoding, eol: file.eol });
    setDirty(false);
    setConflict(null);
    setExternalChanged(false);
  }, [file, draft === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  // 外部修改检测（fs.changed 已被 SSE 失效 file 缓存 → mtime 变了且本地 clean → 提示）
  useEffect(() => {
    if (file === undefined || base === null) return;
    if (file.mtime !== base.mtime && !dirty && !saving) {
      setExternalChanged(true);
    }
  }, [file, base, dirty, saving]);

  const save = useCallback(
    async (force: boolean): Promise<void> => {
      if (base === null || saving) return;
      setSaving(true);
      try {
        const r = await api.put<{ mtime: string; size: number; hash: string }>('/api/fs/file', {
          projectId,
          path,
          content: valueRef.current,
          baseMtime: base.mtime,
          baseSize: base.size,
          baseHash: base.hash,
          encoding: base.encoding,
          eol: base.eol,
          force
        });
        setBase({ ...base, mtime: r.mtime, size: r.size, hash: r.hash });
        setDirty(false);
        setConflict(null);
        void api.del('/api/drafts', { scope: 'project_file', pathKey }).catch(() => {});
        useAppStore.getState().clearDirty(draftKey);
        void message.success('已保存');
        await queryClient.invalidateQueries({ queryKey: ['file', projectId, path] });
      } catch (e) {
        if (e instanceof ApiClientError && e.code === 'MTIME_CONFLICT') {
          const detail = e.detail as { current: DiskVersionInfo } | undefined;
          if (detail !== undefined) setConflict({ disk: detail.current });
        } else {
          void message.error(e instanceof ApiClientError ? e.message : '保存失败');
        }
      } finally {
        setSaving(false);
      }
    },
    [base, projectId, path, pathKey, draftKey, message, queryClient, saving]
  );

  // Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // 草稿 1s 防抖（C-07）
  const onChange = (v: string): void => {
    setValue(v);
    if (!dirty) setDirty(true);
    useAppStore.getState().markDirty(draftKey);
    if (draftTimer.current !== null) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void api
        .put('/api/drafts', {
          scope: 'project_file',
          projectId,
          pathKey,
          path,
          content: valueRef.current,
          baseMtime: base?.mtime ?? null,
          baseSize: base?.size ?? null,
          baseHash: base?.hash ?? null,
          encoding: base?.encoding ?? 'utf8',
          eol: base?.eol ?? 'LF'
        })
        .catch(() => {});
    }, DRAFT_DEBOUNCE_MS);
  };

  const discardLocal = (): void => {
    if (conflict !== null) {
      setValue(conflict.disk.content ?? value);
      setConflict(null);
      void message.info('已放弃本地改动，载入磁盘版本（草稿保留 24h）');
    }
  };

  if (error !== undefined && error !== null) {
    return <Alert type="error" message={error instanceof Error ? error.message : '打开失败'} />;
  }
  if (file === undefined) return <div style={{ padding: 16, opacity: 0.6 }}>加载中…</div>;
  if (file.isBinary) {
    return (
      <Alert
        type="info"
        message="二进制文件"
        description="该文件是二进制格式，不提供编辑器预览。"
        action={<Button onClick={() => window.open(rawUrl(projectId, path), '_blank')}>用外部程序打开</Button>}
      />
    );
  }
  if (file.tooLarge || file.truncated) {
    return <Alert type="warning" message="文件过大（>5MB）" description="仅支持只读预览前 5MB，建议用外部编辑器打开。" />;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} data-testid="editor-pane" data-path={path}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        <span className="tt-mono tt-ellipsis" style={{ fontSize: 12 }}>{path}</span>
        {dirty && (
          <span title="未保存" data-testid="dirty-dot" style={{ width: 8, height: 8, borderRadius: 4, background: SEMANTIC.warning, display: 'inline-block' }} />
        )}
        <Tag>{file.encoding}</Tag>
        <Tag>{file.eol}</Tag>
        <div style={{ flex: 1 }} />
        <Space>
          <Button size="small" disabled={!dirty || saving} onClick={() => void save(false)} data-testid="save-btn">
            保存 (Ctrl+S)
          </Button>
        </Space>
      </div>
      {externalChanged && (
        <Alert
          type="warning"
          showIcon
          message="文件已在磁盘上被外部修改"
          style={{ marginBottom: 4 }}
          action={
            <Space>
              <Button size="small" onClick={() => { void queryClient.invalidateQueries({ queryKey: ['file', projectId, path] }); setExternalChanged(false); }}>重新加载</Button>
              <Button size="small" onClick={() => setExternalChanged(false)}>忽略</Button>
            </Space>
          }
        />
      )}
      <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${SEMANTIC.split}`, borderRadius: 6 }}>
        <CodeMirror
          value={value}
          height="100%"
          theme={dark ? 'dark' : 'light'}
          extensions={[langExtension(path), cmTheme(dark), cmHighlight(dark), EditorView.lineWrapping]}
          onChange={onChange}
          basicSetup={{ foldGutter: true, autocompletion: false }}
        />
      </div>
      <Modal
        open={conflict !== null}
        title="保存冲突：文件已在磁盘上被修改"
        onCancel={() => setConflict(null)}
        footer={[
          <Button key="diff" onClick={() => window.open(rawUrl(projectId, path), '_blank')}>对比（查看磁盘版本）</Button>,
          <Button key="discard" danger onClick={discardLocal}>放弃本地改动</Button>,
          <Button key="overwrite" type="primary" danger onClick={() => { setConflict(null); void save(true); }}>
            用我的内容覆盖磁盘
          </Button>
        ]}
      >
        <p>你的改动仍在（草稿已保留）。磁盘版本摘要：</p>
        <pre className="tt-mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {conflict !== null && `mtime: ${conflict.disk.mtime}\nsize: ${conflict.disk.size}\nhash: ${conflict.disk.hash}`}
        </pre>
        <p style={{ opacity: 0.7 }}>选择：对比后决定 / 放弃本地 / 直接覆盖（不可撤销，建议先对比）。</p>
      </Modal>
    </div>
  );
}
