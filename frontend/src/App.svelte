<script>
  import { onMount } from 'svelte';
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
    <h1>GetTalk</h1>

    <section>
      <h2>Frontend Bootstrap</h2>

      <p>
        Authentication Status: 
        <strong>{$authStore.authenticated ? 'Authenticated' : 'Unauthenticated'}</strong>
      </p>
      
      {#if $authStore.user}
        <p>
          User: <code>{JSON.stringify($authStore.user)}</code>
        </p>
      {/if}

      <p>
        API URL:
        <code>{env.apiUrl}</code>
      </p>

      <p>
        Socket.IO URL:
        <code>{env.socketUrl}</code>
      </p>

      <p>
        Socket status:
        <strong>{socketStatus}</strong>
      </p>

      <button on:click={connectSocket}>
        Connect Socket.IO
      </button>
    </section>
  {/if}
</main>