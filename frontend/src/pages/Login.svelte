<script>
    import PublicLayout from '../components/layout/PublicLayout.svelte';
    import { authStore } from '../stores/auth.store.js';
    
    let username = '';
    let password = '';
    
    const handleLogin = async () => {
        try {
            await authStore.login({ username, password });
        } catch (error) {
            console.error('Login failed');
        }
    }
</script>

<PublicLayout>
    <h2>Login</h2>
    <form on:submit|preventDefault={handleLogin}>
        <div>
            <label for="username">Username</label>
            <input id="username" type="text" bind:value={username} required />
        </div>
        <div>
            <label for="password">Password</label>
            <input id="password" type="password" bind:value={password} required />
        </div>
        <button type="submit" disabled={$authStore.loading}>
            {$authStore.loading ? 'Loading...' : 'Login'}
        </button>
        {#if $authStore.error}
            <p style="color: red;">{$authStore.error}</p>
        {/if}
    </form>
    <p>Don't have an account? <a href="#/register">Register</a></p>
</PublicLayout>
