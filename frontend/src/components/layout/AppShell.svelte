<script>
    import { authStore } from "../../stores/auth.store.js";
    import { replace } from "svelte-spa-router";

    // The guard handles navigation, but we also can add reactive safety checks here.
    // However, since svelte-spa-router wrap handles the condition before mounting,
    // this layout can just trust that it's authenticated.
    // As an additional layer, if authenticated state changes to false, we redirect.
    $: if (!$authStore.loading && !$authStore.authenticated) {
        replace("/login");
    }
</script>

{#if $authStore.loading}
    <div class="loading-state">
        <p>Loading session...</p>
    </div>
{:else if $authStore.authenticated}
    <div class="app-shell">
        <aside class="sidebar">
            <nav>
                <ul>
                    <li><a href="#/">Home</a></li>
                    <li><a href="#/friends">Friends</a></li>
                </ul>
            </nav>
            <div class="user-info">
                <span>{$authStore.user?.username || "User"}</span>
                <button on:click={() => authStore.logout()}>Logout</button>
            </div>
        </aside>
        <main class="main-content">
            <slot />
        </main>
    </div>
{/if}

<style>
    .app-shell {
        display: flex;
        height: 100vh;
        width: 100vw;
    }
    .sidebar {
        width: 250px;
        background-color: #f4f4f4;
        border-right: 1px solid #ddd;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
    }
    .sidebar nav ul {
        list-style: none;
        padding: 1rem;
        margin: 0;
    }
    .sidebar nav ul li {
        margin-bottom: 0.5rem;
    }
    .user-info {
        padding: 1rem;
        border-top: 1px solid #ddd;
    }
    .main-content {
        flex: 1;
        overflow-y: auto;
        padding: 2rem;
    }
    .loading-state {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
    }
</style>
