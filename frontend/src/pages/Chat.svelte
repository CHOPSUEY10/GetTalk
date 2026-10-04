<script>
    import ProtectedLayout from '../components/layout/ProtectedLayout.svelte';
    /** @type {{ conversationId?: string, [key: string]: any }} */
    export let params = {}; // provided by svelte-spa-router
</script>

<ProtectedLayout>
    <h2>Chat</h2>
    <p>Conversation ID: {params.conversationId}</p>
</ProtectedLayout>
