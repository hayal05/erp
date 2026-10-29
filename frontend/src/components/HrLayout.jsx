import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Building2, CalendarCheck, CalendarDays, LayoutDashboard, LogOut, Menu, QrCode, Settings, Users, Wallet } from 'lucide-react';
import { useAuth } from '../api/auth.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { HR_NAV, QR_PATH, ROLE_LABEL, formatClock, initials, layoutMode } from './hrNav.js';

const ICONS = { dashboard: LayoutDashboard, employees: Users, departments: Building2, attendance: CalendarCheck, qr: QrCode, leave: CalendarDays, payroll: Wallet, settings: Settings };

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000); // display only; no API calls
    return () => clearInterval(t);
  }, []);
  return now;
}

// Shell for every /hr page: top bar + sidebar + <Outlet/>. Mounted inside RequireRole('hr') in App.jsx, which
// sends employees to their portal. Role checks here are a convenience; the server enforces them (task 1.9).
export default function HrLayout() {
  const { user, locked, logout } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const now = useClock();

  useEffect(() => { setMenuOpen(false); }, [pathname]); // close the phone drawer after navigating
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Locked tablet (§6.1): no sidebar, no admin controls, QR page only. Survives refresh because the lock
  // comes from the server session (/auth/me), not from component state.
  const mode = layoutMode(locked, pathname);
  if (mode === 'redirect') return <Navigate to={QR_PATH} replace />;
  if (mode === 'locked') return <div className="locked-shell"><Outlet /></div>;

  return (
    <div className="hr-shell">
      <a className="skip-link" href="#main">Skip to content</a>

      <header className="topbar">
        <button type="button" className="icon-btn menu-btn" aria-label="Open menu" aria-expanded={menuOpen}
          aria-controls="hr-nav" onClick={() => setMenuOpen((o) => !o)}><Menu size={20} /></button>
        <span className="brand">Natra</span>
        <span className="spacer" />
        <time className="clock muted" dateTime={now.toISOString()}>{formatClock(now)}</time>
        <ThemeToggle />
        <div className="user-chip">
          <span className="avatar" aria-hidden="true">{initials(user.fullName)}</span>
          <span className="user-text"><strong>{user.fullName}</strong><small className="muted">{ROLE_LABEL[user.role]}</small></span>
        </div>
      </header>

      <aside id="hr-nav" className={`sidebar${menuOpen ? ' open' : ''}`}>
        <nav aria-label="Main">
          {HR_NAV.map((item) => {
            const Icon = ICONS[item.key];
            return (
              <NavLink key={item.key} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Icon size={18} aria-hidden="true" /><span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <button type="button" className="nav-item logout" onClick={logout}><LogOut size={18} aria-hidden="true" /><span>Log out</span></button>
      </aside>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <main id="main" className="content" tabIndex={-1}><Outlet /></main>
    </div>
  );
}
