<script>
    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";
    import PublicLayout from "../components/layout/PublicLayout.svelte";
    import { authStore } from "../stores/auth.store.js";

    let email = "";
    /** @type {string | null} */
    let localError = null;
    /** @type {string | null} */
    let successMessage = null;
    let isSubmitting = false;
    let redirectCountdown = 3;
    /** @type {any} */
    let countdownTimer = null;

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const handleSubmit = async () => {
        const trimmedEmail = email.trim();
        if (!trimmedEmail) {
            localError = "Silakan masukkan alamat email Anda.";
            return;
        }

        if (!EMAIL_REGEX.test(trimmedEmail)) {
            localError = "Format email tidak valid. Masukkan email yang benar.";
            return;
        }

        localError = null;
        successMessage = null;
        isSubmitting = true;

        try {
            const res = await authStore.forgotPassword({ email: trimmedEmail });
            successMessage =
                res?.message ||
                `Kode OTP telah dikirimkan ke ${trimmedEmail}. Silakan periksa kotak masuk atau folder spam Anda.`;

            // Start countdown and automatically navigate to OTP verification page
            redirectCountdown = 3;
            countdownTimer = setInterval(() => {
                redirectCountdown -= 1;
                if (redirectCountdown <= 0) {
                    clearInterval(countdownTimer);
                    goToVerify();
                }
            }, 1000);
        } catch (err) {
            const e = /** @type {any} */ (err);
            localError = e.message || "Gagal mengirimkan kode OTP. Silakan coba lagi nanti.";
        } finally {
            isSubmitting = false;
        }
    };

    const goToVerify = () => {
        if (countdownTimer) clearInterval(countdownTimer);
        const target = `/forgot-password/verify?email=${encodeURIComponent(email.trim())}`;
        push(target);
    };

    onMount(() => {
        return () => {
            if (countdownTimer) clearInterval(countdownTimer);
        };
    });
</script>

<PublicLayout>
    <div class="space-y-6">
        <div class="text-center mb-6">
            <h2 class="text-xl font-bold text-slate-900 tracking-tight">Lupa Kata Sandi</h2>
            <p class="text-sm text-slate-500 mt-1">
                Masukkan alamat email akun GetTalk Anda untuk menerima kode OTP verifikasi kata sandi.
            </p>
        </div>

        {#if localError}
            <div class="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2.5 animate-fadeIn">
                <svg class="w-5 h-5 text-rose-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{localError}</span>
            </div>
        {/if}

        {#if successMessage}
            <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm space-y-3 animate-fadeIn">
                <div class="flex items-start gap-2.5">
                    <svg class="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                        <p class="font-semibold text-emerald-900">Kode OTP Terkirim</p>
                        <p class="text-xs text-emerald-700 mt-1">{successMessage}</p>
                    </div>
                </div>

                <div class="pt-1 text-center">
                    <button
                        type="button"
                        on:click={goToVerify}
                        class="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-emerald-200 flex items-center justify-center gap-2 cursor-pointer"
                    >
                        <span>Masukkan Kode OTP Sekarang ({redirectCountdown}s)</span>
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                    </button>
                </div>
            </div>
        {:else}
            <form on:submit|preventDefault={handleSubmit} class="space-y-4">
                <div>
                    <label for="email" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                        Alamat Email Akun
                    </label>
                    <div class="relative rounded-xl shadow-sm">
                        <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                            </svg>
                        </div>
                        <input
                            id="email"
                            type="email"
                            bind:value={email}
                            placeholder="nama@email.com"
                            autocomplete="email"
                            required
                            disabled={isSubmitting}
                            class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all disabled:opacity-60"
                        />
                    </div>
                    <p class="text-xs text-slate-400 mt-1.5">
                        Kode 6-digit OTP akan dikirimkan ke alamat email yang terdaftar.
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting}
                    class="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                >
                    {#if isSubmitting}
                        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Mengirim Kode OTP...</span>
                    {:else}
                        <span>Kirim Kode OTP</span>
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                    {/if}
                </button>
            </form>

            <div class="pt-4 border-t border-slate-100 text-center">
                <p class="text-sm text-slate-500">
                    Ingat kata sandi Anda?
                    <a href="#/login" class="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline ml-1">
                        Masuk di sini
                    </a>
                </p>
            </div>
        {/if}
    </div>
</PublicLayout>
