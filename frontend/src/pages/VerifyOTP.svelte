<script>
    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";
    import PublicLayout from "../components/layout/PublicLayout.svelte";
    import { authStore } from "../stores/auth.store.js";
    import { PAGE_ERROR_CODES, getPageErrorMessage } from "../errors/pageerror.js";

    let email = "";
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

    // Resend countdown timer (60 seconds)
    let countdown = 60;
    /** @type {any} */
    let timerInterval = null;

    function extractEmailFromUrl() {
        const hash = window.location.hash || "";
        const qIndex = hash.indexOf("?");
        if (qIndex !== -1) {
            const searchParams = new URLSearchParams(hash.substring(qIndex + 1));
            return searchParams.get("email") || "";
        }
        const search = new URLSearchParams(window.location.search);
        return search.get("email") || "";
    }

    function startTimer() {
        countdown = 60;
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (countdown > 0) {
                countdown -= 1;
            } else {
                clearInterval(timerInterval);
            }
        }, 1000);
    }

    /**
     * @param {number} index
     * @param {Event} e
     */
    function handleInput(index, e) {
        const target = /** @type {HTMLInputElement} */ (e.target);
        // Only allow numeric digits (0-9)
        let val = target.value.replace(/\D/g, "");

        if (val.length > 1) {
            val = val.slice(-1);
        }

        target.value = val;
        otpDigits[index] = val;
        localError = null;

        // Auto-advance to next input if filled
        if (val && index < 5) {
            inputRefs[index + 1]?.focus();
        }

        // Auto-submit if all 6 digits are filled
        if (otpDigits.every((d) => /^\d$/.test(d)) && index === 5) {
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
                // Focus previous input on backspace if current is empty
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

        // Focus the appropriate input
        const nextIndex = Math.min(cleaned.length, 5);
        inputRefs[nextIndex]?.focus();

        if (otpDigits.every((d) => /^\d$/.test(d))) {
            handleVerify();
        }
    }

    const handleVerify = async () => {
        localError = null;
        infoMessage = null;

        const otpCode = otpDigits.join("").trim();

        if (!email.trim()) {
            localError = getPageErrorMessage(PAGE_ERROR_CODES.EMAIL_REQUIRED, "verify-otp");
            return;
        }

        if (!/^\d{6}$/.test(otpCode)) {
            localError = getPageErrorMessage(PAGE_ERROR_CODES.INVALID_OTP_CODE, "verify-otp");
            return;
        }

        isVerifying = true;

        try {
            // Forward to reset password page with email and 6-digit OTP token
            const target = `/reset-password?email=${encodeURIComponent(email.trim())}&token=${encodeURIComponent(otpCode)}`;
            push(target);
        } catch (err) {
            localError = getPageErrorMessage(err, {
                context: "verify-otp",
                fallbackCode: PAGE_ERROR_CODES.OTP_VERIFY_FAILED
            });
        } finally {
            isVerifying = false;
        }
    };

    const handleResend = async () => {
        if (countdown > 0 || isResending) return;

        localError = null;
        infoMessage = null;
        isResending = true;

        try {
            await authStore.forgotPassword({ email: email.trim() });
            infoMessage = "Kode OTP baru telah dikirimkan ke email Anda.";
            startTimer();
            // Clear inputs for new entry
            otpDigits = ["", "", "", "", "", ""];
            inputRefs[0]?.focus();
        } catch (err) {
            localError = getPageErrorMessage(err, {
                context: "verify-otp",
                fallbackCode: PAGE_ERROR_CODES.OTP_SEND_FAILED
            });
        } finally {
            isResending = false;
        }
    };

    onMount(() => {
        email = extractEmailFromUrl();
        startTimer();
        // Autofocus first input
        setTimeout(() => {
            inputRefs[0]?.focus();
        }, 100);

        return () => {
            if (timerInterval) clearInterval(timerInterval);
        };
    });
</script>

<PublicLayout>
    <div class="space-y-6">
        <div class="text-center mb-6">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 mb-3 border border-indigo-100 shadow-sm">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
            </div>
            <h2 class="text-xl font-bold text-slate-900 tracking-tight">Verifikasi Kode OTP</h2>
            <p class="text-sm text-slate-500 mt-1.5 leading-relaxed">
                {#if email}
                    Masukkan 6 digit kode OTP yang kami kirimkan ke:
                    <br />
                    <span class="font-semibold text-slate-800">{email}</span>
                {:else}
                    Masukkan 6 digit kode OTP verifikasi kata sandi Anda.
                {/if}
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

        {#if infoMessage}
            <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-start gap-2.5 animate-fadeIn">
                <svg class="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{infoMessage}</span>
            </div>
        {/if}

        <form on:submit|preventDefault={handleVerify} class="space-y-6">
            <div>
                <label for="otp-0" class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-3 text-center">
                    Kode Verifikasi 6-Digit
                </label>
                <!-- 6 Segmented OTP Boxes -->
                <div class="flex items-center justify-center gap-2 sm:gap-3" on:paste={handlePaste}>
                    {#each otpDigits as digit, index}
                        <input
                            id="otp-{index}"
                            type="text"
                            inputmode="numeric"
                            pattern="[0-9]*"
                            maxlength="1"
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
                disabled={isVerifying || otpDigits.some((d) => !/^\d$/.test(d))}
                class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
            >
                {#if isVerifying}
                    <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Memverifikasi...</span>
                {:else}
                    <span>Verifikasi & Atur Ulang Kata Sandi</span>
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
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
                <a href="#/forgot-password" class="hover:text-slate-600 hover:underline">
                    Ganti Alamat Email
                </a>
                <span>•</span>
                <a href="#/login" class="hover:text-slate-600 hover:underline">
                    Kembali ke Halaman Masuk
                </a>
            </div>
        </div>
    </div>
</PublicLayout>
