import {usePageRefresh} from '../../api/pageRefresh.jsx';
import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import Table, { Badge, Pager } from '../../components/Table.jsx';
import { get } from '../../api/client.js';
import { historyRow } from './attendanceView.js';

const PAGE_SIZE = 20;

// Employee's own attendance history (spec 3, 7 step 5). The server returns only the signed-in person's rows (GET /attendance/mine);
// times are company-timezone HH:MM strings shown as they are. No photos here: selfies are for HR review only.
export default function History() {
  const pageRefresh = usePageRefresh();
  const [range, setRange] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [state, setState] = useState({ loading: true, error: '' });
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const rangeBad = Boolean(range.from && range.to && range.from > range.to);

  useEffect(() => {
    if (rangeBad) return undefined; // the server would answer 400; the form already says why
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get('/attendance/mine', { page, pageSize: PAGE_SIZE, ...(range.from && { from: range.from }), ...(range.to && { to: range.to }) }, { signal: ctrl.signal })
      .then((res) => { setData(res); setState({ loading: false, error: '' }); })
      .catch((e) => { if (e.name !== 'AbortError') setState({ loading: false, error: e.message }); });
    return () => ctrl.abort();
  }, [page, range, rangeBad, reload, pageRefresh]);

  const setDate = (k) => (e) => { setRange((r) => ({ ...r, [k]: e.target.value })); setPage(1); };
  const filtered = Boolean(range.from || range.to);
  const rows = rangeBad ? [] : data.items.map(historyRow);

  const columns = [
    { key: 'date', header: 'Date', className: 'nowrap' },
    { key: 'checkIn', header: 'In', className: 'nowrap' },
    { key: 'checkOut', header: 'Out', className: 'nowrap' },
    { key: 'status', header: 'Status', render: (r) => (
      <>
        <Badge tone={r.tone}>{r.status}</Badge>
        {r.corrected && <><br /><small className="muted">Adjusted by HR</small></>}
      </>
    ) },
  ];

  return (
    <section className="stack">
      <div className="row between">
        <h1>My attendance</h1>
        {filtered && <Button onClick={() => { setRange({ from: '', to: '' }); setPage(1); }}>Clear dates</Button>}
      </div>
      <div className="toolbar toolbar-2">
        <Field label="From" type="date" value={range.from} onChange={setDate('from')} />
        <Field label="To" type="date" value={range.to} onChange={setDate('to')} error={rangeBad ? 'Must be on or after the start date' : undefined} />
      </div>
      <Table caption="My attendance records" columns={columns} rows={rows} loading={state.loading} error={state.error} onRetry={refresh}
        empty={filtered ? 'No attendance records in these dates' : 'No attendance recorded yet. Scan the office QR code to check in.'} />
      <Pager page={page} pageSize={PAGE_SIZE} total={rangeBad ? 0 : data.total} onPage={setPage} disabled={state.loading} />
    </section>
  );
}
