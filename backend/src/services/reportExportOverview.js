const totalsByReport = {
  'monthly-attendance': ['present', 'late', 'absent', 'onLeave', 'incomplete', 'total'],
  'department-headcount': ['active', 'inactive', 'total'],
  'leave-usage': ['used', 'pending'],
  'payroll-register': ['gross', 'incomeTax', 'pension', 'net'],
  'employer-cost-summary': ['gross', 'salaryPaid', 'companyPension', 'employerCost'],
  'employer-cost-detail': ['gross', 'salaryPaid', 'companyPension', 'employerCost'],
  'settlement-balances': ['incomeTaxBalance', 'pensionBalance'],
  'settlement-payments': ['amount'],
  'appraisal-summary': ['total', 'notStarted', 'draft', 'returned', 'submitted', 'approved'],
  'recruitment-summary': ['applications', 'applied', 'shortlisted', 'selected', 'rejected'],
};

const periodKeys = new Set(['date', 'month', 'year', 'from', 'to']);
const numberFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
function formatMoneyMinor(amount) {
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${numberFormat.format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`;
}

function labelValue(value) {
  return String(value).replace(/_/g, ' ').replace(/^./, first => first.toUpperCase());
}

export function reportPeriod({ date, month, year, period, asOf }) {
  if (date) return ['Date', date];
  if (month) return ['Month', month];
  if (year) return ['Year', year];
  if (period) return ['Date range', period];
  return ['As of', asOf];
}

export function reportExportOverview({ id, report, filters, columns, rows, generatedAt, timeZone }) {
  const filterDetails = report.filters.flatMap(({ key, label, options, lookup }) => {
    if (periodKeys.has(key) || filters[key] === undefined) return [];
    const value = filters[key];
    const option = options?.find(option => String(option.value) === String(value));
    const display = option?.label ?? (lookup && typeof value === 'number' ? `ID ${value}` : String(value));
    return [[label, display]];
  });

  const metrics = [];
  if (rows.length) {
    for (const key of totalsByReport[id] ?? []) {
      const column = columns.find(column => column.key === key);
      if (!column) continue;
      const monetary = column.type === 'money';
      const totals = new Map();
      for (const row of rows) {
        if (typeof row[key] !== 'number' || !Number.isFinite(row[key])) continue;
        const currency = monetary ? (row.currency || 'Currency unspecified') : '';
        const amount = monetary ? BigInt(Math.round(row[key] * 100)) : row[key];
        totals.set(currency, (totals.get(currency) ?? (monetary ? 0n : 0)) + amount);
      }
      for (const [currency, amount] of totals) {
        metrics.push([column.header, currency ? `${currency} ${formatMoneyMinor(amount)}` : numberFormat.format(amount)]);
      }
    }
    for (const [key, label] of report.exportCounts ?? []) {
      metrics.push([label, numberFormat.format(rows.filter(row => row[key]).length)]);
    }
    const status = columns.find(column => ['status', 'retirementStatus'].includes(column.key));
    if (status) {
      const counts = new Map();
      for (const row of rows) {
        const label = labelValue(row[status.key] ?? 'Unspecified');
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      for (const [label, count] of counts) {
        metrics.push([`${status.header} – ${label}`, `${numberFormat.format(count)} (${numberFormat.format(count / rows.length * 100)}%)`]);
      }
    }
  }

  return {
    generated: `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(generatedAt)} (${timeZone})`,
    filterDetails,
    metrics,
    description: report.description,
  };
}
