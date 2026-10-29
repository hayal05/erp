import {useLocation,useNavigate} from 'react-router-dom';
import {useAuth} from '../api/auth.jsx';
import {workspaceOptions} from '../api/workspaces.js';
export default function WorkspaceSwitcher(){
 const {user}=useAuth(),{pathname}=useLocation(),navigate=useNavigate(),options=workspaceOptions(user);
 if(options.length<2)return null;
 const current=options.find(o=>pathname===o.to||pathname.startsWith(o.to+'/'))?.to||options[0].to;
 return <label className="field"><span className="sr-only">Workspace</span><select aria-label="Workspace" value={current} onChange={e=>navigate(e.target.value)}>{options.map(o=><option key={o.key} value={o.to}>{o.label}</option>)}</select></label>;
}
