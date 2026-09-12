import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Records one row of real sign-in history — IP address and user-agent are
// only visible to server code (never to browser JS), so this has to be a
// route rather than a direct client insert. Called once, right after a
// successful sign-in, from the login page.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data: profile } = await supabaseAdmin.from('profiles').select('full_name').eq('id', user.id).single();

  // x-forwarded-for can carry a comma-separated chain (client, proxy, proxy…) — the first entry is the original client.
  const forwardedFor = request.headers.get('x-forwarded-for') || '';
  const ip = forwardedFor.split(',')[0].trim() || request.headers.get('x-real-ip') || null;
  const userAgent = request.headers.get('user-agent') || null;

  await supabaseAdmin.from('login_history').insert({
    user_id: user.id,
    actor_name: profile?.full_name || null,
    ip_address: ip,
    user_agent: userAgent,
  });

  return NextResponse.json({ ok: true });
}
