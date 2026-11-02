import { api } from './client.js';

/**
 * Fetch accepted friends for the authenticated user (cursor-paginated).
 * @param {{ limit?: number, after?: string }} [params]
 * @returns {Promise<{ friends: any[], nextCursor: string | null }>}
 */
export const friendLists = (params = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.after) query.set('after', params.after);
    const qs = query.toString() ? `?${query.toString()}` : '';

    return api.get(`/api/friends${qs}`);
};

export const friendRequestList = () => {
    return api.get('/api/friends/requests');
};

// Menambahkan permintaan pertemanan 
/** @param {any} payload */
export const friendRequest = (payload) => {
    return api.post('/api/friends/requests', payload);
};

// Menerima permintaan pertemanan 
/** @param {string} requestId */
export const acceptFriendRequests = (requestId) => {
    return api.post(`/api/friends/requests/${requestId}/accept`, {});
};

// Menolak permintaan pertemanan 
/** @param {string} requestId */
export const rejectFriendRequests = (requestId) => {
    return api.post(`/api/friends/requests/${requestId}/reject`, {});
};

// Menghapus dari daftar pertemanan 
/** @param {any} requestId */
export const deleteFromFriendList = (requestId) => {
    return api.delete(`/api/friends/${requestId}`);
};
