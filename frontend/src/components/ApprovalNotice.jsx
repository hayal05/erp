import {Link,useLocation} from 'react-router-dom';
import {useAuth} from '../api/auth.jsx';
import {workspacePath} from '../api/workspaces.js';
export default function ApprovalNotice(){
 const {approvalNotice,dismissApproval}=useAuth(),{pathname}=useLocation();
 if(!approvalNotice)return null;
 return <div className="notice" role="status"><p>{approvalNotice.message} <Link to={workspacePath('/hr/approvals',pathname)}>View approvals</Link></p><button type="button" onClick={dismissApproval}>Dismiss</button></div>;
}
