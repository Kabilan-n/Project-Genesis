'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../lib/auth.js';

export default function LandingPage() {
  const { token, user } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => { setHydrated(true); }, []);

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-gray-200 flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 border-b border-gray-700/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
            <span className="text-lg text-blue-400 font-bold">G</span>
          </div>
          <div>
            <div className="font-bold text-blue-400 tracking-wide">PROJECT GENESIS</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest">Autonomous civilization sim</div>
          </div>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          {hydrated && token && user ? (
            <>
              <span className="text-gray-400">{user.username}</span>
              <Link href="/viewer" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-semibold tracking-wide transition-colors">
                ENTER WORLD
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="text-gray-400 hover:text-white transition-colors">Log in</Link>
              <Link href="/register" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-semibold tracking-wide transition-colors">
                CREATE ACCOUNT
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-3xl w-full py-16">
          <div className="text-xs text-blue-400 tracking-[0.3em] mb-4">A LIVING WORLD OF AI MINDS</div>
          <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
            Watch a civilization <span className="text-blue-400">write itself</span>.
          </h1>
          <p className="text-gray-400 text-lg leading-relaxed mb-10 max-w-2xl">
            Project Genesis is a persistent simulation where autonomous agents — each powered by their own reasoning model — struggle to survive, form bonds, trade, fight, and build culture from scratch. You are not a player. You are an observer of a world that evolves whether you watch or not.
          </p>

          <div className="grid md:grid-cols-3 gap-4 mb-10">
            <Feature
              title="Survival"
              body="Agents feel hunger, thirst, exhaustion. Ignored needs damage their body. Critical shortages push minds into desperation."
            />
            <Feature
              title="Discovery"
              body="The map begins dark. Agents only know the terrain they've walked. Geography is earned, tile by tile."
            />
            <Feature
              title="Emergence"
              body="Groups, wars, beliefs, laws, and myths arise from thousands of small decisions — not from a script."
            />
          </div>

          <div className="flex items-center gap-4">
            {hydrated && token ? (
              <Link href="/viewer" className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold tracking-wide transition-colors">
                Enter the world &rarr;
              </Link>
            ) : (
              <>
                <Link href="/register" className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold tracking-wide transition-colors">
                  Create your observer account
                </Link>
                <Link href="/login" className="px-6 py-3 border border-gray-600 hover:border-gray-500 text-gray-300 hover:text-white rounded-lg font-semibold tracking-wide transition-colors">
                  Log in
                </Link>
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="px-6 py-4 border-t border-gray-700/30 text-xs text-gray-600 flex justify-between">
        <span>Genesis &mdash; the world keeps running while you sleep.</span>
        <span>v1.0</span>
      </footer>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-4 rounded-lg border border-gray-700/40 bg-[#0c1020]/50">
      <div className="text-sm font-semibold text-blue-300 mb-1">{title}</div>
      <div className="text-xs text-gray-400 leading-relaxed">{body}</div>
    </div>
  );
}
