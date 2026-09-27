import { api } from './client.js';

export const friendLists = () => {
    return api.get('/api/friends');
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