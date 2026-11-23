<script>
  import { createEventDispatcher } from 'svelte';
  import gettalkLogo from '../assets/gettalk.svg';

  /** @type {boolean} */
  export let retrying = false;
  /** @type {string | null} */
  export let lastFailedEndpoint = null;

  const dispatch = createEventDispatcher();

  function handleRetry() {
    if (retrying) return;
    dispatch('retry');
  }
</script>

<div
  role="alert"
  aria-live="assertive"
  class="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-rose-950/60 to-slate-900 text-white p-6"
>
  <div class="max-w-lg w-full text-center space-y-6 bg-slate-900/75 border border-rose-500/30 rounded-3xl p-8 shadow-2xl backdrop-blur-md">
    <!-- Brand & Shield Badge -->
    <div class="flex items-center justify-center gap-3">
      <img src={gettalkLogo} alt="GetTalk Logo" class="w-10 h-10 object-contain drop-shadow-lg" />
      <span class="px-3 py-1 rounded-full text-xs font-semibold tracking-wider uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40">
        Emergency Kill Switch Active
      </span>
    </div>

    <!-- 503 Glow Badge -->
    <div class="relative inline-flex items-center justify-center">
      <span class="text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-rose-400 via-amber-300 to-rose-200">
        503
      </span>
      <div class="absolute -inset-4 bg-rose-500/20 blur-2xl -z-10 rounded-full"></div>
    </div>

    <div class="space-y-3">
      <h1 class="text-2xl font-bold tracking-tight text-white">
        Layanan Sedang Dinonaktifkan Sementara
      </h1>
      <p class="text-slate-300 text-sm leading-relaxed max-w-md mx-auto">
        Server chat GetTalk saat ini sedang dinonaktifkan sementara oleh Administrator Keamanan (<code class="text-rose-300 font-mono">secadmin</code>) untuk pemeliharaan atau penanggulangan insiden keamanan darurat.
      </p>
      {#if lastFailedEndpoint}
        <p class="text-xs text-rose-300/80 font-mono">
          Status: 503 Service Unavailable ({lastFailedEndpoint})
        </p>
      {/if}
    </div>

    <div class="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
      <button
        type="button"
        disabled={retrying}
        on:click={handleRetry}
        class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-semibold text-sm transition-all shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 cursor-pointer"
      >
        <svg
          class="w-4 h-4 {retrying ? 'animate-spin' : ''}"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <span>{retrying ? 'Memeriksa Status Server...' : 'Coba Hubungkan Kembali'}</span>
      </button>
    </div>
  </div>
</div>
