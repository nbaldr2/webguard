import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Search, Globe, Smartphone, Chrome, Tag, Ban, ShieldCheck, RefreshCw } from 'lucide-react';

interface Visit {
  id: number; ip: string; country: string; hostname: string; isp: string;
  os: string; browser: string; referee: string; date: string;
  isbot: number; is_banned: boolean; source: string; blockreason: string;
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last3', label: 'Last 3 Days' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'last30', label: 'Last 30 Days' },
];

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'allowed', label: 'Allowed' },
  { key: 'blocked', label: 'Blocked' },
];

export const History: React.FC = () => {
  const { token } = useAuth();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [totalVisits, setTotalVisits] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [period, setPeriod] = useState('today');
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const API_BASE_URL = '/api';
  const PAGE_SIZE = 100;

  const fetchHistory = useCallback(async (offset: number, append: boolean) => {
    if (!token) return;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/dashboard/visits-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ period, search, type: filterType, limit: PAGE_SIZE, offset }),
      });
      const json = await res.json();
      if (json.status === 'success') {
        if (append) setVisits(p => [...p, ...json.data]);
        else setVisits(json.data);
        setTotalVisits(json.total);
        setHasMore(json.hasMore);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [token, period, search, filterType]);

  useEffect(() => { fetchHistory(0, false); }, [fetchHistory]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const handleBanIP = async (ip: string) => {
    if (!token) return;
    await fetch(`${API_BASE_URL}/settings/ip-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'ip', value: ip }),
    });
    setVisits(prev => prev.map(v => v.ip === ip ? { ...v, is_banned: true } : v));
  };

  const handleUnbanIP = async (ip: string) => {
    if (!token) return;
    await fetch(`${API_BASE_URL}/settings/ip-rules/ip/by-value/${encodeURIComponent(ip)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setVisits(prev => prev.map(v => v.ip === ip ? { ...v, is_banned: false } : v));
  };

  return (
    <div>
      <section className="table-card">
        <div className="table-header">
          <h2>Visit History</h2>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0 1rem 1rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {PERIODS.map(p => (
                <button key={p.key}
                  className={`btn ${period === p.key ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setPeriod(p.key)}
                  style={{ padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.35rem', marginLeft: 'auto' }}>
              <input type="text" className="form-input" placeholder="Search IP, country, hostname, ISP..."
                value={searchInput} onChange={e => setSearchInput(e.target.value)}
                style={{ width: '220px', fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
              />
              <button type="submit" className="btn btn-primary" style={{ padding: '0.35rem 0.6rem' }}>
                <Search size={14} />
              </button>
            </form>
          </div>

          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {TYPES.map(t => (
              <button key={t.key}
                className={`btn ${filterType === t.key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilterType(t.key)}
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <RefreshCw className="animate-spin" size={24} style={{ animation: 'spin 1.5s linear infinite' }} />
            </div>
          ) : visits.length > 0 ? (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Time (GMT)</th>
                    <th>IP Address</th>
                    <th>Country</th>
                    <th>ISP / ASN</th>
                    <th>OS / Browser</th>
                    <th>Referrer</th>
                    <th>Source</th>
                    <th>Shield Action</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map(v => (
                    <tr key={v.id}>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {new Date(v.date).toLocaleString('en-GB', {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td>
                        <span className="visit-ip">{v.ip}</span>
                        {v.hostname && v.hostname !== 'N/A' && v.hostname !== v.ip && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {v.hostname}
                          </div>
                        )}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}>
                          <Globe size={14} style={{ color: 'var(--text-muted)' }} />
                          {v.country}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {v.isp}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Smartphone size={14} style={{ color: 'var(--text-muted)' }} />
                          <span>{v.os}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          <Chrome size={12} style={{ color: 'var(--text-muted)' }} />
                          <span>{v.browser}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.referee || 'Direct'}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.source ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Tag size={12} style={{ color: 'var(--text-muted)' }} />
                            {v.source}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge-status ${v.isbot === 1 ? 'human' : 'bot'}`}>
                          {v.isbot === 1 ? 'Allowed' : 'Blocked (bot)'}
                        </span>
                        {v.isbot === 0 && v.blockreason && (
                          <div style={{ fontSize: '0.70rem', color: '#f2f2fc', marginTop: '0.20rem', maxWidth: '130px', lineHeight: 1.2 }}>
                            {v.blockreason}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {v.is_banned ? (
                          <button className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-success)', borderColor: 'rgba(16, 185, 129, 0.2)' }}
                            onClick={() => handleUnbanIP(v.ip)}
                          >
                            <ShieldCheck size={12} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                            Unban IP
                          </button>
                        ) : (
                          <button className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-accent)', borderColor: 'rgba(244, 63, 94, 0.2)' }}
                            onClick={() => handleBanIP(v.ip)}
                          >
                            <Ban size={12} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                            Ban IP
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Showing {visits.length} of {totalVisits} visits
                </span>
                {hasMore && (
                  <button className="btn btn-secondary" onClick={() => fetchHistory(visits.length, true)}
                    disabled={loadingMore}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                  >
                    {loadingMore ? 'Loading...' : 'Load More'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No visits found for this period.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};