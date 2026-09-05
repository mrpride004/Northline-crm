import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Public, unauthenticated by design — this is what the customer-facing
// tracking link hits. Only returns status-relevant fields, never phone,
// address, notes, pricing, or who's assigned — just enough to reassure a
// customer their order is being handled.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STATUS_MESSAGES = {
  New: 'We\'ve received your order and are getting it ready.',
  Confirmed: 'Your order has been confirmed and is being prepared.',
  Preparing: 'Your order is being packed for delivery.',
  Dispatched: 'Your order is on its way to you.',
  Delivered: 'Your order has been delivered. Thank you!',
  Unreachable: 'We tried to reach you about your delivery — please expect a follow-up call.',
  Rescheduled: 'Your delivery has been rescheduled.',
  Cancelled: 'This order has been cancelled.',
};

export async function POST(request) {
  const { orderId } = await request.json();
  if (!orderId) return NextResponse.json({ error: 'Missing order ID.' }, { status: 400 });

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, customer, status, priority, preferred_time, reschedule_date, product_id, created_at')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  let productName = null;
  if (order.product_id) {
    const { data: product } = await supabaseAdmin.from('products').select('name').eq('id', order.product_id).maybeSingle();
    productName = product?.name || null;
  }

  return NextResponse.json({
    id: order.id,
    customer_first_name: (order.customer || '').split(' ')[0] || 'there',
    status: order.status,
    message: STATUS_MESSAGES[order.status] || 'Your order is being processed.',
    product_name: productName,
    preferred_time: order.preferred_time,
    reschedule_date: order.reschedule_date,
    created_at: order.created_at,
  });
}
