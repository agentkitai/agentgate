import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

export type Role = 'viewer' | 'editor' | 'admin' | 'owner';

export interface UserInfo {
  id: string;
  displayName: string;
  email: string | null;
  role: Role;
  type: 'oidc' | 'api-key';
  tenantId: string;
  permissions: string[];
}

export type AuthMode = 'api-key-only' | 'sso' | 'dual';

interface AuthContextType {
  /** Current user (null if not authenticated) */
  user: UserInfo | null;
  /** Whether the user is authenticated (SSO or API key) */
  isAuthenticated: boolean;
  /** Detected auth mode from server */
  authMode: AuthMode;
  /** Loading state during initial auth check */
  loading: boolean;
  /** Login with API key (fallback) */
  loginWithApiKey: (key: string) => Promise<void>;
  /** Initiate SSO login */
  loginWithSSO: () => Promise<void>;
  /** Logout */
  logout: () => Promise<void>;
  /** Check if user has a specific permission */
  hasPermission: (permission: string) => boolean;
  /** Check if user has one of these roles */
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_KEY_STORAGE = 'agentgate_api_key';
const REFRESH_TOKEN_STORAGE = 'agentgate_refresh_token';
const baseUrl = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Detect auth mode from the server config endpoint.
 * Falls back to 'api-key-only' if the endpoint doesn't exist.
 */
async function detectAuthMode(): Promise<AuthMode> {
  try {
    const res = await fetch(`${baseUrl}/auth/mode`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      // Server returns { mode: 'api-key-only' | 'dual' | 'oidc-required' }
      if (data.mode === 'oidc-required' || data.mode === 'dual') return 'sso';
      if (data.mode === 'dual') return 'dual';
    }
  } catch {
    // Server might not have this endpoint yet — fall back
  }
  return 'api-key-only';
}

/** Fetch current user from /auth/me */
async function fetchMe(apiKey?: string | null): Promise<UserInfo | null> {
  try {
    const headers: HeadersInit = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl}/auth/me`, {
      headers,
      credentials: 'include',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('api-key-only');
  const [loading, setLoading] = useState(true);

  // On mount: detect auth mode, try to restore session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Pick up refresh token from cookie (set by server after OIDC callback redirect)
      const refreshCookie = document.cookie
        .split('; ')
        .find(c => c.startsWith('agentgate_refresh='));
      if (refreshCookie) {
        const token = refreshCookie.split('=')[1];
        if (token) {
          localStorage.setItem(REFRESH_TOKEN_STORAGE, token);
          // Clear the cookie
          document.cookie = 'agentgate_refresh=; Max-Age=0; Path=/';
        }
      }

      const mode = await detectAuthMode();
      if (cancelled) return;
      setAuthMode(mode);

      // Try SSO session cookie first
      let me = await fetchMe();

      // Fall back to stored API key
      if (!me) {
        const storedKey = localStorage.getItem(API_KEY_STORAGE);
        if (storedKey) {
          me = await fetchMe(storedKey);
          if (!me) {
            // Stale key
            localStorage.removeItem(API_KEY_STORAGE);
          }
        }
      }

      if (!cancelled) {
        setUser(me);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loginWithApiKey = useCallback(async (key: string) => {
    const me = await fetchMe(key);
    if (!me) throw new Error('Invalid API key or server not reachable');
    localStorage.setItem(API_KEY_STORAGE, key);
    setUser(me);
  }, []);

  const loginWithSSO = useCallback(async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to initiate SSO login');
    const { url } = await res.json();
    // Redirect to IdP
    window.location.href = url;
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE);
    try {
      await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refreshToken: refreshToken || undefined }),
      });
    } catch {
      // Best effort
    }
    localStorage.removeItem(API_KEY_STORAGE);
    localStorage.removeItem(REFRESH_TOKEN_STORAGE);
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!user) return false;
      return user.permissions.includes('*') || user.permissions.includes(permission);
    },
    [user],
  );

  const hasRole = useCallback(
    (...roles: Role[]) => {
      if (!user) return false;
      return roles.includes(user.role);
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        authMode,
        loading,
        loginWithApiKey,
        loginWithSSO,
        logout,
        hasPermission,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
