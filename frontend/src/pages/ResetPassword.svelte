<script>
    import { onMount } from "svelte";
    import PublicLayout from "../components/layout/PublicLayout.svelte";
    import { authStore } from "../stores/auth.store.js";

    let email = "";
    let token = "";
    let password = "";
    let confirmPassword = "";

    let showPassword = false;
    let showConfirmPassword = false;

    /** @type {string | null} */
    let localError = null;
    /** @type {string | null} */
    let successMessage = null;
    let isSubmitting = false;
    let tokenMissing = false;

    function extractQueryParams() {
        const hash = window.location.hash || "";
        const qIndex = hash.indexOf("?");
        if (qIndex !== -1) {
            const searchParams = new URLSearchParams(hash.substring(qIndex + 1));
            return {
                token: searchParams.get("token") || "",
                email: searchParams.get("email") || "",
            };
        }
        const search = new URLSearchParams(window.location.search);
        return {
            token: search.get("token") || "",
            email: search.get("email") || "",
        };
    }

    onMount(() => {
        const params = extractQueryParams();
        token = params.token.trim();
        email = params.email.trim();

        if (!token || !email || !/^\d{6}$/.test(token)) {
            tokenMissing = true;
            localError = "Kode OTP 6-digit atau informasi email tidak ditemukan. Silakan lakukan verifikasi ulang melalui halaman lupa kata sandi.";
        }
    });

    $: hasMinLength = password.length >= 8;
    $: passwordsMatch = password && confirmPassword && password === confirmPassword;

    const handleReset = async () => {
        localError = null;

        if (!email || !/^\d{6}$/.test(token)) {
            localError = "Informasi kode OTP 6-digit atau email tidak valid. Silakan minta kode baru.";
            return;
        }

        if (!hasMinLength) {
            localError = "Kata sandi baru harus minimal 8 karakter.";
            return;
        }

        if (password !== confirmPassword) {
            localError = "Konfirmasi kata sandi tidak cocok.";
            return;
        }

        isSubmitting = true;
        try {
            const res = await authStore.resetPassword({
                email,
                token,
                newPassword: password,
                password,
            });
            successMessage =
                res?.message || "Kata sandi berhasil diatur ulang. Silakan masuk kembali.";
        } catch (err) {
            const e = /** @type {any} */ (err);
            localError =
                e.message ||
                "Kode OTP pengaturan ulang kata sandi tidak valid atau telah kedaluwarsa.";
        } finally {
            isSubmitting = false;
        }
    };
</script>

<PublicLayout>
    <div class="space-y-6">
        <div class="text-center mb-6">
            <h2 class="text-xl font-bold text-slate-900 tracking-tight">Atur Ulang Kata Sandi</h2>
            <p class="text-sm text-slate-500 mt-1">
                Buat kata sandi baru yang kuat untuk melindungi akun dan percakapan Anda.
            </p>
        </div>

        {#if localError}
            <div class="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2.5 animate-fadeIn">
                <svg class="w-5 h-5 text-rose-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div class="flex-1">
                    <span>{localError}</span>
                    {#if tokenMissing || localError.includes("tidak valid") || localError.includes("kedaluwarsa") || localError.includes("expired") || localError.includes("Invalid")}
                        <div class="mt-2">
                            <a
                                href="#/forgot-password"
                                class="inline-flex items-center text-xs font-semibold text-rose-700 hover:text-rose-900 underline gap-1"
                            >
                                Minta kode OTP baru
                                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                </svg>
                            </a>
                        </div>
                    {/if}
                </div>
            </div>
        {/if}

        {#if successMessage}
            <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm space-y-3 animate-fadeIn">
                <div class="flex items-start gap-2.5">
                    <svg class="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                        <p class="font-bold text-emerald-900 text-base">Kata Sandi Berhasil Diperbarui!</p>
                        <p class="text-xs text-emerald-700 mt-1">
                            {successMessage}
                        </p>
                        <p class="text-xs text-emerald-700/80 mt-1">
                            Demi keamanan, semua sesi aktif lainnya di perangkat lain telah otomatis dicabut.
                        </p>
                    </div>
                </div>
            </div>

            <div class="pt-2">
                <a
                    href="#/login"
                    class="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-indigo-200 hover:shadow-indigo-300"
                >
                    <span>Masuk dengan Kata Sandi Baru</span>
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                </a>
            </div>
        {:else if !tokenMissing}
            <form on:submit|preventDefault={handleReset} class="space-y-4">
                {#if email}
                    <div class="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center justify-between">
                        <span class="font-medium">Akun:</span>
                        <span class="font-semibold text-slate-900">{email}</span>
                    </div>
                {/if}

                <div>
                    <label for="new-password" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                        Kata Sandi Baru
                    </label>
                    <div class="relative rounded-xl shadow-sm">
                        <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <input
                            id="new-password"
                            type={showPassword ? "text" : "password"}
                            bind:value={password}
                            placeholder="Minimal 8 karakter"
                            autocomplete="new-password"
                            required
                            disabled={isSubmitting}
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
                    <label for="confirm-password" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                        Konfirmasi Kata Sandi Baru
                    </label>
                    <div class="relative rounded-xl shadow-sm">
                        <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                        </div>
                        <input
                            id="confirm-password"
                            type={showConfirmPassword ? "text" : "password"}
                            bind:value={confirmPassword}
                            placeholder="Ulangi kata sandi baru"
                            autocomplete="new-password"
                            required
                            disabled={isSubmitting}
                            class="w-full pl-10 pr-11 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all disabled:opacity-60"
                        />
                        <button
                            type="button"
                            class="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                            on:click={() => (showConfirmPassword = !showConfirmPassword)}
                            tabindex="-1"
                        >
                            {#if showConfirmPassword}
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

                <!-- Requirement hints -->
                <div class="p-3 bg-slate-50 rounded-xl space-y-1.5 text-xs text-slate-500">
                    <div class="flex items-center gap-2 {hasMinLength ? 'text-emerald-600 font-medium' : ''}">
                        <svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            {#if hasMinLength}
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                            {:else}
                                <circle cx="10" cy="10" r="3" />
                            {/if}
                        </svg>
                        <span>Minimal 8 karakter</span>
                    </div>
                    <div class="flex items-center gap-2 {passwordsMatch ? 'text-emerald-600 font-medium' : ''}">
                        <svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            {#if passwordsMatch}
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                            {:else}
                                <circle cx="10" cy="10" r="3" />
                            {/if}
                        </svg>
                        <span>Kata sandi cocok</span>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting || !hasMinLength || !passwordsMatch}
                    class="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                >
                    {#if isSubmitting}
                        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Memperbarui Kata Sandi...</span>
                    {:else}
                        <span>Simpan Kata Sandi Baru</span>
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    {/if}
                </button>
            </form>
        {/if}

        <div class="pt-4 border-t border-slate-100 text-center">
            <p class="text-sm text-slate-500">
                Kembali ke
                <a href="#/login" class="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline ml-1">
                    Halaman Masuk
                </a>
            </p>
        </div>
    </div>
</PublicLayout>
