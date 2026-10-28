import { useCallback, useEffect, useState } from 'react';
import Button from '../components/Button.jsx';
import { get } from '../api/client.js';

// Loads one GET endpoint for a payroll settings tab: { data, loading, error, reload }. Stale responses are aborted when the
// path changes or the tab unmounts. `path` null = nothing to load yet.
export function useResource(path, query) {
  const [state, setState] = useState({ data: null, loading: !!path, error: '' });
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  const key = JSON.stringify(query ?? null);
  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: '' }); return undefined; }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    get(path, query, { signal: ctrl.signal })
      .then((data) => setState({ data, loading: false, error: '' }))
      .catch((e) => { if (e.name !== 'AbortError') setState({ data: null, loading: false, error: e.message || 'Could not load' }); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, n]);
  return { ...state, reload };
}

// Shared loading / error block for the tab bodies. Renders nothing when there is data to show.
export function ResourceState({ loading, error, onRetry }) {
  if (loading) return <p className="muted" aria-busy="true" role="status">Loading…</p>;
  if (error) return (
    <div className="stack" role="alert"><p className="form-error">{error}</p><div><Button onClick={onRetry}>Try again</Button></div></div>
  );
  return null;
}
