import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const { identifier } = await request.json();
  if (!identifier) return NextResponse.json({ error: 'Missing identifier.' }, { status: 400 });

  // Already an email — nothing to resolve.
  if (identifier.includes('@')) {
    return NextResponse.json({ email: identifier.trim() });
  }

  // Otherwise treat it as a username and look up the matching account.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', identifier.trim())
    .maybeSingle();

  if (!profile) return NextResponse.json({ error: 'No account found for that username.' }, { status: 404 });

  const { data: userData, error } = await supabaseAdmin.auth.admin.getUserById(profile.id);
  if (error || !userData?.user?.email) return NextResponse.json({ error: 'No account found for that username.' }, { status: 404 });

  return NextResponse.json({ email: userData.user.email });
}
