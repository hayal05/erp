import {createContext,useContext} from 'react';
const PageRefreshContext=createContext(0);
export function PageRefreshProvider({version,children}){
  return <PageRefreshContext.Provider value={version}>{children}</PageRefreshContext.Provider>;
}
export const usePageRefresh=()=>useContext(PageRefreshContext);
