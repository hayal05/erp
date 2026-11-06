import { useState } from 'react';
import { getFile } from '../api/client.js';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Table, { Pager } from '../components/Table.jsx';
import { ResourceState, useResource } from './payrollResource.jsx';

const PAGE_SIZE = 20;

export default function Reports() {
  const catalog = useResource('/reports');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const reports = catalog.data?.items ?? [];
  const visible = reports.filter(report =>
    `${report.title} ${report.group}`.toLowerCase().includes(search.trim().toLowerCase()));
  const report = reports.find(item => item.id === selected);

  return <section className="stack">
    <h1>Reports</h1>
    <ResourceState loading={catalog.loading} error={catalog.error} onRetry={catalog.reload} />
    {catalog.data && <>
      <div className="row">
        <Field label="Search reports" type="search" placeholder="Search reports" value={search} onChange={e => setSearch(e.target.value)} />
        <Field label="Report" as="select" placeholder="Choose a report" value={visible.some(item => item.id === selected) ? selected : ''}
          options={visible.map(item => ({ value: item.id, label: item.title }))}
          onChange={e => setSelected(e.target.value)} />
      </div>
      {!visible.length && <p className="muted">{reports.length ? 'No matching reports' : 'No reports available'}</p>}
      {report && visible.includes(report) && <Preview key={report.id} report={report} today={catalog.data.today} />}
    </>}
  </section>;
}

function Preview({ report, today }) {
  const [filters, setFilters] = useState(() => Object.fromEntries(
    report.filters.map(filter => [filter.key, filter.type === 'date' ? today : ''])));
  const [submitted, setSubmitted] = useState(null);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const needsLookups = report.filters.some(filter => filter.lookup);
  const lookups = useResource(needsLookups ? '/attendance-records/lookups' : null);
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
      const file = await getFile(`/reports/${report.id}/export.xlsx`, { query: submitted });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report.id}-${submitted.date}.xlsx`;
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

  return <section className="stack">
    {lookups.error && <ResourceState error={lookups.error} onRetry={lookups.reload} />}
    <form className="row" onSubmit={run}>
      {report.filters.map(filter => <Field key={filter.key} label={filter.label}
        as={filter.type === 'select' ? 'select' : undefined}
        type={filter.type === 'select' ? undefined : filter.type}
        placeholder={filter.placeholder} options={filter.options ?? lookupOptions[filter.lookup]}
        disabled={Boolean(filter.lookup && lookups.loading)}
        required={filter.required} value={filters[filter.key]}
        onChange={e => setFilters(current => ({
          ...current,
          ...(filter.key === 'departmentId' ? { employeeId: '' } : {}),
          [filter.key]: e.target.value,
        }))} />)}
      <Button size="sm" type="submit" variant="primary" busy={preview.loading} disabled={exporting}>Preview</Button>
      {report.formats.includes('xlsx') && <Button size="sm" busy={exporting}
        disabled={!submitted || filtersChanged || preview.loading || !preview.data || Boolean(preview.error)}
        onClick={download}>Export Excel</Button>}
    </form>
    {exportError && <p role="alert" className="form-error">{exportError}</p>}
    {submitted && <>
      <Table caption={report.title} columns={report.columns}
        rows={preview.loading ? [] : preview.data?.items} loading={preview.loading}
        error={preview.error} onRetry={preview.reload} empty="No saved records match these filters" />
      {preview.data && !preview.loading && <Pager page={page} pageSize={PAGE_SIZE}
        total={preview.data.total} onPage={setPage} />}
    </>}
  </section>;
}
