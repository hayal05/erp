import { useState } from 'react';
import { patch, post } from '../api/client.js';
import { formatMoney } from '../api/money.js';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { useResource } from './payrollResource.jsx';
import { buildPosition, EMPTY_POSITION, positionForm, positionServerFields, validatePosition } from './positionForm.js';

const PAGE_SIZE = 20;

function useGrades(positionId) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const path = `/positions/${positionId}/grades`;
  const result = useResource(path, { page, pageSize: PAGE_SIZE, search: search.trim() });
  return { ...result, page, setPage, search, setSearch(value) { setSearch(value); setPage(1); }, path };
}

export function JobGradePicker({ positionId, value, current, onChange, disabled, error }) {
  const grades = useGrades(positionId);
  const options = (grades.data?.items ?? []).map(grade => ({ value: grade.id, label: grade.name }));
  if (value && !options.some(option => String(option.value) === value)) {
    options.unshift({ value, label: current?.name ?? 'Current grade' });
  }
  return <div className="stack full">
    {(grades.data?.total > PAGE_SIZE || grades.search) && <Field type="search" label="Search job grades"
      placeholder="Grade name" maxLength={100} value={grades.search} onChange={e => grades.setSearch(e.target.value)} disabled={disabled} />}
    <Field as="select" label="Job grade" placeholder="Position default" options={options} value={value}
      disabled={disabled || grades.loading || !!grades.error} error={error}
      onChange={e => onChange(e.target.value, grades.data?.items.find(grade => String(grade.id) === e.target.value))} />
    {grades.error && <p className="form-error" role="alert">{grades.error} <Button size="sm" onClick={grades.reload}>Try again</Button></p>}
    {(grades.data?.total > PAGE_SIZE || grades.page > 1) && <Pager page={grades.page} pageSize={PAGE_SIZE}
      total={grades.data?.total ?? 0} onPage={grades.setPage} disabled={grades.loading || disabled} />}
  </div>;
}

export default function PositionGrades({ position, canManage, onClose }) {
  return <Modal open wide title={`Job grades · ${position.name}`} onClose={onClose}
    footer={<Button onClick={onClose}>Close</Button>}>
    <PositionGradeList positionId={position.id} canManage={canManage} />
  </Modal>;
}

export function PositionGradeList({ positionId, canManage }) {
  const grades = useGrades(positionId);
  const [editing, setEditing] = useState(null);
  return (
    <div className="stack">
      <div className="row between">
        <Field type="search" label="Search job grades" placeholder="Grade name" maxLength={100}
          value={grades.search} onChange={e => grades.setSearch(e.target.value)} />
        {canManage && <Button size="sm" variant="primary" onClick={() => setEditing({})}>Add grade</Button>}
      </div>
      {editing && <GradeForm key={editing.id ?? 'new'} grade={editing} path={grades.path}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); grades.reload(); }} />}
      <Table caption="Position job grades" rows={grades.data?.items ?? []} loading={grades.loading} error={grades.error}
        onRetry={grades.reload} empty="No job grades found" columns={[
          { key: 'name', header: 'Grade' },
          { key: 'basicMinor', header: 'Basic salary', align: 'num', render: row => formatMoney(row.basicMinor) },
          { key: 'allowanceMinor', header: 'Allowance', align: 'num', render: row => formatMoney(row.allowanceMinor) },
          ...(canManage ? [{ key: 'actions', header: 'Actions', render: row => <Button size="sm" aria-label={`Edit ${row.name}`}
            onClick={() => setEditing(row)}>Edit</Button> }] : []),
        ]} />
      {(grades.data?.total > PAGE_SIZE || grades.page > 1) && <Pager page={grades.page} pageSize={PAGE_SIZE}
        total={grades.data?.total ?? 0} onPage={grades.setPage} disabled={grades.loading} />}
    </div>
  );
}

function GradeForm({ grade, path, onSaved, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState(() => grade.id ? positionForm({ ...EMPTY_POSITION, ...grade }) : { ...EMPTY_POSITION });
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = key => e => setForm(current => ({ ...current, [key]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    const problems = validatePosition(form);
    if (problems.name === 'Give the position a name') problems.name = 'Enter a grade name';
    setFields(problems);
    setError('');
    if (Object.keys(problems).length) return;
    setBusy(true);
    const { name, basicMinor, allowanceMinor } = buildPosition(form);
    try {
      if (grade.id) await patch(`${path}/${grade.id}`, { name, basicMinor, allowanceMinor });
      else await post(path, { name, basicMinor, allowanceMinor });
      toast.success('Job grade saved');
      onSaved();
    } catch (err) {
      if (err.code === 'approval_pending') {
        toast.success(err.message);
        onSaved();
      } else {
        setFields(positionServerFields(err.fields));
        setError(err.message);
        setBusy(false);
      }
    }
  }

  return <form className="form-grid" onSubmit={save}>
    {error && <p className="form-error full" role="alert">{error}</p>}
    <Field label="Grade name" maxLength={100} value={form.name} error={fields.name} onChange={set('name')} disabled={busy} />
    <Field label="Monthly basic salary" inputMode="decimal" value={form.basic} error={fields.basic} onChange={set('basic')} disabled={busy} />
    <Field label="Monthly allowance" inputMode="decimal" value={form.allowance} error={fields.allowance} onChange={set('allowance')} disabled={busy} />
    <div className="row end full">
      <Button size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button size="sm" type="submit" variant="primary" busy={busy}>Save grade</Button>
    </div>
  </form>;
}
