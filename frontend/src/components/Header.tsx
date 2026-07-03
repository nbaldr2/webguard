import React from 'react';
import { useAuth } from '../context/AuthContext';
import { ShieldCheck, ShieldAlert, ShieldX, Calendar } from 'lucide-react';

interface HeaderProps {
  currentPage: string;
}

export const Header: React.FC<HeaderProps> = ({ currentPage }) => {
  const { user } = useAuth();

  if (!user) return null;

  const getPageTitle = () => {
    switch (currentPage) {
      case 'dashboard':
        return { title: 'Traffic Dashboard', subtitle: 'Monitor visitors and bot hits in real-time' };
      case 'settings':
        return { title: 'Whitelist & Blacklists', subtitle: 'Manage country/OS/browser whitelists and block IP rules' };
      case 'general':
        return { title: 'General Settings', subtitle: 'Configure IP intelligence API providers for accurate detection' };
      case 'code':
        return { title: 'Client Integration Code', subtitle: 'Copy code snippets to embed in your PHP/Node sites' };
      default:
        return { title: 'WebGuard V2', subtitle: 'Antibot Shield System' };
    }
  };

  const { title, subtitle } = getPageTitle();

  const isSubActive = user.end_sub ? new Date(user.end_sub) > new Date() : false;
  const isBannedOrPending = user.active === 2;

  return (
    <header className="header">
      <div className="header-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="header-actions">
        {isBannedOrPending ? (
          <div className="badge-sub expired" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldX size={16} />
            Banned / Inactive
          </div>
        ) : isSubActive ? (
          <div className="badge-sub" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldCheck size={16} />
            Subscription Active
          </div>
        ) : (
          <div className="badge-sub expired" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldAlert size={16} />
            Subscription Expired
          </div>
        )}

        {user.end_sub && !isBannedOrPending && (
          <div className="badge-sub" style={{ background: 'rgba(255, 255, 255, 0.02)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Calendar size={16} />
            Expires: {new Date(user.end_sub).toLocaleDateString()}
          </div>
        )}
      </div>
    </header>
  );
};
