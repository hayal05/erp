import {createContext,useContext,useEffect,useRef,useState,useCallback} from 'react';
import {get,post} from './client.js';
const VacancyUnreadContext=createContext({unreadCount:null,refreshUnread:async()=>{},openVacancy:async()=>{}});
export function VacancyUnreadProvider({pathname,visit,children}){
 const [unreadCount,setUnreadCount]=useState(null),latest=useRef(0),mounted=useRef(true);
 const refreshUnread=useCallback(async(signal)=>{
  const ticket=++latest.current;
  try{const result=await get('/vacancies/unread-count',undefined,{signal});if(mounted.current&&ticket===latest.current)setUnreadCount(result.unreadCount);}
  catch(e){if(mounted.current&&ticket===latest.current&&e.name!=='AbortError')setUnreadCount(null);}
 },[]);
 const openVacancy=useCallback(async id=>{
  await post(`/vacancies/${id}/open`);
  // Re-read after each completed write so overlapping responses cannot restore an old count.
  await refreshUnread();
 },[refreshUnread]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;latest.current++;};},[]);
 useEffect(()=>{
  const ctrl=new AbortController();refreshUnread(ctrl.signal);
  const focus=()=>{if(document.visibilityState!=='hidden')refreshUnread(ctrl.signal);};
  window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
  return()=>{ctrl.abort();window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[pathname,visit,refreshUnread]);
 return <VacancyUnreadContext.Provider value={{unreadCount,refreshUnread,openVacancy}}>{children}</VacancyUnreadContext.Provider>;
}
export const useVacancyUnread=()=>useContext(VacancyUnreadContext);
