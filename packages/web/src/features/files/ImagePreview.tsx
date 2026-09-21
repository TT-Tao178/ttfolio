/** 图片预览（经用户内容端口 /raw 只读代理）。 */
import { Empty } from 'antd';
import React, { useState } from 'react';
import { rawUrl } from '@/lib/api';

export function ImagePreview({ projectId, path }: { projectId: string; path: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 16, height: '100%', overflow: 'auto' }}>
      {failed ? (
        <Empty description={'无法加载：' + path} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 64 }} />
      ) : (
        <img src={rawUrl(projectId, path)} alt={path} style={{ maxWidth: '100%', borderRadius: 8 }} onError={() => setFailed(true)} />
      )}
    </div>
  );
}
