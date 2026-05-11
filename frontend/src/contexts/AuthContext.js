import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

// In Docker, nginx proxies /api to backend, so we use relative URL
// In development with separate ports, use REACT_APP_BACKEND_URL
const API_URL = process.env.REACT_APP_BACKEND_URL 
  ? process.env.REACT_APP_BACKEND_URL + '/api'
  : '/api';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(() => localStorage.getItem('finflow_token'));
  const isLoggingOut = useRef(false);

  // Create axios instance with credentials (httpOnly cookie sent automatically)
  const api = axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
    },
    withCredentials: true,
  });

  // Add auth header as fallback (backward compatibility)
  api.interceptors.request.use((config) => {
    const currentToken = localStorage.getItem('finflow_token');
    if (currentToken) {
      config.headers.Authorization = `Bearer ${currentToken}`;
    }
    return config;
  });

  // Handle 401 errors — but NOT for auth endpoints to avoid loops
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      const url = error.config?.url || '';
      const isAuthEndpoint = url.includes('/auth/me') || url.includes('/auth/logout');
      if (error.response?.status === 401 && !isAuthEndpoint && !isLoggingOut.current) {
        clearSession();
      }
      return Promise.reject(error);
    }
  );

  // Clear session state without calling API
  const clearSession = useCallback(() => {
    localStorage.removeItem('finflow_token');
    setToken(null);
    setUser(null);
    setPermissions({});
    setModules([]);
  }, []);

  const fetchUser = useCallback(async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data.user);
      setPermissions(response.data.permissions);
      setModules(response.data.modules);
      return response.data;
    } catch (error) {
      clearSession();
      return null;
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      if (token) {
        await fetchUser();
      }
      setLoading(false);
    };
    initAuth();
  }, [token, fetchUser]);

  // Login with email + password
  const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    const data = response.data;
    
    if (data.token) {
      localStorage.setItem('finflow_token', data.token);
      setToken(data.token);
      setUser(data.user);
      await fetchUser();
    }
    
    return data;
  };

  // Step 2: Verify OTP to complete login
  const verifyOTP = async (email, otp) => {
    const response = await api.post('/auth/verify-otp', { email, otp });
    const { token: newToken, user: userData } = response.data;
    
    localStorage.setItem('finflow_token', newToken);
    setToken(newToken);
    setUser(userData);
    await fetchUser();
    
    return response.data;
  };

  // Change password
  const changePassword = async (currentPassword, newPassword) => {
    const response = await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    return response.data;
  };

  const logout = async () => {
    if (isLoggingOut.current) return;
    isLoggingOut.current = true;
    try {
      await api.post('/auth/logout');
    } catch (error) {
      // Ignore logout errors
    }
    clearSession();
    isLoggingOut.current = false;
  };

  const hasPermission = (moduleName) => {
    if (!user) return false;
    if (user.role_name === 'SuperAdmin') return true;
    return permissions[moduleName] === true;
  };

  const value = {
    user,
    permissions,
    modules,
    loading,
    isAuthenticated: !!user,
    login,
    verifyOTP,
    changePassword,
    logout,
    hasPermission,
    api,
    fetchUser,
    token,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
