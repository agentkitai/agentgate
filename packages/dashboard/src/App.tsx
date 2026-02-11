import { useState, lazy, Suspense } from 'react';
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary';
import {
  HomeSkeleton,
  RequestListSkeleton,
  AuditLogSkeleton,
  ApiKeysSkeleton,
  WebhooksSkeleton,
  SkeletonBox,
} from './components/Skeleton';

const Home = lazy(() => import('./pages/Home'));
const RequestList = lazy(() => import('./pages/RequestList'));
const RequestDetail = lazy(() => import('./pages/RequestDetail'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));
const Webhooks = lazy(() => import('./pages/Webhooks'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Login = lazy(() => import('./pages/Login'));

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}

// Navigation link component
function NavLink({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  const location = useLocation();
  const isActive = location.pathname === to || 
    (to !== '/' && location.pathname.startsWith(to));

  return (
    <Link
      to={to}
      onClick={onClick}
      className={`block py-2 px-3 rounded-lg transition-colors ${
        isActive
          ? 'bg-blue-50 text-blue-600 font-medium'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
      }`}
    >
      {children}
    </Link>
  );
}

function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isAuthenticated, logout } = useAuth();
  const location = useLocation();

  // Don't show header on login page
  const isLoginPage = location.pathname === '/login';

  const closeMobileMenu = () => setMobileMenuOpen(false);

  if (isLoginPage) {
    return (
      <ChunkErrorBoundary>
        <Suspense fallback={<div className="flex items-center justify-center h-screen"><SkeletonBox className="h-8 w-8" /></div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </ChunkErrorBoundary>
    );
  }

  return (
    <ToastProvider>
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">AG</span>
              </div>
              <span className="font-semibold text-lg text-gray-900 hidden sm:block">AgentGate</span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              <NavLink to="/">Dashboard</NavLink>
              <NavLink to="/requests">Requests</NavLink>
              <NavLink to="/audit">Audit Log</NavLink>
              <NavLink to="/settings/api-keys">API Keys</NavLink>
              <NavLink to="/settings/webhooks">Webhooks</NavLink>
            </nav>

            {/* Desktop Logout */}
            {isAuthenticated && (
              <button
                onClick={logout}
                className="hidden md:block text-gray-500 hover:text-gray-700 text-sm font-medium transition-colors"
              >
                Logout
              </button>
            )}

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                // X icon
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                // Hamburger icon
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white">
            <nav className="px-4 py-3 space-y-1">
              <NavLink to="/" onClick={closeMobileMenu}>Dashboard</NavLink>
              <NavLink to="/requests" onClick={closeMobileMenu}>Requests</NavLink>
              <NavLink to="/audit" onClick={closeMobileMenu}>Audit Log</NavLink>
              <NavLink to="/settings/api-keys" onClick={closeMobileMenu}>API Keys</NavLink>
              <NavLink to="/settings/webhooks" onClick={closeMobileMenu}>Webhooks</NavLink>
              {isAuthenticated && (
                <button
                  onClick={() => {
                    closeMobileMenu();
                    logout();
                  }}
                  className="w-full text-left py-2 px-3 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Logout
                </button>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Mobile menu backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-10 md:hidden"
          onClick={closeMobileMenu}
        />
      )}

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <ChunkErrorBoundary>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Suspense fallback={<HomeSkeleton />}>
                  <Home />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/requests"
            element={
              <ProtectedRoute>
                <Suspense fallback={<RequestListSkeleton />}>
                  <RequestList />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/requests/:id"
            element={
              <ProtectedRoute>
                <Suspense fallback={<div className="space-y-6"><SkeletonBox className="h-6 w-32" /><div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4"><SkeletonBox className="h-7 w-64" /><SkeletonBox className="h-4 w-48" /></div></div>}>
                  <RequestDetail />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <ProtectedRoute>
                <Suspense fallback={<AuditLogSkeleton />}>
                  <AuditLog />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/api-keys"
            element={
              <ProtectedRoute>
                <Suspense fallback={<ApiKeysSkeleton />}>
                  <ApiKeys />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/webhooks"
            element={
              <ProtectedRoute>
                <Suspense fallback={<WebhooksSkeleton />}>
                  <Webhooks />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<Suspense fallback={null}><Login /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ChunkErrorBoundary>
      </main>
    </div>
    </ToastProvider>
  );
}

export default App;
