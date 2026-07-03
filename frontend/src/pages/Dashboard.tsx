import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  ShieldAlert, Users, Eye, Percent, Globe, RefreshCw, Plus, 
  Trash2, Ban, CheckCircle, ShieldCheck, ArrowRightLeft, Chrome, Smartphone,
  Calendar, Database, Tag
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

interface Stats {
  totalBadIps: number;
  visitsToday: number;
  botsToday: number;
  humansToday: number;
  uniqueIps: number;
  visits24h: number;
  botRateToday: number;
  topCountry: string;
  totalVisits: number;
  totalBots: number;
  totalHumans: number;
  totalUniqueIps: number;
  visits7days: number;
  bots7days: number;
  humans7days: number;
  botRate7days: number;
}

interface Visit {
  id: number;
  ip: string;
  country: string;
  hostname: string;
  isp: string;
  os: string;
  browser: string;
  referee: string;
  date: string;
  isbot: number;
  is_banned: boolean;
  source: string;
  blockreason: string;
}

interface ChartItem {
  day: string;
  humans: number;
  bots: number;
  total: number;
}

interface PieData {
  browsers: { name: string; value: number }[];
  systems: { name: string; value: number }[];
  countries: { name: string; value: number }[];
}

export const Dashboard: React.FC = () => {
  const { token } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [chartData, setChartData] = useState<ChartItem[]>([]);
  const [pieData, setPieData] = useState<PieData | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreVisits, setHasMoreVisits] = useState(false);
  const [totalVisits, setTotalVisits] = useState(0);

  const API_BASE_URL = 'http://localhost:5005/api';
  const VISITS_PAGE_SIZE = 100;

  const fetchVisits = useCallback(async (offset: number, append: boolean) => {
    if (!token) return;
    if (append) setLoadingMore(true);

    try {
      const visitsRes = await fetch(`${API_BASE_URL}/dashboard/recent-visits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ limit: VISITS_PAGE_SIZE, offset }),
      });
      const visitsJson = await visitsRes.json();

      if (visitsJson.status === 'success') {
        if (append) {
          setVisits(prev => [...prev, ...visitsJson.data]);
        } else {
          setVisits(visitsJson.data);
        }
        setHasMoreVisits(visitsJson.hasMore);
        setTotalVisits(visitsJson.total);
      }
    } catch (err) {
      console.error('Error fetching visits:', err);
    } finally {
      if (append) setLoadingMore(false);
    }
  }, [token]);

  const fetchDashboardData = useCallback(async (isSilent = false) => {
    if (!token) return;
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const [statsRes, chartRes, pieRes] = await Promise.all([
        fetch(`${API_BASE_URL}/dashboard/stats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE_URL}/dashboard/visits-chart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE_URL}/dashboard/pie-charts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        }),
      ]);

      const [statsJson, chartJson, pieJson] = await Promise.all([
        statsRes.json(), chartRes.json(), pieRes.json(),
      ]);

      if (statsJson.status === 'success') setStats(statsJson.data);
      if (chartJson.status === 'success') setChartData(chartJson.data);
      if (pieJson.status === 'success') setPieData(pieJson.data);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  const loadMoreVisits = () => {
    fetchVisits(visits.length, true);
  };

  const handleClearVisits = async () => {
    if (!token) return;
    if (!window.confirm('Are you sure you want to clear all visits? This cannot be undone.')) return;

    try {
      const res = await fetch(`${API_BASE_URL}/dashboard/clear-visits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (data.status === 'success') {
        setVisits([]);
        setTotalVisits(0);
        setHasMoreVisits(false);
      }
    } catch (err) {
      console.error('Error clearing visits:', err);
    }
  };

  // Set up auto-refresh every 6 seconds for visits and charts, and 60 seconds for KPIs
  useEffect(() => {
    fetchDashboardData();
    fetchVisits(0, false);

    const intervalId = setInterval(() => {
      fetchDashboardData(true);
      fetchVisits(0, false);
    }, 6000);

    return () => clearInterval(intervalId);
  }, [fetchDashboardData, fetchVisits]);

  // Ban an IP
  const handleBanIP = async (ip: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/settings/ip-rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: 'ip', value: ip }),
      });

      if (res.ok) {
        fetchVisits(0, false);
      }
    } catch (err) {
      console.error('Error banning IP:', err);
    }
  };

  // Whitelist/Unban an IP
  const handleWhitelistIP = async (ip: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/settings/ip-rules/ip/by-value/${encodeURIComponent(ip)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        fetchVisits(0, false);
      }
    } catch (err) {
      console.error('Error whitelisting IP:', err);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <RefreshCw className="animate-spin" size={40} style={{ color: 'var(--color-primary)', animation: 'spin 1.5s linear infinite' }} />
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // Chart configuration
  const barChartData = {
    labels: chartData.map(c => c.day),
    datasets: [
      {
        label: 'Allowed (Human)',
        data: chartData.map(c => c.humans),
        backgroundColor: '#10b981', // Emerald
        borderRadius: 6,
      },
      {
        label: 'Blocked (Bot)',
        data: chartData.map(c => c.bots),
        backgroundColor: '#ef4444', // Red
        borderRadius: 6,
      }
    ]
  };

  const barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: '#9ca3af',
          font: { family: 'Outfit' }
        }
      },
      tooltip: {
        titleFont: { family: 'Outfit' },
        bodyFont: { family: 'Outfit' }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
      }
    }
  };

  const getDoughnutData = (items: { name: string; value: number }[] | undefined, label: string, color: string) => {
    if (!items || items.length === 0) {
      return {
        labels: ['No Data'],
        datasets: [{
          data: [1],
          backgroundColor: ['rgba(255, 255, 255, 0.05)'],
          borderWidth: 0
        }]
      };
    }
    return {
      labels: items.map(i => i.name),
      datasets: [
        {
          label: label,
          data: items.map(i => i.value),
          backgroundColor: [
            '#8b5cf6', // Violet
            '#06b6d4', // Cyan
            '#f43f5e', // Rose
            '#10b981', // Emerald
            '#f59e0b', // Amber
          ],
          borderWidth: 1,
          borderColor: 'rgba(0,0,0,0.1)'
        }
      ]
    };
  };

  const pieChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false // Display legend in a custom list below/next to chart
      }
    },
    cutout: '70%'
  };

  return (
    <div>
      {/* KPI Stats Grid */}
      {stats && (
        <section className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-icon">
              <Eye size={20} />
            </div>
            <div className="kpi-info">
              <h3>Visits Today</h3>
              <div className="kpi-value">{stats.visitsToday}</div>
            </div>
          </div>

          <div className="kpi-card bot">
            <div className="kpi-icon">
              <ShieldAlert size={20} />
            </div>
            <div className="kpi-info">
              <h3>Bots Blocked Today</h3>
              <div className="kpi-value">{stats.botsToday}</div>
            </div>
          </div>

          <div className="kpi-card success">
            <div className="kpi-icon">
              <Users size={20} />
            </div>
            <div className="kpi-info">
              <h3>Unique IPs Today</h3>
              <div className="kpi-value">{stats.uniqueIps}</div>
            </div>
          </div>

          <div className="kpi-card success">
            <div className="kpi-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
              <CheckCircle size={20} />
            </div>
            <div className="kpi-info">
              <h3>Allowed Today</h3>
              <div className="kpi-value">{stats.humansToday}</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon" style={{ background: 'rgba(6, 182, 212, 0.1)', color: 'var(--color-secondary)' }}>
              <Eye size={20} />
            </div>
            <div className="kpi-info">
              <h3>Visits (24h)</h3>
              <div className="kpi-value">{stats.visits24h}</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
              <Calendar size={20} />
            </div>
            <div className="kpi-info">
              <h3>Last 7 Days</h3>
              <div className="kpi-value">{stats.visits7days}</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
              <Database size={20} />
            </div>
            <div className="kpi-info">
              <h3>Total All-Time</h3>
              <div className="kpi-value">{stats.totalVisits}</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon" style={{ background: 'rgba(6, 182, 212, 0.1)', color: 'var(--color-secondary)' }}>
              <Percent size={20} />
            </div>
            <div className="kpi-info">
              <h3>Bot Rate Today</h3>
              <div className="kpi-value">{stats.botRateToday}%</div>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon" style={{ background: 'rgba(13, 148, 136, 0.1)', color: '#2dd4bf' }}>
              <Globe size={20} />
            </div>
            <div className="kpi-info">
              <h3>Top Country</h3>
              <div className="kpi-value" style={{ fontSize: '1.75rem' }}>{stats.topCountry}</div>
            </div>
          </div>

          <div className="kpi-card" style={{ cursor: 'pointer' }} onClick={() => fetchDashboardData(true)}>
            <div className="kpi-icon" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)' }}>
              <RefreshCw className={refreshing ? 'animate-spin' : ''} size={20} style={{ animation: refreshing ? 'spin 1s linear infinite' : '' }} />
            </div>
            <div className="kpi-info">
              <h3>Blacklisted IPs</h3>
              <div className="kpi-value">{stats.totalBadIps}</div>
            </div>
          </div>
        </section>
      )}

      {/* Charts Grid */}
      <section className="charts-grid">
        <div className="chart-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2>Visits Activity (Last 5 Days)</h2>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10b981' }}></span> Humans
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#ef4444' }}></span> Bots
              </span>
            </div>
          </div>
          <div className="chart-container">
            {chartData.length > 0 ? (
              <Bar data={barChartData} options={barChartOptions} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>No visit activity logged yet</div>
            )}
          </div>
        </div>

        <div className="chart-card">
          <h2>OS Breakdown</h2>
          <div className="chart-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {pieData && pieData.systems && pieData.systems.length > 0 ? (
              <>
                <div style={{ height: '140px', width: '140px', position: 'relative' }}>
                  <Doughnut data={getDoughnutData(pieData.systems, 'Visits', '#8b5cf6')} options={pieChartOptions} />
                </div>
                <div style={{ width: '100%', marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {pieData.systems.map((item, idx) => (
                    <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: ['#8b5cf6', '#06b6d4', '#f43f5e', '#10b981', '#f59e0b'][idx] }}></span>
                        {item.name}
                      </span>
                      <span style={{ fontWeight: 600 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>No OS data available</div>
            )}
          </div>
        </div>
      </section>

      {/* Recent Visits Table */}
      <section className="table-card">
        <div className="table-header">
          <h2>Recent Visitor Log (Real-time)</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--color-success)', display: 'inline-block' }}></span>
              Polling live updates
            </span>
            <button
              className="btn btn-secondary"
              onClick={handleClearVisits}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: 'var(--color-accent)', borderColor: 'rgba(244, 63, 94, 0.2)' }}
            >
              <Trash2 size={12} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
              Clear Visits
            </button>
          </div>
        </div>

        <div className="table-wrapper">
          {visits.length > 0 ? (
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
                  {visits.map((visit) => (
                    <tr key={visit.id}>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {new Date(visit.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td>
                        <span className="visit-ip">{visit.ip}</span>
                        {visit.hostname && visit.hostname !== 'N/A' && visit.hostname !== visit.ip && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {visit.hostname}
                          </div>
                        )}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}>
                          <Globe size={14} style={{ color: 'var(--text-muted)' }} />
                          {visit.country}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {visit.isp}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Smartphone size={14} style={{ color: 'var(--text-muted)' }} />
                          <span>{visit.os}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          <Chrome size={12} style={{ color: 'var(--text-muted)' }} />
                          <span>{visit.browser}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {visit.referee || 'Direct'}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {visit.source ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Tag size={12} style={{ color: 'var(--text-muted)' }} />
                            {visit.source}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge-status ${visit.isbot === 1 ? 'human' : 'bot'}`}>
                          {visit.isbot === 1 ? 'Allowed' : 'Blocked (bot)'}
                        </span>
                        {visit.isbot === 0 && visit.blockreason && (
                          <div style={{ fontSize: '0.70rem', color: '#f2f2fc', marginTop: '0.20rem', maxWidth: '130px', lineHeight: 1.2 }}>
                            {visit.blockreason}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {visit.is_banned ? (
                          <button 
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-success)', borderColor: 'rgba(16, 185, 129, 0.2)' }}
                            onClick={() => handleWhitelistIP(visit.ip)}
                          >
                            <ShieldCheck size={12} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                            Unban IP
                          </button>
                        ) : (
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-accent)', borderColor: 'rgba(244, 63, 94, 0.2)' }}
                            onClick={() => handleBanIP(visit.ip)}
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
                {hasMoreVisits && (
                  <button
                    className="btn btn-secondary"
                    onClick={loadMoreVisits}
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
              No visitors logged yet. Integrate the snippet on your site to begin shielding.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
