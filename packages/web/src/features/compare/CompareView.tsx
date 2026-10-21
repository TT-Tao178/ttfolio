/** 文件对比查看器（FR-13.9 / T-106b）：两份文本并排行对齐（只读；单滚动容器天然同步）。 */
import { Alert, Spin, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import React, { useMemo } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { FileContent } from '@ttfolio/shared';
import { SEMANTIC } from '@/theme/tokens';
import { alignLines, decodeCompareSpec, isTrashSide, type CompareSide } from './compareShared';

/** 渲染行数上限：超大文件对齐结果只渲染前 N 行，诚实提示 */
const MAX_RENDER_ROWS = 4000;

function labelOf(s: CompareSide): string {
  return isTrashSide(s) ? `回收站副本 · ${s.name}` : s.path;
}

function basenameOf(s: CompareSide): string {
  const raw = isTrashSide(s) ? s.name : s.path;
  const segs = raw.split(/[\\/]/);
  return segs[segs.length - 1] ?? raw;
}

type SideState = { ok: true; content: string } | { ok: false; reason: string };

export function CompareView({ specJson }: { specJson: string }): React.JSX.Element {
  const spec = decodeCompareSpec(specJson);
  const leftRef: CompareSide = spec?.left ?? { projectId: '', path: '' };
  const rightRef: CompareSide = spec?.right ?? { projectId: '', path: '' };
  const enabled = spec !== null;
  const leftQ = useQuery({
    queryKey: ['compare', 'left', spec?.left ?? null],
    queryFn: () => loadSide(leftRef),
    enabled,
  });
  const rightQ = useQuery({
    queryKey: ['compare', 'right', spec?.right ?? null],
    queryFn: () => loadSide(rightRef),
    enabled,
  });

  const leftState = toState(leftQ.data, leftQ.error, leftQ.isLoading);
  const rightState = toState(rightQ.data, rightQ.error, rightQ.isLoading);

  const align = useMemo(() => {
    if (leftState.ok !== true || rightState.ok !== true) return null;
    return alignLines(leftState.content.split('\n'), rightState.content.split('\n'));
  }, [leftState, rightState]);

  if (spec === null) {
    return <Alert type="warning" message="无效的对比规格" style={{ margin: 16 }} />;
  }

  const err =
    leftState.ok === false
      ? `左侧：${leftState.reason}`
      : rightState.ok === false
        ? `右侧：${rightState.reason}`
        : null;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 16px' }} data-testid="compare-view">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        对比：{basenameOf(spec.left)} ↔ {basenameOf(spec.right)}
      </Typography.Title>
      <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 8 }} className="tt-mono">
        <span style={{ marginRight: 16 }}>左 = {labelOf(spec.left)}</span>
        <span>右 = {labelOf(spec.right)}</span>
      </div>
      {err !== null ? (
        <Alert type="warning" message={err} showIcon />
      ) : align === null ? (
        <Spin style={{ display: 'block', margin: '48px auto' }} />
      ) : (
        <>
          {align.aligned === false && (
            <Alert
              type="info"
              message="两侧行数较多，已按行号平行排列（未做内容对齐）"
              style={{ marginBottom: 6 }}
            />
          )}
          {align.rows.length > MAX_RENDER_ROWS && (
            <Alert
              type="warning"
              message={`共 ${align.rows.length} 行，仅渲染前 ${MAX_RENDER_ROWS} 行`}
              style={{ marginBottom: 6 }}
            />
          )}
          <div
            className="tt-mono"
            style={{ fontSize: 12, lineHeight: 1.5, minWidth: 760 }}
            data-testid="compare-grid"
          >
            {(() => {
              let ln = 0;
              let rn = 0;
              return align.rows.slice(0, MAX_RENDER_ROWS).map((r, i) => {
                const leftNo = r.left !== null ? ++ln : null;
                const rightNo = r.right !== null ? ++rn : null;
                return <CompareRow key={i} r={r} ln={leftNo} rn={rightNo} />;
              });
            })()}
          </div>
        </>
      )}
    </div>
  );
}

function CompareRow({
  r,
  ln,
  rn,
}: {
  r: { left: string | null; right: string | null; same: boolean };
  ln: number | null;
  rn: number | null;
}): React.JSX.Element {
  const cls = !r.same
    ? r.right === null
      ? 'tt-diff-del'
      : r.left === null
        ? 'tt-diff-add'
        : 'tt-diff-chg'
    : '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 44px 1fr' }}>
      <LineNo n={ln} />
      <div className={cls} style={cellStyle}>
        {r.left ?? ' '}
      </div>
      <LineNo n={rn} />
      <div className={cls} style={cellStyle}>
        {r.right ?? ' '}
      </div>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  padding: '0 6px',
  borderInlineStart: `1px solid ${SEMANTIC.split}`,
};

function LineNo({ n }: { n: number | null }): React.JSX.Element {
  return (
    <div style={{ textAlign: 'right', padding: '0 6px', opacity: 0.45, userSelect: 'none' }}>
      {n !== null ? n : ' '}
    </div>
  );
}

function loadSide(s: CompareSide): Promise<{ content: string }> {
  if (isTrashSide(s)) {
    return api.get<{ content: string; encoding: string }>(`/api/trash/${s.trashId}/file`, {
      name: s.name,
    });
  }
  return api.get<FileContent>('/api/fs/file', { projectId: s.projectId, path: s.path });
}

function toState(data: { content: string } | undefined, error: unknown, isLoading: boolean): SideState {
  if (isLoading) return { ok: false, reason: '加载中' };
  if (error !== null && error !== undefined) {
    return { ok: false, reason: error instanceof ApiClientError ? error.message : '读取失败' };
  }
  if (data === undefined) return { ok: false, reason: '无数据' };
  const fc = data as FileContent;
  if (fc.isBinary === true) return { ok: false, reason: '二进制文件不支持对比' };
  if (fc.tooLarge === true) return { ok: false, reason: '文件超过 5MB，不支持对比' };
  return { ok: true, content: data.content };
}
