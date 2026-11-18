import { writable } from 'svelte/store';
import type { SecurityAlert, StreamMessage, TelemetryEvent } from '../lib/types/telemetry.ts';
import streamClient from '../services/sse/stream.client.ts';
import { alertsStore } from './alerts.store.ts';
import { eventsStore } from './events.store.ts';
import { uiStore } from './ui.store.ts';

export interface StreamState {
  status: 'connected' | 'connecting' | 'disconnected';
  lastEventAt: string | null;
}

function createStreamStore() {
  const { subscribe, update } = writable<StreamState>({
    status: 'disconnected',
    lastEventAt: null,
  });

  let initialized = false;

  return {
    subscribe,
    start: () => {
      if (initialized) {
        streamClient.connect();
        return;
      }
      initialized = true;
      streamClient.onStatusChange((status) => {
        update((s) => ({ ...s, status }));
      });
      streamClient.onMessage((msg: StreamMessage) => {
        update((s) => ({ ...s, lastEventAt: msg.timestamp }));
        if (msg.type === 'telemetry_event' && msg.payload) {
          eventsStore.prependRealtimeEvent(msg.payload as TelemetryEvent);
        } else if (msg.type === 'security_alert' && msg.payload) {
          const al = msg.payload as SecurityAlert;
          alertsStore.prependRealtimeAlert(al);
          uiStore.notify(`[IDS Alert] ${al.ruleId}: ${al.title}`, 'warning');
        }
      });
      streamClient.connect();
    },
    stop: () => {
      streamClient.disconnect();
    },
  };
}

export const streamStore = createStreamStore();
export default streamStore;

