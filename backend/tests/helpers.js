// Shared by DB-backed tests. Importing this first sets the test env and decides whether
// to skip. Tests that truncate tables refuse to run unless the database name contains "test".
process.env.NODE_ENV = 'test';
const url = process.env.TEST_DATABASE_URL;

export const dbSkip = !url ? 'TEST_DATABASE_URL not set'
  : !/test/i.test(new URL(url).pathname) ? 'TEST_DATABASE_URL must point at a database whose name contains "test"'
  : false;

if (!dbSkip) process.env.DATABASE_URL = url;

export const TRUNCATE_ALL =
  'TRUNCATE audit_logs, payroll_entry_items, payroll_entries, deduction_items, payroll_periods, salary_profiles, other_taxes, income_tax_brackets, holidays, leave_requests, leave_balances, attendance_tokens, attendance_records, sessions, employees, users, departments, shifts RESTART IDENTITY CASCADE';
