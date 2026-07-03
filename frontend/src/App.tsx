import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { General } from './pages/General';
import { CodeGenerator } from './pages/CodeGenerator';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { ShieldAlert, RefreshCw } from 'lucide-react';

const MainAppContent: React.FC = () => {
  const { user, loading, token } = useAuth();
  const [currentPage, setCurrentPage] = useState<'dashboard' | 'settings' | 'general' | 'code' | 'signin' | 'signup'>('signin');

  // Handle routing based on authentication status
  useEffect(() => {
    if (!loading) {
      if (token && user) {
        // If logged in, go to dashboard
        if (currentPage === 'signin' || currentPage === 'signup') {
          setCurrentPage('dashboard');
        }
      } else {
        // If not logged in, go to signin (unless they were explicitly on signup)
        if (currentPage !== 'signup') {
          setCurrentPage('signin');
        }
      }
    }
  }, [user, token, loading]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem' }}>
        <ShieldAlert size={48} style={{ color: 'var(--color-primary)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--text-secondary)', animation: 'spin 1.5s linear infinite' }} />
          <span style={{ color: 'var(--text-secondary)' }}>Securing connection...</span>
        </div>
      </div>
    );
  }

  // Auth pages (no sidebar or header)
  if (currentPage === 'signin') {
    return <SignIn setCurrentPage={(page) => setCurrentPage(page as any)} />;
  }

  if (currentPage === 'signup') {
    return <SignUp setCurrentPage={(page) => setCurrentPage(page as any)} />;
  }

  // Dashboard / App layout pages (requires sidebar + header)
  return (
    <div className="app-container">
      <div className="bg-gradient-glow"></div>
      
      <Sidebar currentPage={currentPage} setCurrentPage={(page) => setCurrentPage(page as any)} />
      
      <main className="main-content">
        <Header currentPage={currentPage} />
        
        <div className="page-content" style={{ marginTop: '1rem' }}>
          {currentPage === 'dashboard' && <Dashboard />}
          {currentPage === 'settings' && <Settings />}
          {currentPage === 'general' && <General />}
          {currentPage === 'code' && <CodeGenerator />}
        </div>
      </main>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
}

export default App;
