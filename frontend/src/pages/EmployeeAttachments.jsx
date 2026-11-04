import {useEffect,useRef,useState} from 'react';
import {usePermission} from '../api/auth.jsx';
import {post} from '../api/client.js';
import {useResource} from './payrollResource.jsx';
import Button from '../components/Button.jsx';
import Field from '../components/Field.jsx';
import Table,{Pager} from '../components/Table.jsx';
import AttachmentDownload from '../components/AttachmentDownload.jsx';
import {useToast} from '../components/Toast.jsx';
const SIZE=5,MAX=5*1024*1024;
export const ATTACHMENT_ACCEPT='.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp';
const titles={incoming:'Incoming attachments',outgoing:'Outgoing attachments'};
function base64(file,signal){return new Promise((resolve,reject)=>{
 const reader=new FileReader(),abort=()=>reader.abort();
 const finish=fn=>value=>{signal.removeEventListener('abort',abort);fn(value);};
 reader.onload=finish(()=>resolve(String(reader.result).split(',')[1]));reader.onerror=finish(()=>reject(new Error('Could not read the file')));reader.onabort=finish(()=>reject(new DOMException('Cancelled','AbortError')));
 signal.addEventListener('abort',abort,{once:true});reader.readAsDataURL(file);
});}
export default function EmployeeAttachments({employeeId,direction}){
 const canManage=usePermission('employees.manage'),[page,setPage]=useState(1),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[inputKey,setInputKey]=useState(0);
 const request=useRef(null),toast=useToast();
 useEffect(()=>()=>request.current?.abort(),[]);
 const r=useResource(`/employees/${employeeId}/attachments`,{direction,page,pageSize:SIZE});
 async function upload(e){
  e.preventDefault();if(!file||request.current)return;setError('');setNotice('');
  if(file.size>MAX||!file.size){setError('Choose a file between 1 byte and 5 MB');return;}
  const ctrl=new AbortController();request.current=ctrl;setBusy(true);
  const reset=()=>{setFile(null);setInputKey(n=>n+1);};
  try{await post(`/employees/${employeeId}/attachments`,{direction,fileName:file.name,fileBase64:await base64(file,ctrl.signal)},{signal:ctrl.signal});reset();setPage(1);r.reload();toast.success('Attachment added');}
  catch(e){if(e.name!=='AbortError'){if(e.code==='approval_pending'){setNotice('Submitted for approval');reset();}else setError(e.message);}}
  finally{request.current=null;if(!ctrl.signal.aborted)setBusy(false);}
 }
 return <section className="card stack employee-profile-section employee-attachments"><h2>{titles[direction]}</h2>
  {canManage&&<form className="attachment-upload" onSubmit={upload}>
   <Field key={inputKey} type="file" label={`${titles[direction]} file`} hideLabel accept={ATTACHMENT_ACCEPT} disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setError('');setNotice('');}}/>
   <Button size="sm" type="submit" busy={busy} disabled={!file}>Upload</Button>
   <small className="muted attachment-limit">PDF, Word, Excel or picture · Max 5 MB</small>
  </form>}
  {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="muted" role="status">{notice}</p>}
  <AttachmentList employeeId={employeeId} items={r.data?.items??[]} loading={r.loading} error={r.error} onRetry={r.reload} caption={titles[direction]}/>
  {(r.data?.total>SIZE||page>1)&&<Pager page={page} pageSize={SIZE} total={r.data?.total??0} onPage={setPage} disabled={r.loading}/>} 
 </section>;
}
export function AttachmentList({employeeId,items,loading=false,error='',onRetry,caption='Attachments'}){
 return <Table caption={caption} rows={items} loading={loading} error={error} onRetry={onRetry} empty="No attachments" columns={[
  {key:'fileName',header:'File',render:r=><div className="attachment-name"><strong>{r.fileName}</strong><small className="muted">{Math.max(1,Math.ceil(r.byteSize/1024))} KB · {r.uploadedBy}</small></div>},
  {key:'uploadedAt',header:'Uploaded',render:r=><time dateTime={r.uploadedAt}>{new Date(r.uploadedAt).toLocaleDateString()}</time>},
  {key:'download',header:<span className="sr-only">Download</span>,render:r=><AttachmentDownload path={`/employees/${employeeId}/attachments/${r.id}/download`} fileName={r.fileName}/>}
 ]}/>;
}
