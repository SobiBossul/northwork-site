import type { SupabaseClient } from '@supabase/supabase-js';

export const GIF_MESSAGE_PREFIX = 'NWGIF1:';

export type NorthworkProfile = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

export type NorthworkMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type NorthworkConversation = {
  id: string;
  member_one: string;
  member_two: string;
  last_message_at: string | null;
  created_at: string;
  peer: NorthworkProfile;
  lastMessage: NorthworkMessage | null;
  unread: boolean;
};

export type GifPayload = {
  url: string;
  title: string;
  id?: string;
  page?: string;
  creator?: string;
  onload?: string;
  onclick?: string;
  onsent?: string;
};

export function parseGifMessage(body: string): GifPayload | null {
  if (!body.startsWith(GIF_MESSAGE_PREFIX)) return null;
  try {
    const payload = JSON.parse(body.slice(GIF_MESSAGE_PREFIX.length)) as GifPayload;
    const url = new URL(payload.url);
    if (
      url.protocol !== 'https:' ||
      !/^media\d*\.giphy\.com$/i.test(url.hostname) ||
      !/\/media\//i.test(url.pathname) ||
      !/\.(gif|webp)$/i.test(url.pathname)
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isGifMessage(body: string): boolean {
  return parseGifMessage(body) !== null;
}

export async function loadInbox(client: SupabaseClient, userId: string): Promise<NorthworkConversation[]> {
  const { data: conversations, error } = await client
    .from('northwork_conversations')
    .select('id,member_one,member_two,last_message_at,created_at')
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw error;

  const rows = conversations ?? [];
  if (!rows.length) return [];

  const peerIds = [...new Set(rows.map((row: any) => row.member_one === userId ? row.member_two : row.member_one))];
  const conversationIds = rows.map((row: any) => row.id);

  const [profilesResult, readsResult, messagesResult] = await Promise.all([
    client.from('northwork_public_profiles')
      .select('id,display_name,username,avatar_url')
      .in('id', peerIds),
    client.from('northwork_chat_reads')
      .select('conversation_id,last_read_at')
      .eq('user_id', userId)
      .in('conversation_id', conversationIds),
    client.from('northwork_messages')
      .select('id,conversation_id,sender_id,body,created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (readsResult.error) throw readsResult.error;
  if (messagesResult.error) throw messagesResult.error;

  const profiles = new Map<string, NorthworkProfile>(
    (profilesResult.data ?? []).map((profile: NorthworkProfile) => [profile.id, profile] as [string, NorthworkProfile]),
  );
  const reads = new Map<string, string>(
    (readsResult.data ?? []).map((read: any) => [read.conversation_id, read.last_read_at] as [string, string]),
  );
  const latestMessages = new Map<string, NorthworkMessage>();
  for (const message of (messagesResult.data ?? []) as NorthworkMessage[]) {
    if (!latestMessages.has(message.conversation_id)) latestMessages.set(message.conversation_id, message);
  }

  return rows.map((row: any) => {
    const peerId = row.member_one === userId ? row.member_two : row.member_one;
    const lastMessage = latestMessages.get(row.id) ?? null;
    const readAt = reads.get(row.id);
    const unread = Boolean(
      lastMessage && lastMessage.sender_id !== userId &&
      (!readAt || new Date(lastMessage.created_at).getTime() > new Date(readAt).getTime()),
    );
    return {
      ...row,
      peer: profiles.get(peerId) ?? {
        id: peerId, display_name: 'Northwork member', username: null, avatar_url: null,
      },
      lastMessage,
      unread,
    } as NorthworkConversation;
  }).sort((a, b) =>
    new Date(b.last_message_at || b.created_at).getTime() -
    new Date(a.last_message_at || a.created_at).getTime(),
  );
}

export async function searchMembers(client: SupabaseClient, userId: string, query: string): Promise<NorthworkProfile[]> {
  const term = query.trim().replace(/^@+/, '');
  if (term.length < 2) return [];
  const [usernameResult, nameResult] = await Promise.all([
    client.from('northwork_public_profiles')
      .select('id,display_name,username,avatar_url')
      .ilike('username', `%${term}%`)
      .neq('id', userId)
      .limit(8),
    client.from('northwork_public_profiles')
      .select('id,display_name,username,avatar_url')
      .ilike('display_name', `%${term}%`)
      .neq('id', userId)
      .limit(8),
  ]);
  if (usernameResult.error) throw usernameResult.error;
  if (nameResult.error) throw nameResult.error;
  return [...new Map(
    [...(usernameResult.data ?? []), ...(nameResult.data ?? [])]
      .map((profile: NorthworkProfile) => [profile.id, profile] as [string, NorthworkProfile]),
  ).values()].slice(0, 10) as NorthworkProfile[];
}

export async function startConversation(client: SupabaseClient, otherUserId: string): Promise<string> {
  const { data, error } = await client.rpc('northwork_start_direct_conversation', {
    p_other_user_id: otherUserId,
  });
  if (error) throw error;
  return data as string;
}

export async function loadMessages(client: SupabaseClient, conversationId: string): Promise<NorthworkMessage[]> {
  // Fetch the newest page first, then reverse it for chronological rendering.
  const { data, error } = await client.from('northwork_messages')
    .select('id,conversation_id,sender_id,body,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(250);
  if (error) throw error;
  return ((data ?? []) as NorthworkMessage[]).reverse();
}

export async function markConversationRead(client: SupabaseClient, conversationId: string, userId: string): Promise<void> {
  const { error } = await client.from('northwork_chat_reads').upsert({
    conversation_id: conversationId,
    user_id: userId,
    last_read_at: new Date().toISOString(),
  }, { onConflict: 'conversation_id,user_id' });
  if (error) throw error;
}

export async function sendMessage(
  client: SupabaseClient,
  conversationId: string,
  senderId: string,
  body: string,
): Promise<NorthworkMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Write a message first.');
  if (trimmed.length > 3000) throw new Error('Messages can contain up to 3,000 characters.');
  const { data, error } = await client.from('northwork_messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, body: trimmed })
    .select('id,conversation_id,sender_id,body,created_at')
    .single();
  if (error) throw error;
  return data as NorthworkMessage;
}

export async function sendGif(
  client: SupabaseClient,
  conversationId: string,
  senderId: string,
  gif: any,
): Promise<NorthworkMessage> {
  const rawUrl = gif?.images?.original?.url;
  if (!rawUrl) throw new Error('This GIF has no original image URL.');
  const url = new URL(rawUrl);
  if (
    url.protocol !== 'https:' ||
    !/^media\d*\.giphy\.com$/i.test(url.hostname) ||
    !/\/media\//i.test(url.pathname) ||
    !/\.(gif|webp)$/i.test(url.pathname)
  ) throw new Error('That GIF link is not supported.');

  const payload: GifPayload = {
    url: url.toString(),
    title: String(gif.title || 'GIF').slice(0, 120),
    id: String(gif.id || '').slice(0, 80),
    page: /^https:\/\/giphy\.com\//i.test(gif.url || '') ? gif.url : 'https://giphy.com',
    creator: String(gif.user?.username || '').slice(0, 80),
    onload: gif.analytics?.onload?.url || '',
    onclick: gif.analytics?.onclick?.url || '',
    onsent: gif.analytics?.onsent?.url || '',
  };
  let body = GIF_MESSAGE_PREFIX + JSON.stringify(payload);
  if (body.length > 3000) {
    delete payload.onload;
    delete payload.onclick;
    delete payload.onsent;
    body = GIF_MESSAGE_PREFIX + JSON.stringify(payload);
  }
  if (body.length > 3000) throw new Error('This GIF could not be encoded for Northwork Chat.');
  return sendMessage(client, conversationId, senderId, body);
}

export function messagePreview(body: string): string {
  return isGifMessage(body) ? 'GIF' : body;
}
