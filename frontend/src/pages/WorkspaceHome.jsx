import {Link,useLocation} from 'react-router-dom';
import {useAuth} from '../api/auth.jsx';
import {canOpenPath,workspaceArea,workspacePath} from '../api/workspaces.js';
import {HR_NAV} from '../components/hrNav.js';
export default function WorkspaceHome(){
 const {user}=useAuth(),{pathname}=useLocation(),finance=workspaceArea(pathname)==='finance';
 return <section className="stack"><h1>{finance?'Finance':'HR'} workspace</h1><p>Welcome, {user.fullName}.</p><div className="stack">{HR_NAV.filter(i=>i.key!=='dashboard'&&canOpenPath(user,workspacePath(i.to,pathname))).map(i=><Link className="card" key={i.key} to={workspacePath(i.to,pathname)}>{i.label}</Link>)}</div></section>;
}
