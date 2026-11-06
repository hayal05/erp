import { useState } from 'react';
import { post } from '../api/client.js';
import Button from '../components/Button.jsx';
import Modal from '../components/Modal.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import AppraisalScorePreview from './AppraisalScorePreview.jsx';
import { ResourceState, useResource } from './payrollResource.jsx';

const PAGE_SIZE = 10;

export default function AppraisalPublications({ template, onClose, onSaved }) {
  const base = `/appraisals/templates/${template.id}`;
  const draft = useResource(base + '/structure');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(null);
  const history = useResource(base + '/publications', { page, pageSize: PAGE_SIZE });
  const selected = useResource(version ? `${base}/publications/${version}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const ready = draft.data?.weights?.ready && draft.data?.ratings?.ready;
  const published = template.publishedVersion === draft.data?.version;

  async function publish() {
    if (busy || !ready || published) return;
    setBusy(true);
    setError('');
    try {
      await post(base + '/publications', { version: draft.data.version });
      toast.success('Template published');
      onSaved();
    } catch (err) {
      if (err.code === 'approval_pending') {
        toast.success(err.message);
        onSaved();
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return <Modal open wide title={`Publish · ${template.name}`} dismissible={!busy} onClose={() => !busy && onClose()}
    footer={<><Button disabled={busy} onClick={onClose}>Close</Button>
      <Button variant="primary" busy={busy} disabled={!ready || published || draft.loading || !!draft.error} onClick={publish}>Publish draft</Button></>}>
    <div className="stack">
      <ResourceState loading={draft.loading} error={draft.error} onRetry={draft.reload} />
      {draft.data && <p>{published ? `Version ${draft.data.version} is published.`
        : ready ? `Publish version ${draft.data.version} as a fixed copy of the current saved draft.`
        : 'Complete the category weights, criterion weights, and rating brackets before publishing.'}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <Table caption="Published versions" rowKey="version" rows={history.loading ? [] : history.data?.items}
        loading={history.loading} error={history.error} onRetry={history.reload} empty="No published versions" columns={[
          { key: 'version', header: 'Version' }, { key: 'name', header: 'Name' },
          { key: 'publishedAt', header: 'Published', render: row => new Date(row.publishedAt).toLocaleString() },
          { key: 'preview', header: 'Preview', render: row => <Button size="sm" aria-label={`Preview version ${row.version}`}
            onClick={() => setVersion(row.version)}>Preview</Button> },
        ]} />
      <Pager page={page} pageSize={PAGE_SIZE} total={history.data?.total ?? 0} onPage={setPage} disabled={history.loading} />
      <ResourceState loading={selected.loading} error={selected.error} onRetry={selected.reload} />
      {version && selected.data?.version === version && <div className="stack">
        <strong>Published version {version}</strong>
        <AppraisalScorePreview key={version} categories={selected.data.categories} brackets={selected.data.brackets} disabled={busy} />
      </div>}
    </div>
  </Modal>;
}
