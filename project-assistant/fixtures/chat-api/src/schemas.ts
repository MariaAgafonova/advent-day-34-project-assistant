export interface ChatInput { content: string; client_message_id: string }
export const MAX_CONTENT_LENGTH = 4000;

export function validateMessage(value: unknown): ChatInput {
  const v = value as Partial<ChatInput>;
  if (!v || typeof v.content !== 'string' || !v.content.trim() || v.content.length > MAX_CONTENT_LENGTH)
    throw new Error('invalid_content');
  if (typeof v.client_message_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.client_message_id))
    throw new Error('invalid_client_message_id');
  return { content: v.content, client_message_id: v.client_message_id };
}
