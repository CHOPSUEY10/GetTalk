<script>
  import { onMount } from 'svelte';
  import Router from 'svelte-spa-router';
  import { routes } from './router/index.js';
  import env from './config/env.js';
  import { socket } from './lib/socket.js';
  import { authStore } from './stores/auth.store.js';

  let socketStatus = 'disconnected';

  const connectSocket = () => {
    socket.connect();

    socketStatus = 'connecting';

    socket.once('connect', () => {
      socketStatus = 'connected';
    });

    socket.once('connect_error', () => {
      socketStatus = 'error';
    });
  }

  onMount(() => {
    authStore.initialize();
  });
</script>

<main>
  {#if $authStore.loading}
    <div class="loading-state">
      <p>Loading session...</p>
    </div>
  {:else if $authStore.error}
    <div class="error-state">
      <p>Error initializing application: {$authStore.error}</p>
      <button on:click={() => authStore.initialize()}>Retry</button>
    </div>
  {:else}
    <Router {routes} />
  {/if}
</main>