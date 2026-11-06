import { useState } from 'react';
import { post, put } from '../api/client.js';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { ResourceState, useResource } from './payrollResource.jsx';

const PAGE_SIZE = 20;
const kinds = [{ value: 'quarterly', label: 'Quarterly' }, { value: 'annual', label: 'Annual' }, { value: 'custom', label: 'Custom' }];
const base = '/appraisals/cycles';
const emptyCycle = { name: '', kind: 'quarterly', startsOn: '', endsOn: '', dueOn: '' };
const template = row => row.templateName ? `${row.templateName} · v${row.templateVersion}` : '—';

export default function AppraisalCycles() {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const cycles = useResource(base, { page, pageSize: PAGE_SIZE });
  return <div className="stack">
    <div className="row between"><h2>Appraisal cycles</h2>
      <Button size="sm" variant="primary" onClick={() => setEditing(emptyCycle)}>New cycle</Button>
    </div>
    <Table caption="Appraisal cycles" rows={cycles.loading ? [] : cycles.data?.items} loading={cycles.loading}
      error={cycles.error} onRetry={cycles.reload} empty="No appraisal cycles" columns={[
        { key: 'name', header: 'Cycle' },
        { key: 'kind', header: 'Frequency', render: row => kinds.find(kind => kind.value === row.kind)?.label },
        { key: 'startsOn', header: 'From' }, { key: 'endsOn', header: 'To' }, { key: 'dueOn', header: 'Deadline' },
        { key: 'openedAt', header: 'Status', render: row => row.openedAt ? 'Open' : 'Draft' },
        { key: 'actions', header: 'Actions', render: row => <div className="row">
          {!row.openedAt && <Button size="sm" onClick={() => setEditing(row)}>Edit</Button>}
          <Button size="sm" onClick={() => setAssigning(row)}>Assignments</Button>
        </div> },
      ]} />
    <Pager page={page} pageSize={PAGE_SIZE} total={cycles.data?.total ?? 0} onPage={setPage} disabled={cycles.loading} />
    {editing && <CycleEditor cycle={editing} onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); setPage(1); cycles.reload(); }} />}
    {assigning && <CycleAssignments key={assigning.id} id={assigning.id}
      onClose={() => { setAssigning(null); cycles.reload(); }} />}
  </div>;
}

function CycleEditor({ cycle, onClose, onSaved }) {
  const [form, setForm] = useState(cycle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (cycle.id) await put(`${base}/${cycle.id}`, form);
      else await post(base, form);
      toast.success('Cycle saved');
      onSaved();
    } catch (err) {
      if (err.code === 'approval_pending') { toast.success(err.message); onSaved(); }
      else setError(err.message);
    } finally { setBusy(false); }
  }
  return <Modal open title={cycle.id ? 'Edit cycle' : 'New appraisal cycle'} dismissible={!busy} onClose={onClose} footer={<>
    <Button disabled={busy} onClick={onClose}>Cancel</Button>
    <Button type="submit" form="appraisal-cycle" variant="primary" busy={busy}>Save draft</Button>
  </>}>
    <form id="appraisal-cycle" className="form-grid" onSubmit={save}>
      <Field className="full" label="Cycle name" value={form.name} onChange={set('name')} maxLength={120} required disabled={busy} />
      <Field as="select" label="Frequency" value={form.kind} onChange={set('kind')} options={kinds} disabled={busy} />
      <Field label="Review deadline" type="date" value={form.dueOn} onChange={set('dueOn')} required disabled={busy} />
      <Field label="Period starts" type="date" value={form.startsOn} onChange={set('startsOn')} required disabled={busy} />
      <Field label="Period ends" type="date" value={form.endsOn} onChange={set('endsOn')} required disabled={busy} />
      {error && <p className="form-error full" role="alert">{error}</p>}
    </form>
  </Modal>;
}

function CycleAssignments({ id, onClose }) {
  const path = `${base}/${id}/assignments`;
  const data = useResource(path);
  return data.data?.cycle
    ? <AssignmentEditor key={data.data.cycle.version} data={data.data} path={path} onClose={onClose} onSaved={data.reload} loading={data.loading} />
    : <Modal open title="Cycle assignments" onClose={onClose}>
      <ResourceState loading={data.loading} error={data.error} onRetry={data.reload} />
    </Modal>;
}

function AssignmentEditor({ data, path, onClose, onSaved, loading }) {
  const { cycle } = data;
  const [items, setItems] = useState(data.items);
  const [employee, setEmployee] = useState(null);
  const [reviewer, setReviewer] = useState(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  const disabled = Boolean(busy || loading);
  function assign() {
    if (!employee || !reviewer) return;
    setItems(current => [...current.filter(row => row.employeeId !== employee.id), {
      employeeId: employee.id, employee: employee.name, reviewerId: reviewer.id, reviewer: reviewer.name,
    }]);
    setChanged(true);
    setEmployee(null);
  }
  async function save(action) {
    if (disabled) return;
    setBusy(action);
    setError('');
    try {
      if (action === 'open') await post(`${base}/${cycle.id}/open`, { version: cycle.version });
      else await put(path, { version: cycle.version, assignments: items.map(({ employeeId, reviewerId }) => ({ employeeId, reviewerId })) });
      toast.success(action === 'open' ? 'Cycle opened' : 'Assignments saved');
      onSaved();
    } catch (err) {
      if (err.code === 'approval_pending') { toast.success(err.message); onClose(); }
      else setError(err.fields?.assignments ?? err.message);
    } finally { setBusy(''); }
  }
  return <Modal open wide title={`Assignments · ${cycle.name}`} dismissible={!busy} onClose={onClose} footer={<>
    <Button disabled={!!busy} onClick={onClose}>Close</Button>
    {!cycle.openedAt && <>
      <Button busy={busy === 'save'} disabled={!changed || disabled} onClick={() => save('save')}>Save assignments</Button>
      <Button variant="primary" busy={busy === 'open'} disabled={changed || disabled || !items.length} onClick={() => save('open')}>Open cycle</Button>
    </>}
  </>}>
    <div className="stack">
      {!cycle.openedAt && <div className="row">
        <AssignmentChoice path="/appraisals/employees" label="Employee" value={employee} onChange={setEmployee} disabled={disabled} />
        <AssignmentChoice path={base + '/reviewers'} label="Reviewer" value={reviewer} onChange={setReviewer} disabled={disabled} />
        <Button size="sm" disabled={!employee || !reviewer || disabled} onClick={assign}>Assign reviewer</Button>
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <Table caption="Cycle assignments" rowKey="employeeId" rows={items} empty="No employees assigned" columns={[
        { key: 'employee', header: 'Employee' }, { key: 'reviewer', header: 'Reviewer' },
        ...(cycle.openedAt ? [{ key: 'templateName', header: 'Published template', render: template }] : [
          { key: 'remove', header: 'Actions', render: row => <Button size="sm" disabled={disabled}
            onClick={() => { setItems(current => current.filter(item => item.employeeId !== row.employeeId)); setChanged(true); }}>Remove</Button> },
        ]),
      ]} />
    </div>
  </Modal>;
}

function AssignmentChoice({ path, label, value, onChange, disabled }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const result = useResource(path, { page, search, pageSize: PAGE_SIZE });
  const items = (result.data?.items ?? []).map(item => ({ id: Number(item.id), name: item.name ?? `${item.fullName} · ${item.employeeCode}` }));
  const options = value && !items.some(item => item.id === value.id) ? [value, ...items] : items;
  return <div className="stack">
    {(search || result.data?.total > PAGE_SIZE) && <Field type="search" label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}`}
      maxLength={120} value={search} disabled={disabled} onChange={event => { setSearch(event.target.value); setPage(1); }} />}
    <Field as="select" label={label} placeholder={`Choose ${label.toLowerCase()}`}
      value={value?.id ?? ''} options={options.map(item => ({ value: item.id, label: item.name }))}
      disabled={disabled || result.loading || !!result.error}
      onChange={event => onChange(options.find(item => String(item.id) === event.target.value) ?? null)} />
    {result.error && <ResourceState error={result.error} onRetry={result.reload} />}
    {(page > 1 || result.data?.total > PAGE_SIZE) && <Pager page={page} pageSize={PAGE_SIZE} total={result.data?.total ?? 0} onPage={setPage}
      disabled={disabled || result.loading} />}
  </div>;
}

export function MyAppraisalAssignments() {
  const [page, setPage] = useState(1);
  const assignments = useResource('/appraisals/assignments', { page, pageSize: PAGE_SIZE });
  return <div className="stack">
    <Table caption="My appraisal assignments" rows={assignments.loading ? [] : assignments.data?.items} loading={assignments.loading}
      error={assignments.error} onRetry={assignments.reload} empty="No appraisal assignments" columns={[
        { key: 'employeeCode', header: 'Employee ID' }, { key: 'employee', header: 'Employee' },
        { key: 'cycle', header: 'Cycle' }, { key: 'dueOn', header: 'Deadline' },
        { key: 'templateName', header: 'Template', render: template },
      ]} />
    <Pager page={page} pageSize={PAGE_SIZE} total={assignments.data?.total ?? 0} onPage={setPage} disabled={assignments.loading} />
  </div>;
}
