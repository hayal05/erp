import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Table, { Badge } from '../components/Table.jsx';
import { formatMoney } from '../api/money.js';
import { ResourceState, useResource } from './payrollResource.jsx';
import { detailBreakdown, DEDUCTION_LABELS } from './salaryDetailView.js';
export default function SalaryDetailDialog({ periodId, entry, onClose }) {
  const { data, loading, error, reload } = useResource(`/payroll/periods/${periodId}/entries/${entry.id}`);
  return <Modal open wide title={`Salary details — ${entry.employeeName}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
    {!data ? <ResourceState loading={loading} error={error} onRetry={reload} /> : <SalaryDetails data={data} />}
  </Modal>;
}
export function SalaryDetails({ data }) {
  const { entry: e, period } = data, b = detailBreakdown(data);
  const money = (n) => formatMoney(n);
  const summary = [ ['Basic salary',e.basicMinor], ['Allowance',e.allowanceMinor], ['Gross salary',e.grossMinor], ['Taxable income',e.taxableIncomeMinor],
    [`Income tax (${e.incomeTaxRate}% less ${money(e.incomeTaxFixedDeductionMinor)})`,e.incomeTaxMinor], ['Other tax',e.otherTaxMinor],
    ['Pensionable salary',e.pensionableMinor], [`Employee pension (${e.employeePensionRate}%)`,e.employeePensionMinor], ['Other deductions',e.otherDeductionsMinor], ['Total employee deductions',b.totalEmployeeDeductions], ['Net salary',e.netMinor] ];
  const amount = { key: 'amountMinor', header: 'Amount', align: 'num', render: (r) => money(r.amountMinor) };
  return <div className="stack salary-detail">
    <div className="row between"><p>{e.employeeCode} · {period.month} · {period.currencyCode}</p><Badge tone={period.status === 'draft' ? 'warn' : 'ok'}>{period.status === 'draft' ? 'Draft' : period.status === 'approved' ? 'Approved' : 'Paid'}</Badge></div>
    {!b.matches && <p className="form-error" role="alert">The saved breakdown does not match the salary totals. Review this payroll before proceeding.</p>}
    <dl className="salary-detail-summary salary-summary-main">{summary.map(([label,value]) => <div key={label}><dt>{label}</dt><dd className={label === 'Net salary' && value < 0 ? 'salary-negative' : undefined}>{money(value)}</dd></div>)}</dl>
    <section className="stack salary-breakdown"><div className="row between"><h3>Other taxes</h3><strong>{money(b.taxTotal)}</strong></div>
    {b.taxes.length > 0 && <Table caption="Other tax breakdown" rows={b.taxes} columns={[{ key:'label',header:'Tax' },{ key:'rate',header:'Rate',align:'num',render:(r) => `${r.rate}%` },{ key:'baseMinor',header:'Tax base',align:'num',render:(r) => money(r.baseMinor) },amount]} />}</section>
    <section className="stack salary-breakdown"><div className="row between"><h3>Other deductions</h3><strong>{money(b.deductionTotal)}</strong></div>
    {b.deductions.length > 0 && <Table caption="Other deductions breakdown" rows={b.deductions} columns={[{ key:'label',header:'Deduction' },{ key:'kind',header:'Type',render:(r) => DEDUCTION_LABELS[r.kind] ?? r.kind },amount]} />}</section>
    <h3>Employer cost</h3>
    <dl className="salary-detail-summary"><div><dt>Gross salary</dt><dd>{money(e.grossMinor)}</dd></div><div><dt>Employer pension ({e.employerPensionRate}%)</dt><dd>{money(e.employerPensionMinor)}</dd></div><div><dt>Total employer cost</dt><dd>{money(e.employerCostMinor)}</dd></div></dl>
  </div>;
}
