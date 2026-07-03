import React from 'react';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Code, ShieldAlert, LogOut, ShieldCheck, ShieldX, Settings2 } from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  setCurrentPage: (page: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, setCurrentPage }) => {
  const { user, logout, toggleActive } = useAuth();

  const handleActiveToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    toggleActive(e.target.checked);
  };

  if (!user) return null;

  const isProtectionOn = user.active === 1;

  return (
    <aside className="sidebar">
      <div className="logo">
        <ShieldAlert size={28} className="text-primary" />
        <span>WebGuard <span>V2</span></span>
      </div>

      <ul className="nav-links">
        <li className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}>
          <button onClick={() => setCurrentPage('dashboard')}>
            <LayoutDashboard size={20} />
            Dashboard
          </button>
        </li>
        <li className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}>
          <button onClick={() => setCurrentPage('settings')}>
            <ShieldAlert size={20} />
            Whitelist & Blacklists
          </button>
        </li>
        <li className={`nav-item ${currentPage === 'general' ? 'active' : ''}`}>
          <button onClick={() => setCurrentPage('general')}>
            <Settings2 size={20} />
            General (IP Providers)
          </button>
        </li>
        <li className={`nav-item ${currentPage === 'code' ? 'active' : ''}`}>
          <button onClick={() => setCurrentPage('code')}>
            <Code size={20} />
            Client Snippet
          </button>
        </li>
      </ul>

      <div className="sidebar-footer">
        <div className="active-toggle">
          <label htmlFor="protection-switch">Antibot Filter</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {isProtectionOn ? (
              <ShieldCheck size={16} style={{ color: 'var(--color-success)' }} />
            ) : (
              <ShieldX size={16} style={{ color: 'var(--color-accent)' }} />
            )}
            <label className="switch">
              <input
                id="protection-switch"
                type="checkbox"
                checked={isProtectionOn}
                disabled={user.active === 2}
                onChange={handleActiveToggle}
              />
              <span className="slider"></span>
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '1rem', padding: '0 0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>UFLOW:</span>
          <code style={{ fontSize: '0.9rem', color: 'var(--color-secondary)', fontWeight: 600 }}>{user.uflow}</code>
        </div>

        <div className="nav-item">
          <button onClick={logout} style={{ color: 'var(--color-accent)', width: '100%' }}>
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
};
