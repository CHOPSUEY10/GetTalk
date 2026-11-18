import env from '../../config/env.ts';
import type { StreamMessage } from '../../lib/types/telemetry.ts';

export type StreamEventHandler = (message: StreamMessage) => void;
export type StreamStatusHandler = (status: 'connected' | 'connecting' | 'disconnected') => void;

class ManagedStreamClient {
  private source: EventSource | null = null;
  private handlers = new Set<StreamEventHandler>();
  private statusHandlers = new Set<StreamStatusHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    if (this.source) return;

    this.notifyStatus('connecting');
    const streamUrl = `${env.apiUrl}/api/v1/stream`;
    const es = new EventSource(streamUrl, { withCredentials: true });
    this.source = es;

    es.onopen = () => {
      this.notifyStatus('connected');
    };

    const forwardEvent = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as StreamMessage;
        for (const h of this.handlers) {
          h(parsed);
        }
      } catch {
        // Ignore malformed frame
      }
    };

    es.addEventListener('connected', forwardEvent);
    es.addEventListener('telemetry_event', forwardEvent);
    es.addEventListener('system_metric', forwardEvent);
    es.addEventListener('security_alert', forwardEvent);
    es.addEventListener('heartbeat', forwardEvent);

    es.onerror = () => {
      this.disconnect();
      this.notifyStatus('disconnected');
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 5000);
      }
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    this.notifyStatus('disconnected');
  }

  onMessage(handler: StreamEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatusChange(handler: StreamStatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private notifyStatus(status: 'connected' | 'connecting' | 'disconnected'): void {
    for (const h of this.statusHandlers) {
      h(status);
    }
  }
}

export const streamClient = new ManagedStreamClient();
export default streamClient;

