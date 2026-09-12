'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Resolve a username to its email first (a plain email skips straight through).
    const lookupRes = await fetch('/api/lookup-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: identifier.trim() }),
    });
    const lookupBody = await lookupRes.json();
    if (!lookupRes.ok) {
      setLoading(false);
      setError('Incorrect username/email or password.');
      return;
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: lookupBody.email,
      password,
    });
    setLoading(false);
    if (signInError) {
      setError('Incorrect username/email or password.');
      return;
    }
    // Best-effort — a failed history log should never block getting in.
    if (signInData?.session?.access_token) {
      fetch('/api/log-signin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${signInData.session.access_token}` },
      }).catch(() => {});
    }
    router.replace('/dashboard');
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-mark"><span className="logo-d">D</span>Trailblazer</div>
        <h1 className="gate-title">Sign in</h1>
        <div className="gate-sub">Use the username or email and password you were given.</div>
        {error && <div className="gate-error">{error}</div>}
        <form onSubmit={handleLogin}>
          <span className="field-label">Username or email</span>
          <input required value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="you@company.com or your username" />
          <span className="field-label">Password</span>
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          <button className="enter" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
