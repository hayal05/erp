import AuditBar from '../components/AuditBar.jsx';
import {useAuth} from '../api/auth.jsx';
import {allowed} from '../api/workspaces.js';
import {workspacePath,workspaceArea} from '../api/workspaces.js';
import AttendanceDeductionSettings from './AttendanceDeductionSettings.jsx';
import { useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import DeductionsTab from './DeductionsTab.jsx';
import IncomeTaxTab from './IncomeTaxTab.jsx';
import OtherTaxesTab from './OtherTaxesTab.jsx';
import PensionTab from './PensionTab.jsx';
import { PAYROLL_TABS, tabForKey, tabFromParam } from './payrollSettingsView.js';

// Payroll settings (spec 12): Income Tax, Pension, Other Taxes, Other Deductions. This is the shell: tabs, loading and error states.
// All four tabs are real components now. The server enforces everything; HR only (locked tablet gets 423).
export default function PayrollSettings() {
  const {user}=useAuth();
  const readOnly=!allowed(user,'payroll_settings.manage');
  const {pathname}=useLocation();
  const [params, setParams] = useSearchParams();
  const active = tabFromParam(params.get('tab'));
  const refs = useRef({});
  const choose = (key, focus) => {
    setParams(key === PAYROLL_TABS[0].key ? {} : { tab: key }, { replace: true });
    if (focus) refs.current[key]?.focus();
  };
  const onKey = (e) => {
    const next = tabForKey(active, e.key);
    if (next) { e.preventDefault(); choose(next, true); }
  };

  return (
    <section className="stack">
      <div>
        <p className="muted"><Link to={workspaceArea(pathname)==='finance'?'/finance/payroll':'/hr/settings'}>{workspaceArea(pathname)==='finance'?'← Payroll':'← Settings'}</Link></p>
        <h1>Payroll settings</h1>
      </div>
      <div className="tabs" role="tablist" aria-label="Payroll settings" onKeyDown={onKey}>
        {PAYROLL_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-controls={`panel-${t.key}`}
            aria-selected={t.key === active} tabIndex={t.key === active ? 0 : -1} className="tab"
            ref={(el) => { refs.current[t.key] = el; }} onClick={() => choose(t.key, false)}>{t.label}</button>
        ))}
      </div>
      {readOnly && <p className="muted">Payroll settings are read-only for HR. Finance or Admin manages these settings.</p>}
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="card">
        <fieldset disabled={readOnly && active!=='other-deductions'} style={{border:0,padding:0,margin:0,minWidth:0}}>
        {active === 'income-tax' ? <IncomeTaxTab /> : active === 'pension' ? <PensionTab /> : active === 'other-taxes' ? <OtherTaxesTab /> : <div className="stack"><fieldset disabled={readOnly} style={{border:0,padding:0,margin:0}}><AttendanceDeductionSettings /></fieldset><DeductionsTab readOnly={readOnly} /></div>}
        </fieldset>
      </div>
      <AuditBar type="payroll_settings" id={1} reload={active} />
    </section>
  );
}
