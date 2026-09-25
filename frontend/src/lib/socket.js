import { io } from 'socket.io-client';
import env from '../config/env.js';

export const socket = io(env.socketUrl, {
  autoConnect: false
});