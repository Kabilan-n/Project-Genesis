'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, FormEvent } from 'react';
import { useAuthStore, getApiUrl } from '../../lib/auth.js';

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore(s => s.setAuth);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Registration failed');
        return;
      }
      setAuth(data.token, data.user);
      router.replace('/viewer');
    } catch (err: any) {
      setError(err.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-gray-200 flex flex-col items-center justify-center px-6">
      <Link href="/" className="flex items-center gap-3 mb-10 group">
        <div className="w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center group-hover:border-blue-500/40 transition-colors">
          <span className="text-lg text-blue-400 font-bold">G</span>
        </div>
        <div>
          <div className="font-bold text-blue-400 tracking-wide">PROJECT GENESIS</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">Become an observer</div>
        </div>
      </Link>

      <form onSubmit={onSubmit} className="w-full max-w-sm bg-[#0c1020]/60 border border-gray-700/40 rounded-xl p-6 space-y-4">
        <h1 className="text-xl font-bold mb-2">Create account</h1>

        <label className="block">
          <span className="text-xs text-gray-400 uppercase tracking-wider">Email</span>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-[#0a0e1a] border border-gray-700/50 rounded-md text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-400 uppercase tracking-wider">Username</span>
          <input
            type="text"
            required
            minLength={3}
            maxLength={32}
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-[#0a0e1a] border border-gray-700/50 rounded-md text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-400 uppercase tracking-wider">Password</span>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-[#0a0e1a] border border-gray-700/50 rounded-md text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-400 uppercase tracking-wider">Confirm password</span>
          <input
            type="password"
            required
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-[#0a0e1a] border border-gray-700/50 rounded-md text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </label>

        {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-700/40 rounded-md px-3 py-2">{error}</div>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-gray-400 text-white rounded-md font-semibold text-sm tracking-wide transition-colors"
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>

        <div className="text-xs text-center text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="text-blue-400 hover:text-blue-300">Log in</Link>
        </div>
      </form>
    </div>
  );
}
