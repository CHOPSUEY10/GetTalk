<script>
    import PublicLayout from "../components/layout/PublicLayout.svelte";
    import { register } from "../services/api/auth.api.js";
    import { push } from "svelte-spa-router";

    let username = "";
    let password = "";
    let email = "";
    /** @type {string | null} */
    let error = null;
    let loading = false;

    const handleRegister = async () => {
        try {
            loading = true;
            error = null;
            await register({ username, password, email });
            push("/login");
        } catch (err) {
            const e = /** @type {any} */ (err);
            error = e.message || "Registration failed";
        } finally {
            loading = false;
        }
    };
</script>

<PublicLayout>
    <h2>Register</h2>
    <form on:submit|preventDefault={handleRegister}>
        <!-- Tambahkan field email -->
        <div>
            <label for="email">Email</label>
            <input id="email" type="email" bind:value={email} required />
        </div>

        <div>
            <label for="username">Username</label>
            <input id="username" type="text" bind:value={username} required />
        </div>
        <div>
            <label for="password">Password</label>
            <input
                id="password"
                type="password"
                bind:value={password}
                required
            />
        </div>
        <button type="submit" disabled={loading}>
            {loading ? "Loading..." : "Register"}
        </button>
        {#if error}
            <p style="color: red;">{error}</p>
        {/if}
    </form>
    <p>Already have an account? <a href="#/login">Login</a></p>
</PublicLayout>
