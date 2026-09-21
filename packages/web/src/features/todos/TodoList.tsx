/** 轻量清单（FR-9.1/9.3/9.4）：添加/勾选/删除/折叠完成项；actor 字段预留。 */
import { Button, Input, List, Space, Tag } from 'antd';
import { CheckOutlined, PlusOutlined } from '@ant-design/icons';
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { TodoItem } from '@ttfolio/shared';

export function TodoList({ projectId, scopeAll }: { projectId?: string; scopeAll?: boolean }): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [showDone, setShowDone] = useState(false);
  const queryClient = useQueryClient();
  const url = scopeAll === true ? '/api/todos?scope=all' : `/api/todos?projectId=${projectId ?? ''}`;
  const { data: todos } = useQuery({ queryKey: ['todos', projectId, scopeAll], queryFn: () => api.get<TodoItem[]>(url) });
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['todos'] });
  };
  const add = useMutation({
    mutationFn: () => api.post('/api/todos', { projectId: projectId ?? '', title }),
    onSuccess: () => {
      setTitle('');
      invalidate();
    }
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/api/todos/${id}`, body),
    onSuccess: invalidate
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/todos/${id}`),
    onSuccess: invalidate
  });

  const all = todos ?? [];
  const open = all.filter((t) => !t.done);
  const done = all.filter((t) => t.done);

  return (
    <div data-testid="todo-list">
      <strong>清单</strong>
      {projectId !== undefined || scopeAll === true ? (
        <Space.Compact style={{ width: '100%', margin: '8px 0' }}>
          <Input size="small" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="添加条目（回车确认）" onPressEnter={() => title.trim() !== '' && add.mutate()} />
          <Button size="small" type="primary" icon={<PlusOutlined />} disabled={title.trim() === ''} onClick={() => add.mutate()} />
        </Space.Compact>
      ) : null}
      <List
        size="small"
        dataSource={open}
        locale={{ emptyText: '没有未完成条目' }}
        renderItem={(t) => (
          <List.Item style={{ padding: '3px 0' }}>
            <span style={{ display: 'inline-flex', gap: 8, width: '100%', alignItems: 'center' }}>
              <Button
                size="small"
                type="text"
                icon={<CheckOutlined />}
                onClick={() => patch.mutate({ id: t.id, body: { done: true } })}
              />
              <span style={{ flex: 1 }}>{t.title}</span>
              {t.dueOn !== null && <Tag style={{ fontSize: 10 }}>截止 {t.dueOn}</Tag>}
              {t.category !== null && <Tag style={{ fontSize: 10 }}>{t.category}</Tag>}
              <Button size="small" type="text" danger onClick={() => del.mutate(t.id)}>删除</Button>
            </span>
          </List.Item>
        )}
      />
      {done.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setShowDone(!showDone)}>
            {showDone ? '折叠已完成' : `展开已完成（${done.length}）`}
          </Button>
          {showDone &&
            done.map((t) => (
              <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: 0.55, padding: '2px 0' }}>
                <Button size="small" type="text" onClick={() => patch.mutate({ id: t.id, body: { done: false } })}>↺</Button>
                <span style={{ textDecoration: 'line-through', flex: 1 }}>{t.title}</span>
                <Button size="small" type="text" danger onClick={() => del.mutate(t.id)}>删除</Button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
