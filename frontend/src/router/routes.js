import Login from '../pages/Login.svelte';
import Register from '../pages/Register.svelte';
import Home from '../pages/Home.svelte';
import Friends from '../pages/Friends.svelte';
import Chat from '../pages/Chat.svelte';
import NotFound from '../pages/Notfound.svelte';

export const routeConfig = {
    '/login': { type: 'PUBLIC' },
    '/register': { type: 'PUBLIC' },
    '/': { type: 'PROTECTED' },
    '/friends': { type: 'PROTECTED' },
    '/chat/:conversationId': { type: 'PROTECTED' },
    '*': { type: 'FALLBACK' }
};

export const rawRoutes = {
    '/login': Login,
    '/register': Register,
    '/': Home,
    '/friends': Friends,
    '/chat/:conversationId': Chat,
    '*': NotFound
};
