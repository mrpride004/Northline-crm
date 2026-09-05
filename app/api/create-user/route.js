import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Server-side only — this key must NEVER be exposed to the browser.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  // Confirm the caller is who they say they are, and that they're an admin.
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data: callerProfile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can create logins.' }, { status: 403 });
  }

  const { full_name, email, password, role, state, allowed_products, allowed_sections, username } = await request.json();
  if (!full_name || !email || !password || !['staff', 'dispatch', 'manager', 'logistics', 'marketer', 'inventory'].includes(role)) {
    return NextResponse.json({ error: 'Missing or invalid fields.' }, { status: 400 });
  }

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 400 });

  const { error: profileErr } = await supabaseAdmin.from('profiles').insert({
    id: created.user.id,
    full_name,
    role,
    state: state || null,
    active: true,
    allowed_products: allowed_products && allowed_products.length > 0 ? allowed_products : null,
    allowed_sections: allowed_sections && allowed_sections.length > 0 ? allowed_sections : null,
    username: username ? username.trim().toLowerCase() : null,
  });
  if (profileErr) {
    const message = profileErr.message.includes('duplicate') && profileErr.message.includes('username')
      ? 'That username is already taken — try another.'
      : profileErr.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
