<script>
    import { createEventDispatcher } from "svelte";
    import {
        compareFingerprints,
        verifySafetyNumberQrPayload,
    } from "../../services/crypto/safety-number.js";

    /** @type {boolean} */
    export let open = false;
    /** @type {string} */
    export let peerUsername = "Lawan Bicara";
    /** @type {string} */
    export let currentUsername = "Anda";
    /** @type {any | null} */
    export let safetyNumber = null;
    /** @type {boolean} */
    export let loading = false;
    /** @type {boolean} */
    export let peerVerified = false;
    /** @type {number | null} */
    export let peerVerifiedAt = null;
    /** @type {{ userId: string, previousFingerprint: string, fingerprint: string } | null} */
    export let keyChange = null;
    /** @type {number} */
    export let pendingCount = 0;

    const dispatch = createEventDispatcher();

    /** @type {'digits' | 'qr' | 'compare'} */
    let activeTab = "digits";
    let copied = false;
    let isSubmittingVerify = false;
    let scanCheckInput = "";
    /** @type {{ checked: boolean, valid: boolean, message: string } | null} */
    let scanCheckResult = null;

    // Automatically focus the comparison view if opened while a device change alert is active
    $: if (open && keyChange && activeTab !== "compare" && activeTab !== "digits" && activeTab !== "qr") {
        activeTab = "compare";
    }

    $: blocks = Array.isArray(safetyNumber?.blocks) && safetyNumber.blocks.length === 12
        ? safetyNumber.blocks
        : [];

    $: formattedDigits = safetyNumber?.formatted || blocks.join(" ");

    $: fpComparison = keyChange
        ? safetyNumber?.fingerprintComparison ||
          compareFingerprints(keyChange.previousFingerprint, keyChange.fingerprint)
        : null;

    const closeModal = () => {
        if (!open) return;
        scanCheckInput = "";
        scanCheckResult = null;
        copied = false;
        dispatch("close");
    };

    /** @param {KeyboardEvent} event */
    const handleWindowKeydown = (event) => {
        if (!open) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeModal();
        }
    };

    const handleCopySafetyNumber = async () => {
        if (!formattedDigits) return;
        try {
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(formattedDigits);
            }
            copied = true;
            setTimeout(() => {
                copied = false;
            }, 2200);
        } catch {
            copied = false;
        }
    };

    const handleToggleVerified = () => {
        if (isSubmittingVerify || loading || keyChange) return;
        isSubmittingVerify = true;
        dispatch("toggleVerified", {
            verified: !peerVerified,
            done: () => {
                isSubmittingVerify = false;
            },
        });
        setTimeout(() => {
            isSubmittingVerify = false;
        }, 300);
    };

    /** @param {boolean} markVerified */
    const handleApproveChangedKey = (markVerified = true) => {
        dispatch("acceptKeyChange", { verified: markVerified });
    };

    const handleVerifyQrInput = () => {
        if (!safetyNumber || !scanCheckInput.trim()) {
            scanCheckResult = null;
            return;
        }
        const res = verifySafetyNumberQrPayload(scanCheckInput, safetyNumber);
        if (res.valid) {
            scanCheckResult = {
                checked: true,
                valid: true,
                message: "Cocok! Kode QR / Nomor Keamanan lawan bicara terverifikasi identik.",
            };
        } else {
            scanCheckResult = {
                checked: true,
                valid: false,
                message:
                    "Tidak cocok! Nomor Keamanan atau Kode QR berbeda. Jangan tandai kontak ini sebagai terverifikasi.",
            };
        }
    };

    /** @param {'digits' | 'qr' | 'compare'} tab */
    const selectTab = (tab) => {
        activeTab = tab;
    };
</script>

<svelte:window on:keydown={handleWindowKeydown} />

{#if open}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety-number-modal-title"
        aria-describedby="safety-number-modal-desc"
    >
        <!-- Backdrop click handler -->
        <button
            type="button"
            class="fixed inset-0 w-full h-full cursor-default focus:outline-none"
            aria-label="Tutup modal verifikasi nomor keamanan"
            tabindex="-1"
            on:click={closeModal}
        ></button>

        <!-- Modal Dialog Card -->
        <div class="relative z-10 w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden my-auto">
            <!-- Header -->
            <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
                <div class="flex items-center gap-2.5">
                    {#if keyChange}
                        <div class="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                            </svg>
                        </div>
                    {:else if peerVerified}
                        <div class="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                        </div>
                    {:else}
                        <div class="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                    {/if}

                    <div>
                        <h2 id="safety-number-modal-title" class="text-sm sm:text-base font-bold text-slate-900">
                            Nomor Keamanan Obrolan (Safety Number)
                        </h2>
                        <p id="safety-number-modal-desc" class="text-xs text-slate-500">
                            Verifikasi identitas kriptografis <span class="font-semibold text-slate-700">{currentUsername}</span> &amp; <span class="font-semibold text-slate-700">{peerUsername}</span>
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    on:click={closeModal}
                    aria-label="Tutup modal"
                    class="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
                >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Device Change Security Warning Banner (Rule #17, AC-17) -->
            {#if keyChange}
                <div class="px-5 py-3 bg-rose-50 border-b border-rose-200 text-xs text-rose-900 space-y-1.5" role="alert">
                    <div class="font-bold flex items-center gap-1.5 text-rose-800">
                        <span>⚠️ Peringatan Pergantian Perangkat / Kunci Identitas</span>
                    </div>
                    <p class="leading-relaxed">
                        Kunci publik <strong>{peerUsername}</strong> telah berubah. Status verifikasi sebelumnya telah dibatalkan secara otomatis.
                        {#if pendingCount > 0}
                            Terdapat <strong>{pendingCount}</strong> pesan keluar yang sedang ditahan.
                        {/if}
                        Bandingkan fingerprint atau Safety Number baru di bawah ini sebelum menyetujui.
                    </p>
                </div>
            {/if}

            <!-- Navigation Tabs -->
            <div class="px-5 pt-3 border-b border-slate-200 flex items-center gap-2 bg-white" role="tablist" aria-label="Metode Verifikasi Keamanan">
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "digits"}
                    on:click={() => selectTab("digits")}
                    class="px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer {activeTab === 'digits'
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-slate-500 hover:text-slate-800'}"
                >
                    Nomor Keamanan (60 Digit)
                </button>

                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "qr"}
                    on:click={() => selectTab("qr")}
                    class="px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer {activeTab === 'qr'
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-slate-500 hover:text-slate-800'}"
                >
                    Kode QR
                </button>

                {#if keyChange}
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === "compare"}
                        on:click={() => selectTab("compare")}
                        class="px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer {activeTab === 'compare'
                            ? 'border-rose-600 text-rose-600'
                            : 'border-transparent text-rose-600/70 hover:text-rose-700'}"
                    >
                        Perbandingan Kunci
                    </button>
                {/if}
            </div>

            <!-- Body Content -->
            <div class="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                {#if loading}
                    <div class="py-10 text-center text-slate-500 space-y-2" role="status">
                        <div class="w-7 h-7 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                        <p class="text-xs">Menghitung Nomor Keamanan SHA-512 secara lokal...</p>
                    </div>
                {:else if activeTab === "digits"}
                    <!-- Tab 1: 60-Digit Safety Number Grid (12 blocks x 5 digits) -->
                    <div class="space-y-3">
                        <p class="text-xs text-slate-600 leading-relaxed">
                            Cocokkan 12 blok angka (60 digit) di bawah ini dengan layar milik <strong>{peerUsername}</strong> melalui panggilan suara/video atau tatap muka langsung. Jika seluruh angka identik, komunikasi Anda bebas dari penyadapan (MITM).
                        </p>

                        {#if blocks.length === 12}
                            <div
                                class="p-4 rounded-2xl bg-slate-900 text-white font-mono text-center shadow-inner"
                                aria-label="60 digit Nomor Keamanan dalam 12 blok"
                            >
                                <div class="grid grid-cols-3 sm:grid-cols-4 gap-2.5 sm:gap-3">
                                    {#each blocks as block, idx (idx)}
                                        <div class="px-2 py-2 rounded-lg bg-slate-800/90 border border-slate-700 text-sm sm:text-base font-bold tracking-widest text-indigo-200 select-all">
                                            {block}
                                        </div>
                                    {/each}
                                </div>
                            </div>

                            <div class="flex items-center justify-between gap-2">
                                <span class="text-[11px] text-slate-500">
                                    Algoritma: SHA-512 Deterministik (12 × 5 digit)
                                </span>
                                <button
                                    type="button"
                                    on:click={handleCopySafetyNumber}
                                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                                >
                                    {#if copied}
                                        <span class="text-emerald-600">✓ Nomor Keamanan Disalin</span>
                                    {:else}
                                        <span>Salin Nomor Keamanan</span>
                                    {/if}
                                </button>
                            </div>
                        {:else}
                            <div class="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs text-center">
                                Kunci identitas belum tersedia untuk menurunkan Nomor Keamanan.
                            </div>
                        {/if}

                        <!-- Individual Fingerprints Summary -->
                        {#if safetyNumber?.ownFingerprint && safetyNumber?.peerFingerprint}
                            <div class="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                                <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                                    <div class="font-semibold text-slate-700 mb-0.5">Fingerprint Kunci Anda (SHA-256)</div>
                                    <div class="font-mono text-slate-500 break-all">{safetyNumber.ownFingerprint}</div>
                                </div>
                                <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                                    <div class="font-semibold text-slate-700 mb-0.5">Fingerprint Kunci {peerUsername}</div>
                                    <div class="font-mono text-slate-500 break-all">{safetyNumber.peerFingerprint}</div>
                                </div>
                            </div>
                        {/if}
                    </div>
                {:else if activeTab === "qr"}
                    <!-- Tab 2: Local SVG QR Code -->
                    <div class="space-y-4">
                        <p class="text-xs text-slate-600 leading-relaxed text-center">
                            Pindai kode QR ini menggunakan perangkat <strong>{peerUsername}</strong> saat bertemu langsung. Kode QR dirender murni di dalam browser Anda tanpa mengirim kunci ke server eksternal.
                        </p>

                        <div class="flex flex-col items-center justify-center">
                            <div
                                class="w-[228px] h-[228px] p-2 rounded-2xl bg-white border-2 border-slate-200 shadow-xs flex items-center justify-center shrink-0"
                                data-testid="safety-number-qr-container"
                            >
                                {#if safetyNumber?.qrSvg}
                                    {@html safetyNumber.qrSvg}
                                {:else}
                                    <span class="text-xs text-slate-400">QR tidak tersedia</span>
                                {/if}
                            </div>
                            <span class="mt-2 text-[11px] font-mono text-slate-400">
                                {formattedDigits ? `${blocks.slice(0, 3).join(" ")} … ${blocks.slice(-2).join(" ")}` : ""}
                            </span>
                        </div>

                        <!-- Out-of-band QR / Safety Number matcher -->
                        <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                            <label for="qr-verify-input" class="block text-xs font-semibold text-slate-700">
                                Verifikasi Hasil Pindai QR / Nomor Lawan Bicara:
                            </label>
                            <div class="flex items-center gap-2">
                                <input
                                    id="qr-verify-input"
                                    type="text"
                                    bind:value={scanCheckInput}
                                    on:input={() => {
                                        if (scanCheckResult) scanCheckResult = null;
                                    }}
                                    placeholder="Tempel payload QR atau 60 digit lawan bicara..."
                                    class="flex-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <button
                                    type="button"
                                    on:click={handleVerifyQrInput}
                                    disabled={!scanCheckInput.trim()}
                                    class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
                                >
                                    Periksa
                                </button>
                            </div>
                            {#if scanCheckResult}
                                <p
                                    class="text-xs font-medium {scanCheckResult.valid ? 'text-emerald-700' : 'text-rose-600'}"
                                    role="status"
                                >
                                    {scanCheckResult.message}
                                </p>
                            {/if}
                        </div>
                    </div>
                {:else if activeTab === "compare" && keyChange}
                    <!-- Tab 3: Old vs New Key Comparison (Device Change Alert) -->
                    <div class="space-y-3">
                        <p class="text-xs text-slate-600 leading-relaxed">
                            Perbandingan langsung antara fingerprint perangkat lama yang tersimpan di perangkat Anda dan fingerprint perangkat baru yang dipublikasikan oleh <strong>{peerUsername}</strong>:
                        </p>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <!-- Old Key -->
                            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                                <div class="flex items-center justify-between">
                                    <span class="text-xs font-bold text-slate-700">Kunci Lama (Tersimpan)</span>
                                    <span class="text-[10px] px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">Sebelumnya</span>
                                </div>
                                {#if fpComparison?.previousBlocks?.length}
                                    <div class="grid grid-cols-3 gap-1.5 font-mono text-xs text-center">
                                        {#each fpComparison.previousBlocks as blk, idx (idx)}
                                            <span class="py-1 rounded bg-white border border-slate-200 text-slate-600">{blk}</span>
                                        {/each}
                                    </div>
                                {/if}
                                <div class="text-[10px] font-mono text-slate-500 break-all">
                                    SHA-256: {keyChange.previousFingerprint}
                                </div>
                            </div>

                            <!-- New Key -->
                            <div class="p-3 rounded-xl bg-rose-50/70 border border-rose-200 space-y-2">
                                <div class="flex items-center justify-between">
                                    <span class="text-xs font-bold text-rose-900">Kunci Baru (Saat Ini)</span>
                                    <span class="text-[10px] px-2 py-0.5 rounded bg-rose-200 text-rose-900 font-semibold">Berubah</span>
                                </div>
                                {#if fpComparison?.currentBlocks?.length}
                                    <div class="grid grid-cols-3 gap-1.5 font-mono text-xs text-center">
                                        {#each fpComparison.currentBlocks as blk, idx (idx)}
                                            <span
                                                class="py-1 rounded font-bold {fpComparison.changedBlockIndices.includes(idx)
                                                    ? 'bg-rose-100 border border-rose-300 text-rose-800'
                                                    : 'bg-white border border-slate-200 text-slate-700'}"
                                            >
                                                {blk}
                                            </span>
                                        {/each}
                                    </div>
                                {/if}
                                <div class="text-[10px] font-mono text-rose-800 break-all">
                                    SHA-256: {keyChange.fingerprint}
                                </div>
                            </div>
                        </div>
                    </div>
                {/if}

                <!-- Verification Action Bar -->
                <div class="pt-3 border-t border-slate-200">
                    {#if keyChange}
                        <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-rose-50/80 p-3.5 rounded-xl border border-rose-200">
                            <div class="text-xs text-rose-900">
                                <div class="font-semibold">Konfirmasi Kunci Perangkat Baru</div>
                                <div class="text-[11px] text-rose-700">
                                    Setujui hanya jika Anda telah mencocokkan Safety Number baru dengan {peerUsername}.
                                </div>
                            </div>
                            <div class="flex flex-wrap items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    on:click={() => handleApproveChangedKey(true)}
                                    class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                                >
                                    Setujui &amp; Tandai Terverifikasi
                                </button>
                                <button
                                    type="button"
                                    on:click={() => handleApproveChangedKey(false)}
                                    class="px-3 py-2 rounded-xl bg-white hover:bg-slate-100 border border-rose-300 text-rose-800 text-xs font-semibold transition-colors cursor-pointer"
                                >
                                    Terima Kunci Saja
                                </button>
                            </div>
                        </div>
                    {:else}
                        <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl {peerVerified ? 'bg-emerald-50/80 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}">
                            <div class="flex items-start gap-2.5">
                                <div class="mt-0.5">
                                    {#if peerVerified}
                                        <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-xs font-bold" aria-hidden="true">✓</span>
                                    {:else}
                                        <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-300 text-slate-700 text-xs font-bold" aria-hidden="true">?</span>
                                    {/if}
                                </div>
                                <div>
                                    <div class="text-xs font-bold {peerVerified ? 'text-emerald-900' : 'text-slate-800'}">
                                        {peerVerified ? "Kontak Terverifikasi (Out-of-Band)" : "Belum Diverifikasi Secara Out-of-Band"}
                                    </div>
                                    <div class="text-[11px] {peerVerified ? 'text-emerald-700' : 'text-slate-500'}">
                                        {#if peerVerified && peerVerifiedAt}
                                            Diverifikasi pada {new Date(peerVerifiedAt).toLocaleString()}
                                        {:else}
                                            Tandai sebagai terverifikasi setelah mencocokkan 60 digit angka atau memindai kode QR.
                                        {/if}
                                    </div>
                                </div>
                            </div>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={peerVerified}
                                disabled={loading || isSubmittingVerify || blocks.length !== 12}
                                on:click={handleToggleVerified}
                                class="px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer shrink-0 disabled:opacity-50 {peerVerified
                                    ? 'bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'}"
                            >
                                {#if peerVerified}
                                    Batalkan Status Terverifikasi
                                {:else}
                                    Tandai sebagai Terverifikasi
                                {/if}
                            </button>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Footer -->
            <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                <span>Kunci privat tidak pernah meninggalkan perangkat ini (Rule #17).</span>
                <button
                    type="button"
                    on:click={closeModal}
                    class="px-3.5 py-1.5 rounded-lg bg-slate-200/80 hover:bg-slate-300/80 text-slate-800 font-semibold transition-colors cursor-pointer"
                >
                    Tutup
                </button>
            </div>
        </div>
    </div>
{/if}

