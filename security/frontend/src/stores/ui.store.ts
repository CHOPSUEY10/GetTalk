import { writable } from 'svelte/store';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface UINotification {
  id: string;
  type: NotificationType;
  message: string;
}

export interface UIState {
  sidebarOpen: boolean;
  theme: 'dark' | 'light';
  notifications: UINotification[];
}

let counter = 0;

function createUIStore() {
  const { subscribe, update } = writable<UIState>({
    sidebarOpen: false,
    theme: 'dark',
    notifications: [],
  });

  return {
    subscribe,
    toggleSidebar: (force?: boolean) =>
      update((s) => ({
        ...s,
        sidebarOpen: typeof force === 'boolean' ? force : !s.sidebarOpen,
      })),
    toggleTheme: () =>
      update((s) => {
        const next = s.theme === 'dark' ? 'light' : 'dark';
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-theme', next);
        }
        return { ...s, theme: next };
      }),
    notify: (message: string, type: NotificationType = 'info') => {
      const id = `notif-${Date.now()}-${++counter}`;
      update((s) => ({
        ...s,
        notifications: [...s.notifications, { id, type, message }],
      }));
      setTimeout(() => {
        update((s) => ({
          ...s,
          notifications: s.notifications.filter((n) => n.id !== id),
        }));
      }, 4500);
    },
    dismissNotification: (id: string) =>
      update((s) => ({
        ...s,
        notifications: s.notifications.filter((n) => n.id !== id),
      })),
  };
}

export const uiStore = createUIStore();
export default uiStore;

