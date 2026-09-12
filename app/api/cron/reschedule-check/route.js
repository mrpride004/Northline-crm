import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { notifyUsersServer, getOrderNotifyRecipients } from '../../../../lib/serverNotify';

// Runs once a day (see vercel.json "crons") and moves any order sitting in
// "Rescheduled" whose reschedule_date has arrived (or already passed, in case
// a run was ever missed) back to "New" so it shows up for staff to act on
// again, instead of silently sitting there forever.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  // Vercel automatically sends "Authorization: Bearer $CRON_SECRET" on
  // cron-triggered invocations when CRON_SECRET is set as an env var. If it
  // isn't set yet, we don't block the route — just less locked-down.
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const { data: due, error } = await supabaseAdmin
      .from('orders')
      .select('id, customer, state, reschedule_date')
      .eq('status', 'Rescheduled')
      .lte('reschedule_date', today);

    if (error) throw error;
    if (!due || due.length === 0) {
      return NextResponse.json({ ok: true, moved: 0 });
    }

    const ids = due.map(o => o.id);
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ status: 'New', status_updated_at: new Date().toISOString() })
      .in('id', ids);
    if (updateError) throw updateError;

    await supabaseAdmin.from('order_events').insert(
      due.map(o => ({
        order_id: o.id, actor_id: null, actor_name: 'System',
        event_type: 'status_change', from_status: 'Rescheduled', to_status: 'New',
        note: `Auto-moved back to New — reschedule date (${o.reschedule_date}) arrived.`,
      }))
    );

    const notifyIds = await getOrderNotifyRecipients(supabaseAdmin);
    if (notifyIds.length > 0) {
      // One notification per order so each is clickable/trackable — these are
      // typically only a handful per day.
      await Promise.allSettled(
        due.map(o => notifyUsersServer(supabaseAdmin, {
          userIds: notifyIds, type: 'new_order', orderId: o.id,
          title: 'Reschedule date reached',
          body: `${o.customer}${o.state ? ' · ' + o.state : ''} is back in New — follow up today.`,
        }))
      );
    }

    return NextResponse.json({ ok: true, moved: due.length, order_ids: ids });
  } catch (e) {
    console.error('[reschedule-check] failed:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
