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
import { useSettings } from '@/app/settings';
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
  const { settings } = useSettings();
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
  /** 用户明确要求"载入磁盘版本"：绕过"有未保存改动就不覆盖"的守卫 */
  const [forceReload, setForceReload] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 已载入的版本标识 + 是否已考虑过草稿。
   * 为什么必须记：路径条「刷新」、保存后的失效、SSE 的文件变更都会重新取同一个文件，
   * react-query 每次都返回**新对象**，原实现只按对象身份跑载入 effect，于是任何一次重取
   * 都会 setValue(磁盘内容) 并把 dirty 置回 false —— 未保存的编辑被静默丢弃。
   */
  const loadedRef = useRef<{ version: string; draftApplied: boolean } | null>(null);

  const { data: file, error } = useQuery({
    queryKey: ['file', projectId, path],
    queryFn: () => api.get<FileContent>('/api/fs/file', { projectId, path })
  });

  const { data: draft, isFetchedAfterMount: draftFetchedAfterMount } = useQuery({
    queryKey: ['draft', pathKey],
    queryFn: () =>
      api.get<{ content: string; updatedAt: string } | null>('/api/drafts', { scope: 'project_file', pathKey }),
    enabled: file !== undefined,
    // 必须每次挂载都重取：全局 staleTime=15s 会让"刚打开过、当时没有草稿"的 null 结果被缓存住，
    // 于是后退/前进或切标签回来时（组件重新挂载）拿到陈旧的 null → 有草稿却不恢复。
    staleTime: 0,
    refetchOnMount: 'always'
  });

  // 载入/重载：只在"换了文件"或"磁盘版本真的变了"时重置缓冲区
  useEffect(() => {
    if (file === undefined) return;
    const version = `${path}|${file.mtime}|${file.size}|${file.hash}`;
    // draftReady 必须是"本次挂载后真的取过草稿"，不能只看 draft !== undefined：
    // 重新挂载时 draft 会先是**缓存的旧值**（常见是 null），那时若判为就绪，
    // 第一轮就会把 draftApplied 标 true，真正取回草稿的那一轮被 early-return 跳过 →
    // 编辑器停在磁盘内容、未保存圆点熄灭（实测：后退→前进后草稿内容消失）。
    const draftReady = draft !== undefined && draftFetchedAfterMount;
    const applied = loadedRef.current;
    const sameVersion = applied !== null && applied.version === version;
    // 同一版本、草稿还没到位 → 等草稿那一轮再决定
    if (sameVersion && !draftReady) return;
    // 同一版本、草稿已处理过 → 完全不动缓冲区（刷新/失效/SSE 重取都走这里）
    if (sameVersion && applied.draftApplied) return;
    const sameFile = applied !== null && applied.version.slice(0, applied.version.indexOf('|')) === path;
    // 同一文件、磁盘版本变了、且本地有未保存改动 → 只提示，绝不覆盖
    if (sameFile && dirtyRef.current && !forceReload) {
      setExternalChanged(true);
      return;
    }
    const hasDraft =
      !forceReload && draft !== null && draft !== undefined && draft.content !== '' && draft.content !== file.content;
    if (sameVersion) {
      // 磁盘内容已经在编辑器里了，这一轮只为"草稿是否要填进去"服务，不动其它状态
      if (hasDraft && draft !== null && draft !== undefined) {
        setValue(draft.content);
        setDirty(true);
        setBase({ mtime: file.mtime, size: file.size, hash: file.hash, encoding: file.encoding, eol: file.eol });
        void message.info('已恢复未保存的草稿');
      }
      // draftApplied 如实反映"这一次是否处理过草稿结果"：文件查询通常先于草稿查询返回，
      // 若第一轮就标 true，草稿到达时会被 early-return 跳过 → "有草稿却不恢复"（违反红线 4）。
      loadedRef.current = { version, draftApplied: draftReady };
      return;
    }
    // 版本变化（换文件 / 磁盘变更且无本地改动）：整块重置
    setValue(hasDraft && draft !== null && draft !== undefined ? draft.content : file.content);
    setBase({ mtime: file.mtime, size: file.size, hash: file.hash, encoding: file.encoding, eol: file.eol });
    // 草稿恢复后必须保持"未保存"：原实现无条件 setDirty(false)，把草稿的未保存状态盖掉，
    // 用户会以为已保存（也就不会再按 Ctrl+S）。
    setDirty(hasDraft);
    setConflict(null);
    setExternalChanged(false);
    setForceReload(false);
    if (hasDraft) void message.info('已恢复未保存的草稿');
    loadedRef.current = { version, draftApplied: draftReady };
  }, [file, draft, draftFetchedAfterMount, path, message, forceReload]);

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
      setDirty(false);
      // 标记"本版本已处理过草稿"，否则草稿查询一到齐就会把刚放弃的内容again 恢复回来
      if (file !== undefined) {
        loadedRef.current = { version: `${path}|${file.mtime}|${file.size}|${file.hash}`, draftApplied: true };
      }
      setConflict(null);
      void message.info('已放弃本地改动，载入磁盘版本（草稿保留 24h）');
    }
  };

  // 自动保存（FR-11.2，默认关）：开关打开时，停止输入 2s 后自动落盘。
  // 原先这个开关在设置页里是个死键（没有任何代码读它），用户反馈"设置了没反应"。
  useEffect(() => {
    if (!settings.autoSave || !dirty || saving || conflict !== null || base === null) return;
    const t = setTimeout(() => {
      void save(false);
    }, 2000);
    return () => clearTimeout(t);
  }, [settings.autoSave, dirty, value, saving, conflict, base, save]);

  if (error !== undefined && error !== null) {
    // 目录被误当文件打开时给出可读提示（后端已把 EISDIR 映射为业务错误码 IS_DIRECTORY）
    if (error instanceof ApiClientError && error.code === 'IS_DIRECTORY') {
      return <Alert type="info" message="这是一个目录" description="目录不能作为文件打开；在左侧点击文件夹前的箭头即可展开。" />;
    }
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
              <Button size="small" onClick={() => { setExternalChanged(false); setForceReload(true); void queryClient.invalidateQueries({ queryKey: ['file', projectId, path] }); }}>重新加载</Button>
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
