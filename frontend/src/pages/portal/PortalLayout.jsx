import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { CalendarCheck, CalendarDays, FileText, Home, LogOut, UserRound, ChevronDown } from 'lucide-react';
import { useAuth } from '../../api/auth.jsx';
import WorkspaceSwitcher from '../../components/WorkspaceSwitcher.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';
import { AnnouncementFeed } from '../Announcements.jsx';
import { PORTAL_NAV, firstName } from './portalNav.js';

const ICONS = { profile: UserRound, home: Home, attendance: CalendarCheck, leave: CalendarDays, payslips: FileText };

// Mobile-first shell for employees: compact top bar, content, bottom tab bar (thumb reach).
// Mounted inside RequireRole('employee'); the server enforces access on every request.
export default function PortalLayout() {
  const { user, logout } = useAuth();
  const account = useRef(null);
  useEffect(() => {
    const closeOutside = (event) => {
      if (account.current && !account.current.contains(event.target)) account.current.open = false;
    };
    const escape = (event) => {
      if (event.key === 'Escape' && account.current?.open) {
        account.current.open = false;
        account.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  return (
    <div className="portal-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="portal-top">
        <span className="brand">Natra</span>
        <span className="spacer" />
        <ThemeToggle />
        <details className="portal-account" ref={account}>
          <summary title={user.fullName}><span>{user.fullName}</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="portal-account-options">
            <WorkspaceSwitcher />
            <Link className="btn" to="/portal/change-password" onClick={() => { account.current.open = false; }}>Change password</Link>
            <button type="button" onClick={() => { account.current.open = false; logout(); }}><LogOut size={18} aria-hidden="true" /> Log out</button>
          </div>
        </details>
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
      <AnnouncementFeed />
      <div className="card stack">
        <strong>Check in or out</strong>
        <p className="muted">Scan the office QR code, then take a selfie.</p>
      </div>
    </section>
  );
}
