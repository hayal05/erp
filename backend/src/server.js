import express from 'express';
import helmet from 'helmet';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { cors } from './middleware/cors.js';
import { cookieParser, loadSession } from './middleware/session.js';
import { csrfProtection } from './middleware/csrf.js';
import { lockGate } from './middleware/lock.js';
import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import departmentRoutes from './routes/departments.js';
import shiftRoutes from './routes/shifts.js';
import qrRoutes from './routes/qr.js';
import attendanceRoutes from './routes/attendance.js';
import attendanceRecordRoutes from './routes/attendanceRecords.js';
import leaveRoutes from './routes/leave.js';
import leaveAdminRoutes from './routes/leaveAdmin.js';
import settingsRoutes from './routes/settings.js';
import payrollSettingsRoutes from './routes/payrollSettings.js';
import dashboardRoutes from './routes/dashboard.js';
import payslipRoutes from './routes/payslips.js';
import payrollRoutes from './routes/payroll.js';
import salaryProfileRoutes from './routes/salaryProfiles.js';
import deductionRoutes from './routes/deductions.js';
import { notFound, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render terminates TLS in front of the app

  app.use(helmet());
  app.use(cors);
  // 100 kb everywhere except the selfie submit, which parses its own larger body after the role guard (routes/attendance.js).
  const json = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path === '/api/attendance/scan' ? next() : json(req, res, next)));

  // Lightweight liveness check for UptimeRobot. Deliberately does not touch the database.
  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

  app.use(cookieParser());
  app.use(loadSession); // after /health so uptime pings never touch the database
  app.use(csrfProtection);
  app.use(lockGate); // a locked tablet session can only reach the allowlist (middleware/lock.js)

  app.use('/api/auth', authRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/departments', departmentRoutes);
  app.use('/api/shifts', shiftRoutes);
  app.use('/api/qr', qrRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/attendance-records', attendanceRecordRoutes); // HR list + selfie links (2.17)
  app.use('/api/leave', leaveRoutes); // employee leave: balances, requests, cancel (3.3); HR decisions come in 3.4
  app.use('/api/leave-admin', leaveAdminRoutes); // HR queue, decisions, entitlements (3.4)
  app.use('/api/payroll-settings', payrollSettingsRoutes); // brackets (4.5), pension + bases (4.6); other taxes follow
  app.use('/api/deductions', deductionRoutes);
  app.use('/api/salary-profiles', salaryProfileRoutes);
  app.use('/api/payroll', payrollRoutes);
  app.use('/api/payslips', payslipRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/settings', settingsRoutes); // holidays (3.7); payroll settings join in Phase 4
  // More routers are mounted here by later tasks (qr, attendance, ...).

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export const app = createApp();

// Only listen when run directly (`node src/server.js`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = app.listen(config.port, '0.0.0.0', () =>
    console.log(`Natra ERP API listening on :${config.port}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
