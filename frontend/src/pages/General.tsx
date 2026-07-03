import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash2, Plug, Power, GripVertical, Settings2, PenLine } from 'lucide-react';

interface IPProvider {
  id: number;
  name: string;
  url_template: string;
  api_key: string;
  country_field: string;
  isp_field: string;
  enabled: boolean;
  sort_order: number;
}

export const General: React.FC = () => {
  const { token } = useAuth();
  const [providers, setProviders] = useState<IPProvider[]>([]);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [editingProvider, setEditingProvider] = useState<IPProvider | null>(null);
  const [providerForm, setProviderForm] = useState({ name: '', url_template: '', api_key: '', country_field: '', isp_field: '' });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const API = 'http://localhost:5005/api';

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const loadProviders = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/settings/ip-providers`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (json.status === 'success') setProviders(json.data);
    } catch (err) { console.error('Failed to load IP providers:', err); }
  };

  useEffect(() => { loadProviders(); }, [token]);

  const resetProviderForm = () => setProviderForm({ name: '', url_template: '', api_key: '', country_field: '', isp_field: '' });

  const openAddForm = () => {
    setEditingProvider(null);
    resetProviderForm();
    setShowAddProvider(true);
  };

  const handleEditProvider = (provider: IPProvider) => {
    setEditingProvider(provider);
    setProviderForm({
      name: provider.name,
      url_template: provider.url_template,
      api_key: provider.api_key,
      country_field: provider.country_field,
      isp_field: provider.isp_field,
    });
    setShowAddProvider(true);
  };

  const handleSubmitProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerForm.name || !providerForm.url_template || !providerForm.country_field || !providerForm.isp_field) {
      showMessage('error', 'Name, URL template, Country field, and ISP field are required');
      return;
    }
    try {
      if (editingProvider) {
        const res = await fetch(`${API}/settings/ip-providers/${editingProvider.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(providerForm),
        });
        const data = await res.json();
        if (data.status === 'success') {
          setProviders(prev => prev.map(p => p.id === editingProvider.id ? data.data : p));
          setShowAddProvider(false);
          setEditingProvider(null);
          resetProviderForm();
          showMessage('success', 'Provider updated');
        } else showMessage('error', data.message || 'Failed to update provider');
      } else {
        const res = await fetch(`${API}/settings/ip-providers`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(providerForm),
        });
        const data = await res.json();
        if (data.status === 'success') {
          setProviders(prev => [...prev, data.data]);
          setShowAddProvider(false);
          resetProviderForm();
          showMessage('success', 'Provider added');
        } else showMessage('error', data.message || 'Failed to add provider');
      }
    } catch { showMessage('error', 'Network error'); }
  };

  const cancelForm = () => {
    setShowAddProvider(false);
    setEditingProvider(null);
    resetProviderForm();
  };

  const handleToggleProvider = async (provider: IPProvider) => {
    try {
      const res = await fetch(`${API}/settings/ip-providers/${provider.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: !provider.enabled }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setProviders(prev => prev.map(p => p.id === provider.id ? data.data : p));
      }
    } catch { showMessage('error', 'Network error'); }
  };

  const handleDeleteProvider = async (id: number) => {
    try {
      const res = await fetch(`${API}/settings/ip-providers/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setProviders(prev => prev.filter(p => p.id !== id));
        showMessage('success', 'Provider removed');
      }
    } catch { showMessage('error', 'Network error'); }
  };

  return (
    <div>
      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'}`}
          style={{ position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 100, minWidth: '250px' }}>
          {message.text}
        </div>
      )}

      <section className="settings-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Settings2 size={20} /> IP Intelligence Providers
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Configure IP lookup APIs to detect visitor country and ISP. Providers are tried in order; if one fails, the next is used as fallback.
            </p>
          </div>
          <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            onClick={openAddForm}>
            <Plus size={16} /> Add Provider
          </button>
        </div>

        {/* Provider List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {providers.map((provider, idx) => (
            <div key={provider.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.75rem 1rem',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              opacity: provider.enabled ? 1 : 0.5,
            }}>
              <GripVertical size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <Plug size={18} style={{ color: provider.enabled ? 'var(--color-success)' : 'var(--text-muted)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{provider.name}</span>
                  <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {provider.url_template.replace('{ip}', 'x.x.x.x').replace('{key}', '***')}
                  </code>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Country: <code>{provider.country_field}</code> &nbsp;|&nbsp; ISP: <code>{provider.isp_field}</code>
                  {provider.api_key && <> &nbsp;|&nbsp; API Key: <code>****</code></>}
                </div>
              </div>
              <button className="btn btn-secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', borderColor: 'transparent' }}
                onClick={() => handleToggleProvider(provider)} title={provider.enabled ? 'Disable' : 'Enable'}>
                <Power size={14} style={{ color: provider.enabled ? 'var(--color-success)' : 'var(--text-muted)' }} />
              </button>
              <button className="btn btn-secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', borderColor: 'transparent', color: 'var(--color-secondary)' }}
                onClick={() => handleEditProvider(provider)} title="Edit">
                <PenLine size={14} />
              </button>
              <button className="btn btn-secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', borderColor: 'transparent', color: 'var(--color-accent)' }}
                onClick={() => handleDeleteProvider(provider.id)} title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {providers.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              No IP providers configured. Add one to start enriching visitor data.
            </div>
          )}
        </div>

        {/* Add/Edit Provider Form */}
        {showAddProvider && (
          <div style={{ marginTop: '1.5rem', padding: '1.25rem', border: '1px solid var(--color-primary)', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.04)' }}>
            <h3 style={{ marginBottom: '1rem' }}>{editingProvider ? 'Edit Provider' : 'Add New Provider'}</h3>
            <form onSubmit={handleSubmitProvider} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>Provider Name</label>
                  <input type="text" className="form-input" placeholder="e.g. ipinfo.io" value={providerForm.name}
                    onChange={e => setProviderForm(p => ({ ...p, name: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>API Key (optional)</label>
                  <input type="text" className="form-input" placeholder="e.g. 123abc..." value={providerForm.api_key}
                    onChange={e => setProviderForm(p => ({ ...p, api_key: e.target.value }))} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                  URL Template <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(use <code>{'{ip}'}</code> for IP, <code>{'{key}'}</code> for API key)</span>
                </label>
                <input type="text" className="form-input" placeholder="e.g. https://ipinfo.io/{ip}?token={key}" value={providerForm.url_template}
                  onChange={e => setProviderForm(p => ({ ...p, url_template: e.target.value }))} required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    Country Field <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(JSON path)</span>
                  </label>
                  <input type="text" className="form-input" placeholder="e.g. country or data.country" value={providerForm.country_field}
                    onChange={e => setProviderForm(p => ({ ...p, country_field: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    ISP Field <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(JSON path)</span>
                  </label>
                  <input type="text" className="form-input" placeholder="e.g. org or data.isp" value={providerForm.isp_field}
                    onChange={e => setProviderForm(p => ({ ...p, isp_field: e.target.value }))} required />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={cancelForm}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingProvider ? 'Save Changes' : 'Add Provider'}</button>
              </div>
            </form>
          </div>
        )}

        {/* Preset quick-add */}
        <div style={{ marginTop: '1.5rem' }}>
          <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Quick Add Presets</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { name: 'ip-api.com', url: 'http://ip-api.com/json/{ip}', country: 'countryCode', isp: 'isp', note: 'no key needed' },
              { name: 'ipapi.co', url: 'https://ipapi.co/{ip}/json/', country: 'country_code', isp: 'org', note: 'no key needed' },
              { name: 'ipwhois.io', url: 'https://ipwhois.io/json/{ip}', country: 'country_code', isp: 'isp', note: 'no key needed' },
              { name: 'ipinfo.io', url: 'https://ipinfo.io/{ip}?token={key}', country: 'country', isp: 'org', note: 'free w/ key' },
              { name: 'ipdata.co', url: 'https://api.ipdata.co/{ip}?api-key={key}', country: 'country_code', isp: 'asn.name', note: 'free w/ key' },
              { name: 'ipregistry.co', url: 'https://api.ipregistry.co/{ip}?key={key}', country: 'location.country.code', isp: 'connection.organization', note: 'free w/ key' },
              { name: 'ipbase.com', url: 'https://api.ipbase.com/v2/info?ip={ip}&apiKey={key}', country: 'data.location.country.alpha2', isp: 'data.asn.name', note: 'free w/ key' },
              { name: 'ipgeolocation.io', url: 'https://api.ipgeolocation.io/ipgeo?ip={ip}&apiKey={key}', country: 'country_code2', isp: 'isp', note: 'free w/ key' },
              { name: 'abstractapi.com', url: 'https://ipgeolocation.abstractapi.com/v1/?api_key={key}&ip_address={ip}', country: 'country_code', isp: 'connection.isp_name', note: 'free w/ key' },
              { name: 'ipxapi.com', url: 'http://api.ipxapi.com/{ip}?apiKey={key}', country: 'location.country.code', isp: 'connection.org', note: 'free w/ key' },
              { name: 'ip2location', url: 'https://api.ip2location.com/v2/?ip={ip}&key={key}&format=json', country: 'country_code', isp: 'isp', note: 'free w/ key' },
            ].map(preset => (
              <button key={preset.name} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
                title={preset.note}
                onClick={() => {
                    setEditingProvider(null);
                    setProviderForm({ name: preset.name, url_template: preset.url, api_key: '', country_field: preset.country, isp_field: preset.isp });
                    setShowAddProvider(true);
                  }}>
                + {preset.name}
              </button>
            ))}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Providers marked "no key needed" work without an API key. Others require a free API key from their website.
          </p>
        </div>
      </section>
    </div>
  );
};