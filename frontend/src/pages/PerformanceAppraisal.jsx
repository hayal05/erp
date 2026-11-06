import { useEffect, useState } from 'react';
import { usePermission } from '../api/auth.jsx';
import AppraisalCycles, { MyAppraisalAssignments } from './AppraisalCycles.jsx';
import AppraisalTemplates, { templateScopeLabels } from './AppraisalTemplates.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { useResource } from './payrollResource.jsx';

const PAGE_SIZE = 25;

export default function PerformanceAppraisal() {
  const canConfigure = usePermission('appraisals.configure');
  const canReview = usePermission('appraisals.review');
  const [tab, setTab] = useState('employees');
  return <section className="stack">
    <div className="row between">
      <h1>Performance Appraisal</h1>
      {(canConfigure || canReview) && <div className="row" role="group" aria-label="Appraisal sections">
        <Button size="sm" aria-pressed={tab === 'employees'} onClick={() => setTab('employees')}>Employees</Button>
         {canConfigure && <>
          <Button size="sm" aria-pressed={tab === 'templates'} onClick={() => setTab('templates')}>Templates</Button>
          <Button size="sm" aria-pressed={tab === 'cycles'} onClick={() => setTab('cycles')}>Cycles</Button>
        </>}
        {canReview && <Button size="sm" aria-pressed={tab === 'assignments'} onClick={() => setTab('assignments')}>My assignments</Button>}
      </div>}
    </div>
    {canConfigure && tab === 'templates' ? <AppraisalTemplates />
      : canConfigure && tab === 'cycles' ? <AppraisalCycles />
      : canReview && tab === 'assignments' ? <MyAppraisalAssignments />
      : <EmployeeRoster />}
  </section>;
}

function EmployeeRoster() {
  const canReview = usePermission('appraisals.review');
  const canApprove = usePermission('appraisals.approve');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const roster = useResource('/appraisals/employees', { search: query, page, pageSize: PAGE_SIZE });
  const columns = [
    { key: 'employeeCode', header: 'Employee ID' },
    { key: 'fullName', header: 'Employee' },
    { key: 'department', header: 'Department', render: row => row.department ?? '—' },
    { key: 'template', header: 'Draft template match', render: ({ template }) => {
      if (template?.status === 'matched') return template.name;
      if (template?.status === 'conflict') return `Conflict · ${template.count} ${templateScopeLabels[template.scope].toLowerCase()} templates`;
      return 'No match';
    } },
    ...(canReview ? [{ key: 'canReview', header: 'Review access', render: row => row.canReview ? 'Allowed' : '—' }] : []),
    ...(canApprove ? [{ key: 'canApprove', header: 'Approval access', render: row => row.canApprove ? 'Allowed' : '—' }] : []),
  ];

  return <div className="stack">
    <div className="row between">
      <Field type="search" label="Search appraisal employees" placeholder="Employee name or ID"
        value={search} onChange={event => setSearch(event.target.value)} maxLength={120} />
    </div>
    <Table caption="Employees in appraisal scope" columns={columns} rows={roster.loading ? [] : roster.data?.items}
      loading={roster.loading} error={roster.error} onRetry={roster.reload} empty="No employees match" />
    <Pager page={page} pageSize={PAGE_SIZE} total={roster.data?.total ?? 0} onPage={setPage} disabled={roster.loading} />
  </div>;
}
