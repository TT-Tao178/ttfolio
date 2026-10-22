/**
 * Word / PDF / Excel 只读预览（第 40 轮）：docx-preview（docx）、pdfjs-dist（pdf）、
 * SheetJS（xlsx / xls / csv）纯前端解析，字节经 fetchDocsRaw 二进制通道
 * （服务端白名单 + 50MB 上限 + 路径守卫）。纯本地渲染、无网络请求；
 * 解析失败降级为错误提示，不影响其他文档的阅读与编辑。
 * 三个渲染库全部动态 import：不进首屏 bundle，用到哪个加载哪个。
 */
import { Alert, Button, Spin, Tabs } from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchDocsRaw } from '@/lib/api';

type Kind = 'pdf' | 'docx' | 'sheet';

function kindOf(path: string): Kind | null {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  const ext = (m?.[1] ?? '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'sheet';
  return null;
}

/** 首次渲染页数上限：几百页的 PDF 全量渲染会长时间占死主线程，其余页点按钮继续。 */
const PDF_INITIAL_PAGES = 20;

export function OfficePreview({
  projectId,
  path,
  mountId,
  loader,
}: {
  projectId?: string;
  path: string;
  mountId: string | null;
  /** 自定义取数（FR-13.12 / T-110 文档库等非项目通道）；缺省走 /api/docs/raw */
  loader?: () => Promise<ArrayBuffer>;
}): React.JSX.Element {
  const kind = useMemo(() => kindOf(path), [path]);
  const [data, setData] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    const p = loader !== undefined ? loader() : fetchDocsRaw(projectId ?? '', path, mountId);
    p.then((buf) => {
      if (!alive) return;
      setData(new Uint8Array(buf));
      setLoading(false);
    }).catch((e: unknown) => {
      if (!alive) return;
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, path, mountId, loader]);

  if (loading) return <Spin style={{ margin: '48px auto', display: 'block' }} tip="正在加载文档…" />;
  if (error !== null)
    return (
      <Alert
        type="error"
        message="预览失败"
        description={error}
        style={{ marginTop: 32 }}
        data-testid="office-preview-error"
      />
    );
  if (data === null || kind === null)
    return <Alert type="warning" message="该格式暂不支持预览" style={{ marginTop: 32 }} />;
  if (kind === 'pdf') return <PdfView data={data} />;
  if (kind === 'docx') return <DocxView data={data} />;
  return <SheetView data={data} />;
}

/** 共用取库缓存：同一次会话内重复打开同一文档不重复加载渲染库。 */
let pdfLibs: Promise<[typeof import('pdfjs-dist'), { default: string }]> | null = null;
function loadPdfLibs(): Promise<[typeof import('pdfjs-dist'), { default: string }]> {
  pdfLibs ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]) as Promise<[typeof import('pdfjs-dist'), { default: string }]>;
  return pdfLibs;
}

function PdfView({ data }: { data: Uint8Array }): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [limit, setLimit] = useState(PDF_INITIAL_PAGES);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let cancel = false;
    setError(null);
    setDone(0);
    (async () => {
      try {
        const [{ getDocument, GlobalWorkerOptions }, worker] = await loadPdfLibs();
        GlobalWorkerOptions.workerSrc = worker.default;
        const box = boxRef.current;
        if (!alive || box === null) return;
        box.innerHTML = '';
        // getDocument 会转移底层 ArrayBuffer，复制一份保证「继续渲染」时数据仍可用
        const pdf = await getDocument({ data: data.slice(0) }).promise;
        if (!alive) return;
        setTotal(pdf.numPages);
        const width = Math.max(320, box.clientWidth - 16);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= Math.min(pdf.numPages, limit); i++) {
          if (cancel && !alive) return;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.display = 'block';
          canvas.style.marginBottom = '12px';
          canvas.style.borderRadius = '4px';
          box.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          if (ctx === null) throw new Error('无法创建画布上下文');
          await page.render({ canvas: canvas, canvasContext: ctx, viewport }).promise;
          setDone(i);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
      cancel = true;
    };
  }, [data, limit]);

  const rest = total - done;
  return (
    <div>
      {error !== null && (
        <Alert type="error" message="PDF 渲染失败" description={error} style={{ marginBottom: 12 }} />
      )}
      {total > 0 && done < total && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Spin size="small" />
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            正在渲染 {done}/{total} 页…
          </span>
          {done >= limit && rest > 0 && (
            <Button size="small" onClick={() => setLimit(total)}>
              继续渲染剩余 {rest} 页
            </Button>
          )}
        </div>
      )}
      <div ref={boxRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0 }} />
    </div>
  );
}

function DocxView({ data }: { data: Uint8Array }): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        const box = boxRef.current;
        if (!alive || box === null) return;
        box.innerHTML = '';
        await renderAsync(data.slice(0), box, undefined, {
          inWrapper: true,
          className: 'tt-docx',
          ignoreLastRenderedPageBreak: true,
        });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [data]);

  if (error !== null)
    return <Alert type="error" message="Word 渲染失败" description={error} style={{ marginBottom: 12 }} />;
  return (
    <div
      ref={boxRef}
      className="tt-docx-box"
      style={{ background: 'var(--tt-container-bg, #fff)', borderRadius: 8, padding: 8 }}
    />
  );
}

function SheetView({ data }: { data: Uint8Array }): React.JSX.Element {
  const [sheets, setSheets] = useState<Array<{ name: string; html: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // xlsx 约 430KB：动态加载，不进首屏 vendor chunk
        const XLSX = await import('xlsx');
        const wb = XLSX.read(data.slice(0), { type: 'array' });
        const rows = wb.SheetNames.flatMap((name) => {
          const ws = wb.Sheets[name];
          if (ws === undefined) return [];
          return [{ name, html: XLSX.utils.sheet_to_html(ws, { header: '', footer: '' }) }];
        });
        if (alive) setSheets(rows);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [data]);

  if (error !== null)
    return <Alert type="error" message="表格解析失败" description={error} style={{ marginTop: 16 }} />;
  if (sheets === null) return <Spin style={{ margin: '32px auto', display: 'block' }} />;
  if (sheets.length === 0)
    return <Alert type="error" message="表格为空（文件可能已损坏或为旧版格式）" style={{ marginTop: 16 }} />;
  if (sheets.length === 1)
    return <div className="tt-sheet" dangerouslySetInnerHTML={{ __html: sheets[0]?.html ?? '' }} />;
  return (
    <Tabs
      items={sheets.map((s) => ({
        key: s.name,
        label: s.name,
        children: <div className="tt-sheet" dangerouslySetInnerHTML={{ __html: s.html }} />,
      }))}
    />
  );
}
