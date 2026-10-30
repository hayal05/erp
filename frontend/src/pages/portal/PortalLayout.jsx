import {VacancyUnreadProvider,useVacancyUnread} from '../../api/vacancyUnread.jsx';
import {PageRefreshProvider} from '../../api/pageRefresh.jsx';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Briefcase, CalendarCheck, CalendarDays, FileText, Home, LogOut, UserRound, ChevronDown } from 'lucide-react';
import { useAuth } from '../../api/auth.jsx';
import WorkspaceSwitcher from '../../components/WorkspaceSwitcher.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';
import { AnnouncementFeed } from '../Announcements.jsx';
import { PORTAL_NAV, firstName } from './portalNav.js';

const ICONS = { vacancies: Briefcase, profile: UserRound, home: Home, attendance: CalendarCheck, leave: CalendarDays, payslips: FileText };

// Employee shell: desktop sidebar, with bottom navigation on tablet and mobile widths.
// Mounted inside RequireRole('employee'); the server enforces access on every request.
export default function PortalLayout() {
  const { user, logout } = useAuth();
  const account = useRef(null), mainRef = useRef(null);
  const { pathname } = useLocation();
  useEffect(()=>{mainRef.current?.scrollTo(0,0);},[pathname]);
  const [sectionVisit, setSectionVisit] = useState(0);
  const visitSection = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setSectionVisit(n => n + 1);
  };
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
    <VacancyUnreadProvider key={user.id} pathname={pathname} visit={sectionVisit}><PageRefreshProvider version={sectionVisit}><div className="portal-shell">
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
      <nav className="portal-tabs" aria-label="Main">
        <PortalNavigation visitSection={visitSection} />
      </nav>
      <main ref={mainRef} id="main" className="portal-content" tabIndex={-1}><Outlet /></main>
    </div></PageRefreshProvider></VacancyUnreadProvider>
  );
}

function PortalNavigation({visitSection}){
 const {unreadCount}=useVacancyUnread();
 return PORTAL_NAV.map(item=>{
  const Icon=ICONS[item.key],count=item.key==='vacancies'?unreadCount:0;
  return <NavLink key={item.key} to={item.to} end={item.end} onClick={visitSection} className={({isActive})=>`tab${isActive?' active':''}`}
   aria-label={count>0?`${item.label}, ${count} unopened ${count===1?'vacancy':'vacancies'}`:undefined}>
   <span className="portal-tab-icon"><Icon size={22} aria-hidden="true"/>{count>0&&<span className="nav-unread-count" aria-hidden="true">{count>99?'99+':count}</span>}</span><span>{item.label}</span>
  </NavLink>;
 });
}

export function PortalHome() {
  const { user } = useAuth();
  return (
    <section className="stack portal-home-page">
      <div className="row between"><h1>Hello, {firstName(user.fullName)}</h1><Link className="btn sm" to="/portal/scan">Check in / out</Link></div>
      <AnnouncementFeed />
    </section>
  );
}
