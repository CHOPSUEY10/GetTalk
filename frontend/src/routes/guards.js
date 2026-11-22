import { replace } from 'svelte-spa-router';
import { get } from 'svelte/store';
import { authStore } from '../stores/auth.store.js';

/**
 * @param {any} config
 * @param {any} detail
 */
export function checkGuard(config, detail) {
    const auth = get(authStore);
    
    if (auth.loading) {
        return false;
    }

    if (config.type === 'ENTRY') {
        return true;
    }

    if (config.type === 'PROTECTED') {
        if (!auth.authenticated) {
            replace('/');
            return false;
        }
    } else if (config.type === 'PUBLIC') {
        if (auth.authenticated) {
            const params = new URLSearchParams(detail.querystring);
            let redirect = params.get('redirect');
            if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
                replace(redirect);
            } else {
                replace('/');
            }
            return false;
        }
    }
    
    return true;
}

