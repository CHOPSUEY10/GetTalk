<script>
    // Public layout for login/register pages
</script>

<div class="public-layout">
    <div class="public-container">
        <header class="public-header">
            <h2>GetTalk</h2>
        </header>
        <main class="public-content">
            <slot />
        </main>
    </div>
</div>

<style>
    .public-layout {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        background-color: #fafafa;
    }
    .public-container {
        width: 100%;
        max-width: 400px;
        background: white;
        padding: 2rem;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .public-header {
        text-align: center;
        margin-bottom: 2rem;
    }
</style>
