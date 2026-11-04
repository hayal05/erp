import {useEffect,useRef,useState} from 'react';
import {getFile} from '../api/client.js';
import Button from './Button.jsx';
import {useToast} from './Toast.jsx';
export default function AttachmentDownload({path,fileName,disabled=false,children='Download'}){
 const [busy,setBusy]=useState(false),request=useRef(null),toast=useToast();
 useEffect(()=>()=>request.current?.abort(),[]);
 async function download(){
  if(request.current||disabled)return;const ctrl=new AbortController();request.current=ctrl;setBusy(true);
  try{
   const blob=await getFile(path,{signal:ctrl.signal});if(ctrl.signal.aborted)return;
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=fileName;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){if(e.name!=='AbortError')toast.error(e.message||'Could not download the file');}
  finally{request.current=null;if(!ctrl.signal.aborted)setBusy(false);}
 }
 return <Button size="sm" busy={busy} disabled={disabled} onClick={download} aria-label={`Download ${fileName}`}>{children}</Button>;
}
