import {useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import Table,{Badge,Pager} from '../../components/Table.jsx';
import Button from '../../components/Button.jsx';
import {formatMoney} from '../../api/money.js';
import {useResource,ResourceState} from '../payrollResource.jsx';
import {SalaryDetails} from '../SalaryDetailDialog.jsx';
import {periodIdFromParam} from '../salarySheetView.js';
const PAGE_SIZE=12;
export default function Payslips(){
 const [page,setPage]=useState(1);
 const resource=useResource('/payslips',{page,pageSize:PAGE_SIZE});
 const columns=[{key:'month',header:'Month'},{key:'status',header:'Status',render:r=><Badge tone="ok">{r.status==='paid'?'Paid':'Approved'}</Badge>},
  {key:'netMinor',header:'Net salary',align:'num',render:r=>`${formatMoney(r.netMinor)} ${r.currencyCode}`},
  {key:'view',header:'Payslip',render:r=><Link className="btn sm" to={`/portal/payslips/${r.id}`} aria-label={`View payslip for ${r.month}`}>View</Link>}];
 return <section className="stack portal-payslips-page"><h1>My payslips</h1>
  <Table caption="My payslips" columns={columns} rows={resource.data?.items??[]} loading={resource.loading} error={resource.error} onRetry={resource.reload} empty="No payslips released yet."/>
  <Pager page={page} pageSize={PAGE_SIZE} total={resource.data?.total??0} onPage={setPage} disabled={resource.loading}/>
 </section>;
}
export function Payslip(){
 const {id}=useParams();
 const parsed=periodIdFromParam(id);
 if(!parsed)return <section className="stack"><h1>Payslip</h1><p role="alert">Payslip not found.</p><Link to="/portal/payslips">Back to payslips</Link></section>;
 return <PayslipBody key={parsed} id={parsed}/>;
}
function PayslipBody({id}){
 const {data,loading,error,reload}=useResource(`/payslips/${id}`);
 return <section className="stack">
  <div className="row between no-print"><Link className="btn sm" to="/portal/payslips">← Payslips</Link>{data&&<Button size="sm" onClick={()=>window.print()}>Print payslip</Button>}</div>
  {!data?<ResourceState loading={loading} error={error} onRetry={reload}/>:<article className="payslip-paper card stack" aria-label={`Payslip for ${data.period.month}`}>
   <header><p className="muted">{data.companyName}</p><h1>Payslip · {data.period.month}</h1><h2>{data.entry.employeeName}</h2></header>
   {data.paidOn&&<p>Payment date: {data.paidOn}</p>}
   <SalaryDetails data={data}/>
  </article>}
 </section>;
}
