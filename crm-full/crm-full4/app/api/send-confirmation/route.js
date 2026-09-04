import { NextResponse } from 'next/server';

// Sends an order confirmation to a customer via SMS (Termii) and/or WhatsApp
// (Meta Cloud API). Requires these environment variables to actually send:
//   TERMII_API_KEY, TERMII_SENDER_ID        (for SMS)
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE_NAME   (for WhatsApp)
// If a provider's keys aren't set, that channel is silently skipped rather
// than failing the whole request — so you can turn on SMS before WhatsApp
// is ready, or vice versa.

async function sendSMS(phone, message) {
  const key = process.env.TERMII_API_KEY;
  const sender = process.env.TERMII_SENDER_ID;
  if (!key || !sender) return { skipped: true, channel: 'sms' };

  const res = await fetch('https://api.ng.termii.com/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      to: phone,
      from: sender,
      sms: message,
      type: 'plain',
      channel: 'generic',
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { channel: 'sms', ok: res.ok, data };
}

async function sendWhatsApp(phone, customerName, orderId) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!token || !phoneId || !templateName) return { skipped: true, channel: 'whatsapp' };

  // Assumes an approved Meta template with two variables: {{1}} name, {{2}} order id.
  // Set up and approve this template in Meta Business Manager first.
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
          parameters: [{ type: 'text', text: customerName }, { type: 'text', text: orderId }],
        }],
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { channel: 'whatsapp', ok: res.ok, data };
}

export async function POST(request) {
  const { phone, customerName, orderId, sendSms, sendWhatsapp } = await request.json();
  if (!phone || !orderId) return NextResponse.json({ error: 'Missing phone or orderId.' }, { status: 400 });

  const message = `Hi ${customerName || 'there'}, we've received your order (${orderId.slice(0, 8)}) and it's being processed. We'll update you as it moves. — Northline`;

  const results = [];
  if (sendSms) results.push(await sendSMS(phone, message));
  if (sendWhatsapp) results.push(await sendWhatsApp(phone, customerName, orderId));

  return NextResponse.json({ ok: true, results });
}
