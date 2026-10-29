import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './api/auth.jsx';
import { homePath, redirectTarget } from './api/paths.js';
import Login from './pages/Login.jsx';
import HrLayout from './components/HrLayout.jsx';
import Employees from './pages/Employees.jsx';
import Departments from './pages/Departments.jsx';
import DepartmentDetail from './pages/DepartmentDetail.jsx';
import Attendance from './pages/Attendance.jsx';
import HrLeave from './pages/Leave.jsx';
import Settings from './pages/Settings.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Payroll from './pages/Payroll.jsx';
import CompanyCosts from './pages/CompanyCosts.jsx';
import PayrollSettings from './pages/PayrollSettings.jsx';
import QrAttendance from './pages/QrAttendance.jsx';
import Profile from './pages/portal/Profile.jsx';
import Scan from './pages/portal/Scan.jsx';
import Payslips, { Payslip } from './pages/portal/Payslips.jsx';
import History from './pages/portal/History.jsx';
import Leave from './pages/portal/Leave.jsx';
import { loginRedirectState, postLoginState } from './pages/portal/scanToken.js';
import PortalLayout, { PortalHome } from './pages/portal/PortalLayout.jsx';

// Placeholder pages: replaced task by task (Dashboard, Attendance, ...).
const Placeholder = ({ title }) => <section><h1>{title}</h1></section>;

function Splash() {
  const { status, error, reload } = useAuth();
  if (status === 'error') {
    return <main role="alert"><p>{error}</p><button onClick={reload}>Try again</button></main>;
  }
  return <main aria-busy="true"><p>Loading…</p></main>;
}

// UI convenience only: the server enforces roles and the lock on every request (task 1.9).
// `from` lets the login page send people back to where they were headed (e.g. a scanned QR link).
function RequireRole({ role, children }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status !== 'ready') return <Splash />;
  // The scanned QR token (URL fragment) rides along in router state so it survives the login screen.
  if (!user) return <Navigate to="/login" replace state={loginRedirectState(location)} />;
  if (user.role !== role) return <Navigate to={homePath(user)} replace />;
  return children;
}

function Landing() {
  const { status, user } = useAuth();
  if (status !== 'ready') return <Splash />;
  return <Navigate to={user ? homePath(user) : '/login'} replace />;
}

// Once signed in (by the form, or already signed in), go back to where the person was headed.
function LoginRoute() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status !== 'ready') return <Splash />;
  if (user) {
    const target = redirectTarget(location.state?.from, user);
    return <Navigate to={target} replace state={postLoginState(target, location.state?.qrToken)} />;
  }
  return <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/hr" element={<RequireRole role="hr"><HrLayout /></RequireRole>}>
          <Route index element={<Dashboard />} />
          <Route path="employees" element={<Employees />} />
          <Route path="departments" element={<Departments />} />
          <Route path="departments/:id" element={<DepartmentDetail />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="qr" element={<QrAttendance />} />
          <Route path="leave" element={<HrLeave />} />
          <Route path="payroll" element={<Payroll />} />
          <Route path="payroll/company-costs" element={<CompanyCosts />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/payroll" element={<PayrollSettings />} />
          <Route path="*" element={<Navigate to="/hr" replace />} />
        </Route>
        <Route path="/portal" element={<RequireRole role="employee"><PortalLayout /></RequireRole>}>
          <Route index element={<PortalHome />} />
          <Route path="profile" element={<Profile />} />
          <Route path="scan" element={<Scan />} />
          <Route path="attendance" element={<History />} />
          <Route path="leave" element={<Leave />} />
          <Route path="payslips" element={<Payslips />} />
          <Route path="payslips/:id" element={<Payslip />} />
          <Route path="*" element={<Navigate to="/portal" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
