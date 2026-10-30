import {Link,useLocation} from 'react-router-dom';
import {useAuth} from '../api/auth.jsx';
import {canOpenPath,workspaceArea,workspacePath,isAdmin} from '../api/workspaces.js';
import {HR_NAV} from '../components/hrNav.js';
export default function WorkspaceHome(){
 const {user}=useAuth(),{pathname}=useLocation(),finance=workspaceArea(pathname)==='finance';
 return <section className="stack workspace-home"><h1>{finance?'Finance':isAdmin(user)?'Admin':'HR'} workspace</h1><nav className="workspace-grid" aria-label="Workspace pages">{HR_NAV.filter(i=>i.key!=='dashboard'&&canOpenPath(user,workspacePath(i.to,pathname))).map(i=><Link className="card" key={i.key} to={workspacePath(i.to,pathname)}>{i.label}</Link>)}</nav></section>;
}
