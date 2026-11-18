import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
  const authorization = req.headers.get("Authorization") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Supabase function secrets are not configured." }, 500);
  if (!/^Bearer\s+\S+/i.test(authorization)) return json({ error: "Sign in is required." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "The session is invalid." }, 401);
    const body = await req.json().catch(() => ({}));
    const messageId = typeof body?.message_id === "string" ? body.message_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(messageId)) return json({ error: "A valid message_id is required." }, 400);

    const { data: message, error: messageError } = await admin
      .from("northwork_messages")
      .select("id,conversation_id,sender_id,body,created_at")
      .eq("id", messageId)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message) return json({ error: "Message not found." }, 404);
    if (message.sender_id !== authData.user.id) return json({ error: "You can only notify about your own messages." }, 403);

    const { data: conversation, error: conversationError } = await admin
      .from("northwork_conversations")
      .select("id,member_one,member_two")
      .eq("id", message.conversation_id)
      .single();
    if (conversationError) throw conversationError;
    const recipientId = conversation.member_one === message.sender_id ? conversation.member_two : conversation.member_one;
    if (recipientId === message.sender_id) return json({ sent: 0, skipped: "self-message" });

    const [{ data: senderProfile, error: profileError }, { data: devices, error: devicesError }] = await Promise.all([
      admin.from("northwork_public_profiles").select("display_name,username,avatar_url").eq("id", message.sender_id).maybeSingle(),
      admin.from("northwork_chat_push_devices").select("id,provider,endpoint,web_subscription,expo_push_token").eq("user_id", recipientId),
    ]);
    if (profileError) throw profileError;
    if (devicesError) throw devicesError;
    const senderName = String(senderProfile?.display_name || senderProfile?.username || "A Northwork member").slice(0, 80);
    const rawBody = String(message.body || "");
    const messageText = rawBody.startsWith("NWGIF1:") ? "Sent you a GIF" : rawBody.replace(/\s+/g, " ").trim().slice(0, 180);
    const avatarUrl = safeHttpsUrl(senderProfile?.avatar_url);
    const siteUrl = (Deno.env.get("NORTHWORK_SITE_URL") || "https://northwork-site.pages.dev").replace(/\/$/, "");
    const deepLink = `${siteUrl}/?northwork-open-chat=${encodeURIComponent(message.conversation_id)}`;
    const title = `${senderName} sent you a message`;
    const tag = `northwork-${message.id}`;
    const payload = {
      title,
      body: messageText || "You received a new message.",
      icon: avatarUrl || `${siteUrl}/northwork-push-icon-192.png`,
      image: avatarUrl || undefined,
      badge: `${siteUrl}/northwork-push-icon-192.png`,
      url: deepLink,
      conversationId: message.conversation_id,
      senderId: message.sender_id,
      tag,
    };

    let webSent = 0;
    let expoSent = 0;
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:notifications@northwork.site";
    const webDevices = (devices || []).filter((device) => device.provider === "web" && device.web_subscription);
    if (webDevices.length && vapidPublic && vapidPrivate) {
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
      const results = await Promise.allSettled(webDevices.map(async (device) => {
        try {
          await webpush.sendNotification(device.web_subscription, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
          webSent += 1;
        } catch (error) {
          const status = (error as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            await admin.from("northwork_chat_push_devices").delete().eq("id", device.id);
          } else {
            console.warn("Web push delivery failed:", status || "unknown", (error as Error)?.message || error);
          }
        }
      }));
      for (const result of results) if (result.status === "rejected") console.warn("Web push send failed:", result.reason);
    }

    const expoDevices = (devices || []).filter((device) => device.provider === "expo" && device.expo_push_token);
    if (expoDevices.length) {
      const expoMessages = expoDevices.map((device) => ({
        to: device.expo_push_token,
        title,
        body: payload.body,
        sound: "default",
        priority: "high",
        channelId: "northwork-messages",
        threadId: message.conversation_id,
        richContent: avatarUrl ? { image: avatarUrl } : undefined,
        data: {
          conversationId: message.conversation_id,
          senderId: message.sender_id,
          senderName,
          avatarUrl,
          url: deepLink,
        },
      }));
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
      if (expoAccessToken) headers.Authorization = `Bearer ${expoAccessToken}`;
      const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers,
        body: JSON.stringify(expoMessages),
      });
      const expoResult = await expoResponse.json().catch(() => ({}));
      if (!expoResponse.ok) {
        console.warn("Expo push service returned an error:", expoResponse.status, expoResult);
      } else {
        const tickets = Array.isArray(expoResult?.data) ? expoResult.data : [expoResult?.data];
        for (let index = 0; index < tickets.length; index += 1) {
          const ticket = tickets[index];
          if (ticket?.status === "ok") expoSent += 1;
          if (ticket?.details?.error === "DeviceNotRegistered") {
            await admin.from("northwork_chat_push_devices").delete().eq("id", expoDevices[index].id);
          } else if (ticket?.status === "error") {
            console.warn("Expo push ticket failed:", ticket.message || ticket.details?.error);
          }
        }
      }
    }

    return json({ sent: webSent + expoSent, web: webSent, expo: expoSent });
  } catch (error) {
    console.error("northwork-chat-push failed:", error);
    return json({ error: (error as Error)?.message || "Push delivery failed." }, 500);
  }
});
