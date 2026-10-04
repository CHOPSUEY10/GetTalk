<script>
    import { push } from 'svelte-spa-router';
</script>

<div class="not-found">
    <h2>404</h2>
    <p>Page not found</p>
    <button on:click={() => push('/')}>Back to GetTalk</button>
</div>

<style>
    .not-found {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 100vh;
        text-align: center;
    }
</style>
