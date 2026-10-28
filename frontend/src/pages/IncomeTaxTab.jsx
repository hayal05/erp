import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import { useToast } from '../components/Toast.jsx';
import { patch, put } from '../api/client.js';
import { formatMoney } from '../api/money.js';
import { ResourceState, useResource } from './payrollResource.jsx';
import { MAX_BRACKETS, addBracketRow, bracketRows, bracketsChanged, buildBrackets, previewFor, removeBracketRow,
  serverBracketErrors, setBracketField, validateBracketRows } from './bracketView.js';
import { TAX_BASE_OPTIONS } from './payrollSettingsView.js';

// Income Tax tab (spec 12-13): the bracket table, the taxable-base choice and a worked example.
// Tax = MAX(0, income x rate / 100 - fixed deduction) on the bracket where from <= income < to. The table is saved whole (PUT) and only
// when valid; the server checks again and an invalid table leaves the saved one untouched.
export default function IncomeTaxTab() {
  const brackets = useResource('/payroll-settings/brackets');
  const calc = useResource('/payroll-settings/calculation');
  const [saved, setSaved] = useState(null); // the table as last loaded or saved: [{ fromMinor, toMinor, rate, fixedDeductionMinor }]
  useEffect(() => { if (brackets.data) setSaved(brackets.data.items); }, [brackets.data]);

  // Only the first load replaces the tab; a background reload (after saving the tax base) must not unmount the editor and lose edits.
  if (!brackets.data && (brackets.loading || brackets.error)) return <ResourceState loading={brackets.loading} error={brackets.error} onRetry={brackets.reload} />;
  if (!calc.data && (calc.loading || calc.error)) return <ResourceState loading={calc.loading} error={calc.error} onRetry={calc.reload} />;
  if (!saved) return null;
  const problems = saved === brackets.data.items ? brackets.data.problems : []; // a save returns a usable table
  return (
    <div className="stack">
      <TaxBase settings={calc.data} onSaved={calc.reload} />
      <BracketEditor saved={saved} onSaved={setSaved} serverProblems={problems} />
      <Preview items={saved} />
    </div>
  );
}

function TaxBase({ settings, onSaved }) {
  const toast = useToast();
  const [value, setValue] = useState(settings.taxBase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setValue(settings.taxBase), [settings.taxBase]);

  async function save() {
    setBusy(true); setError('');
    try { await patch('/payroll-settings/calculation', { taxBase: value }); toast.success('Tax base saved'); onSaved(); }
    catch (err) { setError(err.fields?.taxBase || err.message || 'Could not save'); }
    finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <h2>Taxable income</h2>
      <div className="row">
        <Field as="select" label="Income tax is calculated on" value={value} options={TAX_BASE_OPTIONS} error={error}
          onChange={(e) => { setValue(e.target.value); setError(''); }} />
        <Button variant="primary" busy={busy} disabled={value === settings.taxBase} onClick={save}>Save tax base</Button>
      </div>
      <p className="muted">Applies to drafts generated from now on. Approved payroll keeps the values it was approved with.</p>
    </div>
  );
}

function BracketEditor({ saved, onSaved, serverProblems }) {
  const toast = useToast();
  const [rows, setRows] = useState(() => bracketRows(saved));
  const [attempted, setAttempted] = useState(false); // show inline errors only after the first Save click
  const [server, setServer] = useState(null);         // errors from a 400, cleared by the next edit
  const [busy, setBusy] = useState(false);

  const local = validateBracketRows(rows);
  const view = server ?? (attempted ? local : { rows: {}, problems: [] });
  const changed = bracketsChanged(rows, saved);
  const edit = (next) => { setRows(next); setServer(null); };

  async function save() {
    setAttempted(true);
    if (Object.keys(local.rows).length || local.problems.length) return;
    setBusy(true);
    try {
      const res = await put('/payroll-settings/brackets', buildBrackets(rows));
      onSaved(res.items); setRows(bracketRows(res.items)); setServer(null); setAttempted(false);
      toast.success('Income tax brackets saved');
    } catch (err) {
      if (err.status === 400 && Object.keys(err.fields).length) setServer(serverBracketErrors(err.fields));
      else toast.error(err.message || 'Could not save. Nothing was changed.');
    } finally { setBusy(false); }
  }
  const discard = () => { setRows(bracketRows(saved)); setServer(null); setAttempted(false); };

  return (
    <div className="stack">
      <h2>Income tax brackets</h2>
      {serverProblems.length > 0 && !changed && (
        <div className="form-error" role="alert">The saved table cannot be used for payroll yet: {serverProblems.join('; ')}.</div>
      )}
      <div className="table-wrap">
        <table className="table bracket-table">
          <thead>
            <tr><th>#</th><th>From</th><th>To <span className="muted">(blank = no limit)</span></th><th>Rate %</th><th>Fixed deduction</th><th><span className="sr-only">Remove</span></th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="nowrap">{i + 1}</td>
                {[['from', 'From'], ['to', 'To'], ['rate', 'Rate'], ['deduction', 'Fixed deduction']].map(([f, label]) => (
                  <td key={f}>
                    <input className="bracket-input" inputMode="decimal" value={r[f]} aria-label={`Bracket ${i + 1} ${label}`}
                      placeholder={f === 'to' ? 'No limit' : ''} aria-invalid={view.rows[i]?.[f] ? true : undefined}
                      onChange={(e) => edit(setBracketField(rows, i, f, e.target.value))} />
                    {view.rows[i]?.[f] && <small className="field-error">{view.rows[i][f]}</small>}
                  </td>
                ))}
                <td><Button size="sm" aria-label={`Remove bracket ${i + 1}`} onClick={() => edit(removeBracketRow(rows, i))}><Trash2 size={16} aria-hidden="true" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.problems.length > 0 && <ul className="form-error" role="alert">{view.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="row">
        <Button disabled={rows.length >= MAX_BRACKETS} onClick={() => edit(addBracketRow(rows))}><Plus size={16} aria-hidden="true" /> Add bracket</Button>
        <span className="grow" />
        <Button disabled={!changed || busy} onClick={discard}>Discard changes</Button>
        <Button variant="primary" busy={busy} disabled={!changed} onClick={save}>Save brackets</Button>
      </div>
    </div>
  );
}

// Worked example from the SAVED table (display only; payroll is always calculated by the server).
function Preview({ items }) {
  const [text, setText] = useState('');
  const r = previewFor(text, items);
  return (
    <div className="stack">
      <h2>Try an income</h2>
      <Field label="Monthly taxable income" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)}
        error={r.kind === 'error' ? r.message : ''} placeholder="e.g. 2,500" />
      <p role="status" className="muted">
        {r.kind === 'tax' && <>Bracket {r.position}: income tax is <strong>{formatMoney(r.taxMinor)}</strong>.</>}
        {r.kind === 'none' && 'No saved bracket matches this income.'}
        {r.kind === 'empty' && 'Type an income to see the tax from the saved table.'}
      </p>
    </div>
  );
}
