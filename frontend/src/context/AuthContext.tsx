import React, { createContext, useContext, useState, useEffect } from 'react';

export interface User {
  id: number;
  uflow: string;
  tg_user: string;
  active: number; // 0 = inactive, 1 = active, 2 = banned/pending
  end_sub?: string;
  start_sub?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (uflow: string, password: string) => Promise<boolean>;
  register: (tgUser: string, password: string) => Promise<boolean>;
  logout: () => void;
  toggleActive: (newState: boolean) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE_URL = '/api';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('webguard_token'));
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = async (authToken: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          setUser(data.user);
        } else {
          logout();
        }
      } else {
        logout();
      }
    } catch (err) {
      console.error('Fetch me error:', err);
      logout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchUser(token);
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (uflow: string, password: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uflow, password }),
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        localStorage.setItem('webguard_token', data.token);
        setToken(data.token);
        setUser(data.user);
        return true;
      } else {
        setError(data.message || 'Login failed');
        return false;
      }
    } catch (err) {
      setError('Connection failed. Server might be offline.');
      return false;
    }
  };

  const register = async (tgUser: string, password: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_user: tgUser, password }),
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        localStorage.setItem('webguard_token', data.token);
        setToken(data.token);
        setUser(data.user);
        return true;
      } else {
        setError(data.message || 'Registration failed');
        return false;
      }
    } catch (err) {
      setError('Connection failed. Server might be offline.');
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem('webguard_token');
    setToken(null);
    setUser(null);
    setError(null);
  };

  const toggleActive = async (newState: boolean) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/settings/toggle-active`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ active: newState }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          setUser((prev) => (prev ? { ...prev, active: data.active ? 1 : 0 } : null));
        }
      }
    } catch (err) {
      console.error('Toggle active error:', err);
    }
  };

  const refreshUser = async () => {
    if (token) {
      await fetchUser(token);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        error,
        login,
        register,
        logout,
        toggleActive,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
