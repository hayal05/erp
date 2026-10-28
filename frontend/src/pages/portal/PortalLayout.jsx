import { NavLink, Outlet } from 'react-router-dom';
import { CalendarCheck, CalendarDays, FileText, Home, LogOut } from 'lucide-react';
import { useAuth } from '../../api/auth.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';
import { PORTAL_NAV, firstName } from './portalNav.js';

const ICONS = { home: Home, attendance: CalendarCheck, leave: CalendarDays, payslips: FileText };

// Mobile-first shell for employees: compact top bar, content, bottom tab bar (thumb reach).
// Mounted inside RequireRole('employee'); the server enforces access on every request.
export default function PortalLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="portal-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="portal-top">
        <span className="brand">Natra</span>
        <span className="spacer" />
        <ThemeToggle />
        <button type="button" className="icon-btn" onClick={logout} aria-label={`Log out ${user.fullName}`}><LogOut size={20} aria-hidden="true" /></button>
      </header>
      <main id="main" className="portal-content" tabIndex={-1}><Outlet /></main>
      <nav className="portal-tabs" aria-label="Main">
        {PORTAL_NAV.map((item) => {
          const Icon = ICONS[item.key];
          return (
            <NavLink key={item.key} to={item.to} end={item.end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
              <Icon size={22} aria-hidden="true" /><span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

export function PortalHome() {
  const { user } = useAuth();
  return (
    <section className="stack">
      <h1>Hello, {firstName(user.fullName)}</h1>
      <div className="card stack">
        <strong>Check in or out</strong>
        <p className="muted">Scan the QR code on the office tablet with your phone camera. You will be asked to take a selfie.</p>
      </div>
    </section>
  );
}
