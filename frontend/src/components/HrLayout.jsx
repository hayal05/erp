import {PageRefreshProvider} from '../api/pageRefresh.jsx';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Briefcase, ShieldCheck, Landmark, Megaphone, Building2, CalendarCheck, CalendarDays, LayoutDashboard, LogOut, Menu, QrCode, Settings, Users, Wallet } from 'lucide-react';
import AuditBottomBar from './AuditBottomBar.jsx';
import {auditScope} from '../api/auditScope.js';
import ApprovalNotice from './ApprovalNotice.jsx';
import WorkspaceSwitcher from './WorkspaceSwitcher.jsx';
import {canOpenPath,workspacePath,workspaceArea,isAdmin} from '../api/workspaces.js';
import { useAuth } from '../api/auth.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { HR_NAV, QR_PATH, ROLE_LABEL, formatClock, initials, layoutMode } from './hrNav.js';

const ICONS = { vacancies: Briefcase, approvals: ShieldCheck, access: ShieldCheck, settlements: Landmark, announcements: Megaphone, dashboard: LayoutDashboard, employees: Users, departments: Building2, attendance: CalendarCheck, qr: QrCode, leave: CalendarDays, payroll: Wallet, settings: Settings };

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
  const mainRef = useRef(null);
  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [pathname]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sectionVisit, setSectionVisit] = useState(0);
  const visitSection = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setSectionVisit(n => n + 1); // Refresh even when the active sidebar section is clicked again.
    setMenuOpen(false);
  };
  const now = useClock();
  const audit = auditScope(pathname,user);

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
    <PageRefreshProvider version={sectionVisit}><div className={`hr-shell${audit ? ' has-audit-footer' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>

      <header className="topbar">
        <button type="button" className="icon-btn menu-btn" aria-label="Open menu" aria-expanded={menuOpen}
          aria-controls="hr-nav" onClick={() => setMenuOpen((o) => !o)}><Menu size={20} /></button>
        <span className="brand">Natra</span>
        <span className="spacer" />
        <time className="clock muted" dateTime={now.toISOString()}>{formatClock(now)}</time>
        <ThemeToggle />
        <WorkspaceSwitcher />
        <div className="user-chip" title={user.fullName}>
          <span className="avatar" aria-hidden="true">{initials(user.fullName)}</span>
          <span className="user-text"><strong>{user.fullName}</strong><small className="muted">{workspaceArea(pathname)==='finance'?'Finance':isAdmin(user)?'Admin':'HR'}</small></span>
        </div>
      </header>

      <aside id="hr-nav" className={`sidebar${menuOpen ? ' open' : ''}`}>
        <nav aria-label="Main">
          {HR_NAV.filter(item => canOpenPath(user,workspacePath(item.to,pathname))).map((item) => {
            const Icon = ICONS[item.key];
            return (
              <NavLink key={item.key} to={workspacePath(item.to,pathname)} end={item.end} onClick={visitSection} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Icon size={18} aria-hidden="true" /><span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <button type="button" className="nav-item logout" onClick={logout}><LogOut size={18} aria-hidden="true" /><span>Log out</span></button>
      </aside>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <main ref={mainRef} id="main" className="content" tabIndex={-1}><ApprovalNotice /><Outlet /></main>
      {audit && <AuditBottomBar key={pathname} scope={audit} />}
    </div></PageRefreshProvider>
  );
}
