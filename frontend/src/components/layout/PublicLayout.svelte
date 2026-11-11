<script>
    import { themeStore } from "../../stores/ui.store.js";
    import Icon from "../common/Icon.svelte";
</script>

<div class="public-layout relative">
    <!-- Top Right Theme Toggle -->
    <div class="fixed top-4 right-4 z-20">
        <button
            type="button"
            on:click={() => themeStore.toggleTheme()}
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:text-indigo-600 shadow-xs transition-colors cursor-pointer"
            title={$themeStore === "dark" ? "Ganti ke Mode Terang" : "Ganti ke Mode Gelap"}
            aria-label={$themeStore === "dark" ? "Ganti ke Mode Terang" : "Ganti ke Mode Gelap"}
        >
            <Icon name={$themeStore === "dark" ? "sun" : "moon"} size="sm" />
            <span class="hidden sm:inline">{$themeStore === "dark" ? "Terang" : "Gelap"}</span>
        </button>
    </div>

    <div class="public-container">
        <header class="public-header">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 text-white font-extrabold text-xl mb-3 shadow-md shadow-indigo-500/25">
                G
            </div>
            <h1 class="text-2xl font-bold tracking-tight text-slate-900 m-0">GetTalk</h1>
            <p class="text-xs font-medium text-slate-500 mt-1 flex items-center justify-center gap-1.5">
                <Icon name="shield-check" size="xs" className="text-emerald-600" />
                <span>End-to-End Encrypted Real-Time Chat</span>
            </p>
        </header>
        <main class="public-content">
            <slot />
        </main>
    </div>
</div>
