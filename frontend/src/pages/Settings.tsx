import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash2, Globe } from 'lucide-react';

interface BlacklistRule {
  id: number;
  bad_ip?: string;
  hostname?: string;
  isp?: string;
}

interface BlacklistData {
  badIps: BlacklistRule[];
  hostnames: BlacklistRule[];
  isps: BlacklistRule[];
}

const BROWSER_ICONS: Record<string, string> = {
  'Chrome': '🌐', 'Firefox': '🦊', 'Edge': '🔷', 'Safari': '🧭',
  'Opera': '🔴', 'Opera GX': '🎮', 'Brave': '🦁', 'Samsung Browser': '📱',
  'UC Browser': '🌏', 'Vivaldi': '🎨', 'Yandex Browser': '🇷🇺', 'IE': '💀',
  'Facebook App': '📘', 'Instagram App': '📷', 'Twitter App': '🐦',
  'TikTok App': '🎵', 'WebView': '📦',
};

export const Settings: React.FC = () => {
  const { token } = useAuth();

  const [countries, setCountries] = useState<string[]>([]);
  const [newCountry, setNewCountry] = useState('');
  const [blockedCountries, setBlockedCountries] = useState<string[]>([]);
  const [newBlockedCountry, setNewBlockedCountry] = useState('');

  const [systems, setSystems] = useState<string[]>([]);
  const [systemOptions, setSystemOptions] = useState<string[]>([]);

  const [browsers, setBrowsers] = useState<string[]>([]);
  const [browserOptions, setBrowserOptions] = useState<string[]>([]);

  const [blacklists, setBlacklists] = useState<BlacklistData>({ badIps: [], hostnames: [], isps: [] });

  const [newIp, setNewIp] = useState('');
  const [newHostname, setNewHostname] = useState('');
  const [newIsp, setNewIsp] = useState('');

  const [organizations, setOrganizations] = useState<{ id: number; name: string }[]>([]);
  const [newOrgName, setNewOrgName] = useState('');

  const [referrers, setReferrers] = useState<{ id: number; pattern: string }[]>([]);
  const [newReferrer, setNewReferrer] = useState('');

  const [whitelisted, setWhitelisted] = useState<{ id: number; ip: string }[]>([]);
  const [newWhitelist, setNewWhitelist] = useState('');

  const [hardBlocked, setHardBlocked] = useState<{ id: number; ip: string }[]>([]);
  const [newHardBlock, setNewHardBlock] = useState('');

  const [_savingCountries, setSavingCountries] = useState(false);
  const [savingSystems, setSavingSystems] = useState(false);
  const [savingBrowsers, setSavingBrowsers] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const API = '/api';

  const loadSettings = async () => {
    if (!token) return;
    try {
      const [cRes, sRes, bRes, rRes, bcRes, oRes, rfRes, hbRes, wlRes] = await Promise.all([
        fetch(`${API}/settings/countries`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/settings/system`,    { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/settings/browser`,   { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/settings/ip-rules`,  { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/settings/blocked-countries`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/settings/organizations`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/settings/referrer-blacklist`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/settings/hard-block`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/settings/ip-whitelist`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [cj, sj, bj, rj, bcj, oj, rfj, hbj, wlj] = await Promise.all([cRes.json(), sRes.json(), bRes.json(), rRes.json(), bcRes.json(), oRes.json(), rfRes.json(), hbRes.json(), wlRes.json()]);
      if (cj.status === 'success') setCountries(cj.allowedCountries);
      if (sj.status === 'success') { setSystems(sj.allowedSystems); setSystemOptions(sj.systemOptions); }
      if (bj.status === 'success') { setBrowsers(bj.allowedBrowsers); setBrowserOptions(bj.browserOptions); }
      if (rj.status === 'success') setBlacklists(rj.data);
      if (bcj.status === 'success') setBlockedCountries(bcj.blockedCountries);
      if (oj.status === 'success') setOrganizations(oj.data);
      if (rfj.status === 'success') setReferrers(rfj.data);
      if (hbj.status === 'success') setHardBlocked(hbj.data);
      if (wlj.status === 'success') setWhitelisted(wlj.data);
    } catch (err) { console.error('Failed to load settings:', err); }
  };

  useEffect(() => { loadSettings(); }, [token]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  /* ── Country ── */
  const handleAddCountry = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = newCountry.trim().toUpperCase();
    if (code.length !== 2) { showMessage('error', 'Country code must be 2 letters (e.g. US, FR)'); return; }
    if (countries.includes(code)) { setNewCountry(''); return; }
    const updated = [...countries, code];
    setCountries(updated); setNewCountry('');
    await saveCountries(updated);
  };
  const handleRemoveCountry = async (code: string) => {
    const updated = countries.filter(c => c !== code);
    setCountries(updated); await saveCountries(updated);
  };

  /* ---- Blocked Countries ---- */
  const handleAddBlockedCountry = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = newBlockedCountry.trim().toUpperCase();
    if (code.length !== 2) { showMessage('error', 'Country code must be 2 letters (e.g. RU, CN)'); return; }
    if (blockedCountries.includes(code)) { setNewBlockedCountry(''); return; }
    const updated = [...blockedCountries, code];
    setBlockedCountries(updated); setNewBlockedCountry('');
    await saveBlockedCountries(updated);
  };
  const handleRemoveBlockedCountry = async (code: string) => {
    const updated = blockedCountries.filter(c => c !== code);
    setBlockedCountries(updated); await saveBlockedCountries(updated);
  };
  const saveBlockedCountries = async (list: string[]) => {
    try {
      const res = await fetch(`${API}/settings/blocked-countries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ countries: list }),
      });
      res.ok ? showMessage('success', 'Blocked countries updated') : showMessage('error', 'Failed to update blocked countries');
    } catch { showMessage('error', 'Network error'); }
  };

  const saveCountries = async (list: string[]) => {
    setSavingCountries(true);
    try {
      const res = await fetch(`${API}/settings/countries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ countries: list }),
      });
      res.ok ? showMessage('success', 'Country whitelist updated') : showMessage('error', 'Failed to update countries');
    } finally { setSavingCountries(false); }
  };

  /* ── OS ── */
  const handleOSCheck = async (name: string, checked: boolean) => {
    const updated = checked ? [...systems, name] : systems.filter(s => s !== name);
    setSystems(updated); await saveSystems(updated);
  };
  const saveSystems = async (list: string[]) => {
    setSavingSystems(true);
    try {
      const res = await fetch(`${API}/settings/system`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ systems: list }),
      });
      res.ok ? showMessage('success', 'OS whitelist updated') : showMessage('error', 'Failed to update OS whitelist');
    } finally { setSavingSystems(false); }
  };

  /* ── Browser ── */
  const handleBrowserCheck = async (name: string, checked: boolean) => {
    const updated = checked ? [...browsers, name] : browsers.filter(b => b !== name);
    setBrowsers(updated); await saveBrowsers(updated);
  };
  const saveBrowsers = async (list: string[]) => {
    setSavingBrowsers(true);
    try {
      const res = await fetch(`${API}/settings/browser`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ browsers: list }),
      });
      res.ok ? showMessage('success', 'Browser whitelist updated') : showMessage('error', 'Failed to update browser whitelist');
    } finally { setSavingBrowsers(false); }
  };

  /* ── Blacklist ── */
  const handleAddBlacklist = async (e: React.FormEvent, type: 'ip' | 'hostname' | 'isp', value: string, setValue: (v: string) => void) => {
    e.preventDefault();
    if (!value.trim()) return;
    try {
      const res = await fetch(`${API}/settings/ip-rules`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, value: value.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') { setValue(''); showMessage('success', type.toUpperCase() + ' blocked'); loadSettings(); }
      else showMessage('error', data.message || 'Failed to add rule');
    } catch { showMessage('error', 'Network error'); }
  };
  const handleDeleteBlacklist = async (type: 'ip' | 'hostname' | 'isp', id: number) => {
    try {
      const res = await fetch(`${API}/settings/ip-rules/${type}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.status === 'success') { showMessage('success', 'Rule removed'); loadSettings(); }
      else showMessage('error', data.message || 'Failed to delete');
    } catch { showMessage('error', 'Network error'); }
  };

  /* ── Organizations ── */
  const handleAddOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newOrgName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API}/settings/organizations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') { setNewOrgName(''); showMessage('success', 'Organization blocked'); loadSettings(); }
      else showMessage('error', data.message || 'Failed to add organization');
    } catch { showMessage('error', 'Network error'); }
  };
  const handleDeleteOrganization = async (id: number) => {
    try {
      const res = await fetch(`${API}/settings/organizations/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.status === 'success') { showMessage('success', 'Organization removed'); loadSettings(); }
      else showMessage('error', data.message || 'Failed to delete');
    } catch { showMessage('error', 'Network error'); }
  };

  /* ── Referrer Blacklist ── */
  const handleAddReferrer = async (e: React.FormEvent) => {
    e.preventDefault();
    const pattern = newReferrer.trim();
    if (!pattern) return;
    try {
      const res = await fetch(`${API}/settings/referrer-blacklist`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pattern }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') { setNewReferrer(''); showMessage('success', 'Referrer pattern added'); loadSettings(); }
      else showMessage('error', data.message || 'Failed to add pattern');
    } catch { showMessage('error', 'Network error'); }
  };
  const handleDeleteReferrer = async (id: number) => {
    try {
      const res = await fetch(`${API}/settings/referrer-blacklist/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.status === 'success') { showMessage('success', 'Referrer pattern removed'); loadSettings(); }
      else showMessage('error', data.message || 'Failed to delete');
    } catch { showMessage('error', 'Network error'); }
  };

  /* ── IP Whitelist ── */
  const handleAddWhitelist = async (e: React.FormEvent) => {
    e.preventDefault();
    const ip = newWhitelist.trim();
    if (!ip) return;
    try {
      const res = await fetch(`${API}/settings/ip-whitelist`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ip }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') { setNewWhitelist(''); showMessage('success', 'IP whitelisted'); loadSettings(); }
      else showMessage('error', data.message || 'Failed to add');
    } catch { showMessage('error', 'Network error'); }
  };
  const handleDeleteWhitelist = async (id: number) => {
    try {
      const res = await fetch(`${API}/settings/ip-whitelist/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.status === 'success') { showMessage('success', 'Whitelisted IP removed'); loadSettings(); }
      else showMessage('error', data.message || 'Failed to delete');
    } catch { showMessage('error', 'Network error'); }
  };

  /* ── Hard Blocked IPs ── */
  const handleAddHardBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const ip = newHardBlock.trim();
    if (!ip) return;
    try {
      const res = await fetch(`${API}/settings/hard-block`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ip }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') { setNewHardBlock(''); showMessage('success', 'IP hard blocked'); loadSettings(); }
      else showMessage('error', data.message || 'Failed to add');
    } catch { showMessage('error', 'Network error'); }
  };
  const handleDeleteHardBlock = async (id: number) => {
    try {
      const res = await fetch(`${API}/settings/hard-block/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.status === 'success') { showMessage('success', 'Hard block removed'); loadSettings(); }
      else showMessage('error', data.message || 'Failed to delete');
    } catch { showMessage('error', 'Network error'); }
  };

  /* ── Grouped display ── */
  const osGroups = [
    { label: 'Windows Desktop', items: systemOptions.filter(s => /^windows (7|8|10|11)/i.test(s)) },
    { label: 'Windows Server',  items: systemOptions.filter(s => /^windows server/i.test(s)) },
    { label: 'Apple',           items: systemOptions.filter(s => /^(mac os x|iphone|ipad)$/i.test(s)) },
    { label: 'Mobile & Other',  items: systemOptions.filter(s => /^(android|mobile|linux)$/i.test(s)) },
  ].filter(g => g.items.length > 0);

  const browserGroups = [
    { label: 'Desktop Browsers', items: browserOptions.filter(b => ['Chrome','Firefox','Edge','Safari','Opera','Opera GX','Brave','Vivaldi','Yandex Browser','IE'].includes(b)) },
    { label: 'Mobile Browsers',  items: browserOptions.filter(b => ['Samsung Browser','UC Browser','WebView'].includes(b)) },
    { label: 'In-App Browsers',  items: browserOptions.filter(b => ['Facebook App','Instagram App','Twitter App','TikTok App'].includes(b)) },
  ].filter(g => g.items.length > 0);

  const checkboxStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '0.65rem',
    padding: '0.5rem 0.75rem',
    background: active ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.01)',
    border: '1px solid ' + (active ? 'rgba(99,102,241,0.45)' : 'var(--border-color)'),
    borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s ease',
  });

  const sectionHeader = (title: string, saving: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      {saving && <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}>Saving…</span>}
    </div>
  );

  const groupLabel = (text: string) => (
    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 0.5rem' }}>
      {text}
    </p>
  );

  return (
    <div>
      {message && (
        <div className={'alert ' + (message.type === 'success' ? 'alert-success' : 'alert-error')}
          style={{ position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 100, minWidth: '250px' }}>
          {message.text}
        </div>
      )}

      <div className="settings-grid">

        {/* ═══ LEFT: Whitelists ═══════════════════════════════════════════ */}
        <section className="settings-card">

          {/* Country */}
          <h2>Country Whitelist</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Only visitors from these country codes are allowed. Leave empty to allow all.
          </p>
          <form onSubmit={handleAddCountry} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input type="text" className="form-input" style={{ maxWidth: '120px' }}
              placeholder="US" maxLength={2} value={newCountry} onChange={e => setNewCountry(e.target.value)} />
            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Plus size={16} /> Add
            </button>
          </form>
          <div className="tags-input-container" style={{ marginBottom: '1rem' }}>
            {countries.length > 0 ? countries.map(code => (
              <span key={code} className="tag-item">
                <Globe size={12} />{code}
                <button type="button" className="tag-remove" onClick={() => handleRemoveCountry(code)}>&times;</button>
              </span>
            )) : (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: '0.25rem 0.5rem' }}>All countries allowed</span>
            )}
          </div>
          <hr style={{ borderColor: 'var(--border-color)', margin: '1.5rem 0' }} />
          <h2>Blocked Countries</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Visitors from these countries are blocked immediately. Leave empty to allow all countries (whitelist still applies if set).
          </p>
          <form onSubmit={handleAddBlockedCountry} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input type="text" className="form-input" style={{ maxWidth: '120px' }}
              placeholder="RU" maxLength={2} value={newBlockedCountry} onChange={e => setNewBlockedCountry(e.target.value)} />
            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Plus size={16} /> Block
            </button>
          </form>
          <div className="tags-input-container" style={{ marginBottom: '2.5rem' }}>
            {blockedCountries.length > 0 ? blockedCountries.map(code => (
              <span key={code} className="tag-item" style={{ borderColor: 'rgba(244, 63, 94, 0.3)', background: 'rgba(244, 63, 94, 0.08)' }}>
                <Globe size={12} />{code}
                <button type="button" className="tag-remove" onClick={() => handleRemoveBlockedCountry(code)}>x</button>
              </span>
            )) : (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: '0.25rem 0.5rem' }}>No blocked countries</span>
            )}
          </div>

          {/* OS Whitelist */}
          {sectionHeader('Operating System Whitelist', savingSystems)}
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
            Enabled OS types are allowed. Traffic from unlisted systems is blocked.
          </p>
          {osGroups.map(group => (
            <div key={group.label} style={{ marginBottom: '1.25rem' }}>
              {groupLabel(group.label)}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {group.items.map(sys => (
                  <label key={sys} style={checkboxStyle(systems.includes(sys))}>
                    <input type="checkbox" checked={systems.includes(sys)}
                      onChange={e => handleOSCheck(sys, e.target.checked)}
                      style={{ accentColor: 'var(--color-primary)' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{sys}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          {/* Browser Whitelist */}
          <div style={{ marginTop: '1.5rem' }}>
            {sectionHeader('Browser Whitelist', savingBrowsers)}
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Enabled browsers are allowed. Headless, unknown, or unchecked browsers are blocked as bot hits.
            </p>
            {browserGroups.map(group => (
              <div key={group.label} style={{ marginBottom: '1.25rem' }}>
                {groupLabel(group.label)}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {group.items.map(b => (
                    <label key={b} style={checkboxStyle(browsers.includes(b))}>
                      <input type="checkbox" checked={browsers.includes(b)}
                        onChange={e => handleBrowserCheck(b, e.target.checked)}
                        style={{ accentColor: 'var(--color-primary)' }} />
                      <span style={{ fontSize: '1rem', lineHeight: 1, userSelect: 'none' }}>{BROWSER_ICONS[b] || '🌐'}</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{b}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ RIGHT: Blacklists ══════════════════════════════════════════ */}
        <section className="settings-card" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

          {/* Whitelisted IPs */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0' }}>
              <h2 style={{ margin: 0, color: 'var(--color-success)' }}>Whitelisted IPs</h2>
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, lineHeight: 1,
                padding: '0.2rem 0.55rem', borderRadius: '999px',
                background: whitelisted.length > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                color: whitelisted.length > 0 ? '#34d399' : 'var(--text-muted)',
                border: '1px solid ' + (whitelisted.length > 0 ? 'rgba(16,185,129,0.3)' : 'var(--border-color)'),
              }}>
                {whitelisted.length.toLocaleString()} entries
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0.75rem' }}>
              These IPs bypass the entire detection pipeline and are always allowed.
            </p>
            <form onSubmit={handleAddWhitelist} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="text" className="form-input" placeholder="e.g. 122.3.151.84" value={newWhitelist} onChange={e => setNewWhitelist(e.target.value)} />
              <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'var(--color-success)', borderColor: 'transparent' }}><Plus size={16} /> Whitelist</button>
            </form>
            <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem' }}>
              {whitelisted.length > 0 ? whitelisted.map(w => (
                <div key={w.id} className="rule-list-item">
                  <code style={{ color: 'var(--color-success)' }}>{w.ip}</code>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem', borderColor: 'transparent', color: 'var(--color-accent)' }} onClick={() => handleDeleteWhitelist(w.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )) : <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>No whitelisted IPs</div>}
            </div>
          </div>

          {/* Hard Blocked IPs */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0' }}>
              <h2 style={{ margin: 0, color: 'var(--color-accent)' }}>Hard Blocked IPs</h2>
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, lineHeight: 1,
                padding: '0.2rem 0.55rem', borderRadius: '999px',
                background: hardBlocked.length > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)',
                color: hardBlocked.length > 0 ? '#f87171' : 'var(--text-muted)',
                border: '1px solid ' + (hardBlocked.length > 0 ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'),
              }}>
                {hardBlocked.length.toLocaleString()} entries
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-accent)', margin: '0.5rem 0 0.75rem' }}>
              These IPs are blocked immediately without any pipeline processing, logging, or caching. Use for aggressive scanners.
            </p>
            <form onSubmit={handleAddHardBlock} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="text" className="form-input" placeholder="e.g. 216.244.66.249" value={newHardBlock} onChange={e => setNewHardBlock(e.target.value)} />
              <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'var(--color-accent)', borderColor: 'transparent' }}><Plus size={16} /> Hard Block</button>
            </form>
            <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem' }}>
              {hardBlocked.length > 0 ? hardBlocked.map(hb => (
                <div key={hb.id} className="rule-list-item">
                  <code style={{ color: 'var(--color-accent)' }}>{hb.ip}</code>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem', borderColor: 'transparent', color: 'var(--color-accent)' }} onClick={() => handleDeleteHardBlock(hb.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )) : <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>No hard blocked IPs</div>}
            </div>
          </div>

          {/* IP Blacklist */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0' }}>
              <h2 style={{ margin: 0 }}>IP Blacklist</h2>
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, lineHeight: 1,
                padding: '0.2rem 0.55rem', borderRadius: '999px',
                background: blacklists.badIps.length > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                color: blacklists.badIps.length > 0 ? '#f87171' : 'var(--text-muted)',
                border: '1px solid ' + (blacklists.badIps.length > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'),
              }}>
                {blacklists.badIps.length.toLocaleString()} entries
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0.75rem' }}>
              Block specific IPs or wildcards (e.g. <code>8.8.8.8</code> or <code>8.8.*</code>).
            </p>
            <form onSubmit={e => handleAddBlacklist(e, 'ip', newIp, setNewIp)} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="text" className="form-input" placeholder="e.g. 8.8.8.8" value={newIp} onChange={e => setNewIp(e.target.value)} />
              <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Plus size={16} /> Block</button>
            </form>
            <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem' }}>
              {blacklists.badIps.length > 0 ? blacklists.badIps.map(rule => (
                <div key={rule.id} className="rule-list-item">
                  <code>{rule.bad_ip}</code>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem', borderColor: 'transparent', color: 'var(--color-accent)' }} onClick={() => handleDeleteBlacklist('ip', rule.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )) : <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>IP list empty</div>}
            </div>
          </div>

          {/* Hostname Blacklist */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0' }}>
              <h2 style={{ margin: 0 }}>Hostname Patterns</h2>
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, lineHeight: 1,
                padding: '0.2rem 0.55rem', borderRadius: '999px',
                background: blacklists.hostnames.length > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                color: blacklists.hostnames.length > 0 ? '#f87171' : 'var(--text-muted)',
                border: '1px solid ' + (blacklists.hostnames.length > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'),
              }}>
                {blacklists.hostnames.length.toLocaleString()} entries
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0.75rem' }}>
              Block reverse DNS matches containing keywords (e.g. <code>crawl</code>, <code>spider</code>).
            </p>
            <form onSubmit={e => handleAddBlacklist(e, 'hostname', newHostname, setNewHostname)} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="text" className="form-input" placeholder="e.g. crawl" value={newHostname} onChange={e => setNewHostname(e.target.value)} />
              <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Plus size={16} /> Block</button>
            </form>
            <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem' }}>
              {blacklists.hostnames.length > 0 ? blacklists.hostnames.map(rule => (
                <div key={rule.id} className="rule-list-item">
                  <code>{rule.hostname}</code>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem', borderColor: 'transparent', color: 'var(--color-accent)' }} onClick={() => handleDeleteBlacklist('hostname', rule.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )) : <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>Hostname list empty</div>}
            </div>
          </div>

          {/* ISP Blacklist */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0' }}>
              <h2 style={{ margin: 0 }}>ISP Blacklist</h2>
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, lineHeight: 1,
                padding: '0.2rem 0.55rem', borderRadius: '999px',
                background: blacklists.isps.length > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                color: blacklists.isps.length > 0 ? '#f87171' : 'var(--text-muted)',
                border: '1px solid ' + (blacklists.isps.length > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'),
              }}>
                {blacklists.isps.length.toLocaleString()} entries
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0.75rem' }}>
              Block ISPs matching keywords (e.g. <code>ovh</code>, <code>digitalocean</code>, <code>amazon</code>).
            </p>
            <form onSubmit={e => handleAddBlacklist(e, 'isp', newIsp, setNewIsp)} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="text" className="form-input" placeholder="e.g. digitalocean" value={newIsp} onChange={e => setNewIsp(e.target.value)} />
              <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Plus size={16} /> Block</button>
            </form>
            <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem' }}>
              {blacklists.isps.length > 0 ? blacklists.isps.map(rule => (
                <div key={rule.id} className="rule-list-item">
                  <code>{rule.isp}</code>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem', borderColor: 'transparent', color: 'var(--color-accent)' }} onClick={() => handleDeleteBlacklist('isp', rule.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )) : <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>ISP list empty</div>}
            </div>
          </div>

          {/* Referrer Blacklist */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0' }}>
              <h2 style={{ margin: 0 }}>Referrer Blacklist</h2>
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, lineHeight: 1,
                padding: '0.2rem 0.55rem', borderRadius: '999px',
                background: referrers.length > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                color: referrers.length > 0 ? '#f87171' : 'var(--text-muted)',
                border: '1px solid ' + (referrers.length > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'),
              }}>
                {referrers.length.toLocaleString()} entries
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0.75rem' }}>
              Block visits whose HTTP referrer contains these patterns (e.g. <code>facebook.com</code>, <code>tiktok</code>).
            </p>
            <form onSubmit={handleAddReferrer} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="text" className="form-input" placeholder="e.g. facebook.com" value={newReferrer} onChange={e => setNewReferrer(e.target.value)} />
              <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Plus size={16} /> Block</button>
            </form>
            <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem' }}>
              {referrers.length > 0 ? referrers.map(r => (
                <div key={r.id} className="rule-list-item">
                  <code>{r.pattern}</code>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem', borderColor: 'transparent', color: 'var(--color-accent)' }} onClick={() => handleDeleteReferrer(r.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )) : <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>Referrer list empty</div>}
            </div>
          </div>

          {/* Organization Blacklist */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0' }}>
              <h2 style={{ margin: 0 }}>Blocked Organizations</h2>
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, lineHeight: 1,
                padding: '0.2rem 0.55rem', borderRadius: '999px',
                background: organizations.length > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                color: organizations.length > 0 ? '#f87171' : 'var(--text-muted)',
                border: '1px solid ' + (organizations.length > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'),
              }}>
                {organizations.length.toLocaleString()} entries
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0.75rem' }}>
              Block visitors whose ISP organization matches these names (case-insensitive exact match).
            </p>
            <form onSubmit={handleAddOrganization} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="text" className="form-input" placeholder="e.g. DigitalOcean, LLC" value={newOrgName} onChange={e => setNewOrgName(e.target.value)} />
              <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Plus size={16} /> Block</button>
            </form>
            <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem' }}>
              {organizations.length > 0 ? organizations.map(org => (
                <div key={org.id} className="rule-list-item">
                  <code>{org.name}</code>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem', borderColor: 'transparent', color: 'var(--color-accent)' }} onClick={() => handleDeleteOrganization(org.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )) : <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>Organization list empty</div>}
            </div>
          </div>

        </section>
      </div>
    </div>
  );
};