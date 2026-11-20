<script>
    import { onMount } from "svelte";
    import { replace } from "svelte-spa-router";
    import PublicLayout from "../components/layout/PublicLayout.svelte";
    import { authStore } from "../stores/auth.store.js";
    import { PAGE_ERROR_CODES, getPageErrorMessage } from "../lib/errors/pageerror.js";
    import { validateRegistrationOtpInput } from "../lib/validators.js";

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    let email = "";
    let emailEditable = false;
    /** @type {string[]} */
    let otpDigits = ["", "", "", "", "", ""];
    /** @type {HTMLInputElement[]} */
    let inputRefs = [];

    /** @type {string | null} */
    let localError = null;
    /** @type {string | null} */
    let infoMessage = null;
    let isVerifying = false;
    let isResending = false;
    let verified = false;

    // Resend countdown timer (60 seconds after fresh registration)
    let countdown = 60;
    /** @type {any} */
    let timerInterval = null;

    // Redirect countdown after successful verification
    let redirectCountdown = 2;
    /** @type {any} */
    let redirectInterval = null;

    function extractQueryParams() {
        if (typeof window === "undefined") {
            return { email: "", from: "" };
        }
        const hash = window.location.hash || "";
        const qIndex = hash.indexOf("?");
        if (qIndex !== -1) {
            const searchParams = new URLSearchParams(hash.substring(qIndex + 1));
            return {
                email: searchParams.get("email") || "",
                from: searchParams.get("from") || "",
            };
        }
        const search = new URLSearchParams(window.location.search);
        return {
            email: search.get("email") || "",
            from: search.get("from") || "",
        };
    }

    function startTimer(seconds = 60) {
        countdown = seconds;
        if (timerInterval) clearInterval(timerInterval);
        if (seconds <= 0) return;
        timerInterval = setInterval(() => {
            if (countdown > 0) {
                countdown -= 1;
            } else {
                clearInterval(timerInterval);
                timerInterval = null;
            }
        }, 1000);
    }

    function goToLogin() {
        if (redirectInterval) {
            clearInterval(redirectInterval);
            redirectInterval = null;
        }
        const trimmedEmail = email.trim();
        const target = trimmedEmail
            ? `/login?verified=1&email=${encodeURIComponent(trimmedEmail)}`
            : "/login?verified=1";
        replace(target);
    }

    /**
     * @param {number} index
     * @param {Event} e
     */
    function handleInput(index, e) {
        const target = /** @type {HTMLInputElement} */ (e.target);
        let val = target.value.replace(/\D/g, "");

        if (val.length > 1) {
            val = val.slice(-1);
        }

        target.value = val;
        otpDigits[index] = val;
        localError = null;

        if (val && index < 5) {
            inputRefs[index + 1]?.focus();
        }

        if (otpDigits.every((d) => /^\d$/.test(d)) && index === 5 && EMAIL_REGEX.test(email.trim())) {
            handleVerify();
        }
    }

    /**
     * @param {number} index
     * @param {KeyboardEvent} e
     */
    function handleKeyDown(index, e) {
        if (e.key === "Backspace") {
            if (!otpDigits[index] && index > 0) {
                inputRefs[index - 1]?.focus();
                otpDigits[index - 1] = "";
                e.preventDefault();
            } else {
                otpDigits[index] = "";
            }
            localError = null;
        } else if (e.key === "ArrowLeft" && index > 0) {
            inputRefs[index - 1]?.focus();
        } else if (e.key === "ArrowRight" && index < 5) {
            inputRefs[index + 1]?.focus();
        }
    }

    /**
     * @param {ClipboardEvent} e
     */
    function handlePaste(e) {
        e.preventDefault();
        const clipboardData = e.clipboardData?.getData("text") || "";
        const cleaned = clipboardData.replace(/\D/g, "").slice(0, 6);

        if (!cleaned) return;

        cleaned.split("").forEach((char, i) => {
            if (i < 6) {
                otpDigits[i] = char;
            }
        });

        const nextIndex = Math.min(cleaned.length, 5);
        inputRefs[nextIndex]?.focus();

        if (otpDigits.every((d) => /^\d$/.test(d)) && EMAIL_REGEX.test(email.trim())) {
            handleVerify();
        }
    }

    const handleVerify = async () => {
        if (isVerifying || verified) return;

        localError = null;
        infoMessage = null;

        const trimmedEmail = email.trim();
        const otpCode = otpDigits.join("").trim();

        const validation = validateRegistrationOtpInput({ email: trimmedEmail, otp: otpCode });
        if (!validation.valid) {
            localError = getPageErrorMessage(validation.code, "register-verify");
            return;
        }

        isVerifying = true;

        try {
            await authStore.verifyRegistrationOtp({
                email: trimmedEmail,
                otp: otpCode,
            });

            verified = true;
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }

            redirectCountdown = 2;
            redirectInterval = setInterval(() => {
                redirectCountdown -= 1;
                if (redirectCountdown <= 0) {
                    goToLogin();
                }
            }, 1000);
        } catch (err) {
            localError = getPageErrorMessage(err, {
                context: "register-verify",
                fallbackCode: PAGE_ERROR_CODES.INVALID_OTP_TOKEN,
            });
            otpDigits = ["", "", "", "", "", ""];
            setTimeout(() => {
                inputRefs[0]?.focus();
            }, 0);
        } finally {
            isVerifying = false;
        }
    };

    const handleResend = async () => {
        if (countdown > 0 || isResending || verified) return;

        const trimmedEmail = email.trim();
        if (!trimmedEmail) {
            localError = getPageErrorMessage(PAGE_ERROR_CODES.EMAIL_REQUIRED, "register-verify");
            return;
        }
        if (!EMAIL_REGEX.test(trimmedEmail)) {
            localError = getPageErrorMessage(PAGE_ERROR_CODES.INVALID_EMAIL_FORMAT, "register-verify");
            return;
        }

        localError = null;
        infoMessage = null;
        isResending = true;

        try {
            await authStore.resendRegistrationOtp({ email: trimmedEmail });
            infoMessage = "Kode OTP verifikasi baru telah dikirimkan ke email Anda.";
            startTimer(60);
            otpDigits = ["", "", "", "", "", ""];
            setTimeout(() => {
                inputRefs[0]?.focus();
            }, 0);
        } catch (err) {
            localError = getPageErrorMessage(err, {
                context: "register-verify",
                fallbackCode: PAGE_ERROR_CODES.OTP_SEND_FAILED,
            });
        } finally {
            isResending = false;
        }
    };

    onMount(() => {
        authStore.clearError?.();
        const params = extractQueryParams();
        email = params.email.trim();
        emailEditable = !email;

        if (!email || params.from === "login") {
            countdown = 0;
        } else {
            startTimer(60);
        }

        if (email) {
            setTimeout(() => {
                inputRefs[0]?.focus();
            }, 100);
        }

        return () => {
            if (timerInterval) clearInterval(timerInterval);
            if (redirectInterval) clearInterval(redirectInterval);
        };
    });
</script>

<PublicLayout>
    <div class="space-y-6">
        <div class="text-center mb-6">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 mb-3 border border-indigo-100 shadow-sm">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
            </div>
            <h2 class="text-xl font-bold text-slate-900 tracking-tight">Verifikasi Email Akun</h2>
            <p class="text-sm text-slate-500 mt-1.5 leading-relaxed">
                {#if email && !emailEditable}
                    Masukkan 6 digit kode OTP yang kami kirimkan ke:
                    <br />
                    <span class="font-semibold text-slate-800">{email}</span>
                {:else}
                    Masukkan alamat email terdaftar dan 6 digit kode OTP untuk mengaktifkan akun GetTalk Anda.
                {/if}
            </p>
        </div>

        {#if localError}
            <div role="alert" class="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2.5 animate-fadeIn">
                <svg class="w-5 h-5 text-rose-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{localError}</span>
            </div>
        {/if}

        {#if infoMessage && !verified}
            <div aria-live="polite" class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-start gap-2.5 animate-fadeIn">
                <svg class="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{infoMessage}</span>
            </div>
        {/if}

        {#if verified}
            <div aria-live="polite" class="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm space-y-3 animate-fadeIn">
                <div class="flex items-start gap-2.5">
                    <svg class="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                        <p class="font-bold text-emerald-900">Email Berhasil Diverifikasi!</p>
                        <p class="text-xs text-emerald-700 mt-1">
                            Akun GetTalk Anda telah aktif. Silakan masuk menggunakan email dan kata sandi Anda.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    on:click={goToLogin}
                    class="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-emerald-200 flex items-center justify-center gap-2 cursor-pointer"
                >
                    <span>Masuk Sekarang ({redirectCountdown}s)</span>
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                </button>
            </div>
        {:else}
            <form on:submit|preventDefault={handleVerify} class="space-y-5">
                {#if emailEditable}
                    <div>
                        <label for="verify-email" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                            Email Akun
                        </label>
                        <input
                            id="verify-email"
                            type="email"
                            bind:value={email}
                            placeholder="nama@email.com"
                            autocomplete="email"
                            required
                            disabled={isVerifying}
                            class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all disabled:opacity-60"
                        />
                    </div>
                {/if}

                <div>
                    <label for="register-otp-0" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-3 text-center">
                        Kode Verifikasi 6-Digit
                    </label>
                    <div class="flex items-center justify-center gap-2 sm:gap-3" on:paste={handlePaste}>
                        {#each otpDigits as digit, index}
                            <input
                                id="register-otp-{index}"
                                type="text"
                                inputmode="numeric"
                                pattern="[0-9]*"
                                maxlength="1"
                                autocomplete={index === 0 ? "one-time-code" : "off"}
                                aria-label="Digit {index + 1} dari 6 kode OTP"
                                bind:value={otpDigits[index]}
                                bind:this={inputRefs[index]}
                                on:input={(e) => handleInput(index, e)}
                                on:keydown={(e) => handleKeyDown(index, e)}
                                disabled={isVerifying}
                                class="w-11 h-13 sm:w-12 sm:h-14 text-center font-bold text-xl sm:text-2xl text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all shadow-sm disabled:opacity-60"
                            />
                        {/each}
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={isVerifying || !email.trim() || otpDigits.some((d) => !/^\d$/.test(d))}
                    class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                >
                    {#if isVerifying}
                        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Memverifikasi...</span>
                    {:else}
                        <span>Verifikasi Email & Aktifkan Akun</span>
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    {/if}
                </button>
            </form>

            <div class="space-y-3 pt-4 border-t border-slate-100 text-center">
                <div class="text-sm text-slate-500">
                    Tidak menerima kode?
                    {#if countdown > 0}
                        <span class="font-medium text-slate-400 ml-1">
                            Kirim ulang dalam <span class="font-mono text-slate-600 font-semibold">{countdown}s</span>
                        </span>
                    {:else}
                        <button
                            type="button"
                            on:click={handleResend}
                            disabled={isResending}
                            class="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline ml-1 cursor-pointer disabled:opacity-60"
                        >
                            {isResending ? "Mengirim ulang..." : "Kirim Ulang Kode OTP"}
                        </button>
                    {/if}
                </div>

                <div class="flex items-center justify-center gap-4 text-xs text-slate-400">
                    <a href="#/register" class="hover:text-slate-600 hover:underline">
                        Daftar Akun Lain
                    </a>
                    <span>•</span>
                    <a href="#/login" class="hover:text-slate-600 hover:underline">
                        Kembali ke Halaman Masuk
                    </a>
                </div>
            </div>
        {/if}
    </div>
</PublicLayout>
