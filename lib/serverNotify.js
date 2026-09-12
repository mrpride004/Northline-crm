// Server-side (service-role) notification helpers shared by API routes that
// don't have a logged-in user's session — webhook intake, cron jobs, etc.
// Client code in app/dashboard/features.js has its own versions of these
// (notifyUsers, sendPushNotification) that go through the authenticated
// /api/send-push route; these are the same behavior but callable directly
// from server code that already holds a service-role client.

import webpush from 'web-push';

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ---------- Push + in-app notification rows ----------

export async function sendPushToUserIds(supabaseAdmin, userIds, { title, body, url }) {
  if (!userIds || userIds.length === 0) return;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const { data: subs } = await supabaseAdmin.from('push_subscriptions').select('*').in('user_id', userIds);
    const payload = JSON.stringify({ title: title || 'Trailblazer', body: body || '', url: url || '/dashboard' });
    await Promise.allSettled(
      (subs || []).map(sub =>
        webpush
          .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
          .catch(async (err) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
            }
          })
      )
    );
  } catch (e) {
    console.error('[serverNotify] push failed:', e.message);
  }
}

// Persistent notification row (shows in the bell/Notifications page) + best-effort push.
export async function notifyUsersServer(supabaseAdmin, { userIds, type, title, body, orderId }) {
  if (!userIds || userIds.length === 0) return;
  try {
    await supabaseAdmin.from('notifications').insert(
      userIds.map(uid => ({ recipient_id: uid, type: type || 'general', title, body, order_id: orderId || null }))
    );
  } catch (e) {
    console.error('[serverNotify] notification row insert failed:', e.message);
  }
  await sendPushToUserIds(supabaseAdmin, userIds, { title, body, url: '/dashboard' });
}

// All admins, plus active staff (everyone eligible to see/pick up an
// unassigned order). Used for orders that arrive with no session attached
// (WordPress intake) and for the daily reschedule sweep.
//
// eligibleStaffIds: when a landing page source restricts which staff can see
// and claim its orders, pass that source's eligible_staff array here so the
// "it's up for grabs" notification only goes to staff who can actually claim
// it — notifying everyone but letting only a few act on it isn't competitive,
// it's just noise for the rest.
export async function getOrderNotifyRecipients(supabaseAdmin, eligibleStaffIds) {
  const { data } = await supabaseAdmin.from('profiles').select('id, role, active');
  const restricted = Array.isArray(eligibleStaffIds) && eligibleStaffIds.length > 0;
  return (data || [])
    .filter(p => p.role === 'admin' || (p.role === 'staff' && p.active !== false && (!restricted || eligibleStaffIds.includes(p.id))))
    .map(p => p.id);
}

// ---------- Order confirmation message (SMS / WhatsApp) ----------

const DEFAULT_CONFIRMATION_TEMPLATE =
  "Hi {customer}, we've received your order for {product} ({order_short}) and it's being processed.{track_line} — Trailblazer";

export function fillTemplate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (m, key) => (vars[key] != null ? String(vars[key]) : ''));
}

export async function getConfirmationTemplate(supabaseAdmin) {
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'auto_confirm_message').maybeSingle();
    if (data && data.value) return data.value;
  } catch (e) { /* fall through to default */ }
  return DEFAULT_CONFIRMATION_TEMPLATE;
}

export async function getAutoConfirmSettings(supabaseAdmin) {
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('key, value').in('key', ['sms_auto_confirm', 'whatsapp_auto_confirm']);
    const map = {};
    (data || []).forEach(r => { map[r.key] = r.value; });
    return { sms: map.sms_auto_confirm === 'true', whatsapp: map.whatsapp_auto_confirm === 'true' };
  } catch (e) {
    return { sms: false, whatsapp: false };
  }
}

async function sendSMS(phone, message) {
  const key = process.env.TERMII_API_KEY;
  const sender = process.env.TERMII_SENDER_ID;
  if (!key || !sender) return { skipped: true, channel: 'sms' };

  const res = await fetch('https://api.ng.termii.com/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, to: phone, from: sender, sms: message, type: 'plain', channel: 'generic' }),
  });
  const data = await res.json().catch(() => ({}));
  return { channel: 'sms', ok: res.ok, data };
}

async function sendWhatsApp(phone, customerName, itemLabel, orderId, trackLink) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!token || !phoneId || !templateName) return { skipped: true, channel: 'whatsapp' };

  // Assumes an approved Meta template (Utility category) with four variables:
  // {{1}} customer name, {{2}} product/item ordered, {{3}} short order id,
  // {{4}} tracking line (send '' when there's no tracking link configured —
  // Meta requires every {{n}} placeholder to get a parameter, empty text is fine).
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: customerName || 'there' },
            { type: 'text', text: itemLabel || 'your order' },
            { type: 'text', text: orderId.slice(0, 8) },
            { type: 'text', text: trackLink || '' },
          ],
        }],
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { channel: 'whatsapp', ok: res.ok, data };
}

// customMessage lets a caller (the manual "Send confirmation" button) pass
// admin-composed text straight through; when omitted, the saved template
// (app_settings.auto_confirm_message) is loaded and filled in.
export async function sendOrderConfirmationMessages(supabaseAdmin, { phone, customerName, orderId, itemLabel, sendSms, sendWhatsapp: wantWhatsapp, customMessage }) {
  if (!phone || !orderId) return { ok: false, error: 'Missing phone or orderId.' };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const trackLink = baseUrl ? `${baseUrl}/track/${orderId}` : '';
  const message = customMessage || fillTemplate(await getConfirmationTemplate(supabaseAdmin), {
    customer: customerName || 'there',
    product: itemLabel || 'your order',
    order_id: orderId,
    order_short: orderId.slice(0, 8),
    track_line: trackLink ? ` Track it here: ${trackLink}` : '',
  });

  const results = [];
  if (sendSms) results.push(await sendSMS(phone, message));
  if (wantWhatsapp) results.push(await sendWhatsApp(phone, customerName, itemLabel, orderId, trackLink));
  return { ok: true, results };
}
