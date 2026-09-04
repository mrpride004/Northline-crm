'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError('Incorrect email or password.');
      return;
    }
    router.replace('/dashboard');
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-mark">Northline Dispatch</div>
        <h1 className="gate-title">Sign in</h1>
        <div className="gate-sub">Use the email and password you were given.</div>
        {error && <div className="gate-error">{error}</div>}
        <form onSubmit={handleLogin}>
          <span className="field-label">Email</span>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
          <span className="field-label">Password</span>
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          <button className="enter" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
