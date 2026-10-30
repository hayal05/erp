// Visual placeholders never represent real records or interactive controls.
export function SkeletonBlock({ className = '', width }) {
  return <span aria-hidden="true" className={`skeleton-block ${className}`} style={width ? { width } : undefined} />;
}

export function SkeletonRows({ columns, rows = 5 }) {
  return Array.from({ length: rows }, (_, row) => (
    <tr key={row} aria-hidden="true" className="skeleton-table-row">
      {Array.from({ length: columns }, (_, column) => (
        <td key={column}><SkeletonBlock width={`${[75, 55, 85][(row + column) % 3]}%`} /></td>
      ))}
    </tr>
  ));
}

export default function Skeleton({ variant = 'form', label = 'Loading…', columns = 4 }) {
  const Tag = variant === 'line' ? 'span' : 'div';
  let content;
  if (variant === 'line') content = <SkeletonBlock className="skeleton-inline" />;
  else if (variant === 'image') content = <SkeletonBlock className="skeleton-image" />;
  else if (variant === 'table') content = <div className="table-wrap" aria-hidden="true"><table className="table"><tbody><SkeletonRows columns={columns} /></tbody></table></div>;
  else if (variant === 'cards' || variant === 'dashboard') content = <div className={`skeleton-cards ${variant === 'dashboard' ? 'skeleton-dashboard' : ''}`} aria-hidden="true">
    {Array.from({ length: variant === 'dashboard' ? 4 : 3 }, (_, i) => <div className="card stack" key={i}>
      <SkeletonBlock width="45%" /><SkeletonBlock className="skeleton-heading" width="70%" /><SkeletonBlock width="85%" />
    </div>)}
  </div>;
  else content = <div className="stack" aria-hidden="true">
    <SkeletonBlock className="skeleton-heading" width="40%" />
    <div className="skeleton-fields">{Array.from({ length: variant === 'profile' ? 8 : 4 }, (_, i) => <div className="stack" key={i}>
      <SkeletonBlock width="35%" /><SkeletonBlock className="skeleton-field" />
    </div>)}</div>
    {variant === 'profile' && <SkeletonBlock className="skeleton-image" />}
  </div>;
  return <Tag className={`skeleton skeleton-${variant}`} role="status" aria-busy="true">
    <span className="sr-only">{label}</span>{content}
  </Tag>;
}
