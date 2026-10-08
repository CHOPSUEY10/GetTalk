import { socketStore, socket } from '../stores/socket.store.js';
import {
  joinConversation,
  leaveConversation,
  sendEncryptedMessage,
  markMessageDelivered,
  markMessageRead
} from '../services/socket/client.js';

export const socketState = socketStore;
export const connectSocket = () => socketStore.connect();
export const disconnectSocket = () => socketStore.disconnect();

export {
  socket,
  socketStore,
  joinConversation,
  leaveConversation,
  sendEncryptedMessage,
  markMessageDelivered,
  markMessageRead
};