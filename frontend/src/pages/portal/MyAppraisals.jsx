import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../components/Button.jsx';
import Modal from '../../components/Modal.jsx';
import Table, { Pager } from '../../components/Table.jsx';
import { AppraisalScoreFields } from '../AppraisalScorePreview.jsx';
import { ResourceState, useResource } from '../payrollResource.jsx';

const PAGE_SIZE = 15;
const base = '/my-appraisals';

export default function MyAppraisals() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const list = useResource(base, { page, pageSize: PAGE_SIZE });
  const details = useResource(selected ? `${base}/${selected.id}` : null);
  const result = details.loading ? null : details.data;

  return <section className="stack">
    <div className="row between"><h1>My appraisals</h1><Link className="btn sm" to="/portal/profile">My profile</Link></div>
    <Table caption="Approved appraisal results" rows={list.loading ? [] : list.data?.items} loading={list.loading}
      error={list.error} onRetry={list.reload} empty="No approved appraisals yet" columns={[
        { key: 'cycle', header: 'Cycle' },
        { key: 'rating', header: 'Rating', render: row => row.rating.label },
        { key: 'score', header: 'Score', align: 'num', render: row => `${row.rating.score.toFixed(2)}%` },
        { key: 'action', header: 'Action', render: row => <Button size="sm" onClick={() => setSelected(row)}>View result</Button> },
      ]} />
    <Pager page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={setPage} disabled={list.loading} />
    {selected && <Modal open wide title={selected.cycle} onClose={() => setSelected(null)} footer={<Button onClick={() => setSelected(null)}>Close</Button>}>
      <div className="stack">
        <ResourceState loading={details.loading} error={details.error} onRetry={details.reload} />
        {Number(result?.id) === Number(selected.id) && <>
          <AppraisalScoreFields categories={result.template.categories} inputs={result.inputs} result={result.result} disabled review />
          {result.comment && <div><strong>Overall comment</strong><p className="profile-summary">{result.comment}</p></div>}
        </>}
      </div>
    </Modal>}
  </section>;
}
