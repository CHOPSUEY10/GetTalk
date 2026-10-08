<script>
    import PublicLayout from "../components/layout/PublicLayout.svelte";
    import { authStore } from "../stores/auth.store.js";
    import { replace } from "svelte-spa-router";

    let username = "";
    let password = "";
    let showPassword = false;
    /** @type {string | null} */
    let localError = null;

    const handleLogin = async () => {
        if (!username.trim() || !password) {
            localError = "Silakan masukkan username dan password.";
            return;
        }

        localError = null;
        try {
            await authStore.login({ username: username.trim(), password });
            replace("/");
        } catch (err) {
            const e = /** @type {any} */ (err);
            localError = e.message || "Username atau password salah. Silakan coba lagi.";
        }
    };
</script>

<PublicLayout>
    <div class="space-y-6">
        <div class="text-center mb-6">
            <h2 class="text-xl font-bold text-slate-900 tracking-tight">Selamat Datang Kembali</h2>
            <p class="text-sm text-slate-500 mt-1">Masuk ke akun GetTalk Anda untuk mulai berkirim pesan aman.</p>
        </div>

        {#if localError || $authStore.error}
            <div class="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2.5 animate-fadeIn">
                <svg class="w-5 h-5 text-rose-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{localError || $authStore.error}</span>
            </div>
        {/if}

        <form on:submit|preventDefault={handleLogin} class="space-y-4">
            <div>
                <label for="username" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Username
                </label>
                <div class="relative rounded-xl shadow-sm">
                    <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                    </div>
                    <input
                        id="username"
                        type="text"
                        bind:value={username}
                        placeholder="Masukkan username"
                        autocomplete="username"
                        required
                        disabled={$authStore.loading}
                        class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all disabled:opacity-60"
                    />
                </div>
            </div>

            <div>
                <label for="password" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Password
                </label>
                <div class="relative rounded-xl shadow-sm">
                    <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    </div>
                    <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        bind:value={password}
                        placeholder="••••••••"
                        autocomplete="current-password"
                        required
                        disabled={$authStore.loading}
                        class="w-full pl-10 pr-11 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all disabled:opacity-60"
                    />
                    <button
                        type="button"
                        class="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                        on:click={() => (showPassword = !showPassword)}
                        tabindex="-1"
                    >
                        {#if showPassword}
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                            </svg>
                        {:else}
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                        {/if}
                    </button>
                </div>
            </div>

            <button
                type="submit"
                disabled={$authStore.loading}
                class="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
            >
                {#if $authStore.loading}
                    <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Memproses...</span>
                {:else}
                    <span>Masuk</span>
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                {/if}
            </button>
        </form>

        <div class="pt-4 border-t border-slate-100 text-center">
            <p class="text-sm text-slate-500">
                Belum memiliki akun?
                <a href="#/register" class="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline ml-1">
                    Daftar Sekarang
                </a>
            </p>
        </div>
    </div>
</PublicLayout>
