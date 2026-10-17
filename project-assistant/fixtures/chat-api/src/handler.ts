import { validateMessage } from './schemas.js';

export function handleMessage(body: unknown) {
  const input = validateMessage(body);
  return { status: 200, body: { accepted: true, client_message_id: input.client_message_id } };
}
