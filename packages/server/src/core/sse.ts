/** SSE 事件中枢（C-30 / API-9）：只携带"发生了什么 + 实体 id"，保留最近 500 条支持断线补齐。 */
import type { SseEvent, SseEventName } from '@ttfolio/shared';

interface Client {
  id: number;
  send: (chunk: string) => void;
  close: () => void;
}

export class SseHub {
  private clients = new Map<number, Client>();
  private buffer: SseEvent[] = [];
  private seq = 0;
  private nextClientId = 1;
  private readonly capacity = 500;

  subscribe(
    send: (chunk: string) => void,
    close: () => void,
    lastEventId?: number,
  ): { id: number; replay: SseEvent[] } {
    const id = this.nextClientId++;
    this.clients.set(id, { id, send, close });
    const replay = lastEventId !== undefined ? this.buffer.filter((e) => e.id > lastEventId) : [];
    return { id, replay };
  }

  unsubscribe(id: number): void {
    this.clients.delete(id);
  }

  clientCount(): number {
    return this.clients.size;
  }

  publish(event: SseEventName, data: Record<string, unknown>): void {
    this.seq += 1;
    const evt: SseEvent = { id: this.seq, event, data };
    this.buffer.push(evt);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    const payload = `id: ${evt.id}\nevent: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`;
    for (const client of this.clients.values()) {
      try {
        client.send(payload);
      } catch {
        this.clients.delete(client.id);
      }
    }
  }
}
