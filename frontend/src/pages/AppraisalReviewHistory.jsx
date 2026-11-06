import { useState } from 'react';
import Table, { Pager } from '../components/Table.jsx';
import { useResource } from './payrollResource.jsx';

const PAGE_SIZE = 10;
const labels = { save: 'Draft saved', submit: 'Submitted', approve: 'Approved', return: 'Returned' };

export default function AppraisalReviewHistory({ path, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [page, setPage] = useState(1);
  const history = useResource(open ? path + '/history' : null, { page, pageSize: PAGE_SIZE });
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="stack">
    <summary>Review history</summary>
    {open && <>
      <Table caption="Review history" rows={history.loading ? [] : history.data?.items} loading={history.loading}
        error={history.error} onRetry={history.reload} empty="No review activity" columns={[
          { key: 'action', header: 'Action', render: row => labels[row.action.split('.').at(-1)] ?? row.action },
          { key: 'actor', header: 'By', render: row => row.actor ?? '—' },
          { key: 'at', header: 'Date', render: row => new Date(row.at).toLocaleString() },
          { key: 'reason', header: 'Note', render: row => row.reason || '—' },
        ]} />
      <Pager page={page} pageSize={PAGE_SIZE} total={history.data?.total ?? 0} onPage={setPage} disabled={history.loading} />
    </>}
  </details>;
}
