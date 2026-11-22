import { wrap } from 'svelte-spa-router/wrap';
import { rawRoutes, routeConfig } from './routes.js';
import { checkGuard } from './guards.js';
import { push, replace, pop } from 'svelte-spa-router';
import { authStore } from '../stores/auth.store.js';

const routes = Object.fromEntries(
    Object.entries(rawRoutes).map(([path, loader]) => {
        const config = /** @type {Record<string, any>} */ (routeConfig)[path];
        if (!config || config.type === 'FALLBACK') {
            return [
                path,
                wrap({
                    asyncComponent: loader
                })
            ];
        }

        return [
            path,
            wrap({
                asyncComponent: loader,
                conditions: (detail) => checkGuard(config, detail)
            })
        ];
    })
);

// Centralized 401 handling
window.addEventListener('api:unauthorized', () => {
    authStore.setUnauthenticated();
    replace('/');
});

export { routes, push, replace, pop };

