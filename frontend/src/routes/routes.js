export const routeConfig = {
    '/': { type: 'ENTRY' },
    '/landing': { type: 'PUBLIC' },
    '/login': { type: 'PUBLIC' },
    '/register': { type: 'PUBLIC' },
    '/register/verify': { type: 'PUBLIC' },
    '/verify-email': { type: 'PUBLIC' },
    '/forgot-password': { type: 'PUBLIC' },
    '/forgot-password/verify': { type: 'PUBLIC' },
    '/reset-password/verify': { type: 'PUBLIC' },
    '/reset-password': { type: 'PUBLIC' },
    '/friends': { type: 'PROTECTED' },
    '/settings': { type: 'PROTECTED' },
    '/settings/security': { type: 'PROTECTED' },
    '/settings/:tab': { type: 'PROTECTED' },
    '/chat/:conversationId': { type: 'PROTECTED' },
    '*': { type: 'FALLBACK' }
};

export const rawRoutes = {
    '/': () => import('../pages/Home.svelte'),
    '/landing': () => import('../pages/Landing.svelte'),
    '/login': () => import('../pages/Login.svelte'),
    '/register': () => import('../pages/Register.svelte'),
    '/register/verify': () => import('../pages/VerifyEmail.svelte'),
    '/verify-email': () => import('../pages/VerifyEmail.svelte'),
    '/forgot-password': () => import('../pages/ForgotPassword.svelte'),
    '/forgot-password/verify': () => import('../pages/VerifyOTP.svelte'),
    '/reset-password/verify': () => import('../pages/VerifyOTP.svelte'),
    '/reset-password': () => import('../pages/ResetPassword.svelte'),
    '/friends': () => import('../pages/Friends.svelte'),
    '/settings': () => import('../pages/Settings.svelte'),
    '/settings/security': () => import('../pages/SecuritySettings.svelte'),
    '/settings/:tab': () => import('../pages/Settings.svelte'),
    '/chat/:conversationId': () => import('../pages/Chat.svelte'),
    '*': () => import('../pages/Notfound.svelte')
};

