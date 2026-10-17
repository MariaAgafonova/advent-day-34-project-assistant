import { handleMessage } from './handler.js';

export const chatRoute = {
  method: 'POST',
  path: '/api/tickets/:id/messages',
  handle: handleMessage,
};
