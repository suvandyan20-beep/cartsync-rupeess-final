import { useState, type FormEvent } from 'react';
import { X, UserCheck, Store, LogIn, UserPlus } from 'lucide-react';
import type { User, UserRole } from '../types.ts';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  currentUser: User | null;
  demoUsers: User[];
  onSwitchUser: (user: User) => void;
}

export function AuthModal({ open, onClose, currentUser, demoUsers, onSwitchUser }: AuthModalProps) {
  const [mode, setMode] = useState<'switch' | 'login' | 'register'>('switch');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('customer');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const customers = demoUsers.filter((u) => u.role === 'customer');
  const sellers = demoUsers.filter((u) => u.role === 'seller');

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sign in failed.');
        return;
      }
      onSwitchUser(data.user);
      onClose();
    } catch {
      setError('Network error while signing in.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role, address }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Registration failed.');
        return;
      }
      onSwitchUser(data.user);
      onClose();
    } catch {
      setError('Network error while registering account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#24152F]/80 p-4">
      <div className="bg-[#FFFFFF] border-2 border-[#24152F] rounded-2xl w-full max-w-xl shadow-card-lg overflow-hidden animate-fade-in">
        <div className="flex items-center justify-between px-6 py-5 bg-[#24152F] text-[#FFFFFF]">
          <div>
            <h2 className="font-display text-xl font-extrabold text-[#FFFFFF]">Account & Workspace</h2>
            <p className="text-xs text-[#BBA5D5] mt-0.5">
              Switch between Customer and Seller accounts or sign in with your own credentials
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#FFFFFF] hover:bg-[#352145] rounded-xl transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {/* Mode Segmented Control */}
        <div className="px-6 pt-5">
          <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-[#FFF8F0] border-2 border-[#E6D8CB] rounded-2xl">
            <button
              type="button"
              onClick={() => {
                setMode('switch');
                setError(null);
              }}
              className={`py-2 text-xs font-extrabold rounded-xl transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'switch'
                  ? 'bg-[#24152F] text-[#D9F36A]'
                  : 'text-[#29232F] hover:bg-[#BBA5D5]'
              }`}
            >
              Quick Switch
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-2 text-xs font-extrabold rounded-xl transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-[#24152F] text-[#D9F36A]'
                  : 'text-[#29232F] hover:bg-[#BBA5D5]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`py-2 text-xs font-extrabold rounded-xl transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'register'
                  ? 'bg-[#24152F] text-[#D9F36A]'
                  : 'text-[#29232F] hover:bg-[#BBA5D5]'
              }`}
            >
              Create Account
            </button>
          </div>
        </div>

        <div className="p-6 max-h-[75vh] overflow-y-auto">
          {mode === 'switch' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-[#5E5468] mb-2.5 flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                  <span>Customer Accounts</span>
                </h3>
                <div className="divide-y divide-[#E6D8CB] border-2 border-[#E6D8CB] rounded-2xl overflow-hidden">
                  {customers.map((u) => {
                    const active = currentUser?.id === u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          onSwitchUser(u);
                          onClose();
                        }}
                        className={`w-full px-4 py-3.5 flex items-center justify-between text-left transition-colors cursor-pointer ${
                          active ? 'bg-[#ECFCCB]' : 'bg-[#FFFFFF] hover:bg-[#FFF8F0]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-9 h-9 rounded-xl bg-[#24152F] text-[#D9F36A] font-extrabold text-xs flex items-center justify-center shrink-0">
                            {u.avatarInitials}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-extrabold text-[#24152F] truncate">{u.name}</div>
                            <div className="text-xs text-[#5E5468] truncate">{u.email}</div>
                          </div>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-lg text-xs font-extrabold shrink-0 ${
                            active
                              ? 'bg-[#24152F] text-[#D9F36A]'
                              : 'bg-[#FFF8F0] border border-[#E6D8CB] text-[#24152F]'
                          }`}
                        >
                          {active ? 'Active' : 'Switch'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-[#5E5468] mb-2.5 flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-[#FF783D]" strokeWidth={2} />
                  <span>Seller Accounts</span>
                </h3>
                <div className="divide-y divide-[#E6D8CB] border-2 border-[#E6D8CB] rounded-2xl overflow-hidden">
                  {sellers.map((u) => {
                    const active = currentUser?.id === u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          onSwitchUser(u);
                          onClose();
                        }}
                        className={`w-full px-4 py-3.5 flex items-center justify-between text-left transition-colors cursor-pointer ${
                          active ? 'bg-[#FFEAD9]' : 'bg-[#FFFFFF] hover:bg-[#FFF8F0]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-9 h-9 rounded-xl bg-[#FF783D] text-[#24152F] font-extrabold text-xs flex items-center justify-center shrink-0">
                            {u.avatarInitials}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-extrabold text-[#24152F] truncate">{u.name}</div>
                            <div className="text-xs text-[#5E5468] truncate">{u.email}</div>
                          </div>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-lg text-xs font-extrabold shrink-0 ${
                            active
                              ? 'bg-[#24152F] text-[#D9F36A]'
                              : 'bg-[#FFF8F0] border border-[#E6D8CB] text-[#24152F]'
                          }`}
                        >
                          {active ? 'Active' : 'Switch'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <div className="p-3 rounded-xl bg-[#FEE2E2] border-2 border-[#C83E4D] text-xs font-bold text-[#9E2A3B]">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-[#24152F] mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="maya@cartsync.demo"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#FFF8F0] border-2 border-[#E6D8CB] text-[#29232F] placeholder:text-[#5E5468] rounded-xl focus:outline-none focus:border-[#FF783D]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#24152F] mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Demo password: cartsync123"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#FFF8F0] border-2 border-[#E6D8CB] text-[#29232F] placeholder:text-[#5E5468] rounded-xl focus:outline-none focus:border-[#FF783D]"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
              >
                <LogIn className="w-4 h-4" strokeWidth={2} />
                <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
              </button>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              {error && (
                <div className="p-3 rounded-xl bg-[#FEE2E2] border-2 border-[#C83E4D] text-xs font-bold text-[#9E2A3B]">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-[#24152F] mb-1.5">Account Type</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setRole('customer')}
                    className={`py-2.5 px-3 text-xs font-extrabold rounded-xl border-2 transition-colors cursor-pointer ${
                      role === 'customer'
                        ? 'border-[#24152F] bg-[#24152F] text-[#D9F36A]'
                        : 'border-[#E6D8CB] bg-[#FFF8F0] text-[#24152F] hover:border-[#24152F]'
                    }`}
                  >
                    Customer Account
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('seller')}
                    className={`py-2.5 px-3 text-xs font-extrabold rounded-xl border-2 transition-colors cursor-pointer ${
                      role === 'seller'
                        ? 'border-[#24152F] bg-[#24152F] text-[#D9F36A]'
                        : 'border-[#E6D8CB] bg-[#FFF8F0] text-[#24152F] hover:border-[#24152F]'
                    }`}
                  >
                    Seller Storefront
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#24152F] mb-1.5">
                    {role === 'seller' ? 'Store Name' : 'Full Name'}
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={role === 'seller' ? 'Cascade Goods' : 'Jordan Taylor'}
                    className="w-full px-3.5 py-2.5 text-sm bg-[#FFF8F0] border-2 border-[#E6D8CB] text-[#29232F] placeholder:text-[#5E5468] rounded-xl focus:outline-none focus:border-[#FF783D]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#24152F] mb-1.5">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#FFF8F0] border-2 border-[#E6D8CB] text-[#29232F] placeholder:text-[#5E5468] rounded-xl focus:outline-none focus:border-[#FF783D]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#24152F] mb-1.5">Delivery / Hub Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="420 Pine St, Seattle, WA 98101"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#FFF8F0] border-2 border-[#E6D8CB] text-[#29232F] placeholder:text-[#5E5468] rounded-xl focus:outline-none focus:border-[#FF783D]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#24152F] mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#FFF8F0] border-2 border-[#E6D8CB] text-[#29232F] placeholder:text-[#5E5468] rounded-xl focus:outline-none focus:border-[#FF783D]"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-extrabold text-[#24152F] bg-[#FF783D] hover:bg-[#F26324] border-2 border-[#24152F] rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" strokeWidth={2} />
                <span>{submitting ? 'Creating Account...' : 'Create Account'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
