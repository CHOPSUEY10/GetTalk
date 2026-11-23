<script>
  import { onDestroy, onMount } from "svelte";
  import Router from "svelte-spa-router";
  import { routes } from "./routes/index.js";
  import { authStore } from "./stores/auth.store.js";
  import { socketStore } from "./stores/socket.store.js";
  import ServiceUnavailable from "./pages/ServiceUnavailable.svelte";
  import gettalkLogo from "./assets/gettalk.svg";

  let serviceUnavailable = false;
  let retryingConnection = false;
  /** @type {string | null} */
  let lastFailedEndpoint = null;

  /**
   * @param {CustomEvent<{ endpoint?: string, method?: string, status?: number }>} [event]
   */
  function handleServiceUnavailable(event) {
    serviceUnavailable = true;
    retryingConnection = false;
    lastFailedEndpoint = event?.detail?.endpoint || null;
    socketStore.disconnect();
  }

  function handleServiceAvailable() {
    if (serviceUnavailable) {
      serviceUnavailable = false;
      retryingConnection = false;
      lastFailedEndpoint = null;
      if ($authStore.authenticated) {
        socketStore.reconnect();
      }
    }
  }

  async function handleRetryConnection() {
    retryingConnection = true;
    try {
      await authStore.initialize();
      if (!serviceUnavailable && $authStore.authenticated) {
        socketStore.reconnect();
      }
    } finally {
      retryingConnection = false;
    }
  }

  // Manage socket connection lifecycle based on authentication state and kill switch state
  $: if ($authStore.authenticated && !serviceUnavailable) {
    socketStore.connect();
  } else {
    socketStore.disconnect();
  }

  onMount(() => {
    if (typeof window !== "undefined") {
      window.addEventListener("api:service-unavailable", handleServiceUnavailable);
      window.addEventListener("api:service-available", handleServiceAvailable);
    }
    authStore.initialize();
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("api:service-unavailable", handleServiceUnavailable);
      window.removeEventListener("api:service-available", handleServiceAvailable);
    }
  });
</script>

<main class="min-h-screen w-full">
  {#if serviceUnavailable}
    <ServiceUnavailable
      retrying={retryingConnection}
      {lastFailedEndpoint}
      on:retry={handleRetryConnection}
    />
  {:else if $authStore.loading}
    <!-- Landing / Splash screen saat pertama kali masuk -->
    <div class="flex flex-col items-center justify-center min-h-screen w-full bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-6">
      <div class="flex flex-col items-center text-center max-w-sm">
        <!-- Logo Badge -->
        <div class="relative flex items-center justify-center w-20 h-20 mb-6 animate-pulse">
          <img src={gettalkLogo} alt="GetTalk Logo" class="w-20 h-20 object-contain drop-shadow-2xl" />
          <div class="absolute -inset-1 rounded-3xl bg-indigo-500/20 blur-sm -z-10"></div>
        </div>

        <h1 class="text-3xl font-bold tracking-tight text-white mb-2">
          GetTalk
        </h1>
        <p class="text-sm text-slate-300 leading-relaxed">
          End-to-End Encrypted Real-Time Chat Application
        </p>
      </div>
    </div>
  {:else}
    <!-- Langsung diarahkan ke route yang sesuai via Router & Guards (Public login/register atau Protected dashboard) -->
    <Router {routes} />
  {/if}
</main>
