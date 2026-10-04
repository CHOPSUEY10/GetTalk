import { api } from './client.js';

/** @param {string} convId*/
export const getMessages = (convId) => {
    return api.get(`/api/conversations/${convId}/messages`);
};

/**
 * @param {any} payload
 * @param {string} convId
 */
export const sendMessages = (payload, convId) => {
    return api.post(`/api/conversations/${convId}/messages`, payload);
};
