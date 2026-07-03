import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, UserPlus } from 'lucide-react';

interface SignUpProps {
  setCurrentPage: (page: string) => void;
}

export const SignUp: React.FC<SignUpProps> = ({ setCurrentPage }) => {
  const [tgUser, setTgUser] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registering, setRegistering] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const { register, error } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError(null);

    if (!tgUser || !password || !confirmPassword) return;

    if (password !== confirmPassword) {
      setPassError('Passwords do not match');
      return;
    }

    setRegistering(true);
    const success = await register(tgUser.trim(), password);
    setRegistering(false);

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
          <h2>Create Account</h2>
          <p>Register with your Telegram username</p>
        </div>

        {(error || passError) && (
          <div className="alert alert-error">
            <span>{error || passError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="tg_user">Telegram Username</label>
            <input
              id="tg_user"
              type="text"
              className="form-input"
              placeholder="@username"
              value={tgUser}
              onChange={(e) => setTgUser(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
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

          <div className="form-group" style={{ marginBottom: '2rem' }}>
            <label htmlFor="confirm_password">Confirm Password</label>
            <input
              id="confirm_password"
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.85rem' }}
            disabled={registering}
          >
            <UserPlus size={18} />
            {registering ? 'Creating Account...' : 'Sign Up'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Already have an account?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setCurrentPage('signin'); }}>
              Sign In
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};
