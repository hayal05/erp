import { useState } from 'react';
import { del, patch, post } from '../api/client.js';
import AppraisalWeights from './AppraisalWeights.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { useResource } from './payrollResource.jsx';

const PAGE_SIZE = 20;
export const templateScopeLabels = { company: 'Company-wide', department: 'Department', position: 'Position', grade: 'Job grade' };
const scopeOptions = Object.entries(templateScopeLabels).map(([value, label]) => ({ value, label }));
const emptyTemplate = { name: '', scope: 'company', targetId: null };

export default function AppraisalTemplates() {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [weightTemplate, setWeightTemplate] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const templates = useResource('/appraisals/templates', { page, pageSize: PAGE_SIZE });

  function saved() {
    setEditing(null);
    templates.reload();
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await del(`/appraisals/templates/${removing.id}`);
      if (templates.data?.items.length === 1 && page > 1) setPage(page - 1);
      toast.success('Template deleted');
      setRemoving(null);
      templates.reload();
    } catch (err) {
      if (err.code === 'approval_pending') {
        toast.success(err.message);
        setRemoving(null);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return <div className="stack">
    <div className="row between">
      <h2>Template drafts</h2>
      <Button size="sm" variant="primary" onClick={() => setEditing(emptyTemplate)}>New template</Button>
    </div>
    <Table caption="Appraisal templates" rows={templates.loading ? [] : templates.data?.items} loading={templates.loading}
      error={templates.error} onRetry={templates.reload} empty="No templates yet" columns={[
        { key: 'name', header: 'Template' },
        { key: 'scope', header: 'Scope', render: row => templateScopeLabels[row.scope] },
        { key: 'targetName', header: 'Target', render: row => row.targetName ?? 'All employees' },
        { key: 'actions', header: 'Actions', render: row => <div className="row">
          <Button size="sm" onClick={() => setEditing(row)}>Edit</Button>
          <Button size="sm" onClick={() => setWeightTemplate(row)}>Scorecard</Button>
          <Button size="sm" onClick={() => { setRemoving(row); setError(''); }}>Delete</Button>
        </div> },
      ]} />
    <Pager page={page} pageSize={PAGE_SIZE} total={templates.data?.total ?? 0} onPage={setPage} disabled={templates.loading} />
    {editing && <TemplateEditor key={editing.id ?? 'new'} template={editing} onSaved={saved} onClose={() => setEditing(null)} />}
    {weightTemplate && <AppraisalWeights key={weightTemplate.id} template={weightTemplate}
      onClose={() => setWeightTemplate(null)} onSaved={() => { setWeightTemplate(null); templates.reload(); }} />}
    {removing && <Modal open title="Delete template?" onClose={() => !busy && setRemoving(null)} footer={<>
      <Button disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button>
      <Button variant="danger" busy={busy} onClick={remove}>Delete</Button>
    </>}>
      <p>{removing.name}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>}
  </div>;
}

function TemplateEditor({ template, onSaved, onClose }) {
  const [name, setName] = useState(template.name);
  const [scope, setScope] = useState(template.scope);
  const [target, setTarget] = useState(template.targetId ? { id: template.targetId, name: template.targetName } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  async function save(event) {
    event.preventDefault();
    if (busy || (scope !== 'company' && !target)) return;
    setBusy(true);
    setError('');
    const body = { name, scope, targetId: target?.id ?? null };
    try {
      if (template.id) await patch(`/appraisals/templates/${template.id}`, { ...body, version: template.version });
      else await post('/appraisals/templates', body);
      toast.success('Template saved');
      onSaved();
    } catch (err) {
      if (err.code === 'approval_pending') {
        toast.success(err.message);
        onSaved();
      } else {
        setError(err.fields?.targetId ?? err.message);
        setBusy(false);
      }
    }
  }

  return <Modal open title={template.id ? 'Edit template' : 'New template'} onClose={() => !busy && onClose()} footer={<>
    <Button disabled={busy} onClick={onClose}>Cancel</Button>
    <Button type="submit" form="appraisal-template-form" variant="primary" busy={busy}
      disabled={scope !== 'company' && !target}>Save template</Button>
  </>}>
    <form id="appraisal-template-form" className="stack" onSubmit={save}>
      <Field label="Template name" required maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} />
      <Field as="select" label="Scope" options={scopeOptions} value={scope} disabled={busy}
        onChange={event => { setScope(event.target.value); setTarget(null); }} />
      {scope !== 'company' && <TemplateTarget key={scope} scope={scope} target={target} onChange={setTarget} disabled={busy} />}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </Modal>;
}

function TemplateTarget({ scope, target, onChange, disabled }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const result = useResource('/appraisals/templates/targets', { scope, search, page, pageSize: PAGE_SIZE });
  const items = result.data?.scope === scope ? result.data.items : [];
  const options = target && !items.some(item => item.id === target.id) ? [target, ...items] : items;
  return <>
    {(search || result.data?.total > PAGE_SIZE) && <Field type="search" label="Search targets" placeholder="Search targets" maxLength={120}
      value={search} disabled={disabled} onChange={event => { setSearch(event.target.value); setPage(1); }} />}
    <Field as="select" label={templateScopeLabels[scope]} placeholder="Choose a target" required
      value={target?.id ?? ''} options={options.map(item => ({ value: item.id, label: item.name }))}
      disabled={disabled || result.loading || !!result.error}
      onChange={event => onChange(options.find(item => String(item.id) === event.target.value) ?? null)} />
    {result.error && <p className="form-error" role="alert">{result.error} <Button size="sm" onClick={result.reload}>Try again</Button></p>}
    {(result.data?.total > PAGE_SIZE || page > 1) && <Pager page={page} pageSize={PAGE_SIZE} total={result.data?.total ?? 0}
      onPage={setPage} disabled={disabled || result.loading} />}
  </>;
}
