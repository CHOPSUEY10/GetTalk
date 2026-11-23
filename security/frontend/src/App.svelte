<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import SecurityShell from './components/layout/SecurityShell.svelte';
  import ApplicationMonitoring from './pages/ApplicationMonitoring.svelte';
  import AuditLogs from './pages/AuditLogs.svelte';
  import DetectionRules from './pages/DetectionRules.svelte';
  import IdsAlerts from './pages/IdsAlerts.svelte';
  import Login from './pages/Login.svelte';
  import NetworkMonitoring from './pages/NetworkMonitoring.svelte';
  import Overview from './pages/Overview.svelte';
  import SecurityEvents from './pages/SecurityEvents.svelte';
  import Settings from './pages/Settings.svelte';
  import WebMonitoring from './pages/WebMonitoring.svelte';
  import { resolveHashRoute, type RoutePath } from './routes/routes.ts';
  import { authStore } from './stores/auth.store.ts';
  import { settingsStore } from './stores/settings.store.ts';
  import { streamStore } from './stores/stream.store.ts';

  let currentRoute: RoutePath = resolveHashRoute();

  function navigate(path: string) {
    if (typeof window !== 'undefined') {
      window.location.hash = path;
    }
    currentRoute = resolveHashRoute();
  }

  function handleHashChange() {
    currentRoute = resolveHashRoute();
  }

  function handleUnauthorized() {
    streamStore.stop();
    authStore.setUnauthenticated();
  }

  $: if ($authStore.authenticated) {
    streamStore.start();
    if ($authStore.user?.role === 'admin') {
      settingsStore.loadKillSwitch();
    }
  } else {
    streamStore.stop();
  }

  onMount(() => {
    authStore.initialize();
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('sec:unauthorized', handleUnauthorized);
  });

  onDestroy(() => {
    streamStore.stop();
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('sec:unauthorized', handleUnauthorized);
    }
  });
</script>

{#if $authStore.loading}
  <div class="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-300 gap-3">
    <div class="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
    <p class="text-xs font-medium">Initializing GetTalk Security Console...</p>
  </div>
{:else if !$authStore.authenticated}
  <Login />
{:else}
  <SecurityShell {currentRoute} {navigate}>
    {#if currentRoute === '/'}
      <Overview />
    {:else if currentRoute === '/network'}
      <NetworkMonitoring />
    {:else if currentRoute === '/web'}
      <WebMonitoring />
    {:else if currentRoute === '/application'}
      <ApplicationMonitoring />
    {:else if currentRoute === '/events'}
      <SecurityEvents />
    {:else if currentRoute === '/alerts'}
      <IdsAlerts />
    {:else if currentRoute === '/rules'}
      <DetectionRules />
    {:else if currentRoute === '/audit-logs'}
      <AuditLogs />
    {:else if currentRoute === '/settings'}
      <Settings />
    {:else}
      <Overview />
    {/if}
  </SecurityShell>
{/if}

