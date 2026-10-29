import Login from '../pages/Login.svelte';
import Register from '../pages/Register.svelte';
import Home from '../pages/Home.svelte';
import Friends from '../pages/Friends.svelte';
import Chat from '../pages/Chat.svelte';
import NotFound from '../pages/Notfound.svelte';
import SecuritySettings from '../pages/SecuritySettings.svelte';
import ForgotPassword from '../pages/ForgotPassword.svelte';
import VerifyOTP from '../pages/VerifyOTP.svelte';
import ResetPassword from '../pages/ResetPassword.svelte';

export const routeConfig = {
    '/login': { type: 'PUBLIC' },
    '/register': { type: 'PUBLIC' },
    '/forgot-password': { type: 'PUBLIC' },
    '/forgot-password/verify': { type: 'PUBLIC' },
    '/reset-password': { type: 'PUBLIC' },
    '/': { type: 'PROTECTED' },
    '/friends': { type: 'PROTECTED' },
    '/settings/security': { type: 'PROTECTED' },
    '/chat/:conversationId': { type: 'PROTECTED' },
    '*': { type: 'FALLBACK' }
};

export const rawRoutes = {
    '/login': Login,
    '/register': Register,
    '/forgot-password': ForgotPassword,
    '/forgot-password/verify': VerifyOTP,
    '/reset-password': ResetPassword,
    '/': Home,
    '/friends': Friends,
    '/settings/security': SecuritySettings,
    '/chat/:conversationId': Chat,
    '*': NotFound
};
