import { useState } from 'react';
import Modal from '../components/Modal.jsx';
import Button from '../components/Button.jsx';
import Table from '../components/Table.jsx';
import { formatMoney } from '../api/money.js';
import Field from '../components/Field.jsx';
import { useToast } from '../components/Toast.jsx';
import { patch, post } from '../api/client.js';
import { GradeForm, PositionGradeList } from './PositionGrades.jsx';
import { saveErrorView } from './departmentView.js';
import { EMPTY_POSITION, POSITION_NAME_MAX, buildPosition, monthlyTotal, positionChanged, positionForm, positionServerFields, validatePosition } from './positionForm.js';

// Add (position = null) or edit one position of a department. Mount with a `key` so the form resets each time it opens.
export default function PositionDialog({ departmentId, position, onClose, onSaved }) {
  const toast = useToast();
  const [section, setSection] = useState('details');
  const showGrades = section !== 'details';
  const [noGradeNeeded, setNoGradeNeeded] = useState(false);
  const [grades, setGrades] = useState([]);
  const [draftIndex, setDraftIndex] = useState(null);
  const positionPay = position ? !position.requiresJobGrade : noGradeNeeded;
  const [form, setForm] = useState(position ? positionForm(position) : EMPTY_POSITION);
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setFields((x) => ({ ...x, [k]: undefined })); };
  const check = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.checked })); };
  const payForm = positionPay ? form : { ...form, basic: '0', allowance: '0' };
  const total = positionPay ? monthlyTotal(form) : '';

  function stageGrade(grade) {
    if (grades.some((item, index) => index !== draftIndex && item.name.toLowerCase() === grade.name.toLowerCase())) {
      return 'Choose a different grade name';
    }
    setGrades(items => draftIndex === -1 ? [...items, grade] : items.map((item, index) => index === draftIndex ? grade : item));
    setFields(current => ({ ...current, initialGrades: undefined }));
    setDraftIndex(null);
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || draftIndex !== null) return;
    const problems = validatePosition(payForm);
    if (!position && !noGradeNeeded && !grades.length) problems.initialGrades = 'Add at least one job grade';
    setFields(problems);
    setError('');
    if (Object.keys(problems).length) return;
    if (position && !positionChanged(payForm, position)) { setError('Nothing was changed.'); return; }
    setBusy(true);
    try {
      const body = buildPosition(payForm);
      const saved = position ? await patch(`/positions/${position.id}`, body) : await post(`/departments/${departmentId}/positions`, noGradeNeeded ? body : { ...body, initialGrades: grades });
      toast.success(position ? 'Position saved' : `${saved.name} was added`);
      onSaved(saved);
    } catch (err) {
      if (err.code === 'approval_pending') {
        toast.success(err.message);
        onSaved();
        return;
      }
      const v = saveErrorView(err);
      setFields(positionServerFields(v.fields));
      setError(v.message || 'Please fix the highlighted fields.');
      setBusy(false);
    }
  }

  return (
    <Modal open wide title={position ? 'Edit position' : 'Add position'} onClose={() => !busy && onClose()}
      footer={showGrades ? <Button onClick={onClose}>Close</Button> : <>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form="position-form" busy={busy} disabled={draftIndex !== null}>{position ? 'Save' : 'Save position'}</Button>
      </>}>
      {position && <div className="row" role="group" aria-label="Position sections">
        <Button size="sm" variant={showGrades ? 'default' : 'primary'} aria-pressed={!showGrades} disabled={busy} onClick={() => setSection('details')}>Position details</Button>
        <Button size="sm" variant={showGrades ? 'primary' : 'default'} aria-pressed={showGrades} disabled={busy} onClick={() => setSection('grades')}>Job grades</Button>
      </div>}
      {showGrades && <PositionGradeList positionId={position.id} canManage startAdding={section === 'add-grade'} />}
      {!showGrades && <form id="position-form" className="form-grid" onSubmit={submit} noValidate>
        {error && <div className="form-error full" role="alert">{error}</div>}
        <div className="position-name-row full">
          <Field label="Position name" maxLength={POSITION_NAME_MAX} autoComplete="off" value={form.name} error={fields.name} onChange={set('name')} />
          <Button size="sm" disabled={busy || (!position && (noGradeNeeded || draftIndex !== null))}
            onClick={() => position ? setSection('add-grade') : setDraftIndex(-1)}>Add job grade</Button>
        </div>
        {!position && <label className="full">
          <input type="checkbox" checked={noGradeNeeded} disabled={busy} onChange={e => {
            setNoGradeNeeded(e.target.checked);
            setDraftIndex(null);
            setFields(current => ({ ...current, basic: undefined, allowance: undefined, initialGrades: undefined }));
          }} /> No job grade needed
        </label>}
        {fields.initialGrades && !noGradeNeeded && <p className="form-error full" role="alert">{fields.initialGrades}</p>}
        {positionPay && <>
          <Field label="Monthly basic salary" inputMode="decimal" autoComplete="off" value={form.basic} error={fields.basic} onChange={set('basic')} />
          <Field label="Monthly allowance" inputMode="decimal" autoComplete="off" value={form.allowance} error={fields.allowance} onChange={set('allowance')} />
        </>}
        {(position || noGradeNeeded || grades.length > 0) && <fieldset className="salary-profile-flags full"><legend>Tax &amp; pension</legend>
          <label><input type="checkbox" checked={form.allowanceTaxable} onChange={check('allowanceTaxable')} /> Taxable allowance</label>
          <label><input type="checkbox" checked={form.allowancePensionable} onChange={check('allowancePensionable')} /> Pensionable allowance</label>
          <label><input type="checkbox" checked={form.pensionApplies} onChange={check('pensionApplies')} /> Employee pension</label>
          <small className="muted">Allowance flags require matching payroll base settings.</small>
        </fieldset>}
        {total && <div className="position-total full" aria-live="polite"><span>Monthly total</span><strong>{total}</strong></div>}
        {position && <small className="muted full">Existing salaries stay unchanged. Renaming updates job titles.</small>}
      </form>}
      {!position && !noGradeNeeded && draftIndex !== null && <GradeForm
        grade={grades[draftIndex] ?? {}} onClose={() => setDraftIndex(null)} onStage={stageGrade} />}
      {!position && !noGradeNeeded && grades.length > 0 && <Table caption="Job grades" rowKey="name" rows={grades} columns={[
        { key: 'name', header: 'Grade' },
        { key: 'basicMinor', header: 'Basic salary', align: 'num', render: grade => formatMoney(grade.basicMinor) },
        { key: 'allowanceMinor', header: 'Allowance', align: 'num', render: grade => formatMoney(grade.allowanceMinor) },
        { key: 'actions', header: 'Actions', render: grade => <div className="row">
          <Button size="sm" disabled={busy || draftIndex !== null} onClick={() => setDraftIndex(grades.indexOf(grade))}>Edit</Button>
          <Button size="sm" disabled={busy || draftIndex !== null} onClick={() => setGrades(items => items.filter(item => item !== grade))}>Remove</Button>
        </div> },
      ]} />}
    </Modal>
  );
}
