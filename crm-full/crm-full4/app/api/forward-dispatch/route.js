import { NextResponse } from 'next/server';

// Forwards order details to one person at an external (non-onboarded) dispatch
// company, who then relays it into their own WhatsApp group. Uses the same
// SMS/WhatsApp credentials as send-confirmation — see that file for the
// environment variables needed.

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

async function sendWhatsAppText(phone, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return { skipped: true, channel: 'whatsapp' };
  // Free-form text only works within a 24h customer-service window (i.e. this
  // contact must have messaged your WhatsApp number recently). For a contact
  // who hasn't, use a template message the same way send-confirmation does.
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: message } }),
  });
  const data = await res.json().catch(() => ({}));
  return { channel: 'whatsapp', ok: res.ok, data };
}

export async function POST(request) {
  const { phone, channel, orderSummary } = await request.json();
  if (!phone || !orderSummary) return NextResponse.json({ error: 'Missing phone or orderSummary.' }, { status: 400 });

  const message = `New order for dispatch:\n${orderSummary}\n\nPlease confirm and forward to your team.`;

  const result = channel === 'sms' ? await sendSMS(phone, message) : await sendWhatsAppText(phone, message);
  return NextResponse.json({ ok: true, result });
}
