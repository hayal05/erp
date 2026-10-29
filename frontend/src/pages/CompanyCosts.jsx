import { useEffect, useState } from 'react';
import Button from '../components/Button.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { get } from '../api/client.js';
import { formatMoney } from '../api/money.js';
const SIZE = 12, DETAIL_SIZE = 25;
export default function CompanyCosts({ reload }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [detail, setDetail] = useState(null);
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: '' });
  useEffect(() => {
    const ctrl = new AbortController(); setState(s => ({ ...s, loading: true, error: '' }));
    get('/payroll-costs', { page, pageSize: SIZE }, { signal: ctrl.signal })
      .then(r => { if (!ctrl.signal.aborted) setState({ ...r, loading: false, error: '' }); })
      .catch(e => { if (!ctrl.signal.aborted) setState({ items: [], total: 0, loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [page, retry, reload]);
  const totalButton = (r, kind) => <button type="button" className="salary-cell" onClick={() => setDetail({ period: r, kind })}
    aria-label={`View ${kind === 'salary' ? 'salary paid' : 'company pension'} details for ${r.month}`}>{formatMoney(kind === 'salary' ? r.salaryPaidMinor : r.companyPensionMinor)}</button>;
  return <section className="card stack" aria-labelledby="company-costs-title">
    <h2 id="company-costs-title">Company costs</h2>
    <p className="muted">Paid payrolls by payroll month. Salary paid is net pay after employee deductions. Select a total to see every employee. Employer pension is recorded payroll cost; it does not confirm remittance to the pension authority.</p>
    <Table caption="Monthly company payroll costs" columns={[
      { key: 'month', header: 'Payroll month' }, { key: 'paidOn', header: 'Paid on' }, { key: 'currency', header: 'Currency' },
      { key: 'employeeCount', header: 'Employees', align: 'num' },
      { key: 'salaryPaidMinor', header: 'Salary paid (net)', align: 'num', render: r => totalButton(r, 'salary') },
      { key: 'companyPensionMinor', header: 'Company pension', align: 'num', render: r => totalButton(r, 'pension') },
    ]} rows={state.items} loading={state.loading} error={state.error} onRetry={() => setRetry(n => n + 1)} empty="No paid payrolls yet. Mark a payroll paid to include its costs here." />
    <Pager page={page} pageSize={SIZE} total={state.total} onPage={setPage} disabled={state.loading} />
    {detail && <CostDetails key={`${detail.period.id}-${detail.kind}`} {...detail} onClose={() => setDetail(null)} />}
  </section>;
}
function CostDetails({ period, kind, onClose }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: '' });
  useEffect(() => {
    const ctrl = new AbortController(); setState(s => ({ ...s, loading: true, error: '' }));
    get(`/payroll/periods/${period.id}/entries`, { page, pageSize: DETAIL_SIZE }, { signal: ctrl.signal })
      .then(r => { if (!ctrl.signal.aborted) setState({ ...r, loading: false, error: '' }); })
      .catch(e => { if (!ctrl.signal.aborted) setState({ items: [], total: 0, loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [period.id, page, retry]);
  const salary = kind === 'salary';
  const money = (key, header) => ({ key, header, align: 'num', render: r => formatMoney(r[key]) });
  const columns = [{ key: 'employeeCode', header: 'Employee ID' }, { key: 'employeeName', header: 'Employee name' },
    ...salary ? [money('basicMinor','Basic salary'), money('allowanceMinor','Allowance'), money('grossMinor','Gross salary'),
      { key: 'deductions', header: 'Employee deductions', align: 'num', render: r => formatMoney(r.grossMinor - r.netMinor) }, money('netMinor','Salary paid (net)')]
      : [money('pensionableMinor','Pensionable salary'), { key: 'employerPensionRate', header: 'Company rate', align: 'num', render: r => `${r.employerPensionRate}%` }, money('employerPensionMinor','Company contribution')]];
  return <Modal open wide title={`${salary ? 'Salary paid' : 'Company pension'} · ${period.month}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
    <div className="stack"><p>Paid on {period.paidOn} · {period.currency} · {period.employeeCount} employees</p>
      <p><strong>Monthly total: {formatMoney(salary ? period.salaryPaidMinor : period.companyPensionMinor)} {period.currency}</strong></p>
      <Table caption={salary ? 'Employee salary payments' : 'Employer pension contributions'} columns={columns} rows={state.items} loading={state.loading} error={state.error} onRetry={() => setRetry(n => n + 1)} empty="No employee entries" />
      <Pager page={page} pageSize={DETAIL_SIZE} total={state.total} onPage={setPage} disabled={state.loading} />
      {salary && <p className="muted">Gross salary total: {formatMoney(period.grossMinor)} {period.currency}. Gross salary plus employer pension: {formatMoney(period.employerCostMinor)} {period.currency}.</p>}
    </div>
  </Modal>;
}
