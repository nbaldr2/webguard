import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Copy, Check, FileCode, RefreshCw, Tag, Shield } from 'lucide-react';

interface Snippets {
  php: string;
  node: string;
}

export const CodeGenerator: React.FC = () => {
  const { token } = useAuth();
  const [snippets, setSnippets] = useState<Snippets | null>(null);
  const [activeTab, setActiveTab] = useState<'php' | 'node'>('php');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourceInput, setSourceInput] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [encryptedPHP, setEncryptedPHP] = useState<string | null>(null);
  const [encryptedCopied, setEncryptedCopied] = useState(false);

  const API_BASE_URL = '/api';

  const fetchSnippets = useCallback(async (source: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (source.trim()) params.set('source', source.trim());
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`${API_BASE_URL}/code/snippet${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.status === 'success') {
        setSnippets(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch snippets:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSnippets(sourceName);
  }, [fetchSnippets, sourceName]);

  const handleSourceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setSourceName(sourceInput.trim());
    }
  };

  const handleSourceBlur = () => {
    if (sourceInput.trim() !== sourceName) {
      setSourceName(sourceInput.trim());
    }
  };

  const handleCopy = () => {
    if (!snippets) return;
    const textToCopy = activeTab === 'php' ? snippets.php : snippets.node;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEncryptPHP = () => {
    if (!snippets?.php) return;
    const clean = snippets.php
      .replace(/^<\?php\s*/i, '')
      .replace(/\s*\?>\s*$/i, '')
      .trim();
    const encoded = btoa(clean);
    const wrapped = `<?php\n\n$payload = '${encoded}';\n\neval(base64_decode($payload));`;
    setEncryptedPHP(wrapped);
  };

  const handleCopyEncrypted = () => {
    if (!encryptedPHP) return;
    navigator.clipboard.writeText(encryptedPHP);
    setEncryptedCopied(true);
    setTimeout(() => setEncryptedCopied(false), 2000);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
        <RefreshCw className="animate-spin" size={30} style={{ color: 'var(--color-primary)', animation: 'spin 1.5s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      <section className="settings-card" style={{ marginBottom: '2rem' }}>
        <h2>WebGuard Integration Code</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Select your target platform and copy the integration snippet. Paste it at the very top of the pages you wish to protect from bots, scrapers, and crawlers.
        </p>

        {/* Source Identifier Input */}
        <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Tag size={14} />
              Source Identifier (optional)
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Give this snippet a name to identify where visits come from (e.g. "main-site", "landing-page", "checkout"). The source will appear in your visitor log.
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
              <input
                type="text"
                value={sourceInput}
                onChange={(e) => setSourceInput(e.target.value)}
                onKeyDown={handleSourceKeyDown}
                onBlur={handleSourceBlur}
                placeholder="e.g. main-site, landing-page, checkout"
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  outline: 'none',
                }}
              />
            </div>
          </label>
        </div>

        {/* Tab Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <button
            className="btn"
            style={{
              background: activeTab === 'php' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              borderColor: activeTab === 'php' ? 'var(--color-primary)' : 'var(--border-color)',
              color: activeTab === 'php' ? 'var(--text-primary)' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
            onClick={() => setActiveTab('php')}
          >
            <FileCode size={16} />
            PHP Snippet
          </button>
          <button
            className="btn"
            style={{
              background: activeTab === 'node' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              borderColor: activeTab === 'node' ? 'var(--color-primary)' : 'var(--border-color)',
              color: activeTab === 'node' ? 'var(--text-primary)' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
            onClick={() => setActiveTab('node')}
          >
            <FileCode size={16} />
            Node.js Middleware
          </button>
        </div>

        {/* Instructions */}
        <div style={{ marginBottom: '1.5rem' }}>
          {activeTab === 'php' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>PHP Instructions:</span>
              <p>1. Copy the code snippet below.</p>
              <p>2. Paste it at the <strong>very beginning</strong> of your PHP file (before any HTML, white space, or other PHP execution).</p>
              <p>3. If WebGuard detects a bot, it will return a 404 response and stop execution immediately.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Node.js Express Instructions:</span>
              <p>1. Copy the Express middleware code below.</p>
              <p>2. Drop the middleware definition into your project.</p>
              <p>3. Apply the middleware globally using <code>app.use(webguardAntibot)</code> or to individual routes.</p>
            </div>
          )}
        </div>

        {/* Snippet Block */}
        {snippets && (
          <>
            <div className="snippet-box">
              <button className="snippet-copy-btn" onClick={handleCopy} title="Copy to clipboard">
                {copied ? <Check size={16} style={{ color: 'var(--color-success)' }} /> : <Copy size={16} />}
              </button>
              <pre>
                <code>{activeTab === 'php' ? snippets.php : snippets.node}</code>
              </pre>
            </div>

            {/* Encrypt PHP Button */}
            {activeTab === 'php' && (
              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn"
                  onClick={handleEncryptPHP}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'rgba(245, 158, 11, 0.1)',
                    borderColor: 'rgba(245, 158, 11, 0.3)',
                    color: '#f59e0b',
                  }}
                >
                  <Shield size={16} />
                  Encrypt PHP Snippet
                </button>
              </div>
            )}

            {/* Encrypted Snippet Output */}
            {encryptedPHP && activeTab === 'php' && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Shield size={14} style={{ color: '#f59e0b' }} />
                    Encrypted Snippet (base64 encoded)
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Copy and paste this into your PHP file instead of the raw snippet
                  </span>
                </div>
                <div className="snippet-box" style={{ borderColor: 'rgba(245, 158, 11, 0.3)' }}>
                  <button className="snippet-copy-btn" onClick={handleCopyEncrypted} title="Copy to clipboard">
                    {encryptedCopied ? <Check size={16} style={{ color: 'var(--color-success)' }} /> : <Copy size={16} />}
                  </button>
                  <pre>
                    <code>{encryptedPHP}</code>
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};