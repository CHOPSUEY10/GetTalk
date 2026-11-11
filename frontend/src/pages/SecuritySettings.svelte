<script>
    import { onMount } from "svelte";
    import ProtectedLayout from "../components/layout/ProtectedLayout.svelte";
    import { authStore } from "../stores/auth.store.js";
    import {
        PAGE_ERROR_CODES,
        getPageErrorMessage
    } from "../lib/errors/pageerror.js";
    import Icon from "../components/common/Icon.svelte";
    import Skeleton from "../components/common/Skeleton.svelte";

    let loading = true;
    let saving = false;
    let enabled = false;
    let password = "";
    let showPassword = false;
    let code = "";
    let secret = "";
    let secretCopied = false;
    let recoveryCopied = false;
    /** @type {string[]} */
    let recoveryCodes = [];
    let errorMessage = "";
    let successMessage = "";

    onMount(async () => {
        try {
            const status = await authStore.getMfaStatus();
            enabled = status.enabled;
        } catch (error) {
            errorMessage = getPageErrorMessage(error, {
                context: "security-settings",
                fallbackCode: PAGE_ERROR_CODES.MFA_STATUS_LOAD_FAILED
            });
        } finally {
            loading = false;
        }
    });

    async function startSetup() {
        errorMessage = "";
        successMessage = "";
        saving = true;
        try {
            const result = await authStore.setupMfa({ password });
            secret = result.secret;
            password = "";
        } catch (error) {
            errorMessage = getPageErrorMessage(error, {
                context: "security-settings",
                fallbackCode: PAGE_ERROR_CODES.MFA_SETUP_FAILED
            });
        } finally {
            saving = false;
        }
    }

    async function confirmSetup() {
        errorMessage = "";
        successMessage = "";
        const verificationCode = code.trim();
        if (!/^\d{6}$/.test(verificationCode)) {
            errorMessage = getPageErrorMessage(
                PAGE_ERROR_CODES.MFA_SETUP_CODE_INVALID,
                "security-settings"
            );
            return;
        }

        saving = true;
        try {
            const result = await authStore.enableMfa({ code: verificationCode });
            enabled = true;
            secret = "";
            code = "";
            recoveryCodes = result.recoveryCodes || [];
            successMessage =
                "MFA berhasil diaktifkan. Simpan kode pemulihan sekali pakai di bawah ini pada tempat yang aman.";
        } catch (error) {
            errorMessage = getPageErrorMessage(error, {
                context: "security-settings",
                fallbackCode: PAGE_ERROR_CODES.INVALID_MFA_CODE
            });
        } finally {
            saving = false;
        }
    }

    async function turnOff() {
        errorMessage = "";
        successMessage = "";
        saving = true;
        try {
            await authStore.disableMfa({ password, code: code.trim() });
            enabled = false;
            password = "";
            code = "";
            recoveryCodes = [];
            successMessage = "Autentikasi dua faktor (MFA) telah dinonaktifkan.";
        } catch (error) {
            errorMessage = getPageErrorMessage(error, {
                context: "security-settings",
                fallbackCode: PAGE_ERROR_CODES.MFA_DISABLE_FAILED
            });
        } finally {
            saving = false;
        }
    }

    async function copySecretKey() {
        if (!secret) return;
        try {
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(secret);
            }
            secretCopied = true;
            setTimeout(() => (secretCopied = false), 2200);
        } catch {
            secretCopied = false;
        }
    }

    async function copyRecoveryCodes() {
        if (!recoveryCodes.length) return;
        try {
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(recoveryCodes.join("\n"));
            }
            recoveryCopied = true;
            setTimeout(() => (recoveryCopied = false), 2200);
        } catch {
            recoveryCopied = false;
        }
    }

    function downloadRecoveryCodes() {
        if (!recoveryCodes.length || typeof document === "undefined") return;
        const content = [
            "GetTalk — Kode Pemulihan MFA Sekali Pakai",
            `Akun: ${$authStore.user?.username || $authStore.user?.email || "User"}`,
            `Tanggal: ${new Date().toISOString()}`,
            "",
            ...recoveryCodes
        ].join("\n");
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "gettalk-recovery-codes.txt";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }
</script>

<ProtectedLayout>
    <section class="max-w-3xl w-full mx-auto space-y-6 pb-6">
        <header class="pb-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
                <h1 class="text-2xl font-bold text-slate-900 tracking-tight">Keamanan & Privasi Akun</h1>
                <p class="mt-0.5 text-sm text-slate-500">
                    Kelola autentikasi dua faktor (TOTP MFA) dan perlindungan kriptografi akun Anda.
                </p>
            </div>
            <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold self-start sm:self-auto">
                <Icon name="shield-check" size="sm" />
                <span>Kunci Privat Tersimpan Lokal</span>
            </div>
        </header>

        <!-- Account Overview Card -->
        <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div class="flex items-center gap-3.5 min-w-0">
                <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white font-bold flex items-center justify-center text-base uppercase shrink-0 shadow-xs">
                    {($authStore.user?.username || "U").slice(0, 2)}
                </div>
                <div class="min-w-0">
                    <h2 class="text-base font-bold text-slate-900 truncate">
                        {$authStore.user?.username || "Pengguna GetTalk"}
                    </h2>
                    <p class="text-xs text-slate-500 truncate">
                        {$authStore.user?.email || "Sesi terautentikasi"}
                    </p>
                </div>
            </div>

            {#if !loading}
                <div class="flex items-center gap-2 shrink-0">
                    <span
                        class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border {enabled
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-amber-50 border-amber-200 text-amber-800'}"
                    >
                        <span class="w-1.5 h-1.5 rounded-full {enabled ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
                        <span>{enabled ? "MFA Aktif" : "MFA Belum Aktif"}</span>
                    </span>
                </div>
            {/if}
        </div>

        {#if errorMessage}
            <div
                role="alert"
                class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center justify-between gap-3 animate-fadeIn"
            >
                <div class="flex items-center gap-2.5">
                    <Icon name="alert-triangle" size="md" className="text-rose-600" />
                    <span>{errorMessage}</span>
                </div>
                <button
                    type="button"
                    class="p-1 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
                    aria-label="Tutup pesan kesalahan"
                    on:click={() => (errorMessage = "")}
                >
                    <Icon name="x" size="xs" />
                </button>
            </div>
        {/if}

        {#if successMessage}
            <div
                role="status"
                class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex items-center justify-between gap-3 animate-fadeIn"
            >
                <div class="flex items-center gap-2.5">
                    <Icon name="check" size="md" className="text-emerald-600" />
                    <span>{successMessage}</span>
                </div>
                <button
                    type="button"
                    class="p-1 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
                    aria-label="Tutup pesan sukses"
                    on:click={() => (successMessage = "")}
                >
                    <Icon name="x" size="xs" />
                </button>
            </div>
        {/if}

        {#if loading}
            <Skeleton variant="security-card" count={1} label="Memuat status keamanan..." />
        {:else if enabled}
            <!-- MFA Enabled State -->
            <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6 animate-fadeIn">
                <div class="flex items-start gap-3.5 pb-4 border-b border-slate-100">
                    <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
                        <Icon name="shield-check" size="md" />
                    </div>
                    <div>
                        <h2 class="font-bold text-slate-900 text-base">Autentikasi Dua Faktor (MFA) Aktif</h2>
                        <p class="mt-0.5 text-xs sm:text-sm text-slate-500 leading-relaxed">
                            Setiap proses masuk memerlukan kode 6 digit dari aplikasi autentikator TOTP Anda atau kode pemulihan sekali pakai.
                        </p>
                    </div>
                </div>

                {#if recoveryCodes.length}
                    <div class="rounded-2xl border border-amber-300 bg-amber-50/90 p-5 space-y-3">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div class="flex items-center gap-2">
                                <Icon name="alert-triangle" size="sm" className="text-amber-700" />
                                <h3 class="font-bold text-amber-900 text-sm">
                                    Kode Pemulihan — Ditampilkan Sekali Saja
                                </h3>
                            </div>
                            <div class="flex items-center gap-2">
                                <button
                                    type="button"
                                    on:click={copyRecoveryCodes}
                                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold transition-colors cursor-pointer"
                                >
                                    <Icon name={recoveryCopied ? "check" : "copy"} size="xs" />
                                    <span>{recoveryCopied ? "Tersalin" : "Salin Semua"}</span>
                                </button>
                                <button
                                    type="button"
                                    on:click={downloadRecoveryCodes}
                                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                                >
                                    <Icon name="download" size="xs" />
                                    <span>Unduh (.txt)</span>
                                </button>
                            </div>
                        </div>
                        <p class="text-xs text-amber-800 leading-relaxed">
                            Simpan kode-kode ini di tempat yang aman. Setiap kode hanya dapat digunakan satu kali apabila Anda kehilangan akses ke perangkat autentikator.
                        </p>
                        <ul class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs text-amber-950">
                            {#each recoveryCodes as recoveryCode (recoveryCode)}
                                <li class="px-3 py-2 rounded-lg bg-white border border-amber-200 text-center font-bold tracking-wider select-all">
                                    {recoveryCode}
                                </li>
                            {/each}
                        </ul>
                    </div>
                {/if}

                <form on:submit|preventDefault={turnOff} class="space-y-4 pt-1">
                    <div>
                        <h3 class="text-sm font-bold text-slate-900">Nonaktifkan MFA</h3>
                        <p class="text-xs text-slate-500 mt-0.5">
                            Masukkan kode autentikator/pemulihan dan kata sandi akun Anda untuk menonaktifkan perlindungan dua faktor.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label
                                for="disable-mfa-code"
                                class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                            >
                                Kode Otentikasi
                            </label>
                            <input
                                id="disable-mfa-code"
                                name="authentication code"
                                type="text"
                                bind:value={code}
                                placeholder="6 digit TOTP atau kode pemulihan"
                                autocomplete="one-time-code"
                                required
                                disabled={saving}
                                class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all"
                            />
                        </div>

                        <div>
                            <label
                                for="disable-mfa-password"
                                class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                            >
                                Password Akun
                            </label>
                            <div class="relative">
                                <input
                                    id="disable-mfa-password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    bind:value={password}
                                    placeholder="Password akun Anda"
                                    autocomplete="current-password"
                                    required
                                    disabled={saving}
                                    class="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all"
                                />
                                <button
                                    type="button"
                                    class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                                    aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                                    on:click={() => (showPassword = !showPassword)}
                                >
                                    <Icon name={showPassword ? "eye-off" : "eye"} size="sm" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="pt-1">
                        <button
                            type="submit"
                            disabled={saving || !code.trim() || !password}
                            class="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"
                        >
                            {#if saving}
                                <span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                <span>Memproses...</span>
                            {:else}
                                <span>Nonaktifkan MFA</span>
                            {/if}
                        </button>
                    </div>
                </form>
            </div>
        {:else if secret}
            <!-- Step 2: Secret Key & 6-Digit Verification -->
            <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5 animate-fadeIn">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <span class="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                            Langkah 2 dari 2
                        </span>
                        <h2 class="text-base font-bold text-slate-900 mt-0.5">
                            Hubungkan Aplikasi Autentikator
                        </h2>
                        <p class="mt-1 text-xs sm:text-sm text-slate-500 leading-relaxed">
                            Salin kunci rahasia TOTP di bawah ini ke aplikasi autentikator Anda (Google Authenticator, Authy, 1Password, atau Bitwarden). Kunci setup berlaku selama 10 menit.
                        </p>
                    </div>
                </div>

                <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="min-w-0">
                        <span class="text-[11px] font-semibold text-slate-500 block mb-1">
                            Kunci Setup TOTP (Base32):
                        </span>
                        <p class="break-all font-mono text-sm font-bold text-slate-900 select-all">
                            {secret}
                        </p>
                    </div>
                    <button
                        type="button"
                        on:click={copySecretKey}
                        class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer shrink-0 self-start sm:self-center"
                    >
                        <Icon name={secretCopied ? "check" : "copy"} size="xs" className={secretCopied ? "text-emerald-600" : ""} />
                        <span>{secretCopied ? "Kunci Disalin" : "Salin Kunci"}</span>
                    </button>
                </div>

                <form on:submit|preventDefault={confirmSetup} class="space-y-4">
                    <div>
                        <label
                            for="setup-code"
                            class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                        >
                            Kode Verifikasi 6 Digit
                        </label>
                        <input
                            id="setup-code"
                            type="text"
                            inputmode="numeric"
                            maxlength="6"
                            placeholder="Contoh: 123456"
                            bind:value={code}
                            autocomplete="one-time-code"
                            required
                            disabled={saving}
                            class="w-full sm:max-w-xs px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-mono tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all"
                        />
                    </div>

                    <div class="flex flex-wrap items-center gap-2.5">
                        <button
                            type="submit"
                            disabled={saving || code.trim().length !== 6}
                            class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                        >
                            {#if saving}
                                <span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                <span>Memproses...</span>
                            {:else}
                                <Icon name="shield-check" size="sm" />
                                <span>Aktifkan MFA</span>
                            {/if}
                        </button>
                        <button
                            type="button"
                            disabled={saving}
                            on:click={() => {
                                secret = "";
                                code = "";
                                errorMessage = "";
                            }}
                            class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                        >
                            Batal
                        </button>
                    </div>
                </form>
            </div>
        {:else}
            <!-- Step 1: MFA Not Enabled Yet -->
            <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5 animate-fadeIn">
                <div class="flex items-start gap-3.5 pb-4 border-b border-slate-100">
                    <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
                        <Icon name="shield" size="md" />
                    </div>
                    <div>
                        <h2 class="font-bold text-slate-900 text-base">Tingkatkan Keamanan dengan MFA</h2>
                        <p class="mt-0.5 text-xs sm:text-sm text-slate-500 leading-relaxed">
                            Tambahkan lapisan keamanan ekstra. Anda akan diminta memasukkan kode 6 digit dari aplikasi autentikator setiap kali masuk ke akun GetTalk.
                        </p>
                    </div>
                </div>

                <form on:submit|preventDefault={startSetup} class="space-y-4 max-w-md">
                    <div>
                        <label
                            for="setup-password"
                            class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                        >
                            Konfirmasi Password Akun untuk Memulai Setup
                        </label>
                        <div class="relative">
                            <input
                                id="setup-password"
                                type={showPassword ? "text" : "password"}
                                bind:value={password}
                                placeholder="Masukkan password akun Anda"
                                autocomplete="current-password"
                                required
                                disabled={saving}
                                class="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all"
                            />
                            <button
                                type="button"
                                class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                                aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                                on:click={() => (showPassword = !showPassword)}
                            >
                                <Icon name={showPassword ? "eye-off" : "eye"} size="sm" />
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={saving || !password}
                        class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                    >
                        {#if saving}
                            <span class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                            <span>Memproses...</span>
                        {:else}
                            <Icon name="shield" size="sm" />
                            <span>Mulai setup MFA</span>
                        {/if}
                    </button>
                </form>
            </div>
        {/if}
    </section>
</ProtectedLayout>
