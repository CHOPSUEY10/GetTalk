<script>
    import PublicLayout from "../components/layout/PublicLayout.svelte";
    import { register } from "../services/api/auth.api.js";
    import { push } from "svelte-spa-router";

    let username = "";
    let email = "";
    let password = "";
    let confirmPassword = "";
    let showPassword = false;
    /** @type {string | null} */
    let error = null;
    let loading = false;
    let success = false;

    const handleRegister = async () => {
        error = null;

        if (!username.trim() || !email.trim() || !password) {
            error = "Semua kolom wajib diisi.";
            return;
        }

        if (password.length < 6) {
            error = "Password minimal terdiri dari 6 karakter.";
            return;
        }

        if (password !== confirmPassword) {
            error = "Konfirmasi password tidak cocok.";
            return;
        }

        try {
            loading = true;
            await register({
                username: username.trim(),
                email: email.trim(),
                password
            });
            success = true;
            setTimeout(() => {
                push("/login");
            }, 1500);
        } catch (err) {
            const e = /** @type {any} */ (err);
            error = e.message || "Pendaftaran akun gagal. Silakan coba lagi.";
        } finally {
            loading = false;
        }
    };
</script>

<PublicLayout>
    <div class="space-y-6">
        <div class="text-center mb-6">
            <h2 class="text-xl font-bold text-slate-900 tracking-tight">Buat Akun Baru</h2>
            <p class="text-sm text-slate-500 mt-1">Daftar akun GetTalk untuk memulai percakapan aman terenkripsi.</p>
        </div>

        {#if success}
            <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-3 animate-fadeIn">
                <svg class="w-5 h-5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <div>
                    <p class="font-semibold">Pendaftaran Berhasil!</p>
                    <p class="text-xs text-emerald-600 mt-0.5">Mengalihkan ke halaman login...</p>
                </div>
            </div>
        {/if}

        {#if error}
            <div class="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2.5 animate-fadeIn">
                <svg class="w-5 h-5 text-rose-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{error}</span>
            </div>
        {/if}

        <form on:submit|preventDefault={handleRegister} class="space-y-4">
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
                        placeholder="Pilih username"
                        autocomplete="username"
                        required
                        disabled={loading || success}
                        class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all disabled:opacity-60"
                    />
                </div>
            </div>

            <div>
                <label for="email" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Email
                </label>
                <div class="relative rounded-xl shadow-sm">
                    <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <input
                        id="email"
                        type="email"
                        bind:value={email}
                        placeholder="nama@email.com"
                        autocomplete="email"
                        required
                        disabled={loading || success}
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
                        placeholder="Minimal 6 karakter"
                        autocomplete="new-password"
                        required
                        disabled={loading || success}
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

            <div>
                <label for="confirmPassword" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Konfirmasi Password
                </label>
                <div class="relative rounded-xl shadow-sm">
                    <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                    </div>
                    <input
                        id="confirmPassword"
                        type={showPassword ? "text" : "password"}
                        bind:value={confirmPassword}
                        placeholder="Ulangi password"
                        autocomplete="new-password"
                        required
                        disabled={loading || success}
                        class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all disabled:opacity-60"
                    />
                </div>
            </div>

            <button
                type="submit"
                disabled={loading || success}
                class="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
            >
                {#if loading}
                    <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Mendaftarkan...</span>
                {:else}
                    <span>Daftar Sekarang</span>
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                {/if}
            </button>
        </form>

        <div class="pt-4 border-t border-slate-100 text-center">
            <p class="text-sm text-slate-500">
                Sudah memiliki akun?
                <a href="#/login" class="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline ml-1">
                    Masuk di sini
                </a>
            </p>
        </div>
    </div>
</PublicLayout>
