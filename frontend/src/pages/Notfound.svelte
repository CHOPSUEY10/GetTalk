<script>
    import { push } from "svelte-spa-router";
    import { authStore } from "../stores/auth.store.js";
</script>

<div class="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-6">
    <div class="max-w-md w-full text-center space-y-6">
        <!-- 404 Glow Badge -->
        <div class="relative inline-flex items-center justify-center">
            <span class="text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-300 to-indigo-200">
                404
            </span>
            <div class="absolute -inset-4 bg-indigo-500/20 blur-2xl -z-10 rounded-full"></div>
        </div>

        <div class="space-y-2">
            <h1 class="text-2xl font-bold tracking-tight text-white">
                Halaman Tidak Ditemukan
            </h1>
            <p class="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">
                Halaman yang Anda cari tidak tersedia, telah dipindahkan, atau tautan yang Anda tuju salah.
            </p>
        </div>

        <div class="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
                type="button"
                class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer"
                on:click={() => push("/")}
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span>{$authStore.authenticated ? 'Kembali ke Beranda' : 'Menuju Halaman Utama'}</span>
            </button>

            {#if !$authStore.authenticated}
                <button
                    type="button"
                    class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm transition-colors border border-white/10"
                    on:click={() => push("/login")}
                >
                    Masuk ke Akun
                </button>
            {/if}
        </div>
    </div>
</div>
