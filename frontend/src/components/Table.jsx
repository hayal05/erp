import { SkeletonRows } from './Skeleton.jsx';
import { pageInfo } from './pagination.js';
import Button from './Button.jsx';

// Compact data table with loading / error / empty states.
//   columns: [{ key, header, render?: (row) => node, align?: 'num', className? }]
//   <Table columns={cols} rows={items} rowKey="id" loading={busy} error={msg} onRetry={reload} empty="No employees yet" />
export default function Table({ columns, rows = [], rowKey = 'id', caption, loading = false, error = '', onRetry, empty = 'Nothing to show', onRowClick }) {
  const span = columns.length;
  const state = error ? { cls: 'error', node: <><span role="alert">{error}</span>{onRetry && <> <Button size="sm" onClick={onRetry}>Try again</Button></>}</> }
    : !rows.length ? { cls: '', node: empty } : null;

  return (
    // tabIndex: a scrollable region must be reachable by keyboard
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0} aria-busy={loading || undefined}>
      {loading && !error && <span className="sr-only" role="status">Loading {caption || 'records'}…</span>}
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.align === 'num' ? 'num' : c.className}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {loading && !error ? <SkeletonRows columns={span} rows={Math.min(rows.length || 5, 5)} /> : state ? (
            <tr><td colSpan={span} className={`state ${state.cls}`}>{state.node}</td></tr>
          ) : rows.map((row) => (
            <tr key={row[rowKey]} className={onRowClick ? 'clickable' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'num' ? 'num' : c.className}>{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Status chip: text plus colour (never colour alone). tone: ok | warn | danger | info | neutral
export const Badge = ({ tone = 'neutral', children }) => <span className={`badge ${tone}`}>{children}</span>;

// "21-40 of 45" with Previous / Next. `onPage(n)` receives the new page number.
export function Pager({ page, pageSize, total, onPage, disabled = false }) {
  const p = pageInfo({ page, pageSize, total });
  return (
    <nav className="pager" aria-label="Pagination">
      <span aria-live="polite">{p.total === 0 ? 'No results' : `${p.from}–${p.to} of ${p.total}`}</span>
      <span className="row">
        <Button size="sm" disabled={disabled || !p.hasPrev} onClick={() => onPage(p.page - 1)}>Previous</Button>
        <Button size="sm" disabled={disabled || !p.hasNext} onClick={() => onPage(p.page + 1)}>Next</Button>
      </span>
    </nav>
  );
}
