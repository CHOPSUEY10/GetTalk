<script>
  import { onDestroy, onMount } from "svelte";
  import Router from "svelte-spa-router";
  import { routes } from "./routes/index.js";
  import { authStore } from "./stores/auth.store.js";
  import { socketStore } from "./stores/socket.store.js";
  import gettalkLogo from "./assets/gettalk.svg";

  let serviceUnavailable = false;

  function handleServiceUnavailable() {
    serviceUnavailable = true;
  }

  function handleRetryConnection() {
    serviceUnavailable = false;
    authStore.initialize();
    if ($authStore.authenticated) {
      socketStore.reconnect();
    }
  }

  // Manage socket connection lifecycle based on authentication state
  $: if ($authStore.authenticated) {
    socketStore.connect();
  } else {
    socketStore.disconnect();
  }

  onMount(() => {
    authStore.initialize();
    if (typeof window !== "undefined") {
      window.addEventListener("api:service-unavailable", handleServiceUnavailable);
    }
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("api:service-unavailable", handleServiceUnavailable);
    }
  });
</script>

<main class="min-h-screen w-full">
  {#if serviceUnavailable}
    <div
      role="alert"
      class="sticky top-0 z-50 w-full bg-rose-950/95 border-b border-rose-500/40 text-rose-100 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <div>
        <strong class="font-semibold">Layanan Sedang Dinonaktifkan Sementara (503)</strong>
        <span class="block sm:inline sm:ml-2 text-rose-200/90 text-xs">
          Server chat GetTalk sedang dalam pemeliharaan keamanan darurat. Silakan coba lagi beberapa saat lagi.
        </span>
      </div>
      <button
        type="button"
        on:click={handleRetryConnection}
        class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
      >
        Coba Muat Ulang
      </button>
    </div>
  {/if}
  {#if $authStore.loading}
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
