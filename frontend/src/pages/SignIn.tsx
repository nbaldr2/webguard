import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, LogIn } from 'lucide-react';

interface SignInProps {
  setCurrentPage: (page: string) => void;
}

export const SignIn: React.FC<SignInProps> = ({ setCurrentPage }) => {
  const [uflow, setUflow] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const { login, error } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uflow || !password) return;

    setSigningIn(true);
    const success = await login(uflow.trim(), password);
    setSigningIn(false);

    if (success) {
      setCurrentPage('dashboard');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">
            <ShieldAlert size={36} style={{ color: 'var(--color-primary)' }} />
            <span>WebGuard <span>V2</span></span>
          </div>
          <h2>Sign In</h2>
          <p>Enter your uflow identifier and password to continue</p>
        </div>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="uflow">Uflow ID</label>
            <input
              id="uflow"
              type="text"
              className="form-input"
              placeholder="e.g. u1234"
              value={uflow}
              onChange={(e) => setUflow(e.target.value)}
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: '2rem' }}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.85rem' }}
            disabled={signingIn}
          >
            <LogIn size={18} />
            {signingIn ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Don't have an account?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setCurrentPage('signup'); }}>
              Sign Up
            </a>
          </p>
          <p style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
            Forgot password? Contact{' '}
            <a href="https://t.me/webguard_support" target="_blank" rel="noopener noreferrer">
              Telegram Support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};
