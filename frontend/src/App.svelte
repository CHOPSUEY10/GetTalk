<script>
  import { onMount } from "svelte";
  import Router from "svelte-spa-router";
  import { routes } from "./router/index.js";
  import { authStore } from "./stores/auth.store.js";
  import { connectSocket, disconnectSocket } from "./lib/socket.js";

  // Manage socket connection lifecycle based on authentication state
  $: if ($authStore.authenticated) {
    connectSocket();
  } else {
    disconnectSocket();
  }

  onMount(() => {
    authStore.initialize();
  });
</script>

<main class="min-h-screen w-full">
  {#if $authStore.loading}
    <!-- Landing / Splash screen saat pertama kali masuk -->
    <div class="flex flex-col items-center justify-center min-h-screen w-full bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-6">
      <div class="flex flex-col items-center text-center max-w-sm">
        <!-- Logo Badge -->
        <div class="relative flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-2xl shadow-indigo-500/40 mb-6 animate-pulse">
          <span class="text-3xl font-extrabold text-white">G</span>
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
