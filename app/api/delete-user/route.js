import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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

  const { data: callerProfile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can remove logins.' }, { status: 403 });
  }

  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: 'Missing userId.' }, { status: 400 });
  if (userId === user.id) return NextResponse.json({ error: "You can't remove your own admin account." }, { status: 400 });

  await supabaseAdmin.from('profiles').delete().eq('id', userId);
  const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authDeleteErr) return NextResponse.json({ error: authDeleteErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
