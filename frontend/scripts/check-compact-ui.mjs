// Offline markup smoke checks. This does not replace browser layout/keyboard/camera/print QA.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {permissionsFor} from '../../backend/src/services/permissions.js';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{StaticRouter}=require('react-router-dom/server');
const person={id:1,employeeCode:'E-1',fullName:'Example Employee',username:'example',departmentId:1,positionId:1,department:'Operations',position:'Officer',startDate:'2025-01-01',today:'2026-10-30',employmentType:'full_time',status:'active',active:true,shiftId:1,shift:'Day',accessRoles:[],email:null,phone:null,positionHistory:[]};
const period={id:1,month:'2026-10',status:'paid',paidOn:'2026-10-30',currencyCode:'ETB',currency:'ETB',today:'2026-10-30',employeeCount:1};
const entry={id:1,employeeCode:'E-1',employeeName:'Example Employee',basicMinor:100000,allowanceMinor:20000,grossMinor:120000,taxableIncomeMinor:120000,incomeTaxRate:10,incomeTaxFixedDeductionMinor:0,incomeTaxMinor:12000,otherTaxMinor:0,pensionableMinor:100000,employeePensionRate:7,employeePensionMinor:7000,employerPensionRate:11,employerPensionMinor:11000,otherDeductionsMinor:0,netMinor:101000,employerCostMinor:131000};
const salary={entry,period,items:[]},calc={employeePensionRate:7,companyPensionRate:11,taxBase:'basic_plus_taxable_allowance',pensionBase:'basic'};
const vacancy={id:1,title:'Internal officer',department:'Operations',position:'Officer',departmentId:1,positionId:1,closingOn:'2026-12-01',status:'open',acceptingApplications:true,unopened:true,applicationCount:0};
const fixtures={'/retirement':{settings:{retirementAge:60,version:1},today:'2026-11-04',items:[],total:0},'/dashboard':{retirement:{retirementAge:60,nearing:4,passed:2},employeeGender:{male:{count:1,percentage:100},female:{count:0,percentage:0},unspecified:{count:0,percentage:0}},date:'2026-10-30',stats:{totalEmployees:1,presentToday:1,lateToday:0,absentToday:0,onLeaveToday:0,pendingLeave:0},payroll:{...period,totalMinor:101000},recentAttendance:[],pendingLeave:[]},'/vacancies':{items:[vacancy],total:1,today:'2026-10-30'},'/employees':{items:[person],total:1},'/departments':{items:[{id:1,name:'Operations'}],total:1},'/departments/1/positions':{items:[{id:1,name:'Officer'}],total:1},'/payroll-settings/calculation':calc,'/payroll-settings/brackets':{items:[],problems:[]},'/payroll-settings/other-taxes':{items:[],bases:['gross','basic']},'/payroll-settings/attendance-deductions':{absenceDeductionEnabled:true,unpaidLeaveDeductionEnabled:true},'/deductions':{items:[]},'/payslips':{items:[{...period,netMinor:101000}],total:1},'/payslips/1':salary};
const report={id:'monthly-attendance',title:'Monthly attendance summary',group:'Attendance',description:'Uses saved records.',
 filters:[{key:'month',label:'Attendance month',type:'month',required:true}],formats:['xlsx','pdf','docx'],columns:[]};
fixtures['/reports']={today:'2026-10-30',items:[report,{...report,id:'payroll-register',title:'Payroll register',group:'Payroll'}]};
globalThis.__compactReview={user:null,fixtures};
globalThis.document={body:{},documentElement:{dataset:{theme:'dark'}}};
const extraExports={
 'Dashboard.jsx':['DashboardContent'],'Payroll.jsx':['SalaryEditDialog'],'Reports.jsx':['Preview'],
 'IncomeTaxTab.jsx':['TaxBase','BracketEditor','Preview'],'PensionTab.jsx':['PensionForm'],
 'OtherTaxesTab.jsx':['OtherTaxDialog'],'DeductionsTab.jsx':['DeductionDialog'],
 'Settlements.jsx':['PaymentForm','SettlementDetails'],'Vacancies.jsx':['VacancyEditor','Applications','ApplicantProfile'],
 'Announcements.jsx':['AnnouncementEditor'],'AccessManagement.jsx':['AccessDialog'],
};
const server=await createServer({root,configFile:root+'vite.config.js',server:{middlewareMode:true},appType:'custom',plugins:[{
 name:'offline-compact-markup-review',enforce:'pre',transform(code,id,options){
  if(!options?.ssr)return;
  const path=id.split('?')[0];
  if(path.endsWith('/api/auth.jsx'))return `export function useAuth(){return {user:globalThis.__compactReview.user,status:'ready',locked:false,logout(){},login(){},changePassword(){},setLocked(){}};} export const usePermission=p=>useAuth().user.permissions.includes(p); export const AuthProvider=({children})=>children;`;
  if(path.endsWith('/pages/payrollResource.jsx'))return `import Skeleton from '../components/Skeleton.jsx';export function useResource(path){return {data:path?(globalThis.__compactReview.fixtures[path]??{items:[],total:0}):null,loading:false,error:'',reload(){}};} export const ResourceState=({error,loading})=>error?<p role="alert">{error}</p>:loading?<Skeleton/>:null;`;
  // React's server renderer cannot render portals; keep real Modal markup inline for this check.
  if(path.endsWith('/components/Modal.jsx'))return code.replace("import { createPortal } from 'react-dom';",'const createPortal=node=>node;');
  if(path.includes('/pages/')){const names=extraExports[path.split('/').pop()];if(names)return code+'\nexport { '+names.join(',')+' };';}
 }
}]});
let checks=0;
try{
 const {ToastProvider}=await server.ssrLoadModule('/src/components/Toast.jsx');
 async function render(file,name='default',props={},location='/hr'){
  const module=await server.ssrLoadModule('/src/'+file);
  assert.equal(typeof module[name],'function',`${file}: ${name}`);
  const html=renderToStaticMarkup(React.createElement(StaticRouter,{location},React.createElement(ToastProvider,null,React.createElement(module[name],props))));
  assert.ok(!html.includes('NaN'),`${file}: invalid displayed number`);checks++;return html;
 }
 for(const roles of [['admin'],['hr'],['finance'],[]]){
  const user={...person,role:'employee',accessRoles:roles};user.permissions=permissionsFor(user);globalThis.__compactReview.user=user;
  for(const file of ['Retirement','Dashboard','PerformanceAppraisal','WorkspaceHome','Employees','Departments','DepartmentDetail','Attendance','QrAttendance','Leave','Payroll','CompanyCosts','PayrollSettings','Settlements','Approvals','AccessManagement','Announcements','Vacancies','Settings','Login','ChangePassword'])await render(`pages/${file}.jsx`);
  for(const file of ['Profile','History','Leave','Payslips','Scan'])await render(`pages/portal/${file}.jsx`,'default',{},'/portal');
  await render('pages/Vacancies.jsx','default',{employee:true},'/portal/vacancies');
  const postings=await render('pages/Vacancies.jsx');
  assert.equal(postings.includes('Post vacancy'),roles.includes('admin')||roles.includes('hr'),'Posting controls leaked or disappeared');
  const access=await render('pages/AccessManagement.jsx','AccessDialog',{employee:person});
  assert.equal(access.includes('Grant access'),roles.includes('admin'),'Grant controls leaked or disappeared');
  await render('components/HrLayout.jsx');await render('pages/portal/PortalLayout.jsx');await render('pages/portal/PortalLayout.jsx','PortalHome',{},'/portal');
 }
 const user={...person,role:'employee',accessRoles:['admin']};user.permissions=permissionsFor(user);globalThis.__compactReview.user=user;
 for(const theme of ['dark','light']){
  document.documentElement.dataset.theme=theme;
  await render('components/HrLayout.jsx');await render('components/Skeleton.jsx','default',{variant:'dashboard'});
 }
 assert.match(await render('pages/AppraisalTemplates.jsx'), />New template</);
 assert.match(await render('pages/AppraisalCycles.jsx'), />New cycle</);
 assert.match(await render('pages/AppraisalApprovals.jsx'), /Awaiting approval/);
 assert.match(await render('pages/portal/MyAppraisals.jsx','default',{},'/portal/appraisals'), /Approved appraisal results/);
 assert.match(await render('pages/AppraisalCycles.jsx','MyAppraisalAssignments'), /My appraisal assignments/);
 fixtures['/appraisals/templates/1/structure']={version:1,categories:[
  {id:'category-1',name:'Service',weight:10000,criteria:[{id:'criterion-1',name:'Quality',weight:5000}]},
 ]};
 const appraisalWeights=await render('pages/AppraisalWeights.jsx','default',{template:{id:1,name:'Sample template'},onClose(){},onSaved(){}});
 const scoringMarkup=await render('pages/AppraisalScoringRule.jsx','default',{scoring:{
  method:'lookup',cap:100,missing:'required',allowNotApplicable:false,belowScore:0,thresholds:[{minimum:0,score:75}],
 },onChange(){}});
 for(const label of ['Custom scoring table','Score cap','Missing input','Allow not applicable','Add threshold']) assert.ok(scoringMarkup.includes(label));
 const publication=await render('pages/AppraisalPublications.jsx','default',{template:{id:1,name:'Sample template'},onClose(){},onSaved(){}});
 assert.match(publication, /Publish draft/);
 const completeCategories=[{id:'category-1',name:'Service',weight:10000,criteria:[{id:'criterion-1',name:'Quality',weight:10000}]}];
 const scorePreview=await render('pages/AppraisalScorePreview.jsx','default',{categories:completeCategories,brackets:[{label:'Standard',min:0,max:10000}]});
 for(const label of ['Score preview','Category score','Quality','Input required']) assert.ok(scorePreview.includes(label));
 fixtures['/appraisals/reviews/1/1']={employee:'Example Employee',cycle:'Q4',dueOn:'2027-01-15',
  template:{name:'Sample template',version:2,categories:completeCategories,brackets:[{label:'Standard',min:0,max:10000}]},
  review:{version:0,inputs:{},comment:'',submittedAt:null,result:null},
 };
 const reviewerForm=await render('pages/AppraisalReview.jsx','default',{assignment:{cycleId:1,employeeId:1},onClose(){},onChanged(){}});
 for(const label of ['Save draft','Submit appraisal','Overall comment','Quality','Input required']) assert.ok(reviewerForm.includes(label));

 for(const label of ['Add category','Add criterion','Weights incomplete','50.00%','Save draft','Add bracket','Mandatory criterion']) assert.ok(appraisalWeights.includes(label));

 const reportPicker=await render('pages/Reports.jsx');
 assert.match(reportPicker, /<optgroup label="Attendance">/);
 assert.match(reportPicker, /<optgroup label="Payroll">/);
 const reportPreview=await render('pages/Reports.jsx','Preview',{report,today:fixtures['/reports'].today});
 assert.match(reportPreview, /<summary>Notes<\/summary>/);
 assert.match(reportPreview, /Export format/);
 assert.match(reportPreview, /<button[^>]*disabled=""[^>]*>Export<\/button>/);
 assert.ok(!reportPreview.includes('Export Excel'));
 assert.ok(!reportPreview.includes('Date period'));
 fixtures['/reports/appraisal-lookups']={cycles:[{id:1,name:'Q4 review'}],ratings:[{id:'Standard',name:'Standard'}]};
 const appraisalReport={...report,title:'Appraisal results',lookupPath:'/reports/appraisal-lookups',filters:[
  {key:'cycleId',label:'Cycle',type:'select',lookup:'cycles',placeholder:'All cycles'},
  {key:'rating',label:'Rating',type:'select',lookup:'ratings',placeholder:'All ratings'},
 ]};
 const appraisalReportPreview=await render('pages/Reports.jsx','Preview',{report:appraisalReport,today:fixtures['/reports'].today});
 assert.match(appraisalReportPreview, /Q4 review/);
 assert.match(appraisalReportPreview, /Standard/);

 const rangedReport={...report,filters:[
  {key:'from',label:'From date',type:'date',required:true},
  {key:'to',label:'To date',type:'date',required:true},
 ]};
 const rangePreview=await render('pages/Reports.jsx','Preview',{report:rangedReport,today:fixtures['/reports'].today});
 for(const label of ['Weekly','Monthly','Custom range','From date','To date']) assert.ok(rangePreview.includes(label));

 const department={id:1,name:'Operations'},shift={id:1,name:'Day',startTime:'08:00',endTime:'17:00',workDays:[1,2,3,4,5],graceMinutes:10};
 for(const props of [{employee:null},{employee:person}]){
  const html=await render('pages/EmployeeDialog.jsx','default',{...props,departments:[department],shifts:[shift]});
  for(const label of ['Employee ID','Full name','Gender','Date of birth','Field of study','Username','Department','Position','Start date'])assert.ok(html.includes(label),`Employee form lost ${label}`);
 }
 await render('pages/DepartmentDialog.jsx','default',{department});
 const newPosition=await render('pages/PositionDialog.jsx','default',{departmentId:1,position:null});
 assert.match(newPosition, /<button type="button" class="btn sm">Add job grade<\/button>/);
 assert.match(newPosition, /No job grade needed/);
 assert.ok(!newPosition.includes('Monthly basic salary'));
 assert.match(await render('pages/PositionDialog.jsx','default',{departmentId:1,position:{id:1,name:'Officer',basicMinor:100000,allowanceMinor:0}}), /position-name-row[\s\S]*Position name[\s\S]*>Add job grade</);
 assert.match(await render('pages/PositionGrades.jsx','PositionGradeList',{positionId:1,canManage:true}), />Add grade</);
 assert.match(await render('pages/PositionGrades.jsx','PositionGradeList',{positionId:1,canManage:true,startAdding:true}), />Save grade</);
 for(const name of ['HolidayDialog','ShiftDialog'])await render('pages/SettingsDialogs.jsx',name,{holiday:null,year:2026,shift});
 const request={id:1,employee:person.fullName,code:person.employeeCode,type:'Annual',dates:'30 Oct 2026',days:1,reason:'Family event'};
 for(const decision of ['approve','reject'])await render('pages/LeaveDialogs.jsx','DecisionDialog',{request,decision});
 await render('pages/LeaveDialogs.jsx','EntitlementDialog',{employee:person,year:2026,balance:{name:'Annual',entitled:20,adjusted:0,used:1,pending:0}});
 await render('pages/CorrectionDialog.jsx','default',{record:{...person,id:1,workDate:'2026-10-30',status:'present',checkInTime:'08:00',checkOutTime:'17:00'}});
 await render('pages/Payroll.jsx','SalaryEditDialog',{period,entry,field:'basicMinor'});
 for(const action of ['generate','regenerate','approve','pay'])await render('pages/PayrollWorkflowDialog.jsx','default',{action,month:period.month,period,total:1});
 await render('pages/IncomeTaxTab.jsx','TaxBase',{settings:calc});
 await render('pages/IncomeTaxTab.jsx','BracketEditor',{saved:[{fromMinor:0,toMinor:null,rate:10,fixedDeductionMinor:0}],serverProblems:[]});
 await render('pages/IncomeTaxTab.jsx','Preview',{items:[]});await render('pages/PensionTab.jsx','PensionForm',{saved:calc});
 await render('pages/OtherTaxesTab.jsx','OtherTaxDialog',{tax:null,bases:['gross','basic']});await render('pages/DeductionsTab.jsx','DeductionDialog',{item:null,employeeId:1});
 await render('pages/Settlements.jsx','PaymentForm',{period,kind:'income_tax',balance:12000});await render('pages/Settlements.jsx','SettlementDetails',{period,kind:'pension'});
 await render('pages/Announcements.jsx','AnnouncementEditor',{item:{title:'Example',body:'Full message',status:'draft'}});
 await render('pages/Vacancies.jsx','VacancyEditor',{item:vacancy,today:period.today});await render('pages/Vacancies.jsx','Applications',{vacancy});
 const profile=await render('pages/Vacancies.jsx','ApplicantProfile',{profile:{...person,experienceSummary:'Experience remains available',positionHistory:[{id:1,department:'Operations',position:'Officer',recordedOn:'2025-01-01'}]}});
 assert.ok(profile.includes('Experience remains available')&&profile.includes('2025-01-01'),'Applicant snapshot details lost');
 await render('pages/AccessManagement.jsx','AccessDialog',{employee:person});await render('components/UnlockDialog.jsx','default',{open:true});
 const balanceProps={year:2026,items:[{leaveTypeId:1,name:'Annual leave',hasBalance:true,total:20,remaining:12,used:5,pending:3,adjusted:2},{leaveTypeId:2,name:'Unpaid leave',hasBalance:false,used:1,pending:0,adjusted:0}]};
 const balanceMarkup=await render('pages/portal/Leave.jsx','EmployeeLeaveBalances',balanceProps,'/portal/leave');
 for(const value of ['Annual leave','12 days left','No limit'])assert.ok(balanceMarkup.includes(value),`Leave balance lost ${value}`);
 const negativeBalance=await render('pages/portal/Leave.jsx','EmployeeLeaveBalances',{year:2026,items:[{...balanceProps.items[0],remaining:-2,used:21,pending:1}]},'/portal/leave');
 assert.ok(negativeBalance.includes('-2 days left')&&negativeBalance.includes('leave-empty'),'Overspent leave balance is not visible');
 assert.ok(!(await render('pages/portal/Leave.jsx','EmployeeLeaveBalances',{year:2026,items:[]},'/portal/leave')).includes('aria-label="Leave balances'),'Empty balances rendered an unused list');
 const ownProfile={...person,gender:'female',dateOfBirth:'1995-02-28',fieldOfStudy:'Economics',experienceSummary:'Previous role in customer service'};
 const ownProps={profile:ownProfile,history:{items:[{id:1,position:'Officer',department:'Operations',recordedOn:'2025-01-01',baseline:true}],total:1,loading:false,error:''},page:1,summary:ownProfile.experienceSummary,editing:false,busy:false,saveError:''};
 const own=await render('pages/portal/Profile.jsx','ProfileDetails',ownProps,'/portal/profile');
 for(const value of [person.fullName,person.employeeCode,person.username,'Operations','Officer','Personal details &amp; contact','Employment','Previous role in customer service','Starting record','Female','Date of birth','Economics'])assert.ok(own.includes(value),`Employee profile lost ${value}`);
 assert.ok(!own.includes('<input')&&!own.includes('<textarea'),'HR-managed profile facts became editable');
 await render('pages/portal/Profile.jsx','ProfileDetails',{...ownProps,editing:true},'/portal/profile');
 await render('pages/portal/Profile.jsx','ProfileDetails',{...ownProps,profile:{...ownProfile,fullName:'A very long employee name that must wrap in the identity header',email:null,phone:null},history:{items:[],total:0,loading:false,error:''}},'/portal/profile');
 const historyError=await render('pages/portal/Profile.jsx','ProfileDetails',{...ownProps,history:{items:[],total:0,loading:false,error:'History unavailable'}},'/portal/profile');
 assert.ok(historyError.includes('History unavailable')&&historyError.includes('Retry'),'Position history error recovery disappeared');
 const html=await render('pages/SalaryDetailDialog.jsx','SalaryDetails',{data:salary});
 for(const label of ['Basic salary','Allowance','Gross salary','Taxable income','Income tax','Employee pension','Net salary','Total employer cost'])assert.ok(html.includes(label),`Salary detail lost ${label}`);
 assert.ok(html.includes('1,010.00')&&html.includes('1,310.00'),'Saved net/employer totals changed');
 const adminProfile={...person,departmentName:'Operations',positionName:'Officer',shiftName:'Day',gender:'female',dateOfBirth:'1995-11-05',fieldOfStudy:'Economics',experienceSummary:'Planning experience',positionHistory:{items:[{id:1,department:'Historic department',position:'Former Officer',recordedOn:'2025-01-02',baseline:true}],total:1}};
 const adminProfileHtml=await render('pages/EmployeeProfile.jsx','EmployeeProfileDetails',{profile:adminProfile});
 for(const text of ['Personal details','Employment','Contact &amp; account','Experience','Position history','Female','Economics','Planning experience','Historic department','Former Officer','Starting record'])assert.ok(adminProfileHtml.includes(text),`Admin employee profile lost ${text}`);
 assert.ok(!adminProfileHtml.includes('<textarea'),'Admin profile unexpectedly edits employee facts');
 for(const title of ['Incoming attachments','Outgoing attachments'])assert.ok(adminProfileHtml.includes(title),`Profile missing ${title}`);
 const legacyProfile=await render('pages/EmployeeProfile.jsx','EmployeeProfileDetails',{profile:{...adminProfile,gender:null,dateOfBirth:null,fieldOfStudy:null,email:null,phone:null,experienceSummary:'',positionHistory:{items:[],total:0}}});
 assert.ok(legacyProfile.includes('No experience added.')&&legacyProfile.includes('No position history recorded.'),'Legacy profile empty states lost');
 const historyPage=await render('pages/EmployeeProfile.jsx','EmployeeProfileDetails',{profile:{...adminProfile,positionHistory:{...adminProfile.positionHistory,total:12}},page:2,loading:true});
 assert.ok(historyPage.includes('Previous')&&historyPage.includes('aria-busy="true"'),'Profile history pagination/loading lost');
 for(const prefix of ['/hr','/finance']){
  const profileLink=await render('pages/Employees.jsx','EmployeeProfileLink',{employee:person},prefix+'/employees');
  assert.ok(profileLink.includes(`href="${prefix}/employees/1/profile"`)&&profileLink.includes('Profile for Example Employee'),'Employee profile link lost workspace or accessible name');
 }
 const fileItems=[{id:7,fileName:'Employment letter.pdf',byteSize:2048,uploadedBy:'hr.example',uploadedAt:'2026-11-04T12:00:00Z'}];
 const attachmentList=await render('pages/EmployeeAttachments.jsx','AttachmentList',{employeeId:1,items:fileItems});
 for(const text of ['Employment letter.pdf','hr.example','2 KB','Download Employment letter.pdf'])assert.ok(attachmentList.includes(text),`Attachment list lost ${text}`);
 const previousUser=globalThis.__compactReview.user;globalThis.__compactReview.user={role:'employee',permissions:permissionsFor({role:'employee',accessRoles:['finance']})};
 const financeProfile=await render('pages/EmployeeProfile.jsx','EmployeeProfileDetails',{profile:adminProfile});
 assert.ok(!financeProfile.includes('type="file"')&&financeProfile.includes('Incoming attachments'),'Finance can upload or cannot view attachments');globalThis.__compactReview.user=previousUser;
 const scopeRole={activities:['employees.manage','payroll_settings.manage']};
 const scopePicker=await render('pages/CustomAccessRoles.jsx','ScopeSelection',{role:scopeRole,departments:[{id:1,name:'Operations'},{id:2,name:'Finance'}],value:'department:1',onChange(){}});
 assert.ok(scopePicker.includes('value="department:1"')&&scopePicker.includes('value="department:2"'));
 assert.ok(!/<(?:select|option)[^>]*disabled/.test(scopePicker),'Mixed role must not disable department selection');
 assert.ok(scopePicker.includes('Not granted for this scope: Change payroll settings'),'Excluded activity must be shown before granting access');
 const allScope=await render('pages/CustomAccessRoles.jsx','ScopeSelection',{role:scopeRole,value:'all',onChange(){}});
 assert.ok(!allScope.includes('Not granted for this scope'));
 const roleEditor=await render('pages/CustomAccessRoles.jsx','RoleEditor',{role:{name:'Team Leader',activities:['attendance.read','attendance.qr','attendance.qr.lock']},onClose(){},onSaved(){}});
 for(const text of ['Team Leader','Correct attendance','Generate QR codes','Lock and unlock own QR screen','Approve another person','Supports department and employee scopes'])assert.ok(roleEditor.includes(text),`Custom role editor lost ${text}`);
 assert.ok(!roleEditor.includes('access.manage'),'Protected General Admin power appears as a custom checkbox');
 const customManager={...person,role:'employee',accessRoles:[],customGrants:[{name:'Team Leader',scopeType:'departments',departmentIds:[1],employeeIds:[],permissions:['attendance.read','attendance.qr.read','attendance.qr','attendance.qr.lock']}]};customManager.permissions=permissionsFor(customManager);
 const oldUser=globalThis.__compactReview.user;globalThis.__compactReview.user=customManager;
 const customNav=await render('components/HrLayout.jsx');assert.ok(customNav.includes('href="/hr/attendance"')&&!customNav.includes('href="/hr/payroll"')&&!customNav.includes('href="/hr/access-management"'),'Custom role sidebar shows unticked pages');
 await render('pages/QrAttendance.jsx');globalThis.__compactReview.user=oldUser;
 const retireRows=[{id:1,employeeCode:'RET-1',fullName:'Retiring Employee',department:'Operations',position:'Officer',employmentStatus:'active',dateOfBirth:'1966-11-04',age:60,retirementDate:'2026-11-04',daysRemaining:0,status:'reached'},{id:2,employeeCode:'RET-2',fullName:'Upcoming Employee',employmentStatus:'active',dateOfBirth:'1966-11-05',age:59,retirementDate:'2026-11-05',daysRemaining:1,status:'within_year'},{id:3,employeeCode:'RET-3',fullName:'Legacy Employee',employmentStatus:'inactive',dateOfBirth:null,age:null,retirementDate:null,daysRemaining:null,status:'missing_birth_date'},{id:4,employeeCode:'RET-4',fullName:'Overdue Employee',employmentStatus:'active',dateOfBirth:'1966-11-03',age:60,retirementDate:'2026-11-03',daysRemaining:-1,status:'reached'}];
 const retireMarkup=await render('pages/Retirement.jsx','RetirementTable',{items:retireRows});
 for(const text of ['Retiring Employee','1966-11-04','1966-11-05','Retirement age reached','Within one year','Missing birth date','Today','&lt;1 month','&lt;1 month overdue','Inactive'])assert.ok(retireMarkup.includes(text),`Retirement report lost ${text}`);
 const approxRetirement=await render('pages/Retirement.jsx','RetirementTable',{items:[{...retireRows[0],id:11,daysRemaining:400},{...retireRows[0],id:12,daysRemaining:-730}]});
 for(const text of ['≈ 1 year 1 month','≈ 2 years 0 months overdue'])assert.ok(approxRetirement.includes(text),`Approximate retirement time lost ${text}`);
 const unsetRetirement=await render('pages/Retirement.jsx','RetirementAgeForm',{settings:{retirementAge:null,version:1},onSaved(){}});
 assert.ok(unsetRetirement.includes('Retirement age')&&unsetRetirement.includes('placeholder="Years"')&&unsetRetirement.includes('required=""'),'Retirement age setup missing');
 const retirementCard=await render('pages/Dashboard.jsx','DashboardContent',{data:fixtures['/dashboard']});
 for(const text of ['Nearing · 3 months','Passed','>4</dd>','>2</dd>','href="/hr/retirement"'])assert.ok(retirementCard.includes(text),`Dashboard retirement card lost ${text}`);
 const retirementUnset=await render('pages/Dashboard.jsx','DashboardContent',{data:{...fixtures['/dashboard'],retirement:{retirementAge:null,nearing:null,passed:null}}});
 assert.ok(retirementUnset.includes('Retirement age not set')&&!retirementUnset.includes('Nearing · 3 months'),'Unset retirement age shows misleading counts');
 const financeRetirement=await render('pages/Dashboard.jsx','DashboardContent',{data:fixtures['/dashboard']},'/finance');
 assert.ok(financeRetirement.includes('href="/finance/retirement"'),'Retirement link leaves finance workspace');
 const genderDashboard=async(employeeGender,totalEmployees)=>render('pages/Dashboard.jsx','DashboardContent',{data:{...fixtures['/dashboard'],stats:{...fixtures['/dashboard'].stats,totalEmployees},employeeGender}});
 const genderMarkup=await genderDashboard({male:{count:2,percentage:66.7},female:{count:1,percentage:33.3},unspecified:{count:0,percentage:0}},3);
 for(const value of ['Employee gender share','Male','Female','<strong>2</strong>','<strong>1</strong>','(66.7%)','(33.3%)'])assert.ok(genderMarkup.includes(value),`Dashboard gender share lost ${value}`);
 assert.ok(!genderMarkup.includes('Unspecified'),'Unneeded unspecified gender shown');
 const legacyGender=await genderDashboard({male:{count:1,percentage:50},female:{count:0,percentage:0},unspecified:{count:1,percentage:50}},2);
 assert.ok(legacyGender.includes('Unspecified')&&legacyGender.includes('(50%)'),'Missing gender records hidden');
 const emptyGender=await genderDashboard({male:{count:0,percentage:0},female:{count:0,percentage:0},unspecified:{count:0,percentage:0}},0);
 assert.ok(emptyGender.includes('(0%)')&&!/NaN|Infinity/.test(emptyGender),'Empty employee percentages invalid');
 const chartMarkup=await render('pages/Dashboard.jsx','DashboardContent',{data:{...fixtures['/dashboard'],employeeDepartments:[{id:1,name:'Operations',count:8,male:6,female:2,unspecified:0},{id:null,name:'Unassigned',count:2,male:0,female:1,unspecified:1}]}});
 for(const value of ['Gender share','role="img"','Employees by department','Department headcount','Operations','Unassigned','height="184"','Male: 6 (75%)','Female: 2 (25%)','Unspecified: 1 (50%)'])assert.ok(chartMarkup.includes(value),`Dashboard charts lost ${value}`);
 assert.ok(!/NaN|Infinity/.test(emptyGender),'Empty chart has invalid geometry');
 assert.ok(emptyGender.includes('No employees'),'Empty department chart missing');
 const skeleton=await render('components/Skeleton.jsx','default',{variant:'dashboard'});
 assert.ok(skeleton.includes('role="status"')&&skeleton.includes('aria-hidden="true"'),'Skeleton announcements/decorations lost');
 const field=await render('components/Field.jsx','default',{label:'Employee search',type:'search',placeholder:'Name or ID',error:'Example error'});
 for(const match of field.matchAll(/(?:for|aria-describedby)="([^"]+)"/g))for(const id of match[1].split(' '))assert.ok(field.includes(`id="${id}"`),'Field label/error reference has no target');
 console.log(`Passed ${checks} offline render cases plus salary/profile/permission/accessibility assertions.`);
 console.log('Uses local fixtures and inline portals. Does not execute effects, network mutations or browser interactions.');
}finally{await server.close();delete globalThis.__compactReview;delete globalThis.document;}
