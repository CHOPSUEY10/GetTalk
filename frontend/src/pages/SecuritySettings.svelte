<script>
    import { onMount } from "svelte";
    import ProtectedLayout from "../components/layout/ProtectedLayout.svelte";
    import {
        disableMfa,
        enableMfa,
        getMfaStatus,
        setupMfa,
    } from "../services/api/auth.api.js";
    import { authStore } from "../stores/auth.store.js";
    import {
        PAGE_ERROR_CODES,
        getPageErrorMessage,
    } from "../errors/pageerror.js";

    let loading = true;
    let saving = false;
    let enabled = false;
    let password = "";
    let code = "";
    let secret = "";
    /** @type {string[]} */
    let recoveryCodes = [];
    let errorMessage = "";
    let successMessage = "";

    onMount(async () => {
        try {
            const status = await getMfaStatus();
            enabled = status.enabled;
        } catch (error) {
            errorMessage = getPageErrorMessage(error, {
                context: "security-settings",
                fallbackCode: PAGE_ERROR_CODES.MFA_STATUS_LOAD_FAILED,
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
            const result = await setupMfa({ password });
            secret = result.secret;
            password = "";
        } catch (error) {
            errorMessage = getPageErrorMessage(error, {
                context: "security-settings",
                fallbackCode: PAGE_ERROR_CODES.MFA_SETUP_FAILED,
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
                "security-settings",
            );
            return;
        }

        saving = true;
        try {
            const result = await enableMfa({ code: verificationCode });
            enabled = true;
            secret = "";
            code = "";
            recoveryCodes = result.recoveryCodes;
            successMessage =
                "MFA aktif. Simpan kode pemulihan ini di tempat yang aman.";
            authStore.updateUser({ ...$authStore.user, mfaEnabled: true });
        } catch (error) {
            errorMessage = getPageErrorMessage(error, {
                context: "security-settings",
                fallbackCode: PAGE_ERROR_CODES.INVALID_MFA_CODE,
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
            await disableMfa({ password, code: code.trim() });
            enabled = false;
            password = "";
            code = "";
            recoveryCodes = [];
            successMessage = "MFA telah dinonaktifkan.";
            authStore.updateUser({ ...$authStore.user, mfaEnabled: false });
        } catch (error) {
            errorMessage = getPageErrorMessage(error, {
                context: "security-settings",
                fallbackCode: PAGE_ERROR_CODES.MFA_DISABLE_FAILED,
            });
        } finally {
            saving = false;
        }
    }
</script>

<ProtectedLayout>
    <section class="max-w-3xl mx-auto space-y-6">
        <header>
            <h1 class="text-2xl font-bold text-slate-900">Keamanan Akun</h1>
            <p class="mt-1 text-sm text-slate-600">
                Kelola autentikasi dua faktor dengan aplikasi autentikator TOTP.
            </p>
        </header>

        {#if errorMessage}
            <div
                role="alert"
                class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
            >
                {errorMessage}
            </div>
        {/if}
        {#if successMessage}
            <div
                role="status"
                class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"
            >
                {successMessage}
            </div>
        {/if}

        {#if loading}
            <p class="text-sm text-slate-500">Memuat status keamanan...</p>
        {:else if enabled}
            <div>
                <h2 class="font-bold text-emerald-500">MFA aktif</h2>
                <p class="mt-1 text-sm text-slate-600">
                    Login memerlukan kode dari aplikasi autentikator atau kode
                    pemulihan sekali pakai.
                </p>
            </div>
            <div
                class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
            >
                {#if recoveryCodes.length}
                    <div
                        class="rounded-xl border border-amber-300 bg-amber-50 p-4"
                    >
                        <h3 class="font-semibold text-amber-900">
                            Kode pemulihan — ditampilkan sekali
                        </h3>
                        <p class="my-2 text-sm text-amber-800">
                            Simpan kode-kode ini sekarang. Setiap kode hanya
                            dapat digunakan satu kali.
                        </p>
                        <ul
                            class="grid grid-cols-2 gap-2 font-mono text-sm text-amber-950"
                        >
                            {#each recoveryCodes as recoveryCode}
                                <li>{recoveryCode}</li>
                            {/each}
                        </ul>
                    </div>
                {/if}

                <form on:submit|preventDefault={turnOff} class="space-y-3">
                    <h3 class="text-xl mb-7">Nonaktifkan MFA</h3>
                    <label
                        for="authentication code"
                        class="font-small font-bold">Kode Otentikasi</label
                    >
                    <input
                        name="authentication code"
                        type="text"
                        bind:value={code}
                        placeholder="Kode autentikator atau kode pemulihan"
                        autocomplete="one-time-code"
                        required
                        class="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                    />
                    <label for="password" class="font-small font-bold"
                        >Password</label
                    >
                    <input
                        name="password"
                        type="password"
                        bind:value={password}
                        placeholder="Password akun"
                        autocomplete="current-password"
                        required
                        class="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                    />
                    <button
                        type="submit"
                        disabled={saving}
                        class="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                        {saving ? "Memproses..." : "Nonaktifkan MFA"}
                    </button>
                </form>
            </div>
        {:else if secret}
            <div
                class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
            >
                <div>
                    <h2 class="font-semibold text-slate-900">
                        Hubungkan aplikasi autentikator
                    </h2>
                    <p class="mt-1 text-sm text-slate-600">
                        Tambahkan akun GetTalk di aplikasi TOTP Anda menggunakan
                        kunci ini. Kunci setup berlaku 10 menit.
                    </p>
                </div>
                <p
                    class="break-all rounded-lg bg-slate-100 p-3 font-mono text-sm text-slate-900"
                >
                    {secret}
                </p>
                <form on:submit|preventDefault={confirmSetup} class="space-y-3">
                    <label
                        for="setup-code"
                        class="block text-sm font-medium text-slate-700"
                    >
                        Masukkan kode 6 digit untuk mengonfirmasi setup
                    </label>
                    <input
                        id="setup-code"
                        type="text"
                        inputmode="numeric"
                        maxlength="6"
                        bind:value={code}
                        autocomplete="one-time-code"
                        required
                        class="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                    />
                    <button
                        type="submit"
                        disabled={saving}
                        class="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                        {saving ? "Memproses..." : "Aktifkan MFA"}
                    </button>
                </form>
            </div>
        {:else}
            <div>
                <h2 class="font-bold text-red-500">MFA belum aktif</h2>
                <p class="mt-1 text-sm text-slate-600">
                    Anda akan diminta memasukkan kode autentikator setiap kali
                    login setelah mengaktifkan MFA.
                </p>
            </div>
            <div
                class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
            >
                <form on:submit|preventDefault={startSetup} class="space-y-3">
                    <label
                        for="setup-password"
                        class="block text-sm font-medium text-slate-700"
                    >
                        Konfirmasi password untuk memulai setup
                    </label>
                    <input
                        id="setup-password"
                        type="password"
                        bind:value={password}
                        autocomplete="current-password"
                        required
                        class="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                    />
                    <button
                        type="submit"
                        disabled={saving}
                        class="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                        {saving ? "Memproses..." : "Mulai setup MFA"}
                    </button>
                </form>
            </div>
        {/if}
    </section>
</ProtectedLayout>
