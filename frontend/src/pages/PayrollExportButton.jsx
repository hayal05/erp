import { useEffect, useRef, useState } from 'react';
import Button from '../components/Button.jsx';
import { useToast } from '../components/Toast.jsx';
import { getFile } from '../api/client.js';
export default function PayrollExportButton({ period, disabled }) {
  const [busy,setBusy]=useState(false), request=useRef(null);
  const toast=useToast();
  useEffect(()=>()=>request.current?.abort(),[]);
  async function download() {
    if(request.current || disabled) return;
    const ctrl=new AbortController(); request.current=ctrl;setBusy(true);
    try {
      const blob=await getFile(`/payroll/periods/${period.id}/export.csv`,{signal:ctrl.signal});
      if(ctrl.signal.aborted) return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`payroll-${period.month}.csv`;document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e) { if(e.name!=='AbortError') toast.error(e.message || 'Could not export payroll'); }
    finally { request.current=null;if(!ctrl.signal.aborted)setBusy(false); }
  }
  return <Button busy={busy} disabled={disabled} onClick={download}>Export CSV</Button>;
}
