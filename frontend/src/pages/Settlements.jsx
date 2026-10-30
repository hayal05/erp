import Skeleton from '../components/Skeleton.jsx';
import {usePermission} from '../api/auth.jsx';
import AuditBar from '../components/AuditBar.jsx';
import { useEffect,useState } from 'react';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Modal from '../components/Modal.jsx';
import Table,{Badge,Pager} from '../components/Table.jsx';
import { useToast } from '../components/Toast.jsx';
import { get,post } from '../api/client.js';
import { formatMoney } from '../api/money.js';
import { payable,paymentPayload,settlementLabel } from './settlementView.js';
const SIZE=12,DETAIL_SIZE=20;
function useList(path,params,reload){
  const [data,setData]=useState({items:[],total:0,summary:[],loading:true,error:''});
  const query=JSON.stringify(params);
  useEffect(()=>{
    const ctrl=new AbortController();setData(d=>({...d,loading:true,error:''}));
    get(path,JSON.parse(query),{signal:ctrl.signal}).then(r=>{if(!ctrl.signal.aborted)setData({...r,loading:false,error:''});})
      .catch(e=>{if(!ctrl.signal.aborted)setData({items:[],total:0,summary:[],loading:false,error:e.message});});
    return()=>ctrl.abort();
  },[path,query,reload]);return data;
}
export default function Settlements(){
  const [page,setPage]=useState(1),[view,setView]=useState('unsettled'),[reload,setReload]=useState(0),[selected,setSelected]=useState(null);
  const data=useList('/settlements',{page,pageSize:SIZE,view},reload),refresh=()=>setReload(n=>n+1);
  const money=(key,header)=>({key,header,align:'num',render:r=>formatMoney(r[key])});
  const balance=(kind,key,header)=>({key,header,align:'num',render:r=><button type="button" className="salary-cell" onClick={()=>setSelected({period:r,kind})} aria-label={`View ${settlementLabel(kind)} payable for ${r.month}`}>{formatMoney(r[key])}</button>});
  return <section className="stack">
    <div className="row between"><h1>Settlements</h1><Button onClick={refresh} disabled={data.loading}>Refresh</Button></div>
    <p className="muted">Income tax and pension payable from payrolls marked Paid. Pension includes employee and company contributions. Record payments already made to reduce the balance; this does not transfer money.</p>
    {!data.loading&&!data.error&&data.summary?.map(s=><div className="card stack" key={s.currency||'currency'}><strong>Outstanding · {s.currency||'Currency not recorded'}</strong><div className="row"><span>Income tax: <strong>{formatMoney(s.incomeTaxBalanceMinor)}</strong></span><span>Pension: <strong>{formatMoney(s.pensionBalanceMinor)}</strong></span></div></div>)}
    <Field as="select" label="Show" value={view} options={[{value:'unsettled',label:'Unsettled months'},{value:'all',label:'All paid payroll months'}]} onChange={e=>{setView(e.target.value);setPage(1);}} />
    <Table caption="Monthly tax and pension payable" columns={[
      {key:'month',header:'Payroll month'},{key:'currency',header:'Currency'},
      money('incomeTaxMinor','Income tax due'),money('incomeTaxSettledMinor','Tax settled'),balance('income_tax','incomeTaxBalanceMinor','Tax outstanding'),
      money('pensionMinor','Pension due'),money('pensionSettledMinor','Pension settled'),balance('pension','pensionBalanceMinor','Pension outstanding'),
      {key:'status',header:'Status',render:r=><Badge tone={r.incomeTaxBalanceMinor===0&&r.pensionBalanceMinor===0?'ok':'warn'}>{r.incomeTaxBalanceMinor===0&&r.pensionBalanceMinor===0?'Settled':'Unsettled'}</Badge>},
    ]} rows={data.items} loading={data.loading} error={data.error} onRetry={refresh} empty={view==='unsettled'?'No outstanding payables from paid payrolls':'No paid payrolls yet'} />
    <Pager page={page} pageSize={SIZE} total={data.total} onPage={setPage} disabled={data.loading} />
    {selected&&<SettlementDetails key={`${selected.period.id}-${selected.kind}`} {...selected} onClose={()=>setSelected(null)} onRecorded={()=>{setPage(1);refresh();}} />}
  </section>;
}
function SettlementDetails({period,kind,onClose,onRecorded}){
  const canManage=usePermission('settlements.manage');
  const [current,setCurrent]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0),[page,setPage]=useState(1),[historyPage,setHistoryPage]=useState(1),[recording,setRecording]=useState(false),[busy,setBusy]=useState(false);
  const employees=useList(`/payroll/periods/${period.id}/entries`,{page,pageSize:DETAIL_SIZE},reload);
  const history=useList(`/settlements/${period.id}/payments`,{kind,page:historyPage,pageSize:DETAIL_SIZE},reload);
  const refresh=()=>setReload(n=>n+1);
  useEffect(()=>{
    const ctrl=new AbortController();setCurrent(null);setError('');
    get(`/settlements/${period.id}`,{},{signal:ctrl.signal}).then(r=>{if(!ctrl.signal.aborted)setCurrent(r);}).catch(e=>{if(!ctrl.signal.aborted)setError(e.message);});
    return()=>ctrl.abort();
  },[period.id,reload]);
  const label=settlementLabel(kind),amounts=current?payable(current,kind):null;
  const money=(key,header)=>({key,header,align:'num',render:r=>formatMoney(r[key])});
  const cols=[{key:'employeeCode',header:'Employee ID'},{key:'employeeName',header:'Employee name'},...(kind==='income_tax'?[money('taxableIncomeMinor','Taxable income'),money('incomeTaxMinor','Income tax withheld')]
    :[money('pensionableMinor','Pensionable salary'),money('employeePensionMinor','Employee pension'),money('employerPensionMinor','Company pension'),{key:'combined',header:'Total pension',align:'num',render:r=>formatMoney(r.employeePensionMinor+r.employerPensionMinor)}])];
  return <Modal open wide title={`${label} payable · ${period.month}`} onClose={()=>!busy&&onClose()} footer={<Button disabled={busy} onClick={onClose}>Close</Button>} dismissible={!busy}>
    <div className="stack">
      {error?<p className="form-error" role="alert">{error} <Button onClick={refresh}>Retry</Button></p>:!current?<Skeleton label="Loading balance…" />:<>
        <p>{current.currency} · {current.employeeCount} employees · Payroll paid on {current.paidOn}</p>
        <div className="row"><span>Due: <strong>{formatMoney(amounts.due)}</strong></span><span>Settled: <strong>{formatMoney(amounts.paid)}</strong></span><span>Outstanding: <strong>{formatMoney(amounts.balance)}</strong></span></div>
        {kind==='pension'&&<p className="muted">Employee pension: {formatMoney(current.employeePensionMinor)} + company pension: {formatMoney(current.companyPensionMinor)}.</p>}
        {canManage&&amounts.balance>0&&!recording&&<Button variant="primary" onClick={()=>setRecording(true)}>Record payment</Button>}
        {canManage&&recording&&<PaymentForm period={current} kind={kind} balance={amounts.balance} onBusy={setBusy} onConflict={()=>{setRecording(false);refresh();onRecorded();}} onCancel={()=>setRecording(false)} onSaved={()=>{setRecording(false);setHistoryPage(1);refresh();onRecorded();}} />}
      </>}
      <h2>Employee breakdown</h2><p className="muted">Saved payroll liabilities for every employee. Partial settlements apply to this month’s total and are not allocated to individual employees.</p>
      <Table caption={`${label} employee breakdown`} columns={cols} rows={employees.items} loading={employees.loading} error={employees.error} onRetry={refresh} empty="No employee entries" />
      <Pager page={page} pageSize={DETAIL_SIZE} total={employees.total} onPage={setPage} disabled={employees.loading||busy} />
      <h2>Settlement history</h2>
      <Table caption={`${label} settlement history`} columns={[{key:'paymentDate',header:'Payment date'},money('amountMinor','Amount'),{key:'reference',header:'Reference'},{key:'notes',header:'Notes'}, {key:'recordedBy',header:'Recorded by'}]}
        rows={history.items} loading={history.loading} error={history.error} onRetry={refresh} empty="No payments recorded" />
      <Pager page={historyPage} pageSize={DETAIL_SIZE} total={history.total} onPage={setHistoryPage} disabled={history.loading||busy} />
      <AuditBar type="settlement_period" id={period.id} reload={reload}/>
    </div>
  </Modal>;
}
function PaymentForm({period,kind,balance,onBusy,onConflict,onCancel,onSaved}){
  const [form,setForm]=useState({amount:formatMoney(balance),paymentDate:period.today,reference:'',notes:''}),[requestId]=useState(()=>crypto.randomUUID());
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[fields,setFields]=useState({});const toast=useToast();
  const change=key=>e=>setForm(f=>({...f,[key]:e.target.value}));
  async function submit(e){
    e.preventDefault();if(busy)return;const result=paymentPayload(form,balance,period.today,kind,requestId);setFields(result.errors||{});setError('');if(result.errors)return;
    setBusy(true);onBusy(true);
    try{await post(`/settlements/${period.id}/payments`,result.value);toast.success('Settlement payment recorded');onSaved();}
    catch(e){if(e.status===409){toast.error(e.message);onConflict();}else{setError(e.message);setFields(e.fields||{});}}finally{setBusy(false);onBusy(false);}
  }
  return <form className="card stack" onSubmit={submit}>
    <h3>Record {settlementLabel(kind).toLowerCase()} payment</h3>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <Field label={`Amount (${period.currency})`} inputMode="decimal" value={form.amount} onChange={change('amount')} disabled={busy} error={fields.amount||fields.amountMinor} required />
    <Field label="Payment date" type="date" max={period.today} value={form.paymentDate} onChange={change('paymentDate')} disabled={busy} error={fields.paymentDate} required />
    <Field label="Payment reference" value={form.reference} onChange={change('reference')} maxLength={120} disabled={busy} error={fields.reference} required />
    <Field as="textarea" label="Notes (optional)" value={form.notes} onChange={change('notes')} maxLength={1000} disabled={busy} error={fields.notes} />
    <p className="muted">Check the month, amount and reference before saving. Saved payment records cannot be edited or deleted.</p>
    <div className="row"><Button disabled={busy} onClick={onCancel}>Cancel</Button><Button variant="primary" type="submit" busy={busy}>Save payment</Button></div>
  </form>;
}
