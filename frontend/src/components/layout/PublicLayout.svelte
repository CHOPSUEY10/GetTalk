<script>
    // Public layout for login/register pages
</script>

<div class="public-layout">
    <div class="public-container">
        <header class="public-header">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 text-white font-bold text-xl mb-3 shadow-md shadow-indigo-200">
                G
            </div>
            <h1 class="text-2xl font-bold tracking-tight text-slate-900 m-0">GetTalk</h1>
            <p class="text-sm text-slate-500 mt-1">End-to-End Encrypted Real-Time Chat</p>
        </header>
        <main class="public-content">
            <slot />
        </main>
    </div>
</div>
