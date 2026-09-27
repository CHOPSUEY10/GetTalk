import { api } from './client.js';


export const conversationList = () => {
    return api.get('/api/conversations');
};

/** @param {string} convId*/
export const getConversation = (convId) => {
    return api.get(`/api/conversations/${convId}`);
};

/** @param {any} payload*/
export const createConversation = (payload) => {
    return api.post(`/api/conversations`, payload);
};