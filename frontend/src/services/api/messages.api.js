import { api } from './client.js';

/** @param {string} convId*/
export const getMessages = (convId) => {
    return api.get(`/api/conversations/${convId}/messages`);
};

/** @param {string} convId*/
/** @param {any} payload */
export const sendMessages = (payload, convId) => {
    return api.post(`/api/conversations/${convId}/messages`, payload);
};
