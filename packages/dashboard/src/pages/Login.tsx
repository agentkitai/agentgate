import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const { loginWithApiKey, loginWithSSO, authMode, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const from = (location.state as { from?: string })?.from || '/';

  // Handle OIDC callback — if we land on /login after callback, the cookie is already set
  // The AuthProvider will pick it up on mount. Also handle error from callback.
  useEffect(() => {
    const callbackError = searchParams.get('error');
    if (callbackError) {
      setError(`SSO login failed: ${callbackError}`);
    }
  }, [searchParams]);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, from]);

  const handleApiKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await loginWithApiKey(apiKey.trim());
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate API key');
      setLoading(false);
    }
  };

  const handleSSOLogin = async () => {
    setSsoLoading(true);
    setError(null);
    try {
      await loginWithSSO();
      // loginWithSSO redirects to IdP — we won't reach here
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate SSO login');
      setSsoLoading(false);
    }
  };

  const showSSO = authMode === 'sso' || authMode === 'dual';
  const showApiKey = authMode === 'api-key-only' || authMode === 'dual';

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">AG</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">AgentGate Dashboard</h1>
          <p className="text-gray-500 mt-2">
            {showSSO ? 'Sign in to continue' : 'Enter your API key to continue'}
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm space-y-4">
          {/* SSO Button */}
          {showSSO && (
            <>
              <button
                onClick={handleSSOLogin}
                disabled={ssoLoading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg px-4 py-2.5 font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {ssoLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Sign in with SSO
                  </>
                )}
              </button>

              {showApiKey && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="bg-white px-3 text-gray-500">or use API key</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* API Key Form */}
          {showApiKey && (
            <form onSubmit={handleApiKeySubmit} className="space-y-4">
              <div>
                <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  id="apiKey"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                  placeholder="agk_..."
                  autoFocus={!showSSO}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className={`w-full rounded-lg px-4 py-2.5 font-medium focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                  showSSO
                    ? 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 focus:ring-gray-400'
                    : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
                }`}
              >
                {loading ? 'Validating...' : 'Sign In with API Key'}
              </button>
            </form>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Help text */}
        <p className="text-center text-gray-500 text-sm mt-6">
          {showSSO
            ? 'Use your organization SSO credentials to sign in.'
            : 'Need an API key? Create one using the CLI or ask your administrator.'}
        </p>
      </div>
    </div>
  );
}
