import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadDashboard} from '../src/services/dashboard.js';
function fixture(payroll){
 const calls=[],responses=[{rows:[{today:'2026-10-28',clock:'18:00:00',month:'2026-10'}]},
 {rows:[{total_employees:5,present_today:2,late_today:1,absent_today:1,on_leave_today:1,pending_leave:3}]},
 {rows:payroll?[payroll]:[]},{rows:[{id:'4',employee_code:'E4',full_name:'Employee',work_date:'2026-10-28',status:'late',check_in:'09:10',check_out:null}]},
 {rows:[{id:'7',employee_code:'E4',full_name:'Employee',leave_type:'Annual',start_date:'2026-11-02',end_date:'2026-11-03',days:2}]}];
 return {calls,db:{query:async(sql,params)=>{calls.push({sql,params});return responses.shift();}}};
}
test('dashboard returns all metrics and bounded lists with stored monthly net total',async()=>{
 const {db,calls}=fixture({status:'approved',total_minor:'320000',currency_code:'ETB',employee_count:2});
 const d=await loadDashboard(db,{now:'2026-10-28T15:00:00Z'});
 assert.equal(d.stats.totalEmployees,5);assert.equal(d.stats.presentToday,2);assert.equal(d.stats.lateToday,1);
 assert.equal(d.stats.absentToday,1);assert.equal(d.stats.onLeaveToday,1);assert.equal(d.stats.pendingLeave,3);assert.equal(d.payroll.totalMinor,320000);
 assert.equal(d.recentAttendance[0].id,4);assert.equal(d.pendingLeave[0].id,7);
 assert.deepEqual(calls[0].params,['Africa/Addis_Ababa','2026-10-28T15:00:00Z']);
 assert.ok(calls[1].sql.includes('e.start_date<=$1'));assert.ok(calls[1].sql.includes('$2::time>s.end_time'));
 assert.ok(calls[3].sql.includes('LIMIT 8'));assert.ok(calls[4].sql.includes('LIMIT 6'));
 assert.ok(!calls.some(c=>/^(UPDATE|INSERT|DELETE)/.test(c.sql)));
});
test('dashboard distinguishes missing payroll from zero payroll and rejects unsafe totals',async()=>{
 assert.equal((await loadDashboard(fixture().db)).payroll.totalMinor,null);
 assert.equal((await loadDashboard(fixture({status:'draft',total_minor:'0',employee_count:0}).db)).payroll.totalMinor,0);
 await assert.rejects(loadDashboard(fixture({status:'draft',total_minor:'9007199254740993'}).db),/safe money/);
});
