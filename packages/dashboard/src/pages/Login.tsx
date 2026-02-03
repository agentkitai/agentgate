import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Login() {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Get the intended destination from state, or default to home
  const from = (location.state as { from?: string })?.from || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Store the key temporarily to test it
      localStorage.setItem('agentgate_api_key', apiKey.trim());
      
      // Validate the key by making a test request
      const isValid = await api.validateKey();
      
      if (!isValid) {
        localStorage.removeItem('agentgate_api_key');
        setError('Invalid API key or server not reachable');
        setLoading(false);
        return;
      }

      // Key is valid, complete login
      login(apiKey.trim());
      navigate(from, { replace: true });
    } catch (err) {
      localStorage.removeItem('agentgate_api_key');
      setError(err instanceof Error ? err.message : 'Failed to validate API key');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">AG</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">AgentGate Dashboard</h1>
          <p className="text-gray-500 mt-2">Enter your API key to continue</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
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
                placeholder="ag_..."
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Validating...' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Help text */}
        <p className="text-center text-gray-500 text-sm mt-6">
          Need an API key? Create one using the CLI or ask your administrator.
        </p>
      </div>
    </div>
  );
}
