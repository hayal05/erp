import { useState } from 'react';
import { getFile } from '../api/client.js';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { ResourceState, useResource } from './payrollResource.jsx';

const PAGE_SIZE = 20;
const formatLabels = { xlsx: 'Excel', pdf: 'PDF', docx: 'Word' };

export default function Reports() {
  const catalog = useResource('/reports');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const reports = catalog.data?.items ?? [];
  const term = search.trim().toLowerCase();
  const visible = reports.filter(report => `${report.title} ${report.group}`.toLowerCase().includes(term));
  const grouped = new Map();
  for (const report of visible) {
    if (!grouped.has(report.group)) grouped.set(report.group, []);
    grouped.get(report.group).push({ value: report.id, label: report.title });
  }
  const groups = [...grouped].map(([label, options]) => ({ label, options }));
  const report = visible.find(item => item.id === selected);

  return <section className="stack reports-page">
    <div className="row between reports-heading">
      <h1>Reports</h1>
      {catalog.data && !!reports.length && <div className="reports-picker">
        <Field label="Search reports" type="search" placeholder="Search reports" value={search}
          onChange={e => setSearch(e.target.value)} />
        <Field hideLabel label="Report" as="select" placeholder={visible.length ? 'Choose a report' : 'No matching reports'}
          value={report?.id ?? ''} groups={groups} disabled={!visible.length}
          onChange={e => setSelected(e.target.value)} />
      </div>}
    </div>
    <ResourceState loading={catalog.loading && !catalog.data} error={catalog.error} onRetry={catalog.reload} />
    {catalog.data && !reports.length && <p className="muted">No reports available</p>}
    {report && <Preview key={report.id} report={report} today={catalog.data.today} />}
  </section>;
}

function Preview({ report, today }) {
  const [filters, setFilters] = useState(() => Object.fromEntries(
    report.filters.map(filter => [filter.key, filter.default ?? (filter.type === 'date' ? today : filter.type === 'month' ? today.slice(0, 7) : filter.key === 'year' ? today.slice(0, 4) : '')])));
  const [submitted, setSubmitted] = useState(null);
  const [page, setPage] = useState(1);
  const [format, setFormat] = useState(report.formats[0]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const needsLookups = report.filters.some(filter => filter.lookup);
  const lookups = useResource(needsLookups ? report.lookupPath ?? '/attendance-records/lookups' : null);
  const lookupOptions = {
    departments: (lookups.data?.departments ?? []).map(department => ({ value: department.id, label: department.name })),
    employees: (lookups.data?.employees ?? [])
      .filter(employee => !filters.departmentId || String(employee.departmentId) === filters.departmentId)
      .map(employee => ({ value: employee.id, label: `${employee.fullName} · ${employee.employeeCode}` })),
  };
  const preview = useResource(submitted ? `/reports/${report.id}/preview` : null,
    { ...submitted, page, pageSize: PAGE_SIZE });

  function run(event) {
    event.preventDefault();
    setExportError('');
    setPage(1);
    setSubmitted({ ...filters });
    preview.reload();
  }

  async function download() {
    setExporting(true);
    setExportError('');
    try {
      const file = await getFile(`/reports/${report.id}/export.${format}`, { query: submitted });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report.id}-${submitted.date ?? submitted.month ?? submitted.year ?? (submitted.from && submitted.to ? `${submitted.from}-to-${submitted.to}` : submitted.from || submitted.to || preview.data?.today || today)}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error.message);
    } finally {
      setExporting(false);
    }
  }

  const filtersChanged = submitted && report.filters.some(filter => filters[filter.key] !== submitted[filter.key]);

  const exportDisabled = Boolean(exporting || !submitted || filtersChanged || preview.loading || !preview.data || preview.error);

  return <section className="stack reports-preview" aria-label={report.title}>
    {lookups.error && <ResourceState error={lookups.error} onRetry={lookups.reload} />}
    <form className="reports-toolbar" onSubmit={run}>
      <div className="reports-filters">{report.filters.map(filter => <Field key={filter.key} label={filter.label} hideLabel={filter.type === 'select' && Boolean(filter.placeholder)}
        as={filter.type === 'select' ? 'select' : undefined}
        type={filter.type === 'select' ? undefined : filter.type}
        placeholder={filter.placeholder} options={filter.options ?? lookupOptions[filter.lookup]}
        disabled={Boolean(filter.lookup && lookups.loading)}
        min={filter.min} max={filter.max}
        required={filter.required} value={filters[filter.key]}
        onChange={e => setFilters(current => ({
          ...current,
          ...(filter.key === 'departmentId' ? { employeeId: '' } : {}),
          [filter.key]: e.target.value,
        }))} />)}</div>
      <div className="reports-actions">
        {report.description && <details className="report-notes">
          <summary>Notes</summary>
          <p>{report.description}</p>
        </details>}
        <Button size="sm" type="submit" variant="primary" busy={preview.loading} disabled={exporting}>Preview</Button>
        {report.formats.length > 1 && <Field hideLabel label="Export format" as="select"
          options={report.formats.map(value => ({ value, label: formatLabels[value] }))}
          value={format} disabled={exportDisabled} onChange={e => setFormat(e.target.value)} />}
        <Button size="sm" busy={exporting} disabled={exportDisabled} onClick={download}>
          {report.formats.length === 1 ? `Export ${formatLabels[format]}` : 'Export'}
        </Button>
      </div>
    </form>
    {exportError && <p role="alert" className="form-error">{exportError}</p>}
    {submitted && <>
      <Table caption={report.title} columns={(preview.data?.columns ?? report.columns).map(column => column.type === 'money'
          ? { ...column, align: 'num', render: row => row[column.key]?.toFixed(2) ?? '' }
          : column)}
        rows={preview.loading ? [] : preview.data?.items} loading={preview.loading}
        error={preview.error} onRetry={preview.reload} empty="No saved records match these filters" />
      {preview.data && !preview.loading && <Pager page={page} pageSize={PAGE_SIZE}
        total={preview.data.total} onPage={setPage} />}
    </>}
  </section>;
}
