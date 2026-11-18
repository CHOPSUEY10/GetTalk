<script lang="ts">
  import { authStore } from '../../stores/auth.store.ts';
  import { streamStore } from '../../stores/stream.store.ts';
  import { uiStore } from '../../stores/ui.store.ts';
  import Icon from '../common/Icon.svelte';
  import SeverityBadge from '../common/SeverityBadge.svelte';

  export let currentRoute = '/';
  export let navigate: (path: string) => void;

  const navItems = [
    { path: '/', label: 'Overview', icon: 'overview' },
    { path: '/network', label: 'Network (Firewalld)', icon: 'network' },
    { path: '/web', label: 'Web Layer (Nginx)', icon: 'web' },
    { path: '/application', label: 'Application (PM2)', icon: 'application' },
    { path: '/events', label: 'Security Events', icon: 'events' },
    { path: '/alerts', label: 'IDS Alerts', icon: 'alerts' },
    { path: '/rules', label: 'Detection Rules', icon: 'rules' },
    { path: '/audit-logs', label: 'Audit Logs', icon: 'audit' },
    { path: '/settings', label: 'Settings & Health', icon: 'settings' },
  ];
</script>

<div class="min-h-screen flex flex-col md:flex-row bg-slate-950 text-slate-100">
  <!-- Mobile Header -->
  <header class="md:hidden flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
    <div class="flex items-center gap-2.5">
      <button
        type="button"
        class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-800 cursor-pointer"
        aria-label="Toggle navigation menu"
        on:click={() => uiStore.toggleSidebar()}
      >
        <Icon name="menu" size="md" />
      </button>
      <span class="font-bold text-sm tracking-tight">GetTalk Security IDS</span>
    </div>
    <SeverityBadge level={$streamStore.status === 'connected' ? 'healthy' : 'degraded'} />
  </header>

  <!-- Sidebar Navigation -->
  <aside
    class="w-64 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col justify-between {
      $uiStore.sidebarOpen ? 'block' : 'hidden md:flex'
    }"
    aria-label="Security monitoring navigation"
  >
    <div>
      <div class="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <Icon name="shield" size="sm" />
          </div>
          <div>
            <div class="font-bold text-sm text-white leading-tight">GetTalk Security</div>
            <div class="text-[11px] text-slate-400">Telemetry & Passive IDS</div>
          </div>
        </div>
      </div>

      <nav class="p-3 space-y-1">
        {#each navItems as item}
          {@const active = currentRoute === item.path}
          <button
            type="button"
            on:click={() => {
              navigate(item.path);
              uiStore.toggleSidebar(false);
            }}
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer {active
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
              : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}"
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={item.icon} size="sm" />
            <span>{item.label}</span>
          </button>
        {/each}
      </nav>
    </div>

    <div class="p-4 border-t border-slate-800 space-y-3">
      <div class="flex items-center justify-between text-xs">
        <span class="text-slate-400">SSE Telemetry Stream</span>
        <span
          class="inline-flex items-center gap-1.5 font-medium {$streamStore.status === 'connected'
            ? 'text-emerald-400'
            : 'text-amber-400'}"
        >
          <span
            class="w-2 h-2 rounded-full {$streamStore.status === 'connected'
              ? 'bg-emerald-400'
              : 'bg-amber-400'}"
          ></span>
          {$streamStore.status}
        </span>
      </div>

      {#if $authStore.user}
        <div class="flex items-center justify-between pt-2 border-t border-slate-800/80">
          <div class="min-w-0">
            <div class="text-xs font-semibold text-slate-200 truncate">{$authStore.user.username}</div>
            <div class="text-[11px] text-indigo-400 uppercase font-mono">{$authStore.user.role}</div>
          </div>
          <button
            type="button"
            on:click={() => authStore.logout()}
            class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 cursor-pointer"
            title="Sign out"
          >
            <Icon name="log-out" size="xs" />
            <span>Logout</span>
          </button>
        </div>
      {/if}
    </div>
  </aside>

  <!-- Main Workspace -->
  <div class="flex-1 flex flex-col min-w-0">
    <!-- Toast Notifications -->
    {#if $uiStore.notifications.length > 0}
      <div class="fixed top-4 right-4 z-50 space-y-2 max-w-sm w-full">
        {#each $uiStore.notifications as n (n.id)}
          <div
            role="status"
            class="px-4 py-3 rounded-xl border shadow-lg text-xs flex items-center justify-between gap-3 bg-slate-900 border-slate-700 text-slate-100"
          >
            <span>{n.message}</span>
            <button
              type="button"
              class="text-slate-400 hover:text-white cursor-pointer"
              aria-label="Dismiss notification"
              on:click={() => uiStore.dismissNotification(n.id)}
            >
              <Icon name="x" size="xs" />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <main class="flex-1 p-4 md:p-6 overflow-y-auto space-y-6">
      <slot />
    </main>
  </div>
</div>

