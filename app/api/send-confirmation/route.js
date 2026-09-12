import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { sendOrderConfirmationMessages } from '../../../lib/serverNotify';

// Sends an order confirmation to a customer via SMS (Termii) and/or WhatsApp
// (Meta Cloud API). Requires these environment variables to actually send:
//   TERMII_API_KEY, TERMII_SENDER_ID        (for SMS)
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE_NAME   (for WhatsApp)
// If a provider's keys aren't set, that channel is silently skipped rather
// than failing the whole request — so you can turn on SMS before WhatsApp
// is ready, or vice versa. The message text itself is editable by the admin
// in Settings (app_settings.auto_confirm_message) — see lib/serverNotify.js.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const { phone, customerName, orderId, sendSms, sendWhatsapp } = await request.json();
  if (!phone || !orderId) return NextResponse.json({ error: 'Missing phone or orderId.' }, { status: 400 });

  const result = await sendOrderConfirmationMessages(supabaseAdmin, { phone, customerName, orderId, sendSms, sendWhatsapp });
  return NextResponse.json(result);
}
