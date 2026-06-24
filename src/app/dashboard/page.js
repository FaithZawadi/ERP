'use client';
// src/app/dashboard/page.js
// Full QSL ERP Dashboard — all modules wired to Next.js API routes

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// ── DESIGN TOKENS ────────────────────────────────────────────────────────────
const T = {
  navy:'#1B3A5C',navyD:'#0D2238',navyL:'#2E5F8A',gold:'#C8960C',
  white:'#FFFFFF',offwt:'#F0F4F8',lgrey:'#E8ECF0',mgrey:'#94A3B8',
  dgrey:'#334155',green:'#1E6B3C',greenL:'#DCFCE7',red:'#C00000',
  redL:'#FEE2E2',amber:'#B8600B',amberL:'#FEF3C7',blue:'#0070C0',
  blueL:'#EFF6FF',purple:'#6A0DAD',purpleL:'#F3E8FF',
};

// ── UTILITY ──────────────────────────────────────────────────────────────────
const fmt = {
  kes: n => n==null?'—':`Kshs ${Number(n).toLocaleString('en-KE')}`,
  pct: n => n==null?'—':`${(n*100).toFixed(1)}%`,
  date: d => d ? new Date(d).toLocaleDateString('en-KE',{day:'2-digit',month:'short',year:'numeric'}) : '—',
  num: n => n==null?'—':Number(n).toLocaleString(),
};

// ── SHARED UI COMPONENTS ──────────────────────────────────────────────────────
const cs = (obj) => Object.entries(obj).filter(([,v])=>v).map(([k])=>k).join(' ');

function Badge({ children, variant='default', size='sm' }) {
  const map = {
    green:{bg:T.greenL,color:T.green}, red:{bg:T.redL,color:T.red},
    amber:{bg:T.amberL,color:T.amber}, blue:{bg:T.blueL,color:T.blue},
    navy:{bg:'#DCE8F5',color:T.navy}, purple:{bg:T.purpleL,color:T.purple},
    default:{bg:T.lgrey,color:T.dgrey},
  };
  const s=map[variant]||map.default;
  return <span style={{background:s.bg,color:s.color,padding:size==='sm'?'2px 8px':'4px 12px',borderRadius:20,fontSize:size==='sm'?11:12,fontWeight:600,whiteSpace:'nowrap',display:'inline-block'}}>{children}</span>;
}

function Card({ children, style={}, onClick }) {
  return <div onClick={onClick} style={{background:T.white,borderRadius:10,padding:20,boxShadow:'0 1px 3px rgba(27,58,92,.08)',border:`1px solid ${T.lgrey}`,cursor:onClick?'pointer':'default',...style}}>{children}</div>;
}

function Stat({ label, value, sub, icon, variant }) {
  const cols={green:T.green,red:T.red,amber:T.amber,blue:T.blue};
  const bgs={green:T.greenL,red:T.redL,amber:T.amberL,blue:T.blueL};
  return (
    <Card style={{padding:'16px 18px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div style={{flex:1}}>
          <p style={{fontSize:10,color:T.mgrey,fontWeight:600,textTransform:'uppercase',letterSpacing:.8,marginBottom:5}}>{label}</p>
          <p style={{fontSize:20,fontWeight:700,color:cols[variant]||T.navy,lineHeight:1}}>{value}</p>
          {sub&&<p style={{fontSize:11,color:T.mgrey,marginTop:4}}>{sub}</p>}
        </div>
        {icon&&<div style={{width:36,height:36,background:bgs[variant]||'#DCE8F5',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>{icon}</div>}
      </div>
    </Card>
  );
}

function Btn({ children, variant='primary', onClick, size='md', disabled=false, style={} }) {
  const styles={primary:{bg:'var(--brand, #1B3A5C)',color:T.white},gold:{bg:'var(--accent, #C8960C)',color:T.white},outline:{bg:'transparent',color:T.navy,border:`1.5px solid ${T.navy}`},danger:{bg:T.red,color:T.white},ghost:{bg:T.offwt,color:T.dgrey,border:`1px solid ${T.lgrey}`},green:{bg:T.green,color:T.white}};
  const s=styles[variant]||styles.primary;
  const pads={sm:'5px 12px',md:'8px 18px',lg:'11px 24px'};
  return <button onClick={onClick} disabled={disabled} style={{background:disabled?T.lgrey:s.bg,color:disabled?T.mgrey:s.color,border:s.border||'none',padding:pads[size],borderRadius:7,fontSize:size==='sm'?12:13,fontWeight:600,cursor:disabled?'not-allowed':'pointer',...style}}>{children}</button>;
}

function Alert({ type='info', children }) {
  const t={info:{bg:'#EFF6FF',border:'#BFDBFE',color:'#1E40AF',icon:'ℹ️'},warning:{bg:T.amberL,border:'#FCD34D',color:T.amber,icon:'⚠️'},error:{bg:T.redL,border:'#FCA5A5',color:T.red,icon:'🔴'},success:{bg:T.greenL,border:'#86EFAC',color:T.green,icon:'✅'}}[type];
  return <div style={{background:t.bg,border:`1px solid ${t.border}`,color:t.color,padding:'10px 14px',borderRadius:8,display:'flex',gap:8,fontSize:13,marginBottom:14}}><span>{t.icon}</span><span style={{flex:1}}>{children}</span></div>;
}

function Progress({ value, height=6 }) {
  return <div style={{background:T.lgrey,borderRadius:99,overflow:'hidden',height}}><div style={{width:`${Math.min((value||0)*100,100)}%`,height:'100%',background:value>=.95?T.red:value>=.8?T.amber:T.green,borderRadius:99,transition:'width .3s'}}/></div>;
}

function Input({ label, value, onChange, type='text', placeholder='', required, note, readOnly }) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontSize:12,fontWeight:600,color:T.dgrey,marginBottom:5}}>{label}{required&&<span style={{color:T.red}}> *</span>}</label>
      <input type={type} value={value||''} onChange={e=>onChange&&onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly}
        style={{width:'100%',padding:'9px 12px',border:`1.5px solid ${T.lgrey}`,borderRadius:7,fontSize:13,color:T.dgrey,background:readOnly?T.offwt:T.white,outline:'none',boxSizing:'border-box'}}/>
      {note&&<p style={{fontSize:11,color:T.mgrey,marginTop:3}}>{note}</p>}
    </div>
  );
}

function Select({ label, value, onChange, options, required }) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontSize:12,fontWeight:600,color:T.dgrey,marginBottom:5}}>{label}{required&&<span style={{color:T.red}}> *</span>}</label>
      <select value={value||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'9px 12px',border:`1.5px solid ${T.lgrey}`,borderRadius:7,fontSize:13,color:T.dgrey,background:T.white,outline:'none',boxSizing:'border-box'}}>
        {options.map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
      </select>
    </div>
  );
}

function Modal({ title, children, onClose, width=540 }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(13,34,56,.65)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:T.white,borderRadius:12,width:'100%',maxWidth:width,maxHeight:'90vh',overflow:'auto',boxShadow:'0 24px 60px rgba(0,0,0,.3)'}}>
        <div style={{padding:'16px 22px',borderBottom:`1px solid ${T.lgrey}`,display:'flex',justifyContent:'space-between',alignItems:'center',background:T.navy,borderRadius:'12px 12px 0 0'}}>
          <h3 style={{color:T.white,fontSize:15,fontWeight:700,margin:0}}>{title}</h3>
          <button onClick={onClose} style={{background:'none',border:'none',color:T.white,fontSize:22,cursor:'pointer',lineHeight:1,padding:0}}>×</button>
        </div>
        <div style={{padding:22}}>{children}</div>
      </div>
    </div>
  );
}

function DataTable({ headers, rows, empty='No records found.' }) {
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
        <thead>
          <tr>{headers.map((h,i)=><th key={i} style={{background:'var(--brand, #1B3A5C)',color:T.white,padding:'9px 13px',textAlign:'left',fontWeight:600,fontSize:11,textTransform:'uppercase',letterSpacing:.5,whiteSpace:'nowrap'}}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length===0
            ? <tr><td colSpan={headers.length} style={{padding:40,textAlign:'center',color:T.mgrey}}>{empty}</td></tr>
            : rows.map((row,i)=><tr key={i} style={{background:i%2===0?T.white:T.offwt}}>{row.map((cell,j)=><td key={j} style={{padding:'9px 13px',borderBottom:`1px solid ${T.lgrey}`,verticalAlign:'middle'}}>{cell}</td>)}</tr>)
          }
        </tbody>
      </table>
    </div>
  );
}

function SectionHeader({ title, sub, action }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
      <div><h2 style={{fontSize:16,fontWeight:700,color:T.navy,margin:0}}>{title}</h2>{sub&&<p style={{fontSize:12,color:T.mgrey,marginTop:3,margin:0}}>{sub}</p>}</div>
      {action}
    </div>
  );
}

function Loading() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:60,color:T.mgrey,fontSize:13}}>
    <div style={{width:24,height:24,border:`3px solid ${T.lgrey}`,borderTopColor:T.navy,borderRadius:'50%',animation:'spin 1s linear infinite',marginRight:12}}/>Loading…
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>;
}

function Tabs({ tabs, active, setActive }) {
  return (
    <div style={{display:'flex',gap:0,marginBottom:22,borderBottom:`1px solid ${T.lgrey}`}}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>setActive(t.id)} style={{padding:'9px 18px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:active===t.id?700:400,color:active===t.id?T.navy:T.mgrey,borderBottom:active===t.id?`2px solid ${T.gold}`:'2px solid transparent',marginBottom:-1}}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── NAV MODULES ──────────────────────────────────────────────────────────────
const MODULES = [
  {id:'dashboard', label:'Dashboard',         icon:'📊', group:'overview'},
  {id:'finance',   label:'Finance',           icon:'💰', group:'core'},
  {id:'debtors',   label:'Debtors',           icon:'📋', group:'core'},
  {id:'tax',       label:'Tax & KRA',         icon:'🏛️', group:'core'},
  {id:'hr',        label:'HR & Payroll',      icon:'👥', group:'core'},
  {id:'procurement',label:'Procurement',      icon:'📦', group:'core'},
  {id:'stores',    label:'Stores',            icon:'🏪', group:'core'},
  {id:'requisitions',label:'Requisitions',    icon:'📝', group:'core'},
  {id:'assets',    label:'Fixed Assets',      icon:'🏗️', group:'core'},
  {id:'projects',  label:'Projects',          icon:'🏛️', group:'ops'},
  {id:'crm',       label:'CRM & Sales',       icon:'🤝', group:'ops'},
  {id:'fleet',     label:'Fleet',             icon:'🚗', group:'ops'},
  {id:'hse',       label:'HSE',               icon:'🦺', group:'ops'},
  {id:'calibration',label:'Calibration',      icon:'🔬', group:'commercial'},
  {id:'inspection',label:'Inspection (17020)',icon:'🔍', group:'commercial'},
  {id:'bids',      label:'Bids & Pre-Sales',  icon:'📋', group:'commercial'},
  {id:'ic',        label:'Inter-Company',     icon:'🔗', group:'commercial'},
  {id:'integrations',label:'Integrations',   icon:'🌐', group:'commercial'},
  {id:'compliance',label:'Compliance',        icon:'✅', group:'governance'},
  {id:'reports',   label:'Reports',           icon:'📈', group:'governance'},
  {id:'tasks',     label:'Tasks',             icon:'☑️', group:'governance'},
  {id:'admin',     label:'Administration',    icon:'🛡️', group:'governance'},
  {id:'settings',  label:'Settings',          icon:'⚙️', group:'governance'},
];

// ── ROLE-BASED MODULE VISIBILITY ──────────────────────────────────────────
// md and admin always see everything (checked separately below). Every
// other role sees only what's relevant to their actual job — e.g. a
// Technician sees Calibration, Requisitions, Stores, and Fleet, not
// Finance or Tax. 'dashboard' is always included for every role since it's
// the landing view and its content already adapts internally.
//
// This is deliberately a simple allow-list per role rather than trying to
// derive visibility from the granular permissions table — several modules
// here (finance, crm, projects, etc.) don't have a 1:1 permission yet, and
// inferring visibility from an incomplete permission set would silently
// hide modules that should be visible. An explicit map is easier to audit
// and correct than implicit derivation.
const ROLE_MODULES = {
  cfo:                 ['dashboard','finance','debtors','tax','assets','reports','tasks','settings'],
  store_manager:       ['dashboard','stores','requisitions','procurement','reports','tasks','settings'],
  store_clerk:         ['dashboard','stores','requisitions','tasks','settings'],
  procurement_officer: ['dashboard','procurement','stores','requisitions','reports','tasks','settings'],
  fleet_manager:       ['dashboard','fleet','requisitions','reports','tasks','settings'],
  hr_manager:          ['dashboard','hr','reports','tasks','settings'],
  project_manager:     ['dashboard','projects','crm','requisitions','tasks','reports','settings'],
  technician:          ['dashboard','calibration','inspection','requisitions','stores','fleet','tasks','settings'],
  qm:                  ['dashboard','calibration','inspection','compliance','reports','tasks','settings'],
  staff:               ['dashboard','requisitions','tasks','settings'],
};

// md and admin bypass ROLE_MODULES entirely and see every module — this
// matches how every other permission check in the app already treats
// these two roles (see userHasPermission in lib/auth.js).
function modulesForRole(role) {
  if (role === 'md' || role === 'admin') return MODULES;
  const allowed = ROLE_MODULES[role];
  if (!allowed) return MODULES; // unknown/legacy role — fail open rather than lock someone out entirely
  return MODULES.filter(m => allowed.includes(m.id));
}
const GROUPS={overview:'Overview',core:'Core Modules',ops:'Operations',commercial:'Commercial',governance:'Governance'};

// ── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ active, setActive, collapsed, setCollapsed, user, branding={} }) {
  const visibleModules = modulesForRole(user?.role);
  const byGroup = visibleModules.reduce((acc,m)=>{(acc[m.group]=acc[m.group]||[]).push(m);return acc;},{});
  const name = branding.company_display_name || 'QSL ERP';
  return (
    <div style={{width:collapsed?56:210,flexShrink:0,background:T.navyD,display:'flex',flexDirection:'column',height:'100vh',position:'sticky',top:0,overflow:'hidden',transition:'width .2s',zIndex:10}}>
      <div style={{padding:collapsed?'14px 0':'14px 14px',borderBottom:'1px solid rgba(255,255,255,.08)',display:'flex',alignItems:'center',justifyContent:collapsed?'center':'space-between'}}>
        {!collapsed&&(branding.logo_url
          ? <img src={branding.logo_url} alt={name} style={{maxHeight:34,maxWidth:150,objectFit:'contain'}}/>
          : <div><div style={{fontSize:14,fontWeight:800,color:'var(--accent, #C8960C)'}}>{name}</div><div style={{fontSize:9,color:'rgba(255,255,255,.4)',letterSpacing:.5,marginTop:1}}>QALIBRATED SYSTEMS</div></div>)}
        {collapsed&&(branding.logo_url
          ? <img src={branding.logo_url} alt="" style={{maxHeight:24,maxWidth:32,objectFit:'contain'}}/>
          : <span style={{fontSize:15,fontWeight:800,color:'var(--accent, #C8960C)'}}>{name[0]||'Q'}</span>)}
        <button onClick={()=>setCollapsed(!collapsed)} style={{background:'none',border:'none',color:'rgba(255,255,255,.4)',cursor:'pointer',fontSize:14,padding:4,flexShrink:0}}>{collapsed?'→':'←'}</button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'6px 0'}}>
        {Object.entries(byGroup).map(([group,mods])=>(
          <div key={group}>
            {!collapsed&&<div style={{fontSize:9,fontWeight:700,color:'rgba(255,255,255,.25)',textTransform:'uppercase',letterSpacing:1,padding:'12px 14px 4px'}}>{GROUPS[group]}</div>}
            {mods.map(m=>(
              <button key={m.id} onClick={()=>setActive(m.id)} title={collapsed?m.label:''} style={{width:'100%',display:'flex',alignItems:'center',gap:8,padding:collapsed?'8px 0':'8px 12px',background:active===m.id?'rgba(200,150,12,.15)':'none',border:'none',cursor:'pointer',borderLeft:active===m.id?`3px solid ${T.gold}`:'3px solid transparent',justifyContent:collapsed?'center':'flex-start'}}>
                <span style={{fontSize:14,flexShrink:0}}>{m.icon}</span>
                {!collapsed&&<span style={{fontSize:12,fontWeight:active===m.id?600:400,color:active===m.id?T.gold:'rgba(255,255,255,.75)'}}>{m.label}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div style={{padding:collapsed?'10px 0':'10px 12px',borderTop:'1px solid rgba(255,255,255,.08)',display:'flex',alignItems:'center',gap:8,justifyContent:collapsed?'center':'flex-start'}}>
        <div style={{width:28,height:28,borderRadius:'50%',background:T.gold,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:T.navy,flexShrink:0}}>{user?.name?.[0]||'?'}</div>
        {!collapsed&&<div style={{overflow:'hidden'}}><div style={{fontSize:11,fontWeight:600,color:T.white,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user?.name}</div><div style={{fontSize:10,color:T.mgrey}}>{user?.role}</div></div>}
      </div>
    </div>
  );
}

function TopBar({ title, user, alertCount, onLogout }) {
  return (
    <div style={{background:T.white,borderBottom:`1px solid ${T.lgrey}`,padding:'11px 22px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
      <h1 style={{fontSize:16,fontWeight:700,color:'var(--brand, #1B3A5C)',margin:0}}>{title}</h1>
      <div style={{display:'flex',alignItems:'center',gap:14}}>
        <span style={{fontSize:11,color:T.mgrey}}>{new Date().toLocaleDateString('en-KE',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}</span>
        {alertCount>0&&<div style={{position:'relative'}}><span style={{fontSize:17}}>🔔</span><span style={{position:'absolute',top:-4,right:-4,background:T.red,color:T.white,fontSize:9,fontWeight:700,padding:'1px 4px',borderRadius:99}}>{alertCount}</span></div>}
        <div style={{background:T.greenL,color:T.green,padding:'4px 10px',borderRadius:6,fontSize:11,fontWeight:700}}>● Live</div>
        <button onClick={onLogout} style={{background:'none',border:`1px solid ${T.lgrey}`,borderRadius:6,padding:'5px 12px',fontSize:12,cursor:'pointer',color:T.mgrey}}>Sign out</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE VIEWS — each fetches from real API routes
// ═══════════════════════════════════════════════════════════════════════════

// ── DASHBOARD ──────────────────────────────────────────────────────────────
function DashboardHome({ api, setActive }) {
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [dashTab,setDashTab]=useState('summary');
  const [analytics,setAnalytics]=useState(null);
  const [analyticsLoading,setAnalyticsLoading]=useState(false);

  useEffect(()=>{
    api.get('/api/reports?report=md_dashboard').then(r=>{
      if(r?.success) setData(r.data);
      setLoading(false);
    });
  },[]);

  useEffect(()=>{
    if(dashTab==='analytics' && !analytics){
      setAnalyticsLoading(true);
      api.get('/api/reports?report=analytics_dashboard').then(r=>{
        if(r?.success) setAnalytics(r.data);
        setAnalyticsLoading(false);
      });
    }
  },[dashTab]);

  if(loading) return <Loading/>;

  const gp     = data?.gross_profit||0;
  const rev    = data?.revenue_active||0;
  const margin = rev ? gp/rev : 0;

  return (
    <div>
      <Tabs tabs={[{id:'summary',label:'Executive Summary'},{id:'analytics',label:'Analytics & KPIs'}]} active={dashTab} setActive={setDashTab}/>
      {dashTab==='summary'&&(
      <div style={{marginTop:14}}>
      {/* Alert banner */}
      {((data?.overdue_imprest?.count||0)+(data?.overdue_tasks||0)+(data?.expiring_docs||0))>0&&(
        <div style={{background:T.redL,border:`1px solid #FCA5A5`,borderRadius:10,padding:'12px 16px',marginBottom:20}}>
          <div style={{fontWeight:700,color:T.red,fontSize:13,marginBottom:8}}>🚨 Active Alerts Requiring Attention</div>
          {(data?.overdue_imprest?.count||0)>0&&<div style={{fontSize:12,color:T.red,marginBottom:3}}>⏰ {data.overdue_imprest.count} overdue imprest — {fmt.kes(data.overdue_imprest.amount)} at risk</div>}
          {(data?.overdue_tasks||0)>0&&<div style={{fontSize:12,color:T.red,marginBottom:3}}>📋 {data.overdue_tasks} overdue tasks</div>}
          {(data?.expiring_docs||0)>0&&<div style={{fontSize:12,color:T.amber}}>📄 {data.expiring_docs} compliance documents expiring within 60 days</div>}
        </div>
      )}

      {/* KPI Grid */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:14,marginBottom:14}}>
        <Stat label="Portfolio Value" value={`Kshs ${((rev)/1e6).toFixed(1)}M`} sub="Active projects" icon="💼"/>
        <Stat label="Gross Profit" value={`Kshs ${(gp/1e6).toFixed(1)}M`} sub={`Margin: ${fmt.pct(margin)}`} icon="📈" variant={margin>=.15?'green':margin>=.1?'amber':'red'}/>
        <Stat label="Collections" value={`Kshs ${((data?.total_collected||0)/1e6).toFixed(1)}M`} sub="Total received" icon="💳"/>
        <Stat label="Invoiced" value={`Kshs ${((data?.total_invoiced||0)/1e6).toFixed(1)}M`} sub="Billed to date" icon="🧾"/>
        <Stat label="Active Projects" value={data?.active_projects||0} icon="🏛️"/>
        <Stat label="Open Bids" value={data?.open_bids?.count||0} sub={fmt.kes(data?.open_bids?.pipeline)} icon="📋"/>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:14,marginBottom:22}}>
        <Stat label="Overdue Imprest" value={data?.overdue_imprest?.count||0} icon="⏰" variant={(data?.overdue_imprest?.count||0)>0?'red':'green'}/>
        <Stat label="Overdue Tasks" value={data?.overdue_tasks||0} icon="📋" variant={(data?.overdue_tasks||0)>0?'amber':'green'}/>
        <Stat label="Expiring Docs" value={data?.expiring_docs||0} icon="📄" variant={(data?.expiring_docs||0)>0?'amber':'green'}/>
        <Stat label="Total Expenses" value={`Kshs ${((data?.total_expenses||0)/1e6).toFixed(1)}M`} icon="📉"/>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
        {/* Top debtors */}
        <Card>
          <SectionHeader title="Top Debtors" sub="Clients with outstanding balances" action={<Btn size="sm" onClick={()=>setActive('reports')}>Full Report</Btn>}/>
          {(data?.top_debtors||[]).length===0?<p style={{color:T.mgrey,fontSize:13}}>No outstanding balances</p>:(
            data.top_debtors.map((d,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:`1px solid ${T.lgrey}`,fontSize:13}}>
                <span style={{fontWeight:500}}>{d.name}</span>
                <strong style={{color:T.amber}}>{fmt.kes(d.outstanding)}</strong>
              </div>
            ))
          )}
        </Card>
        {/* Quick actions */}
        <Card>
          <SectionHeader title="Quick Actions" sub="Common tasks"/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {[['Request Imprest','finance'],['Post Expense','projects'],['New Lead','crm'],['Raise PR','procurement'],['Check Compliance','compliance'],['Run Tax Report','tax']].map(([label,mod])=>(
              <button key={label} onClick={()=>setActive(mod)} style={{padding:'12px',background:T.offwt,border:`1px solid ${T.lgrey}`,borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600,color:T.navy,textAlign:'center'}}>{label}</button>
            ))}
          </div>
        </Card>
      </div>
      </div>
      )}

      {dashTab==='analytics'&&(
        <div style={{marginTop:14}}>
          {analyticsLoading||!analytics?<Loading/>:(<>
            {/* Top KPI row */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
              <Stat label="Inventory Value" value={fmt.kes(analytics.inventory.total_value)} sub={`${analytics.inventory.item_count} active items`} icon="📦"/>
              <Stat label="Low Stock Alerts" value={analytics.inventory.low_stock_count} icon="⚠️" variant={analytics.inventory.low_stock_count?'red':'green'}/>
              <Stat label="Pending Approvals" value={analytics.pending_approvals.total} icon="⏳" variant={analytics.pending_approvals.total?'amber':'green'}/>
              <Stat label="Fleet Utilization" value={`${analytics.fleet.utilization_rate}%`} sub={`${analytics.fleet.active_vehicles} of ${analytics.fleet.total_vehicles} vehicles`} icon="🚗" variant={analytics.fleet.utilization_rate>=60?'green':analytics.fleet.utilization_rate>=30?'amber':'red'}/>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20}}>
              {/* Inventory by category — pie chart */}
              <Card>
                <SectionHeader title="Inventory Value by Category" sub="Current stock on hand"/>
                {analytics.inventory.by_category.length===0?<p style={{color:T.mgrey,fontSize:13,padding:'30px 0',textAlign:'center'}}>No inventory data yet.</p>:(
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={analytics.inventory.by_category} dataKey="value" nameKey="category" cx="50%" cy="50%" outerRadius={90} label={(e)=>e.category}>
                        {analytics.inventory.by_category.map((entry,i)=>(
                          <Cell key={i} fill={[T.navy,T.gold,T.green,T.blue,T.amber,T.purple,T.red,T.navyL][i%8]}/>
                        ))}
                      </Pie>
                      <Tooltip formatter={(v)=>fmt.kes(v)}/>
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Pending approvals breakdown — bar chart */}
              <Card>
                <SectionHeader title="Pending Approvals by Type" sub="Items awaiting action right now"/>
                {analytics.pending_approvals.total===0?<p style={{color:T.green,fontSize:13,padding:'30px 0',textAlign:'center'}}>✅ Nothing pending approval.</p>:(
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={analytics.pending_approvals.breakdown}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.lgrey}/>
                      <XAxis dataKey="name" tick={{fontSize:10}}/>
                      <YAxis tick={{fontSize:11}}/>
                      <Tooltip/>
                      <Bar dataKey="value" fill={T.amber} radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20}}>
              {/* Procurement trend — line chart */}
              <Card>
                <SectionHeader title="Procurement Trend" sub="LPO value by month, last 6 months"/>
                {analytics.procurement_trend.length===0?<p style={{color:T.mgrey,fontSize:13,padding:'30px 0',textAlign:'center'}}>No procurement activity in this period.</p>:(
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={analytics.procurement_trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.lgrey}/>
                      <XAxis dataKey="month" tick={{fontSize:11}}/>
                      <YAxis tick={{fontSize:11}}/>
                      <Tooltip formatter={(v)=>fmt.kes(v)}/>
                      <Line type="monotone" dataKey="total_value" stroke={T.navy} strokeWidth={2} dot={{r:4}}/>
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Stock movement trend — line chart */}
              <Card>
                <SectionHeader title="Stock Movement Trend" sub="Units received vs issued, last 6 months"/>
                {analytics.stock_movement_trend.length===0?<p style={{color:T.mgrey,fontSize:13,padding:'30px 0',textAlign:'center'}}>No stock movement in this period.</p>:(
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={analytics.stock_movement_trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.lgrey}/>
                      <XAxis dataKey="month" tick={{fontSize:11}}/>
                      <YAxis tick={{fontSize:11}}/>
                      <Tooltip/>
                      <Legend wrapperStyle={{fontSize:11}}/>
                      <Line type="monotone" dataKey="received" name="Received" stroke={T.green} strokeWidth={2} dot={{r:4}}/>
                      <Line type="monotone" dataKey="issued" name="Issued" stroke={T.red} strokeWidth={2} dot={{r:4}}/>
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>

            {/* Fleet utilization detail */}
            <Card>
              <SectionHeader title="Fleet Utilization Detail" sub="Trips and distance covered, last 30 days"/>
              {analytics.fleet.top_utilized.length===0?<p style={{color:T.mgrey,fontSize:13}}>No vehicles registered yet.</p>:(
                <DataTable headers={['Vehicle','Trips (30d)','Distance (km)','Status']}
                  rows={analytics.fleet.top_utilized.map(v=>[
                    <strong>{v.reg_no}</strong>, v.trip_count, v.total_distance,
                    v.trip_count>0?<Badge variant="green">In Use</Badge>:<Badge variant="default">Idle</Badge>,
                  ])}
                />
              )}
            </Card>
          </>)}
        </div>
      )}
    </div>
  );
}

// ── FINANCE MODULE ──────────────────────────────────────────────────────────
function Finance({ api }) {
  const [tab,setTab]=useState('imprest');
  const [imprest,setImprest]=useState([]);
  const [payroll,setPayroll]=useState(null);
  const [payrollEntries,setPayrollEntries]=useState([]);
  const [accounts,setAccounts]=useState([]);
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({employee_id:'',amount:'',purpose:''});
  const [employees,setEmployees]=useState([]);
  const [msg,setMsg]=useState(null);
  const [payStep,setPayStep]=useState('review');
  const [signing,setSigning]=useState(false);
  // Payments (AP) — FIN-006/007/008
  const [payables,setPayables]=useState({stats:{},invoices:[]});
  const [vouchers,setVouchers]=useState([]);
  const [batches,setBatches]=useState([]);
  const [authMatrix,setAuthMatrix]=useState([]);
  const [lpos,setLpos]=useState([]);
  const [matchForm,setMatchForm]=useState({lpo_id:'',invoice_no:'',invoice_amount:''});
  const [adhoc,setAdhoc]=useState({payee:'',amount:'',purpose:''});
  const [batchSel,setBatchSel]=useState([]);
  // GL maturity — FIN-001/002/003
  const [journals,setJournals]=useState([]);
  const [monthEnd,setMonthEnd]=useState(null);
  const [plDept,setPlDept]=useState([]);
  const [closePeriod,setClosePeriod]=useState('2026-06');
  const [jForm,setJForm]=useState({date:new Date().toISOString().split('T')[0],description:'',auto_reverse:false,reversal_date:'',lines:[{account_id:'',debit:'',credit:'',dept:''},{account_id:'',debit:'',credit:'',dept:''}]});
  // Budgeting — FIN-019/020/021
  const [budgetData,setBudgetData]=useState({budgets:[],targets:[]});
  const [budgetYear,setBudgetYear]=useState('2026');
  const [bForm,setBForm]=useState({department:'',cost_centre:'',annual_amount:''});
  const [tForm,setTForm]=useState({scope:'',annual_target:''});
  const [retireForm,setRetireForm]=useState({id:'',amount_accounted:'',receipt_path:''});

  const load = async (t=tab) => {
    setLoading(true);
    if(t==='imprest'){ const r=await api.get('/api/finance?section=imprest'); if(r?.success) setImprest(r.data); }
    if(t==='payroll'){ const r=await api.get('/api/finance?section=payroll&period=2026-06'); if(r?.success){setPayroll(r.data.run);setPayrollEntries(r.data.entries||[]);} }
    if(t==='gl'){ const r=await api.get('/api/finance?section=accounts'); if(r?.success) setAccounts(r.data); }
    if(t==='payments'){
      const [p,v,b,l]=await Promise.all([
        api.get('/api/finance?section=payables'), api.get('/api/finance?section=vouchers'),
        api.get('/api/finance?section=batches'),  api.get('/api/procurement?section=lpos')]);
      if(p?.success)setPayables(p.data); if(v?.success)setVouchers(v.data);
      if(b?.success)setBatches(b.data); if(l?.success)setLpos(l.data);
    }
    if(t==='payauth'){ const r=await api.get('/api/finance?section=payment_authority'); if(r?.success)setAuthMatrix(r.data); }
    if(t==='journals'){ const [j,a]=await Promise.all([api.get('/api/finance?section=journals'),api.get('/api/finance?section=accounts')]); if(j?.success)setJournals(j.data); if(a?.success)setAccounts(a.data); }
    if(t==='monthend'){ const [m,p]=await Promise.all([api.get(`/api/finance?section=month_end&period=${closePeriod}`),api.get(`/api/finance?section=pl_department&period=${closePeriod}`)]); if(m?.success)setMonthEnd(m.data); if(p?.success)setPlDept(p.data); }
    if(t==='budgets'){ const r=await api.get(`/api/finance?section=budget_dashboard&year=${budgetYear}`); if(r?.success)setBudgetData(r.data); }
    setLoading(false);
  };

  useEffect(()=>{load();api.get('/api/hr?section=employees').then(r=>{if(r?.success)setEmployees(r.data);});},[tab]);

  const createImprest = async () => {
    if(!form.employee_id||!form.amount||!form.purpose) return;
    const r=await api.post('/api/finance',{action:'create_imprest',...form,amount:parseFloat(form.amount)});
    if(r?.success){setMsg({type:'success',text:`Imprest ${r.data.ref_no} requested — awaiting Line Manager approval`});setModal(null);setForm({employee_id:'',amount:'',purpose:''});load('imprest');}
    else setMsg({type:'error',text:r?.error||'Failed to create imprest'});
  };
  // FIN-011/012A imprest workflow
  const impAction = async (action,id,extra={}) => { const r=await api.post('/api/finance',{action,id,...extra}); if(r?.success){setMsg({type:'success',text:'Done'});load('imprest');} else setMsg({type:'error',text:r?.error}); };
  const retireImprest = async () => {
    if(!retireForm.id||!retireForm.amount_accounted||!retireForm.receipt_path){ setMsg({type:'error',text:'Receipt reference and amount are required (FIN-012A)'}); return; }
    const r=await api.put('/api/finance',{action:'account_imprest',id:retireForm.id,amount_accounted:parseFloat(retireForm.amount_accounted),receipt_path:retireForm.receipt_path});
    if(r?.success){setMsg({type:r.data.spot_check?'warning':'success',text:r.data.spot_check?'Retired — flagged for FM spot-check':'Imprest retired'});setModal(null);setRetireForm({id:'',amount_accounted:'',receipt_path:''});load('imprest');}
    else setMsg({type:'error',text:r?.error});
  };

  const createPayroll = async () => {
    const r=await api.post('/api/finance',{action:'create_payroll',period:'2026-06'});
    if(r?.success){setMsg({type:'success',text:`Payroll created for June 2026 — ${r.data.entries_count} entries`});load('payroll');}
    else setMsg({type:'error',text:r?.error||'Failed'});
  };

  const signPayroll = async (role) => {
    if(!payroll) return;
    setSigning(true);
    const r=await api.post('/api/finance',{action:'sign_payroll',run_id:payroll.id,signer_role:role,signature_key:`QSL-DS-SIG-${Date.now()}`});
    setSigning(false);
    if(r?.success){setMsg({type:'success',text:`${role.toUpperCase()} signature applied — status: ${r.data.status}`});load('payroll');}
    else setMsg({type:'error',text:r?.error||'Signing failed'});
  };

  const checkOverdue = async () => {
    const r=await api.post('/api/finance',{action:'check_overdue_imprest'});
    if(r?.success) setMsg({type:'success',text:`${r.data.converted_count} imprest records checked and converted where overdue`});
    load('imprest');
  };

  // ── Payments (AP) handlers — FIN-006/007/008 ──
  const matchInvoice = async () => {
    if(!matchForm.lpo_id||!matchForm.invoice_no||!matchForm.invoice_amount) return;
    const r=await api.post('/api/finance',{action:'match_invoice',lpo_id:matchForm.lpo_id,invoice_no:matchForm.invoice_no,invoice_amount:parseFloat(matchForm.invoice_amount)});
    if(r?.success){ setMsg({type:r.data.status==='exception'?'warning':'success',text:r.data.status==='exception'?`Exception flagged for CFO: ${r.data.exception_reason}`:`3-way match passed ✓`}); setMatchForm({lpo_id:'',invoice_no:'',invoice_amount:''}); setModal(null); load('payments'); }
    else setMsg({type:'error',text:r?.error});
  };
  const approveException = async (id) => { const r=await api.post('/api/finance',{action:'approve_invoice_exception',invoice_id:id}); if(r?.success){setMsg({type:'success',text:'Exception approved — invoice now matched'});load('payments');} else setMsg({type:'error',text:r?.error}); };
  const raiseVoucher = async (inv) => { const r=await api.post('/api/finance',{action:'create_voucher',supplier_invoice_id:inv.id}); if(r?.success){setMsg({type:'success',text:`Voucher ${r.data.voucher_no} raised — requires ${r.data.required_level.replace('_',' ').toUpperCase()} approval`});load('payments');} else setMsg({type:'error',text:r?.error}); };
  const raiseAdhoc = async () => { if(!adhoc.payee||!adhoc.amount||!adhoc.purpose)return; const r=await api.post('/api/finance',{action:'create_voucher',...adhoc,amount:parseFloat(adhoc.amount)}); if(r?.success){setMsg({type:'success',text:`Voucher ${r.data.voucher_no} — requires ${r.data.required_level.replace('_',' ').toUpperCase()} approval`});setAdhoc({payee:'',amount:'',purpose:''});setModal(null);load('payments');} else setMsg({type:'error',text:r?.error}); };
  const approveVoucher = async (id) => { const r=await api.post('/api/finance',{action:'approve_voucher',voucher_id:id,signature_key:`QSL-DS-${Date.now()}`}); if(r?.success){setMsg({type:'success',text:'Voucher approved & signed'});load('payments');} else setMsg({type:'error',text:r?.error}); };
  const toggleBatchSel = (id) => setBatchSel(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const createBatch = async () => { if(!batchSel.length){setMsg({type:'error',text:'Select approved vouchers to batch'});return;} const r=await api.post('/api/finance',{action:'create_batch',voucher_ids:batchSel}); if(r?.success){setMsg({type:'success',text:`Batch ${r.data.batch_no} prepared (${r.data.voucher_count} vouchers)`});setBatchSel([]);load('payments');} else setMsg({type:'error',text:r?.error}); };
  const signBatch = async (id,role) => { const r=await api.post('/api/finance',{action:'sign_batch',batch_id:id,signer_role:role,signature_key:`QSL-DS-${role}-${Date.now()}`}); if(r?.success){setMsg({type:'success',text:`Batch ${r.data.status}`});load('payments');} else setMsg({type:'error',text:r?.error}); };

  // ── GL maturity handlers — FIN-002/003 ──
  const jLineSet = (i,k,v) => setJForm(f=>({...f,lines:f.lines.map((l,idx)=>idx===i?{...l,[k]:v}:l)}));
  const jLineAdd = () => setJForm(f=>({...f,lines:[...f.lines,{account_id:'',debit:'',credit:'',dept:''}]}));
  const createJournal = async () => {
    const lines = jForm.lines.filter(l=>l.account_id && (parseFloat(l.debit)||parseFloat(l.credit)))
      .map(l=>({account_id:l.account_id,debit:parseFloat(l.debit)||0,credit:parseFloat(l.credit)||0,dept:l.dept}));
    const dr=lines.reduce((s,l)=>s+l.debit,0), cr=lines.reduce((s,l)=>s+l.credit,0);
    if(lines.length<2||Math.abs(dr-cr)>0.01){ setMsg({type:'error',text:`Journal must balance — debits ${dr} vs credits ${cr}`}); return; }
    const r=await api.post('/api/finance',{action:'create_journal',date:jForm.date,description:jForm.description,lines,auto_reverse:jForm.auto_reverse,reversal_date:jForm.auto_reverse?jForm.reversal_date:null});
    if(r?.success){ setMsg({type:'success',text:`Journal ${r.data.entry_no} drafted — needs review then approval`}); setModal(null); setJForm({date:new Date().toISOString().split('T')[0],description:'',auto_reverse:false,reversal_date:'',lines:[{account_id:'',debit:'',credit:'',dept:''},{account_id:'',debit:'',credit:'',dept:''}]}); load('journals'); }
    else setMsg({type:'error',text:r?.error});
  };
  const jAction = async (action,entry_id) => { const r=await api.post('/api/finance',{action,entry_id,signature_key:`QSL-DS-${Date.now()}`}); if(r?.success){ setMsg({type:'success',text:r.data.reversal_no?`Done — reversal ${r.data.reversal_no}`:'Done'}); load('journals'); } else setMsg({type:'error',text:r?.error}); };
  const reloadMonthEnd = async (p) => { setClosePeriod(p); const [m,pl]=await Promise.all([api.get(`/api/finance?section=month_end&period=${p}`),api.get(`/api/finance?section=pl_department&period=${p}`)]); if(m?.success)setMonthEnd(m.data); if(pl?.success)setPlDept(pl.data); };
  const openClose = async () => { const r=await api.post('/api/finance',{action:'open_close_period',period:closePeriod}); if(r?.success){setMsg({type:'success',text:`Close started for ${closePeriod}`});reloadMonthEnd(closePeriod);} else setMsg({type:'error',text:r?.error}); };
  const toggleCloseItem = async (key,done) => { const r=await api.post('/api/finance',{action:'update_close_item',period:closePeriod,key,done}); if(r?.success)reloadMonthEnd(closePeriod); else setMsg({type:'error',text:r?.error}); };
  const finalizeClose = async () => { const r=await api.post('/api/finance',{action:'finalize_close',period:closePeriod,signature_key:`QSL-DS-${Date.now()}`}); if(r?.success){setMsg({type:'success',text:`${closePeriod} closed & locked`});reloadMonthEnd(closePeriod);} else setMsg({type:'error',text:r?.error}); };

  // ── Budgeting handlers — FIN-019/020 ──
  const reloadBudgets = async (y) => { setBudgetYear(y); const r=await api.get(`/api/finance?section=budget_dashboard&year=${y}`); if(r?.success)setBudgetData(r.data); };
  const createBudget = async () => { if(!bForm.department||!bForm.annual_amount)return; const r=await api.post('/api/finance',{action:'create_budget',fiscal_year:budgetYear,department:bForm.department,cost_centre:bForm.cost_centre,annual_amount:parseFloat(bForm.annual_amount)}); if(r?.success){setMsg({type:'success',text:'Budget saved'});setModal(null);setBForm({department:'',cost_centre:'',annual_amount:''});reloadBudgets(budgetYear);} else setMsg({type:'error',text:r?.error}); };
  const createTarget = async () => { if(!tForm.scope||!tForm.annual_target)return; const r=await api.post('/api/finance',{action:'create_revenue_target',fiscal_year:budgetYear,scope:tForm.scope,annual_target:parseFloat(tForm.annual_target)}); if(r?.success){setMsg({type:'success',text:'Revenue target saved'});setModal(null);setTForm({scope:'',annual_target:''});reloadBudgets(budgetYear);} else setMsg({type:'error',text:r?.error}); };

  const tabs=[{id:'imprest',label:'Imprest Tracker'},{id:'payroll',label:'Payroll'},{id:'gl',label:'Chart of Accounts'},{id:'journals',label:'Journals'},{id:'monthend',label:'Month-End & P&L'},{id:'budgets',label:'Budgets'},{id:'payments',label:'Payments (AP)'},{id:'payauth',label:'Payment Authority'}];
  const payAuthMatrix=[['Staff','≤ Kshs 5,000','Line Manager','Petty Cash'],['Dept Head','≤ Kshs 20,000','Finance Manager','Petty Cash / Transfer'],['Finance Manager','≤ Kshs 100,000','CFO','Bank Transfer'],['CFO','≤ Kshs 500,000','MD','Bank Transfer + Board Note'],['MD','> Kshs 500,000','Board','Board Resolution Required']];

  return (
    <div>
      {msg&&<Alert type={msg.type==='success'?'success':'error'}>{msg.text}</Alert>}
      <Tabs tabs={tabs} active={tab} setActive={t=>{setTab(t);load(t);}}/>
      {loading&&<Loading/>}

      {!loading&&tab==='imprest'&&(
        <>
          <Alert type="warning"><strong>QSL-FIN-CHP-001:</strong> Any imprest not accounted for within 14 calendar days automatically and irreversibly converts to a personal advance deducted from next payroll.</Alert>
          <SectionHeader title="Imprest Register" sub={`${imprest.filter(i=>i.status==='OVERDUE').length} overdue · ${imprest.filter(i=>i.status==='CONVERTED').length} converted`}
            action={<div style={{display:'flex',gap:8}}><Btn size="sm" variant="ghost" onClick={checkOverdue}>Check Overdue</Btn><Btn onClick={()=>setModal('imprest')}>+ Request Imprest</Btn></div>}/>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Ref No','Employee','Purpose','Amount','Due Date','Status','Workflow']}
              rows={imprest.map(i=>[
                <span style={{fontFamily:'monospace',fontSize:11,color:T.mgrey}}>{i.ref_no}</span>,
                <strong>{i.employee_name}</strong>,
                <span style={{fontSize:12}}>{(i.purpose||'').slice(0,40)}{i.purpose?.length>40?'…':''}</span>,
                <strong>{fmt.kes(i.amount)}</strong>,
                fmt.date(i.due_date),
                <Badge variant={i.status==='CONVERTED'||i.status==='FALSE_RECEIPT'?'red':i.status==='deducted'?'purple':i.status==='accounted'?'green':i.status==='released'?'blue':'amber'}>{i.status}{i.spot_check?' ⚑':''}</Badge>,
                i.status==='requested'?<Btn size="sm" onClick={()=>impAction('approve_imprest_request',i.id)}>Approve</Btn>
                :i.status==='approved'?<Btn size="sm" onClick={()=>impAction('release_imprest',i.id)}>Release</Btn>
                :i.status==='released'?<Btn size="sm" onClick={()=>{setRetireForm({id:i.id,amount_accounted:String(i.amount),receipt_path:''});setModal('retire');}}>Retire</Btn>
                :(i.status==='accounted'&&i.spot_check)?<div style={{display:'flex',gap:4}}><Btn size="sm" variant="ghost" onClick={()=>impAction('verify_receipt',i.id)}>Verify</Btn><Btn size="sm" variant="danger" onClick={()=>impAction('flag_false_receipt',i.id,{reason:'Spot-check failed'})}>False</Btn></div>
                :'—',
              ])}
            />
          </Card>
        </>
      )}

      {!loading&&tab==='payroll'&&(
        <>
          <Alert type="info"><strong>HR-010:</strong> Payroll requires 3-step digital signature approval: Finance Manager → CFO → MD. All three must sign before payroll can be processed.</Alert>
          {!payroll?(
            <Card style={{textAlign:'center',padding:40}}>
              <p style={{color:T.mgrey,marginBottom:16}}>No payroll run found for June 2026</p>
              <Btn onClick={createPayroll}>Generate June 2026 Payroll</Btn>
            </Card>
          ):(
            <>
              {/* Signing stepper */}
              <Card style={{marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,color:T.navy,marginBottom:14}}>Approval Workflow — {payroll.period}</div>
                <div style={{display:'flex',gap:0}}>
                  {[{role:'fm',label:'FM Review',signed:!!payroll.fm_sig},{role:'cfo',label:'CFO Sign',signed:!!payroll.cfo_sig},{role:'md',label:'MD Approve',signed:!!payroll.md_sig},{role:'done',label:'Locked ✅',signed:payroll.status==='locked'}].map((s,i,arr)=>{
                    const isActive = !s.signed && (i===0||(arr[i-1]?.signed));
                    return (
                      <div key={s.role} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center'}}>
                        <div style={{display:'flex',alignItems:'center',width:'100%'}}>
                          {i>0&&<div style={{flex:1,height:2,background:s.signed?T.green:T.lgrey}}/>}
                          <div onClick={()=>isActive&&s.role!=='done'&&signPayroll(s.role)} style={{width:30,height:30,borderRadius:'50%',background:s.signed?T.green:isActive?T.gold:T.lgrey,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:T.white,fontWeight:700,flexShrink:0,cursor:isActive&&s.role!=='done'?'pointer':'default'}}>
                            {signing&&isActive?<div style={{width:14,height:14,border:'2px solid #fff',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 1s linear infinite'}}/>:s.signed?'✓':i+1}
                          </div>
                          {i<3&&<div style={{flex:1,height:2,background:s.signed?T.green:T.lgrey}}/>}
                        </div>
                        <div style={{marginTop:6,textAlign:'center'}}>
                          <div style={{fontSize:11,fontWeight:700,color:s.signed?T.green:isActive?T.gold:T.mgrey}}>{s.label}</div>
                          {isActive&&s.role!=='done'&&<div style={{fontSize:10,color:T.gold}}>← Click to sign</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Summary stats */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
                <Stat label="Total Gross" value={fmt.kes(payroll.total_gross)} icon="💰"/>
                <Stat label="Total PAYE" value={fmt.kes(payroll.total_paye)} icon="🏛️" variant="red"/>
                <Stat label="Total Deductions" value={fmt.kes((payroll.total_paye||0)+(payroll.total_nhif||0)+(payroll.total_nssf||0)+(payroll.total_housing||0))} icon="➖" variant="amber"/>
                <Stat label="Total Net Pay" value={fmt.kes(payroll.total_net)} icon="✅" variant="green"/>
              </div>

              <Card style={{padding:0,overflow:'hidden'}}>
                <DataTable headers={['Employee','Dept','Gross Pay','PAYE','NHIF','NSSF','Housing','Net Pay','Status']}
                  rows={payrollEntries.map(e=>[
                    <strong>{e.name}</strong>,
                    <Badge variant="navy">{e.department}</Badge>,
                    fmt.kes(e.gross_pay),
                    <span style={{color:T.red}}>{fmt.kes(e.paye)}</span>,
                    fmt.kes(e.nhif),
                    fmt.kes(e.nssf),
                    fmt.kes(e.housing_levy),
                    <strong style={{color:T.green}}>{fmt.kes(e.net_pay)}</strong>,
                    <Badge variant="amber">{payroll.status}</Badge>,
                  ])}
                />
              </Card>
            </>
          )}
        </>
      )}

      {!loading&&tab==='gl'&&(
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
            <Stat label="Revenue YTD" value="Kshs 142.3M" sub="vs Kshs 285M target" icon="📈" variant="blue"/>
            <Stat label="Expenses YTD" value="Kshs 108.7M" sub="76.4% of revenue" icon="📉"/>
            <Stat label="Gross Profit YTD" value="Kshs 33.6M" sub="Margin: 23.6%" icon="💰" variant="green"/>
          </div>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Code','Account Name','Category','Type']}
              rows={accounts.map(a=>[
                <span style={{fontFamily:'monospace',fontSize:11,fontWeight:600,color:T.navy}}>{a.code}</span>,
                <strong style={{fontSize:12}}>{a.name}</strong>,
                <Badge variant={a.category==='Income'?'green':a.category==='Asset'?'blue':a.category==='Liability'?'red':a.category==='Equity'?'purple':'navy'}>{a.category}</Badge>,
                <span style={{fontSize:11,color:T.mgrey}}>{a.type}</span>,
              ])}
            />
          </Card>
        </>
      )}

      {!loading&&tab==='journals'&&(<>
        <Alert type="info"><strong>FIN-002:</strong> journals require three distinct users — preparer → reviewer → approver. Approval posts the entry; posted journals can't be deleted, only reversed. Accruals can auto-reverse on a chosen date.</Alert>
        <SectionHeader title="Journal Entries" action={<Btn size="sm" onClick={()=>setModal('journal')}>+ New Journal</Btn>}/>
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Entry','Date','Description','Amount','Status','Workflow']}
            empty="No journals yet."
            rows={journals.map(j=>[
              <span style={{fontFamily:'monospace',fontSize:11}}>{j.entry_no}</span>, fmt.date(j.date),
              <span>{j.description}{j.is_reversal?<Badge variant="purple" size="sm"> reversal</Badge>:''}</span>,
              fmt.kes(j.total_debit),
              <Badge variant={j.status==='posted'?'green':j.status==='reviewed'?'blue':'amber'}>{j.status}</Badge>,
              j.status==='draft'?<Btn size="sm" onClick={()=>jAction('review_journal',j.id)}>Review</Btn>
              :j.status==='reviewed'?<Btn size="sm" onClick={()=>jAction('approve_journal',j.id)}>Approve & Post</Btn>
              :j.status==='posted'&&!j.is_reversal&&!j.reversed_by?<Btn size="sm" variant="ghost" onClick={()=>jAction('reverse_journal',j.id)}>Reverse</Btn>
              :'✓',
            ])}/>
        </Card>
      </>)}

      {!loading&&tab==='monthend'&&monthEnd&&(<>
        <Alert type="info"><strong>FIN-003:</strong> complete every checklist item, then the CFO signs off to close the period. A closed period is locked — no journals can be dated into it.</Alert>
        <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:14}}>
          <label style={{fontSize:12,fontWeight:600,color:T.dgrey}}>Period:</label>
          <input type="month" value={closePeriod} onChange={e=>reloadMonthEnd(e.target.value)} style={{padding:'7px 10px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:13}}/>
          <Badge variant={monthEnd.status==='closed'?'green':monthEnd.status==='open'?'amber':'default'}>{monthEnd.status}</Badge>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18}}>
          <Card>
            <SectionHeader title="Close Checklist"
              action={monthEnd.status==='not_started'?<Btn size="sm" onClick={openClose}>Start Close</Btn>
                :monthEnd.status==='open'?<Btn size="sm" onClick={finalizeClose} disabled={!monthEnd.checklist.every(i=>i.done)}>CFO Close & Sign</Btn>:null}/>
            {monthEnd.checklist.map(it=>(
              <label key={it.key} style={{display:'flex',gap:8,alignItems:'center',padding:'7px 0',borderBottom:`1px solid ${T.offwt}`,fontSize:13,opacity:monthEnd.status==='closed'?0.7:1}}>
                <input type="checkbox" checked={!!it.done} disabled={monthEnd.status!=='open'} onChange={()=>toggleCloseItem(it.key,!it.done)}/>
                <span>{it.label}</span>
              </label>
            ))}
            {monthEnd.status==='closed'&&<div style={{marginTop:10,padding:'8px 10px',background:T.greenL,borderRadius:6,fontSize:12,color:T.green}}>🔐 Closed & signed — {fmt.date(monthEnd.closed_at)}</div>}
          </Card>
          <Card>
            <SectionHeader title="P&L by Department" sub={`Posted journals · ${closePeriod}`}/>
            <DataTable headers={['Department','Income','Expense','Net']}
              empty="No posted journals in this period."
              rows={plDept.map(r=>[<strong>{r.dept}</strong>,fmt.kes(r.income),fmt.kes(r.expense),
                <span style={{fontWeight:700,color:(r.net||0)>=0?T.green:T.red}}>{fmt.kes(r.net)}</span>])}/>
          </Card>
        </div>
      </>)}

      {!loading&&tab==='budgets'&&(<>
        <Alert type="info"><strong>FIN-019/020/021:</strong> annual department budgets and revenue targets vs actuals from posted journals. Budgets flag <strong>amber at 80%</strong> and <strong>red at 100%</strong> consumed.</Alert>
        <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:14}}>
          <label style={{fontSize:12,fontWeight:600,color:T.dgrey}}>Fiscal Year:</label>
          <select value={budgetYear} onChange={e=>reloadBudgets(e.target.value)} style={{padding:'7px 10px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:13}}>
            {['2025','2026','2027'].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <SectionHeader title="Department Budgets vs Actual" sub="Actual expense from posted journals" action={<Btn size="sm" onClick={()=>setModal('budget')}>+ Budget</Btn>}/>
        <Card style={{padding:0,overflow:'hidden',marginBottom:18}}>
          <DataTable headers={['Department','Cost Centre','Annual Budget','Actual','Consumed','Variance','Status']}
            empty="No budgets for this year — add one above."
            rows={budgetData.budgets.map(b=>[
              <strong>{b.department}</strong>, b.cost_centre||'—', fmt.kes(b.annual_amount), fmt.kes(b.actual),
              <div style={{minWidth:90}}>
                <div style={{height:6,background:T.lgrey,borderRadius:3,overflow:'hidden'}}><div style={{width:`${Math.min(100,b.consumed_pct)}%`,height:'100%',background:b.status==='over'?T.red:b.status==='warning'?T.amber:T.green}}/></div>
                <span style={{fontSize:10,color:T.mgrey}}>{b.consumed_pct}%</span>
              </div>,
              <span style={{color:b.variance<0?T.red:T.dgrey}}>{fmt.kes(b.variance)}</span>,
              <Badge variant={b.status==='over'?'red':b.status==='warning'?'amber':'green'}>{b.status==='over'?'OVER 100%':b.status==='warning'?'≥80%':'OK'}</Badge>,
            ])}/>
        </Card>

        <SectionHeader title="Revenue vs Target" sub="Actual income from posted journals" action={<Btn size="sm" onClick={()=>setModal('target')}>+ Target</Btn>}/>
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Scope','Annual Target','Actual','Achieved','Variance','Status']}
            empty="No revenue targets for this year."
            rows={budgetData.targets.map(t=>[
              <strong>{t.scope}</strong>, fmt.kes(t.annual_target), fmt.kes(t.actual),
              <span style={{fontWeight:700,color:t.status==='met'?T.green:t.status==='on_track'?T.amber:T.red}}>{t.achieved_pct}%</span>,
              <span style={{color:t.variance<0?T.red:T.green}}>{fmt.kes(t.variance)}</span>,
              <Badge variant={t.status==='met'?'green':t.status==='on_track'?'amber':'red'}>{t.status.replace('_',' ')}</Badge>,
            ])}/>
        </Card>
      </>)}

      {!loading&&tab==='payments'&&(<>
        <Alert type="info"><strong>Accounts Payable:</strong> supplier invoices must clear a 3-way match (LPO ↔ GRN ↔ invoice) before a payment voucher can be raised (FIN-006). Voucher amount sets the required approval authority (FIN-007); approved vouchers are paid in batches signed FM → CFO → MD (FIN-008).</Alert>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:16}}>
          <Stat label="Supplier Invoices" value={payables.stats?.total||0} icon="🧾"/>
          <Stat label="Match Exceptions" value={payables.stats?.exceptions||0} icon="⚠️" variant="amber"/>
          <Stat label="Vouchers" value={vouchers.length} icon="💳"/>
          <Stat label="Batches" value={batches.length} icon="📦"/>
        </div>

        <SectionHeader title="Supplier Invoices — 3-Way Match" action={<div style={{display:'flex',gap:8}}><Btn size="sm" onClick={()=>setModal('match')}>+ Match Invoice</Btn><Btn size="sm" variant="ghost" onClick={()=>setModal('adhoc')}>+ Ad-hoc Voucher</Btn></div>}/>
        <Card style={{padding:0,overflow:'hidden',marginBottom:18}}>
          <DataTable headers={['Invoice','Supplier','Invoice Amt','LPO Amt','Match','Status','']}
            empty="No supplier invoices yet — match one against an LPO above."
            rows={payables.invoices.map(i=>[
              <span style={{fontFamily:'monospace',fontSize:11}}>{i.invoice_no}</span>, i.supplier_name||'—',
              fmt.kes(i.invoice_amount), fmt.kes(i.lpo_amount),
              <Badge variant={i.match_status==='matched'?'green':'amber'}>{i.match_status}</Badge>,
              <Badge variant={i.status==='exception'?'red':i.status==='matched'?'green':'navy'}>{i.status}</Badge>,
              i.status==='exception'?<Btn size="sm" variant="ghost" onClick={()=>approveException(i.id)}>CFO Approve</Btn>
                : i.status==='matched'?<Btn size="sm" onClick={()=>raiseVoucher(i)}>Raise Voucher</Btn> : '✓',
            ])}/>
        </Card>

        <SectionHeader title="Payment Vouchers" sub="Approval enforced by amount (FIN-007). Select approved vouchers to batch."
          action={<Btn size="sm" disabled={!batchSel.length} onClick={createBatch}>Batch {batchSel.length||''} →</Btn>}/>
        <Card style={{padding:0,overflow:'hidden',marginBottom:18}}>
          <DataTable headers={['','Voucher','Payee','Amount','Requires','Status','']}
            empty="No vouchers yet."
            rows={vouchers.map(v=>[
              v.status==='approved'&&!v.batch_id?<input type="checkbox" checked={batchSel.includes(v.id)} onChange={()=>toggleBatchSel(v.id)}/>:'',
              <span style={{fontFamily:'monospace',fontSize:11}}>{v.voucher_no}</span>, v.payee, fmt.kes(v.amount),
              <Badge variant="navy">{(v.required_level||v.auth_level||'').replace('_',' ')}</Badge>,
              <Badge variant={v.status==='paid'?'green':v.status==='approved'?'blue':'amber'}>{v.status}</Badge>,
              v.status==='pending_approval'?<Btn size="sm" onClick={()=>approveVoucher(v.id)}>Approve</Btn>:v.status==='approved'?'✓ signed':'—',
            ])}/>
        </Card>

        <SectionHeader title="Payment Batches — FM → CFO → MD"/>
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Batch','Vouchers','Total','Status','Sign']}
            empty="No batches yet."
            rows={batches.map(b=>[
              <span style={{fontFamily:'monospace',fontSize:11}}>{b.batch_no}</span>, b.voucher_count, fmt.kes(b.total_amount),
              <Badge variant={b.status==='approved'?'green':b.status==='draft'?'amber':'blue'}>{b.status}</Badge>,
              b.status==='approved'?'✓ paid':(
                <div style={{display:'flex',gap:4}}>
                  <Btn size="sm" variant={b.fm_sig?'ghost':'primary'} disabled={!!b.fm_sig} onClick={()=>signBatch(b.id,'fm')}>FM</Btn>
                  <Btn size="sm" variant={b.cfo_sig?'ghost':'primary'} disabled={!b.fm_sig||!!b.cfo_sig} onClick={()=>signBatch(b.id,'cfo')}>CFO</Btn>
                  <Btn size="sm" variant={b.md_sig?'ghost':'primary'} disabled={!b.cfo_sig||!!b.md_sig} onClick={()=>signBatch(b.id,'md')}>MD</Btn>
                </div>
              ),
            ])}/>
        </Card>
      </>)}

      {!loading&&tab==='payauth'&&(
        <>
          <Alert type="info"><strong>QSL-FIN-007 — Payment Authority Matrix:</strong> the system enforces these limits on every payment voucher. A payment above a role's limit is refused with an escalation message — no overrides. Edit the limits in Administration → System Settings → Finance.</Alert>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Authorisation Level','Payment Limit (≤)','Role']}
              rows={authMatrix.map(m=>[
                <strong style={{color:T.navy}}>{m.level}</strong>,
                <span style={{fontWeight:700,color:'var(--accent, #C8960C)',fontFamily:'monospace'}}>{m.limit==null?'No limit (top authority)':fmt.kes(m.limit)}</span>,
                <Badge variant={m.role==='md'?'red':m.role==='cfo'?'amber':'blue'}>{m.role.replace('_',' ')}</Badge>,
              ])}
            />
          </Card>
        </>
      )}

      {modal==='retire'&&(
        <Modal title="Retire Imprest — receipt required (FIN-012A)" onClose={()=>setModal(null)} width={480}>
          <Alert type="info">A receipt photo/PDF is mandatory before claiming. ~20% of retirements are auto-flagged for a Finance Manager spot-check.</Alert>
          <Input label="Amount Accounted (Kshs)" type="number" value={retireForm.amount_accounted} onChange={v=>setRetireForm({...retireForm,amount_accounted:v})} required/>
          <Input label="Receipt reference / URL" value={retireForm.receipt_path} onChange={v=>setRetireForm({...retireForm,receipt_path:v})} required placeholder="uploaded receipt path or URL"/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={retireImprest} disabled={!retireForm.amount_accounted||!retireForm.receipt_path}>Retire</Btn></div>
        </Modal>
      )}

      {modal==='imprest'&&(
        <Modal title="Request Imprest — QSL-FIN-CHP-001" onClose={()=>setModal(null)}>
          <Alert type="warning">Flow: request → Line Manager approves → Finance Manager releases. The 14-day clock starts at release; unretired imprest converts irreversibly to a personal advance.</Alert>
          <Select label="Employee" value={form.employee_id} onChange={v=>setForm({...form,employee_id:v})} required options={[{value:'',label:'Select employee…'},...employees.map(e=>({value:e.id,label:`${e.first_name} ${e.last_name} — ${e.department}`}))]}/>
          <Input label="Amount (Kshs)" value={form.amount} onChange={v=>setForm({...form,amount:v})} type="number" required placeholder="0"/>
          <Input label="Purpose" value={form.purpose} onChange={v=>setForm({...form,purpose:v})} required placeholder="Business purpose…"/>
          <Input label="Expected Return Date" type="date" value={form.expected_return_date||''} onChange={v=>setForm({...form,expected_return_date:v})}/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn onClick={createImprest} disabled={!form.employee_id||!form.amount||!form.purpose}>Submit Request</Btn>
          </div>
        </Modal>
      )}

      {modal==='match'&&(
        <Modal title="3-Way Match — Supplier Invoice (FIN-006)" onClose={()=>setModal(null)} width={540}>
          <Alert type="info">The system matches the invoice against the LPO (ordered) and requires a completed GRN (received). A variance or missing GRN is flagged for CFO approval.</Alert>
          <Select label="Local Purchase Order" value={matchForm.lpo_id} onChange={v=>setMatchForm({...matchForm,lpo_id:v})} required
            options={[{value:'',label:'Select LPO…'},...lpos.map(l=>({value:l.id,label:`${l.lpo_no} — ${fmt.kes(l.grand_total)}`}))]}/>
          <Input label="Supplier Invoice No." value={matchForm.invoice_no} onChange={v=>setMatchForm({...matchForm,invoice_no:v})} required placeholder="e.g. SI-2026-001"/>
          <Input label="Invoice Amount (Kshs)" type="number" value={matchForm.invoice_amount} onChange={v=>setMatchForm({...matchForm,invoice_amount:v})} required placeholder="0"/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={matchInvoice} disabled={!matchForm.lpo_id||!matchForm.invoice_no||!matchForm.invoice_amount}>Run Match</Btn></div>
        </Modal>
      )}

      {modal==='adhoc'&&(
        <Modal title="Ad-hoc Payment Voucher" onClose={()=>setModal(null)} width={520}>
          <Alert type="info">The amount determines the approval authority required (FIN-007).</Alert>
          <Input label="Payee" value={adhoc.payee} onChange={v=>setAdhoc({...adhoc,payee:v})} required/>
          <Input label="Amount (Kshs)" type="number" value={adhoc.amount} onChange={v=>setAdhoc({...adhoc,amount:v})} required placeholder="0"/>
          <Input label="Purpose" value={adhoc.purpose} onChange={v=>setAdhoc({...adhoc,purpose:v})} required/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={raiseAdhoc} disabled={!adhoc.payee||!adhoc.amount||!adhoc.purpose}>Raise Voucher</Btn></div>
        </Modal>
      )}

      {modal==='journal'&&(
        <Modal title="New Journal Entry (FIN-002)" onClose={()=>setModal(null)} width={680}>
          <Alert type="info">Drafted by you (preparer). It must then be reviewed and approved by two other users before it posts.</Alert>
          <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:12}}>
            <Input label="Date" type="date" value={jForm.date} onChange={v=>setJForm({...jForm,date:v})}/>
            <Input label="Description" value={jForm.description} onChange={v=>setJForm({...jForm,description:v})} required placeholder="e.g. June rent accrual"/>
          </div>
          <div style={{marginTop:8,marginBottom:6,fontSize:11,fontWeight:700,color:T.dgrey,textTransform:'uppercase'}}>Lines</div>
          {jForm.lines.map((l,i)=>(
            <div key={i} style={{display:'grid',gridTemplateColumns:'2.5fr 1fr 1fr 1.2fr',gap:6,marginBottom:6}}>
              <select value={l.account_id} onChange={e=>jLineSet(i,'account_id',e.target.value)} style={{padding:'7px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:12}}>
                <option value="">Account…</option>
                {accounts.filter(a=>a.type!=='header').map(a=><option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
              <input type="number" placeholder="Debit" value={l.debit} onChange={e=>jLineSet(i,'debit',e.target.value)} style={{padding:'7px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:12}}/>
              <input type="number" placeholder="Credit" value={l.credit} onChange={e=>jLineSet(i,'credit',e.target.value)} style={{padding:'7px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:12}}/>
              <input placeholder="Dept" value={l.dept} onChange={e=>jLineSet(i,'dept',e.target.value)} style={{padding:'7px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:12}}/>
            </div>
          ))}
          <Btn size="sm" variant="ghost" onClick={jLineAdd}>+ Add line</Btn>
          <div style={{marginTop:12,padding:'8px 10px',background:T.offwt,borderRadius:6}}>
            <label style={{display:'flex',gap:8,alignItems:'center',fontSize:12,fontWeight:600}}>
              <input type="checkbox" checked={jForm.auto_reverse} onChange={e=>setJForm({...jForm,auto_reverse:e.target.checked})}/>
              Accrual — auto-reverse on a future date
            </label>
            {jForm.auto_reverse&&<Input label="Reversal date" type="date" value={jForm.reversal_date} onChange={v=>setJForm({...jForm,reversal_date:v})}/>}
          </div>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:10}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={createJournal} disabled={!jForm.description}>Create Draft</Btn></div>
        </Modal>
      )}

      {modal==='budget'&&(
        <Modal title={`Department Budget — FY ${budgetYear} (FIN-020)`} onClose={()=>setModal(null)} width={500}>
          <Alert type="info">Even monthly phasing is applied automatically. Saving again for the same department/cost-centre updates it.</Alert>
          <Select label="Department" value={bForm.department} onChange={v=>setBForm({...bForm,department:v})} required
            options={[{value:'',label:'Select department…'},...[...new Set(employees.map(e=>e.department).filter(Boolean))].map(d=>({value:d,label:d}))]}/>
          <Input label="Cost Centre (optional)" value={bForm.cost_centre} onChange={v=>setBForm({...bForm,cost_centre:v})} placeholder="e.g. Calibration Lab"/>
          <Input label="Annual Budget (Kshs)" type="number" value={bForm.annual_amount} onChange={v=>setBForm({...bForm,annual_amount:v})} required placeholder="0"/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={createBudget} disabled={!bForm.department||!bForm.annual_amount}>Save Budget</Btn></div>
        </Modal>
      )}

      {modal==='target'&&(
        <Modal title={`Revenue Target — FY ${budgetYear} (FIN-019)`} onClose={()=>setModal(null)} width={500}>
          <Alert type="info">Use a department name, or "Company" for the company-wide target. Actual is measured from posted income journals.</Alert>
          <Select label="Scope" value={tForm.scope} onChange={v=>setTForm({...tForm,scope:v})} required
            options={[{value:'',label:'Select scope…'},{value:'Company',label:'Company-wide'},...[...new Set(employees.map(e=>e.department).filter(Boolean))].map(d=>({value:d,label:d}))]}/>
          <Input label="Annual Target (Kshs)" type="number" value={tForm.annual_target} onChange={v=>setTForm({...tForm,annual_target:v})} required placeholder="0"/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={createTarget} disabled={!tForm.scope||!tForm.annual_target}>Save Target</Btn></div>
        </Modal>
      )}
    </div>
  );
}

// ── TAX & KRA MODULE ─────────────────────────────────────────────────────────
function TaxModule({ api }) {
  const [tab,setTab]=useState('dashboard');
  const [data,setData]=useState(null);
  const [invoices,setInvoices]=useState([]);
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({client_id:'',date:new Date().toISOString().split('T')[0],description:'',amount:'',vat_category:'A'});
  const [clients,setClients]=useState([]);
  const [msg,setMsg]=useState(null);
  const [vatResult,setVatResult]=useState(null);

  useEffect(()=>{
    api.get('/api/tax?section=dashboard').then(r=>{ if(r?.success) setData(r.data); });
    api.get('/api/crm?section=clients').then(r=>{ if(r?.success) setClients(r.data); });
  },[]);

  const loadInvoices = () => { setLoading(true); api.get('/api/tax?section=invoices').then(r=>{ if(r?.success) setInvoices(r.data); setLoading(false); }); };

  const computeVAT = async () => {
    const period = new Date().toISOString().slice(0,7);
    const r = await api.post('/api/tax',{action:'compute_vat_return',period});
    if(r?.success) setVatResult(r.data);
    setMsg(r?.success?{type:'success',text:`VAT return computed for ${period}`}:{type:'error',text:r?.error});
  };

  const createInvoice = async () => {
    if(!form.client_id||!form.description||!form.amount) return;
    const r=await api.post('/api/tax',{action:'create_invoice',client_id:form.client_id,date:form.date,lines:[{description:form.description,amount:parseFloat(form.amount),vat_category:form.vat_category,quantity:1,unit_price:parseFloat(form.amount)}],submit_to_etims:true});
    if(r?.success){ setMsg({type:'success',text:`Invoice ${r.data.invoice_no} created — Total: ${fmt.kes(r.data.total)} — eTIMS: ${r.data.etims?.success?'Submitted':'Queued'}`}); setModal(null); loadInvoices(); }
    else setMsg({type:'error',text:r?.error});
  };

  const vat16 = (amt) => Math.round(parseFloat(amt||0)*0.16);

  return (
    <div>
      {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
      <Tabs tabs={[{id:'dashboard',label:'Tax Dashboard'},{id:'invoices',label:'Tax Invoices (eTIMS)'},{id:'vat',label:'VAT Returns'},{id:'paye',label:'PAYE Returns'},{id:'calendar',label:'Statutory Calendar'}]} active={tab} setActive={t=>{setTab(t);if(t==='invoices')loadInvoices();}}/>

      {tab==='dashboard'&&(
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
            <Stat label="Invoices Issued YTD" value={data?.invoiceStats?.total||0} icon="🧾"/>
            <Stat label="eTIMS Submitted" value={data?.invoiceStats?.submitted||0} icon="✅" variant="green"/>
            <Stat label="Total Invoice Value" value={fmt.kes(data?.invoiceStats?.total_value)} icon="💰"/>
            <Stat label="VAT Returns Filed" value={`${data?.vatStats?.filed||0}/${data?.vatStats?.total||0}`} icon="🏛️" variant="blue"/>
          </div>
          <Alert type="info"><strong>Kenya Tax Obligations:</strong> PAYE due 9th · NHIF due 9th · NSSF due 15th · VAT due 20th · Housing Levy due 9th. KRA eTIMS invoice submission required for all VAT-registered sales.</Alert>
          <Card>
            <SectionHeader title="Statutory Obligations Calendar"/>
            <DataTable headers={['Obligation','Agency','Due Day','Frequency','Next Due']}
              rows={(data?.obligations||[]).map(o=>[
                <strong style={{fontSize:12}}>{o.name}</strong>,
                <Badge variant="navy">{o.agency}</Badge>,
                o.due_day?`${o.due_day}th of month`:'Annual',
                o.frequency,
                <span style={{fontWeight:600,color:T.navy}}>{o.next_due||'—'}</span>,
              ])}
            />
          </Card>
        </>
      )}

      {tab==='invoices'&&(
        <>
          <Alert type="info"><strong>KRA eTIMS:</strong> All invoices are automatically submitted to KRA eTIMS on creation. The CU receipt number confirms KRA acceptance.</Alert>
          <SectionHeader title="Tax Invoice Register" action={<Btn onClick={()=>setModal('invoice')}>+ Create Invoice</Btn>}/>
          {loading?<Loading/>:<Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Invoice No','Client','Date','Subtotal','VAT (16%)','Total','eTIMS Status']}
              rows={invoices.map(i=>[
                <span style={{fontFamily:'monospace',fontSize:11,fontWeight:600}}>{i.invoice_no}</span>,
                <strong style={{fontSize:12}}>{i.client_name}</strong>,
                fmt.date(i.date),
                fmt.kes(i.subtotal),
                <span style={{color:T.red}}>{fmt.kes(i.vat_amount)}</span>,
                <strong>{fmt.kes(i.total)}</strong>,
                <Badge variant={i.etims_status==='submitted'?'green':'amber'}>{i.etims_status||'pending'}</Badge>,
              ])}
            />
          </Card>}
        </>
      )}

      {tab==='vat'&&(
        <>
          <Alert type="info"><strong>VAT:</strong> 16% standard rate. Due 20th of following month. Net VAT = Output VAT (sales) minus Input VAT (purchases). System auto-computes from invoice and LPO data.</Alert>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <Card>
              <SectionHeader title="Compute VAT Return" sub={`Period: ${new Date().toISOString().slice(0,7)}`} action={<Btn onClick={computeVAT} size="sm">Compute Now</Btn>}/>
              {vatResult&&(
                <div>
                  {[['Output VAT (Sales)',vatResult.output_vat,T.red],['Input VAT (Purchases)',vatResult.input_vat,T.green],['Net VAT Payable',vatResult.payable,T.navy]].map(([l,v,c])=>(
                    <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${T.lgrey}`}}>
                      <span style={{fontWeight:600}}>{l}</span><span style={{fontWeight:700,color:c}}>{fmt.kes(v)}</span>
                    </div>
                  ))}
                  <div style={{marginTop:14,display:'flex',gap:8}}>
                    <Btn size="sm" onClick={()=>api.post('/api/tax',{action:'file_return',return_type:'vat',period:new Date().toISOString().slice(0,7)}).then(r=>r?.success&&setMsg({type:'success',text:'VAT return filed on KRA iTax'}))}>File on KRA iTax</Btn>
                  </div>
                </div>
              )}
            </Card>
            <Card>
              <SectionHeader title="Kenya VAT Categories"/>
              {[['A','Standard Rate','16%'],['B','Zero Rated — Exports','0%'],['C','Zero Rated — Other','0%'],['E','Exempt','N/A']].map(([cat,desc,rate])=>(
                <div key={cat} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${T.lgrey}`}}>
                  <div><span style={{fontFamily:'monospace',fontWeight:700,color:T.navy,marginRight:10}}>{cat}</span><span style={{fontSize:12}}>{desc}</span></div>
                  <Badge variant={cat==='A'?'red':'green'}>{rate}</Badge>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}

      {tab==='paye'&&(
        <Card>
          <SectionHeader title="PAYE Bands — Kenya 2024/2025" sub="Source: Kenya Revenue Authority"/>
          <DataTable headers={['Income Band (Monthly)','Tax Rate','Notes']}
            rows={[
              ['0 — Kshs 24,000','10%','First band'],
              ['Kshs 24,001 — Kshs 32,333','25%','Second band'],
              ['Kshs 32,334 — Kshs 500,000','30%','Third band'],
              ['Kshs 500,001 — Kshs 800,000','32.5%','Fourth band'],
              ['Above Kshs 800,000','35%','Top band'],
            ].map(([band,rate,note])=>[band,<strong style={{color:T.red}}>{rate}</strong>,<span style={{fontSize:11,color:T.mgrey}}>{note}</span>])}
          />
          <div style={{marginTop:16,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
            {[['Personal Relief','Kshs 2,400/month'],['NHIF (SHIF)','2.75% of gross'],['NSSF','6% up to Kshs 36,000'],['Housing Levy','1.5% of gross'],['WHT — Professional','5%'],['WHT — Construction','3%']].map(([l,v])=>(
              <div key={l} style={{background:T.offwt,padding:'10px 12px',borderRadius:7}}>
                <div style={{fontSize:10,color:T.mgrey,fontWeight:600}}>{l}</div>
                <div style={{fontSize:13,fontWeight:700,color:T.navy}}>{v}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab==='calendar'&&(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Obligation','Agency','Due','Frequency','Penalty for Late Filing']}
            rows={(data?.obligations||[]).map(o=>[
              <strong style={{fontSize:12}}>{o.name}</strong>,
              o.agency,
              o.due_day?`${o.due_day}th of month`:'Annually',
              o.frequency,
              <span style={{fontSize:11,color:T.red}}>5% of tax due + 2% p.m. interest</span>,
            ])}
          />
        </Card>
      )}

      {modal==='invoice'&&(
        <Modal title="Create Tax Invoice — eTIMS" onClose={()=>setModal(null)}>
          <Alert type="info">Invoice will be automatically submitted to KRA eTIMS on creation.</Alert>
          <Select label="Client" value={form.client_id} onChange={v=>setForm({...form,client_id:v})} required options={[{value:'',label:'Select client…'},...clients.map(c=>({value:c.id,label:`${c.name} — PIN: ${c.kra_pin||'N/A'}`}))]}/>
          <Input label="Invoice Date" value={form.date} onChange={v=>setForm({...form,date:v})} type="date" required/>
          <Input label="Description / Service" value={form.description} onChange={v=>setForm({...form,description:v})} required placeholder="e.g. Calibration services — June 2026"/>
          <Input label="Amount (excl. VAT) — Kshs" value={form.amount} onChange={v=>setForm({...form,amount:v})} type="number" required placeholder="0"/>
          <Select label="VAT Category" value={form.vat_category} onChange={v=>setForm({...form,vat_category:v})} options={[{value:'A',label:'A — Standard Rate (16%)'},{value:'B',label:'B — Zero Rated (Exports)'},{value:'E',label:'E — Exempt'}]}/>
          {form.amount&&<div style={{background:T.offwt,padding:'12px 14px',borderRadius:8,marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:13}}><span>Subtotal:</span><strong>{fmt.kes(parseFloat(form.amount||0))}</strong></div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:T.red}}><span>VAT (16%):</span><strong>{fmt.kes(vat16(form.amount))}</strong></div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:14,fontWeight:700,borderTop:`1px solid ${T.lgrey}`,marginTop:8,paddingTop:8}}><span>Total:</span><span style={{color:T.navy}}>{fmt.kes(parseFloat(form.amount||0)+vat16(form.amount))}</span></div>
          </div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn onClick={createInvoice} disabled={!form.client_id||!form.description||!form.amount}>Create & Submit to eTIMS</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── PROJECTS MODULE ───────────────────────────────────────────────────────────
function Projects({ api }) {
  const [projects,setProjects]=useState([]);
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState(null);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState('overview');
  const [modal,setModal]=useState(null);
  const [expForm,setExpForm]=useState({description:'',category:'Labour Staff',amount:'',date:new Date().toISOString().split('T')[0]});
  const [msg,setMsg]=useState(null);
  const [signing,setSigning]=useState(false);

  useEffect(()=>{ api.get('/api/projects?section=list').then(r=>{ if(r?.success) setProjects(r.data); setLoading(false); }); },[]);

  const loadDetail = (id) => {
    setLoading(true);
    api.get(`/api/projects?section=detail&id=${id}`).then(r=>{ if(r?.success) setDetail(r.data); setLoading(false); });
  };

  const postExpense = async () => {
    if(!expForm.description||!expForm.amount) return;
    const r=await api.post('/api/projects',{action:'post_expense',project_id:selected,...expForm,amount:parseFloat(expForm.amount)});
    if(r?.success){ setMsg({type:'success',text:`Expense posted — ${fmt.kes(expForm.amount)}`}); setModal(null); loadDetail(selected); }
    else setMsg({type:'error',text:r?.error});
  };

  const mdOverride = async () => {
    setSigning(true);
    const r=await api.post('/api/projects',{action:'md_budget_override',project_id:selected,additional_amount:500000,justification:'MD approved additional budget',md_signature_key:`QSL-DS-HA-${Date.now()}`});
    setSigning(false);
    if(r?.success) setMsg({type:'success',text:'MD budget override approved — Kshs 500,000 released'});
    else setMsg({type:'error',text:r?.error});
    loadDetail(selected);
  };

  if(selected&&detail) {
    const p=detail.project;
    const pctBud = p.budget_total>0 ? p.expenses_total/p.budget_total : 0;
    const gp     = p.contract_value - p.expenses_total;
    const margin = p.contract_value>0 ? gp/p.contract_value : 0;
    return (
      <div>
        <button onClick={()=>{setSelected(null);setDetail(null);setMsg(null);}} style={{background:'none',border:'none',color:T.navy,cursor:'pointer',fontSize:13,fontWeight:600,marginBottom:14,display:'flex',alignItems:'center',gap:6}}>← Back to Projects</button>
        {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
        {p.budget_blocked&&!msg&&<Alert type="error">🛑 <strong>PROJ-016:</strong> Budget block active — {fmt.pct(pctBud)} of budget used. MD digital signature required. <Btn size="sm" variant="danger" onClick={mdOverride} disabled={signing}>{signing?'Signing…':'MD Override'}</Btn></Alert>}

        <Card style={{marginBottom:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
            <div><h2 style={{fontSize:16,fontWeight:700,color:T.navy,margin:0}}>{p.name}</h2><p style={{fontSize:12,color:T.mgrey,margin:'4px 0 0'}}>{p.client_name} · PM: {p.pm_name}</p></div>
            <Badge variant={p.status==='active'?'green':p.status==='overdue'?'red':'amber'}>{p.status}</Badge>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginBottom:12}}>
            {[['Value',fmt.kes(p.contract_value)],['Budget',fmt.kes(p.budget_total)],['Expenses',fmt.kes(p.expenses_total)],['Invoiced',fmt.kes(p.invoiced_total)],['Collected',fmt.kes(p.collected_total)]].map(([l,v])=>(
              <div key={l} style={{background:T.offwt,padding:'8px 10px',borderRadius:7}}><div style={{fontSize:9,color:T.mgrey,fontWeight:600}}>{l}</div><div style={{fontSize:12,fontWeight:700,color:T.navy}}>{v}</div></div>
            ))}
          </div>
          <Progress value={pctBud} height={10}/>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:T.mgrey,marginTop:5}}>
            <span>Budget Used: <strong style={{color:pctBud>=.95?T.red:pctBud>=.8?T.amber:T.green}}>{fmt.pct(pctBud)}</strong></span>
            <span>Gross Profit: <strong style={{color:margin>=.15?T.green:margin>=.1?T.amber:T.red}}>{fmt.kes(gp)} ({fmt.pct(margin)})</strong></span>
          </div>
        </Card>

        <Tabs tabs={[{id:'overview',label:'Overview'},{id:'milestones',label:'Milestones'},{id:'expenses',label:'Expenses'},{id:'subcontractors',label:'Subcontractors'},{id:'handover',label:'Handover'}]} active={tab} setActive={setTab}/>

        {tab==='overview'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <Card>
              <SectionHeader title="Daily Updates" sub="PROJ-014/015: Post by COB daily" action={<Btn size="sm" onClick={()=>setModal('expense')} disabled={!!p.budget_blocked}>{p.budget_blocked?'🛑 Blocked':'+ Post Expense'}</Btn>}/>
              {(detail.updates||[]).slice(0,5).map((u,i)=>(
                <div key={i} style={{borderLeft:`3px solid ${i===0?T.gold:T.lgrey}`,paddingLeft:10,marginBottom:12}}>
                  <div style={{fontSize:10,fontWeight:700,color:i===0?T.gold:T.mgrey,marginBottom:3}}>{fmt.date(u.date)} · {u.updated_by_name}</div>
                  {u.exp_update&&<div style={{fontSize:12,color:T.green,marginBottom:2}}>💰 {u.exp_update}</div>}
                  {u.milestone_update&&<div style={{fontSize:12,color:T.navy}}>🎯 {u.milestone_update}</div>}
                </div>
              ))}
            </Card>
            <Card>
              <SectionHeader title="P&L Summary"/>
              {[['Contract Value',p.contract_value,T.navy],['Total Budget',p.budget_total,T.navy],['Expenses',p.expenses_total,T.red],['Gross Profit',gp,margin>=.15?T.green:margin>=.1?T.amber:T.red],['Invoiced',p.invoiced_total,T.navy],['Collected',p.collected_total,T.green]].map(([l,v,c])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:`1px solid ${T.lgrey}`,fontSize:13}}>
                  <span>{l}</span><strong style={{color:c}}>{fmt.kes(v)}</strong>
                </div>
              ))}
            </Card>
          </div>
        )}

        {tab==='milestones'&&(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['#','Milestone','Planned','Actual','% Done','Status']}
              rows={(detail.milestones||[]).map(m=>[
                m.seq,
                <span style={{fontSize:12}}>{m.description}</span>,
                fmt.date(m.planned_date),
                m.actual_date?<span style={{color:T.green}}>{fmt.date(m.actual_date)}</span>:<span style={{color:T.mgrey}}>—</span>,
                <div style={{minWidth:80}}><div style={{fontSize:11,fontWeight:700,color:m.status==='completed'?T.green:T.blue,marginBottom:2}}>{m.pct_complete||0}%</div><Progress value={(m.pct_complete||0)/100}/></div>,
                <Badge variant={m.status==='completed'?'green':m.status==='in_progress'?'blue':'default'}>{m.status||'planned'}</Badge>,
              ])}
            />
          </Card>
        )}

        {tab==='expenses'&&(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Date','Description','Category','Amount','Posted By','Approved']}
              rows={(detail.expenses||[]).map(e=>[
                fmt.date(e.date),
                <span style={{fontSize:12}}>{e.description}</span>,
                <Badge variant="navy">{e.category}</Badge>,
                <strong>{fmt.kes(e.amount)}</strong>,
                e.posted_by_name,
                e.approved_by?<Badge variant="green">✓ Approved</Badge>:<Badge variant="amber">Pending</Badge>,
              ])}
            />
          </Card>
        )}

        {tab==='subcontractors'&&(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Subcontractor','Scope','Contract','Paid','Retention','Balance','RAMS','Status']}
              rows={(detail.subcontractors||[]).map(s=>[
                <strong>{s.supplier_name}</strong>,
                s.scope,
                fmt.kes(s.contract_value),
                fmt.kes(s.paid_to_date),
                fmt.kes(s.contract_value*(s.retention_pct||.1)),
                fmt.kes(s.contract_value-s.paid_to_date),
                s.rams_uploaded?<Badge variant="green">✅ Filed</Badge>:<Badge variant="red">Missing</Badge>,
                <Badge variant={s.status==='active'?'green':'default'}>{s.status}</Badge>,
              ])}
            />
          </Card>
        )}

        {tab==='handover'&&(
          <Card>
            <Alert type="warning"><strong>POH-002:</strong> 4 digital signatures mandatory before project closure: Outgoing PM, Client/Incoming PM, Dept Head, MD.</Alert>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
              {['Outgoing Process Owner','Client / Incoming Representative','Department Head','Managing Director'].map((role,i)=>(
                <div key={role} style={{padding:'14px',border:`2px dashed ${T.lgrey}`,borderRadius:8}}>
                  <div style={{fontSize:10,color:T.mgrey,fontWeight:700,textTransform:'uppercase',marginBottom:6}}>Signature {i+1} of 4</div>
                  <div style={{fontSize:13,fontWeight:700,color:T.navy}}>{role}</div>
                  <Badge variant="default" style={{marginTop:8}}>Awaiting Signature</Badge>
                </div>
              ))}
            </div>
            <div style={{background:T.redL,padding:'10px 14px',borderRadius:7,fontSize:12,color:T.red,fontWeight:600}}>🛑 Project CANNOT be closed until all 4 signatures are applied.</div>
          </Card>
        )}

        {modal==='expense'&&(
          <Modal title="Post Expense — PROJ-014" onClose={()=>setModal(null)}>
            <Alert type="info">Receipt upload mandatory before Finance Manager approval (FIN-012A).</Alert>
            <Input label="Description" value={expForm.description} onChange={v=>setExpForm({...expForm,description:v})} required placeholder="What was this expenditure for?"/>
            <Input label="Amount (Kshs)" value={expForm.amount} onChange={v=>setExpForm({...expForm,amount:v})} type="number" required/>
            <Select label="Category" value={expForm.category} onChange={v=>setExpForm({...expForm,category:v})} options={['Labour Staff','Labour Casual','Subcontractor','Materials','Plant Hire','Transport','Consumables','Safety/PPE','Accommodation','Overhead'].map(c=>({value:c,label:c}))}/>
            <Input label="Date" value={expForm.date} onChange={v=>setExpForm({...expForm,date:v})} type="date"/>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={postExpense} disabled={!expForm.description||!expForm.amount}>Post Expense</Btn>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div>
      {loading?<Loading/>:(
        <>
          <SectionHeader title="Project Portfolio" action={<Btn onClick={()=>{}}>+ New Project</Btn>}/>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:14}}>
            {projects.map(p=>{
              const pct = p.budget_total>0 ? p.expenses_total/p.budget_total : 0;
              return (
                <Card key={p.id} onClick={()=>{setSelected(p.id);loadDetail(p.id);}} style={{cursor:'pointer'}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
                    <div style={{flex:1,minWidth:0,marginRight:8}}><div style={{fontSize:13,fontWeight:700,color:T.navy}}>{p.name}</div><div style={{fontSize:11,color:T.mgrey}}>{p.client_name}</div></div>
                    <Badge variant={p.status==='active'?'green':p.status==='overdue'?'red':'amber'}>{p.status}</Badge>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                    {[['Value',fmt.kes(p.contract_value)],['Expenses',fmt.kes(p.expenses_total)],['Invoiced',fmt.kes(p.invoiced_total)],['Collected',fmt.kes(p.collected_total)]].map(([l,v])=>(
                      <div key={l} style={{background:T.offwt,padding:'6px 8px',borderRadius:6}}><div style={{fontSize:9,color:T.mgrey,fontWeight:600}}>{l}</div><div style={{fontSize:11,fontWeight:700,color:T.navy}}>{v}</div></div>
                    ))}
                  </div>
                  <Progress value={pct}/>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginTop:4}}>
                    <span style={{color:T.mgrey}}>Budget Used</span>
                    <span style={{fontWeight:600,color:pct>=.95?T.red:pct>=.8?T.amber:T.green}}>{fmt.pct(pct)}</span>
                  </div>
                  {pct>=.95&&<div style={{marginTop:6,padding:'5px 8px',background:T.redL,borderRadius:5,fontSize:11,color:T.red,fontWeight:600}}>🛑 Budget Critical — MD Approval Required</div>}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── INTEGRATIONS MODULE ───────────────────────────────────────────────────────
function Integrations({ api }) {
  const [tab,setTab]=useState('status');
  const [status,setStatus]=useState(null);
  const [tenders,setTenders]=useState([]);
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState(null);
  const [mpesaForm,setMpesaForm]=useState({phone:'254',amount:'',invoice_no:''});
  const [etimsResult,setEtimsResult]=useState(null);

  useEffect(()=>{ api.get('/api/integrations?service=status').then(r=>{ if(r?.success) setStatus(r.data); }); },[]);

  const testEtims = async () => {
    setLoading(true);
    const r=await api.post('/api/integrations',{action:'test_etims'});
    setEtimsResult(r?.data);
    setMsg(r?.success&&r?.data?.success?{type:'success',text:'KRA eTIMS connection successful'}:{type:'error',text:r?.data?.message||r?.error||'Connection failed'});
    setLoading(false);
  };

  const fetchTenders = async () => {
    setLoading(true);
    const r=await api.get('/api/integrations?service=ppip_tenders');
    if(r?.success) setTenders(r.data?.tenders||[]);
    setLoading(false);
  };

  const syncTenders = async () => {
    setLoading(true);
    const r=await api.post('/api/integrations',{action:'ppip_sync'});
    if(r?.success) setMsg({type:'success',text:`PPIP sync complete — ${r.data.new_bids_created} new bids created`});
    setLoading(false);
  };

  const sendMpesa = async () => {
    const r=await api.post('/api/integrations',{action:'mpesa_collect',phone:mpesaForm.phone,amount:parseFloat(mpesaForm.amount),invoice_no:mpesaForm.invoice_no});
    setMsg(r?.success?{type:'success',text:r.data.message+(r.data.isMock?' (sandbox/mock mode)':'')}:{type:'error',text:r?.error});
  };

  const integrationsInfo = [
    { name:'KRA eTIMS', icon:'🏛️', desc:'Electronic Tax Invoice Management System. All VAT invoices submitted automatically.',  docs:'https://developer.kra.go.ke', env:'KRA_ETIMS_KEY, KRA_ETIMS_PIN, KRA_ETIMS_DEVICE_ID' },
    { name:'PPIP Tenders', icon:'📋', desc:'Public Procurement Information Portal. Auto-discover government tenders matching QSL services.', docs:'https://tenders.go.ke/api', env:'PPIP_API_KEY, PPIP_ENTITY_CODE' },
    { name:'M-PESA Daraja', icon:'📱', desc:'STK Push for client invoice collection. B2C for supplier payments.',         docs:'https://developer.safaricom.co.ke', env:'MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE' },
    { name:"Africa's Talking SMS", icon:'💬', desc:'Automated SMS alerts — imprest overdue, invoice payment received, approvals.', docs:'https://africastalking.com/docs', env:'AT_API_KEY, AT_USERNAME' },
    { name:'SMTP Email', icon:'📧', desc:'Invoice delivery, approval notifications, payslip distribution.', docs:null, env:'SMTP_HOST, SMTP_USER, SMTP_PASS' },
    { name:'Bank API', icon:'🏦', desc:'Direct bank statement import for reconciliation (Equity, KCB, Stanbic).', docs:null, env:'BANK_API_URL, BANK_API_KEY' },
  ];

  return (
    <div>
      {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
      <Tabs tabs={[{id:'status',label:'Integration Status'},{id:'etims',label:'KRA eTIMS'},{id:'ppip',label:'PPIP Tenders'},{id:'mpesa',label:'M-PESA'},{id:'config',label:'Configuration'}]} active={tab} setActive={setTab}/>

      {tab==='status'&&(
        <>
          <Alert type="info">Configure integrations by setting environment variables in <code style={{background:T.offwt,padding:'1px 5px',borderRadius:4}}>.env.local</code>. All credentials are server-side only — never exposed to the browser.</Alert>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:14}}>
            {(status?.integrations||integrationsInfo).map(s=>(
              <Card key={s.name}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                  <div style={{display:'flex',gap:10,alignItems:'center'}}><span style={{fontSize:24}}>{s.icon}</span><div><div style={{fontSize:14,fontWeight:700,color:T.navy}}>{s.name}</div></div></div>
                  <Badge variant={s.status==='configured'?'green':'amber'}>{s.status||'not configured'}</Badge>
                </div>
                <p style={{fontSize:12,color:T.mgrey,marginBottom:10}}>{s.desc}</p>
                {s.env&&<div style={{background:T.offwt,padding:'6px 8px',borderRadius:6,fontSize:10,fontFamily:'monospace',color:T.navy}}>{s.env}</div>}
                {s.docs&&<a href={s.docs} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:T.blue,display:'block',marginTop:8}}>📖 API Docs →</a>}
              </Card>
            ))}
          </div>
        </>
      )}

      {tab==='etims'&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <Card>
            <SectionHeader title="KRA eTIMS Connection" action={<Btn size="sm" onClick={testEtims} disabled={loading}>{loading?'Testing…':'Test Connection'}</Btn>}/>
            <Alert type="info">Environment: <strong>{process.env.KRA_ETIMS_ENV||'sandbox'}</strong>. Set KRA_ETIMS_ENV=production in .env.local for live submissions.</Alert>
            {etimsResult&&(
              <div style={{background:etimsResult.success?T.greenL:T.redL,padding:'12px 14px',borderRadius:8,fontSize:12}}>
                <strong>Connection Result:</strong> {etimsResult.message}<br/>
                <span style={{fontFamily:'monospace',fontSize:10}}>{JSON.stringify(etimsResult.data,null,2).slice(0,200)}</span>
              </div>
            )}
          </Card>
          <Card>
            <SectionHeader title="eTIMS Requirements"/>
            {['KRA PIN registered for eTIMS','VSCU/OSCU device assigned by KRA','API key from eTIMS portal','Device ID and branch ID configured','Tax invoices follow eTIMS format (VAT categories A/B/C/E)'].map((r,i)=>(
              <div key={i} style={{display:'flex',gap:8,padding:'6px 0',borderBottom:`1px solid ${T.lgrey}`,fontSize:12}}>
                <span style={{color:T.amber}}>○</span>{r}
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab==='ppip'&&(
        <>
          <div style={{display:'flex',gap:10,marginBottom:18}}>
            <Btn onClick={fetchTenders} disabled={loading}>🔍 Search Tenders</Btn>
            <Btn variant="outline" onClick={syncTenders} disabled={loading}>⬇️ Sync to Bids Register</Btn>
          </div>
          {loading&&<Loading/>}
          {tenders.length>0&&(
            <Card style={{padding:0,overflow:'hidden'}}>
              <DataTable headers={['Tender ID','Title','Procuring Entity','Est. Value','Deadline','Status','Action']}
                rows={tenders.map(t=>[
                  <span style={{fontFamily:'monospace',fontSize:11}}>{t.id}</span>,
                  <div style={{maxWidth:220,fontSize:12,fontWeight:500}}>{t.title}</div>,
                  <span style={{fontSize:11}}>{t.procuring_entity}</span>,
                  <strong>{fmt.kes(t.estimated_value)}</strong>,
                  fmt.date(t.deadline),
                  <Badge variant={t.status==='open'?'green':'amber'}>{t.status}</Badge>,
                  <Btn size="sm" variant="ghost">Add to Bids</Btn>,
                ])}
              />
            </Card>
          )}
          {!loading&&tenders.length===0&&<Alert type="info">Click "Search Tenders" to fetch current open tenders from PPIP matching QSL's service categories.</Alert>}
        </>
      )}

      {tab==='mpesa'&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <Card>
            <SectionHeader title="M-PESA STK Push — Collect Payment"/>
            <Alert type="info">Send M-PESA payment request directly to client's phone. They receive a prompt to pay on their handset.</Alert>
            <Input label="Client Phone (254XXXXXXXXX)" value={mpesaForm.phone} onChange={v=>setMpesaForm({...mpesaForm,phone:v})} placeholder="254XXXXXXXXX" required/>
            <Input label="Amount (Kshs)" value={mpesaForm.amount} onChange={v=>setMpesaForm({...mpesaForm,amount:v})} type="number" required/>
            <Input label="Invoice No / Reference" value={mpesaForm.invoice_no} onChange={v=>setMpesaForm({...mpesaForm,invoice_no:v})} placeholder="INV-2026-001"/>
            <Btn onClick={sendMpesa} disabled={!mpesaForm.phone||!mpesaForm.amount} style={{width:'100%',marginTop:4}}>📱 Send STK Push</Btn>
            <p style={{fontSize:11,color:T.mgrey,marginTop:8}}>Sandbox mode returns a mock response. Set MPESA_CONSUMER_KEY and MPESA_ENVIRONMENT=production for live payments.</p>
          </Card>
          <Card>
            <SectionHeader title="M-PESA Integration Details"/>
            {[['Shortcode',process.env.MPESA_SHORTCODE||'Not set'],['Environment',process.env.MPESA_ENVIRONMENT||'sandbox'],['Callback URL','/api/integrations (PUT)'],['STK Push Endpoint','/mpesa/stkpush/v1/processrequest'],['B2C Endpoint','/mpesa/b2c/v1/paymentrequest']].map(([l,v])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:`1px solid ${T.lgrey}`,fontSize:12}}>
                <span style={{color:T.mgrey}}>{l}</span><span style={{fontFamily:'monospace',fontWeight:600,color:T.navy}}>{v}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab==='config'&&(
        <Card>
          <SectionHeader title="Environment Configuration"/>
          <Alert type="warning">Copy <code style={{background:T.offwt,padding:'1px 5px',borderRadius:4}}>.env.example</code> to <code style={{background:T.offwt,padding:'1px 5px',borderRadius:4}}>.env.local</code> and fill in your credentials. Restart the server after changes.</Alert>
          <div style={{fontFamily:'monospace',fontSize:12,background:T.navyD,color:'#e2e8f0',padding:20,borderRadius:8,lineHeight:1.8}}>
            {`# KRA eTIMS\nKRA_ETIMS_PIN=P000000000K\nKRA_ETIMS_DEVICE_ID=<from KRA portal>\nKRA_ETIMS_KEY=<api key>\nKRA_ETIMS_ENV=sandbox\n\n# M-PESA\nMPESA_CONSUMER_KEY=<from developer portal>\nMPESA_CONSUMER_SECRET=<from developer portal>\nMPESA_SHORTCODE=<paybill number>\n\n# PPIP\nPPIP_API_KEY=<from tenders.go.ke account>\n\n# SMTP\nSMTP_USER=info@qalibrated.co.ke\nSMTP_PASS=<app password>`}
          </div>
          <p style={{fontSize:12,color:T.mgrey,marginTop:12}}>Full list of variables in <code>.env.example</code> at project root. All credentials are server-side only per Next.js security model.</p>
        </Card>
      )}
    </div>
  );
}

// ── HR MODULE ─────────────────────────────────────────────────────────────────
function HR({ api }) {
  const [tab,setTab]=useState('employees');
  const [employees,setEmployees]=useState([]);
  const [attendance,setAttendance]=useState([]);
  const [kpi,setKpi]=useState([]);
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({first_name:'',last_name:'',email:'',department:'Engineering',role:'',basic_salary:''});
  const [msg,setMsg]=useState(null);

  const load = async (t=tab) => {
    setLoading(true);
    if(t==='employees') { const r=await api.get('/api/hr?section=employees'); if(r?.success) setEmployees(r.data); }
    if(t==='attendance') { const r=await api.get('/api/hr?section=attendance'); if(r?.success) setAttendance(r.data); }
    if(t==='kpi') { const r=await api.get('/api/hr?section=kpi_summary'); if(r?.success) setKpi(r.data); }
    setLoading(false);
  };

  useEffect(()=>{ load(); },[tab]);

  const createEmployee = async () => {
    if(!form.first_name||!form.last_name||!form.email||!form.department) return;
    const r=await api.post('/api/hr',{action:'create_employee',...form,basic_salary:parseFloat(form.basic_salary||0)});
    if(r?.success){ setMsg({type:'success',text:`Employee created — Emp No: ${r.data.emp_no}. Now register their user account.`}); setModal(null); load('employees'); }
    else setMsg({type:'error',text:r?.error});
  };

  const clockIn = async (emp_id) => {
    const r=await api.post('/api/hr',{action:'clock_in',employee_id:emp_id});
    if(r?.success) setMsg({type:'success',text:`Clocked in${r.data.is_late?' — LATE arrival recorded':' on time'}`});
    load('attendance');
  };

  return (
    <div>
      {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
      <Tabs tabs={[{id:'employees',label:'Employees'},{id:'attendance',label:'Attendance'},{id:'leave',label:'Leave'},{id:'kpi',label:'KPI Scorecards'}]} active={tab} setActive={t=>{setTab(t);}}/>
      {loading&&<Loading/>}

      {!loading&&tab==='employees'&&(
        <>
          <SectionHeader title="Employee Register" sub={`${employees.length} active staff`} action={<Btn onClick={()=>setModal('emp')}>+ Add Employee</Btn>}/>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Emp No','Name','Department','Role','Salary','Leave Balance','Sig Key','Status']}
              rows={employees.map(e=>[
                <span style={{fontFamily:'monospace',fontSize:11,color:T.mgrey}}>{e.emp_no}</span>,
                <strong>{e.first_name} {e.last_name}</strong>,
                <Badge variant="navy">{e.department}</Badge>,
                <span style={{fontSize:12}}>{e.role}</span>,
                fmt.kes(e.basic_salary),
                <Badge variant={e.leave_balance>10?'green':e.leave_balance>5?'amber':'red'}>{e.leave_balance} days</Badge>,
                e.signature_key?<span style={{fontFamily:'monospace',fontSize:10,color:T.green}}>✓ {e.signature_key}</span>:<Badge variant="red">No Sig</Badge>,
                <Badge variant="green">{e.status}</Badge>,
              ])}
            />
          </Card>
        </>
      )}

      {!loading&&tab==='attendance'&&(
        <>
          <Alert type="info"><strong>ATT-001:</strong> GPS-verified clock-in mandatory for field staff. Late arrival alerts go to Line Manager.</Alert>
          <SectionHeader title={`Attendance — ${fmt.date(new Date().toISOString().split('T')[0])}`} action={<Btn size="sm" onClick={()=>employees[0]&&clockIn(employees[0].id)}>Clock In (Demo)</Btn>}/>
          {attendance.length===0?<Card><p style={{color:T.mgrey,textAlign:'center',padding:30}}>No attendance records for today yet.</p></Card>:(
            <Card style={{padding:0,overflow:'hidden'}}>
              <DataTable headers={['Employee','Dept','Clock In','Clock Out','Hours','Late?']}
                rows={attendance.map(a=>[
                  <strong>{a.name}</strong>,
                  <Badge variant="navy">{a.department}</Badge>,
                  a.clock_in?new Date(a.clock_in).toLocaleTimeString():'—',
                  a.clock_out?new Date(a.clock_out).toLocaleTimeString():'—',
                  a.hours_worked?`${a.hours_worked}h`:'—',
                  a.is_late?<Badge variant="red">Late</Badge>:<Badge variant="green">On Time</Badge>,
                ])}
              />
            </Card>
          )}
        </>
      )}

      {!loading&&tab==='kpi'&&(
        <>
          <Alert type="info"><strong>HR-026:</strong> Salary increment is blocked in ERP if L&D hours &lt; 40/year.</Alert>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Employee','Dept','L&D Hours','Target','Avg Score','Increment']}
              rows={kpi.map(e=>[
                <strong>{e.name}</strong>,
                <Badge variant="navy">{e.department}</Badge>,
                <span style={{fontWeight:600,color:(e.l_and_d_hours||0)>=40?T.green:T.amber}}>{e.l_and_d_hours||0}h</span>,
                '40h / year',
                e.avg_score?<span style={{fontWeight:700,color:(e.avg_score||0)>=4?T.green:(e.avg_score||0)>=3?T.amber:T.red}}>{parseFloat(e.avg_score).toFixed(1)}/5.0</span>:'—',
                e.increment_blocked?<Badge variant="red">🛑 BLOCKED</Badge>:<Badge variant="green">✅ Eligible</Badge>,
              ])}
            />
          </Card>
        </>
      )}

      {!loading&&tab==='leave'&&(
        <Card><Alert type="info">Leave requests, approvals, and balance tracking. Annual entitlement: 21 days.</Alert>
          <p style={{color:T.mgrey,fontSize:13,textAlign:'center',padding:20}}>Leave management table — submit and approve requests via API (POST /api/hr with action: request_leave | approve_leave)</p>
        </Card>
      )}

      {modal==='emp'&&(
        <Modal title="Add New Employee" onClose={()=>setModal(null)}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <Input label="First Name" value={form.first_name} onChange={v=>setForm({...form,first_name:v})} required/>
            <Input label="Last Name" value={form.last_name} onChange={v=>setForm({...form,last_name:v})} required/>
          </div>
          <Input label="Email" value={form.email} onChange={v=>setForm({...form,email:v})} type="email" required/>
          <Select label="Department" value={form.department} onChange={v=>setForm({...form,department:v})} options={['Engineering','Finance','Projects','HR','BD','ICT','Executive','Operations'].map(d=>({value:d,label:d}))}/>
          <Input label="Role / Job Title" value={form.role} onChange={v=>setForm({...form,role:v})} required/>
          <Input label="Basic Salary (Kshs/month)" value={form.basic_salary} onChange={v=>setForm({...form,basic_salary:v})} type="number" required/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn onClick={createEmployee} disabled={!form.first_name||!form.last_name||!form.email}>Save Employee</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── PROCUREMENT MODULE ────────────────────────────────────────────────────────
function Procurement({ api }) {
  const [tab,setTab]=useState('prs');
  const [prs,setPrs]=useState([]);
  const [lpos,setLpos]=useState([]);
  const [grns,setGrns]=useState([]);
  const [suppliers,setSuppliers]=useState([]);
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({description:'',department:'Engineering',amount:'',purpose:''});
  const [msg,setMsg]=useState(null);

  const load = (t=tab) => {
    setLoading(true);
    const map={prs:'/api/procurement?section=prs',lpos:'/api/procurement?section=lpos',grns:'/api/procurement?section=grns',suppliers:'/api/procurement?section=suppliers'};
    api.get(map[t]||map.prs).then(r=>{
      if(r?.success){if(t==='prs')setPrs(r.data);if(t==='lpos')setLpos(r.data);if(t==='grns')setGrns(r.data);if(t==='suppliers')setSuppliers(r.data);}
      setLoading(false);
    });
  };

  useEffect(()=>{ load(); },[tab]);

  const createPR = async () => {
    const r=await api.post('/api/procurement',{action:'create_pr',...form,amount:parseFloat(form.amount)});
    if(r?.success){ setMsg({type:'success',text:`PR ${r.data.pr_no} created — ${r.data.quotes_required} quotation(s) required`}); setModal(null); load('prs'); }
    else setMsg({type:'error',text:r?.error});
  };

  const quoteTier = (amt) => amt<=50000?'1 Quote':amt<=500000?'3 Quotes':'Formal Tender';
  const quoteColor = (amt) => amt<=50000?T.green:amt<=500000?T.amber:T.red;

  return (
    <div>
      {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
      <Tabs tabs={[{id:'prs',label:'Requisitions'},{id:'lpos',label:'LPOs'},{id:'grns',label:'GRN'},{id:'suppliers',label:'Suppliers'}]} active={tab} setActive={t=>{setTab(t);}}/>
      {loading&&<Loading/>}

      {!loading&&tab==='prs'&&(
        <>
          <Alert type="info"><strong>PROC-003:</strong> ≤Kshs 50K = 1 quote · Kshs 50K–500K = 3 quotes · &gt;Kshs 500K = formal tender (cannot raise as PR).</Alert>
          <SectionHeader title="Purchase Requisitions" action={<Btn onClick={()=>setModal('pr')}>+ New PR</Btn>}/>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['PR No','Description','Dept','Amount','Quotations','Status','Date']}
              rows={prs.map(p=>[
                <span style={{fontFamily:'monospace',fontSize:11,color:T.navy}}>{p.pr_no}</span>,
                <span style={{fontSize:12}}>{p.description}</span>,
                <Badge variant="navy">{p.department}</Badge>,
                <strong>{fmt.kes(p.amount)}</strong>,
                <span style={{fontSize:11,fontWeight:700,color:quoteColor(p.amount)}}>{quoteTier(p.amount)}</span>,
                <Badge variant={p.status==='approved'?'green':p.status?.includes('pending')?'amber':'blue'}>{p.status}</Badge>,
                fmt.date(p.date),
              ])}
            />
          </Card>
        </>
      )}

      {!loading&&tab==='lpos'&&(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['LPO No','Supplier','Total','VAT','Grand Total','Delivery','Status']}
            rows={lpos.map(l=>[
              <strong style={{fontFamily:'monospace',fontSize:11}}>{l.lpo_no}</strong>,
              l.supplier_name,
              fmt.kes(l.total),
              <span style={{color:T.red}}>{fmt.kes(l.vat)}</span>,
              <strong>{fmt.kes(l.grand_total)}</strong>,
              fmt.date(l.delivery_date),
              <Badge variant={l.status==='delivered'?'green':l.status==='issued'?'blue':'amber'}>{l.status}</Badge>,
            ])}
          />
        </Card>
      )}

      {!loading&&tab==='grns'&&(
        <>
          <Alert type="warning"><strong>STK-020/021/024B:</strong> Stage 1 physical inspection + photo upload BEFORE Stage 2 system GRN. System enforces this — no bypass.</Alert>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['GRN No','LPO','Supplier','Date','Stage 1','Photo','Stage 2','Status']}
              rows={grns.map(g=>[
                <strong style={{fontFamily:'monospace',fontSize:11}}>{g.grn_no}</strong>,
                g.lpo_no,
                g.supplier_name,
                fmt.date(g.date),
                g.stage1_done?<Badge variant="green">✅ Done</Badge>:<Badge variant="amber">Pending</Badge>,
                g.photo_paths&&g.photo_paths!=='[]'?<Badge variant="green">✅ Uploaded</Badge>:<Badge variant="red">Missing</Badge>,
                g.stage2_done?<Badge variant="green">✅ Done</Badge>:<Badge variant="default">Awaiting</Badge>,
                <Badge variant={g.status==='complete'?'green':'amber'}>{g.status}</Badge>,
              ])}
            />
          </Card>
        </>
      )}

      {!loading&&tab==='suppliers'&&(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Code','Supplier Name','Category','Email','Terms','Approved']}
            rows={suppliers.map(s=>[
              <span style={{fontFamily:'monospace',fontSize:11}}>{s.code}</span>,
              <strong>{s.name}</strong>,
              <Badge variant="navy">{s.category}</Badge>,
              <span style={{fontSize:11}}>{s.email}</span>,
              `${s.payment_terms} days`,
              s.is_approved?<Badge variant="green">✅ Approved</Badge>:<Badge variant="amber">Pending</Badge>,
            ])}
          />
        </Card>
      )}

      {modal==='pr'&&(
        <Modal title="New Purchase Requisition — PROC-002" onClose={()=>setModal(null)}>
          <Input label="Description" value={form.description} onChange={v=>setForm({...form,description:v})} required placeholder="Items to be purchased"/>
          <Select label="Department" value={form.department} onChange={v=>setForm({...form,department:v})} options={['Engineering','Projects','Finance','HR','BD','ICT','Executive'].map(d=>({value:d,label:d}))}/>
          <Input label="Estimated Amount (Kshs)" value={form.amount} onChange={v=>setForm({...form,amount:v})} type="number" required
            note={form.amount?`Quotation requirement: ${quoteTier(parseFloat(form.amount))}`:''} />
          <Input label="Business Justification" value={form.purpose} onChange={v=>setForm({...form,purpose:v})} required placeholder="Why is this purchase needed?"/>
          {parseFloat(form.amount)>500000&&<Alert type="error"><strong>PROC-003:</strong> Amount exceeds Kshs 500,000 — this requires a formal tender process, not a PR.</Alert>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn onClick={createPR} disabled={!form.description||!form.amount||parseFloat(form.amount)>500000}>Submit PR</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── REPORTS MODULE ────────────────────────────────────────────────────────────
function Reports({ api, user }) {
  const [tab,setTab]=useState('dashboard');
  const [data,setData]=useState(null);
  const [debtors,setDebtors]=useState([]);
  const [projects,setProjects]=useState([]);
  const [loading,setLoading]=useState(false);
  const [exporting,setExporting]=useState(null);
  const [exportMsg,setExportMsg]=useState(null);

  const loadReport = async (rpt) => {
    setLoading(true);
    const r=await api.get(`/api/reports?report=${rpt}`);
    if(r?.success){if(rpt==='aged_debtors')setDebtors(r.data);if(rpt==='project_profitability')setProjects(r.data);}
    setLoading(false);
  };

  const exportReport = async (report, format, extra={}) => {
    setExporting(report+format);
    setExportMsg(null);
    const r=await api.post('/api/reports',{action:'export',report,format,...extra});
    setExporting(null);
    if(r?.success){setExportMsg({type:'success',text:`✅ ${format.toUpperCase()} exported — ${r.data.url}`});}
    else setExportMsg({type:'error',text:r?.error||'Export failed'});
  };

  useEffect(()=>{ api.get('/api/reports?report=md_dashboard').then(r=>{ if(r?.success) setData(r.data); }); },[]);

  const REPORT_LIST=[
    {id:'md_dashboard',name:'MD Executive Dashboard',tab:'dashboard'},
    {id:'aged_debtors',name:'Aged Debtors',tab:'debtors'},
    {id:'project_profitability',name:'Project Profitability',tab:'projects'},
    {id:'compliance_calendar',name:'Compliance Calendar',tab:'compliance'},
    {id:'payroll_summary',name:'Payroll Summary',tab:''},
    {id:'asset_register',name:'Asset Register',tab:''},
    {id:'fleet_utilisation',name:'Fleet Utilisation',tab:''},
    {id:'ic_balances',name:'Inter-Company Balances',tab:''},
    {id:'lead_pipeline',name:'Lead & Pipeline',tab:''},
    {id:'bid_register',name:'Bid Register',tab:''},
  ];

  return (
    <div>
      <Tabs tabs={[{id:'dashboard',label:'MD Dashboard'},{id:'debtors',label:'Aged Debtors'},{id:'projects',label:'Project P&L'},{id:'all',label:'All Reports'}]} active={tab} setActive={t=>{setTab(t);if(t==='debtors')loadReport('aged_debtors');if(t==='projects')loadReport('project_profitability');}}/>

      {tab==='dashboard'&&data&&(
        <>
          <div style={{background:T.navyD,borderRadius:12,padding:'18px 22px',marginBottom:18}}>
            <div style={{fontSize:11,color:T.gold,fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>MD Executive Dashboard — Live</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12}}>
              {[['Portfolio Value',`Kshs ${((data.revenue_active||0)/1e6).toFixed(1)}M`,'💼'],['Gross Profit',`Kshs ${((data.gross_profit||0)/1e6).toFixed(1)}M`,'📈'],['Collections',`Kshs ${((data.total_collected||0)/1e6).toFixed(1)}M`,'💳'],['Open Bids',data.open_bids?.count||0,'📋'],['Overdue Tasks',data.overdue_tasks||0,'☑️']].map(([l,v,ic])=>(
                <div key={l} style={{background:'rgba(255,255,255,.07)',padding:'12px',borderRadius:8}}>
                  <div style={{fontSize:10,color:'rgba(255,255,255,.5)',fontWeight:600,textTransform:'uppercase',marginBottom:5}}>{ic} {l}</div>
                  <div style={{fontSize:18,fontWeight:800,color:T.gold}}>{v}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <Card><SectionHeader title="Top Debtors — RPT-003"/>
              {(data.top_debtors||[]).map((d,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:`1px solid ${T.lgrey}`,fontSize:13}}>
                  <span style={{fontWeight:500}}>{d.name}</span><strong style={{color:T.amber}}>{fmt.kes(d.outstanding)}</strong>
                </div>
              ))}
            </Card>
            <Card><SectionHeader title="KPIs at a Glance"/>
              {[['Gross Margin',data.margin?fmt.pct(data.margin):'—',data.margin>=.15?'green':'amber'],['Overdue Imprest',data.overdue_imprest?.count||0,(data.overdue_imprest?.count||0)>0?'red':'green'],['Expiring Docs',data.expiring_docs||0,(data.expiring_docs||0)>0?'amber':'green']].map(([l,v,variant])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:`1px solid ${T.lgrey}`}}>
                  <span style={{fontSize:13}}>{l}</span><Badge variant={variant}>{v}</Badge>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}

      {tab==='debtors'&&(<>
        {exportMsg&&<Alert type={exportMsg.type}>{exportMsg.text}</Alert>}
        <SectionHeader title="Aged Debtors" sub={`${debtors.length} clients with outstanding balances`} action={<div style={{display:'flex',gap:8}}><Btn size="sm" variant="ghost" onClick={()=>exportReport('aged_debtors','excel')} disabled={exporting==='aged_debtorsexcel'}>{exporting==='aged_debtorsexcel'?'Exporting…':'⬇ Excel'}</Btn><Btn size="sm" onClick={()=>exportReport('aged_debtors','pdf')} disabled={exporting==='aged_debtorspdf'}>{exporting==='aged_debtorspdf'?'Exporting…':'⬇ PDF'}</Btn></div>}/>
        {loading?<Loading/>:(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Client','Outstanding','Account Owner','Contact','Email']}
              rows={debtors.map(d=>[<strong>{d.name}</strong>,<strong style={{color:T.amber}}>{fmt.kes(d.outstanding)}</strong>,d.account_owner||'—',d.contact_person||'—',<span style={{fontSize:11}}>{d.email||'—'}</span>])}
            />
          </Card>
        )}
      </>)}

      {tab==='projects'&&(<>
        {exportMsg&&<Alert type={exportMsg.type}>{exportMsg.text}</Alert>}
        <SectionHeader title="Project Profitability" action={<Btn size="sm" variant="ghost" onClick={()=>exportReport('project_profitability','excel')} disabled={!!exporting}>{exporting?'Exporting…':'⬇ Excel'}</Btn>}/>
        {loading?<Loading/>:(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Project','Client','Value','Expenses','Gross Profit','Margin','PM']}
              rows={projects.map(p=>[
                <strong style={{fontSize:12}}>{p.name}</strong>,
                p.client||'—',
                fmt.kes(p.contract_value),
                fmt.kes(p.expenses_total),
                <strong style={{color:(p.gross_profit||0)>0?T.green:T.red}}>{fmt.kes(p.gross_profit)}</strong>,
                <Badge variant={(p.margin||0)>=.15?'green':(p.margin||0)>=.1?'amber':'red'}>{fmt.pct(p.margin)}</Badge>,
                p.pm||'—',
              ])}
            />
          </Card>
        )}
      </>)}

      {tab==='all'&&(<>
        {exportMsg&&<Alert type={exportMsg.type}>{exportMsg.text}</Alert>}
        <Alert type="info">Click Export on any report to download as PDF or Excel. Files saved to the server and accessible via URL.</Alert>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:12}}>
          {[
            {id:'aged_debtors',name:'Aged Debtors (RPT-003)',excel:true,pdf:true},
            {id:'project_profitability',name:'Project Profitability (RPT-005)',excel:true,pdf:false},
            {id:'asset_register',name:'Asset Register (RPT-010)',excel:true,pdf:false},
            {id:'audit_trail',name:'Audit Trail Export',excel:true,pdf:true},
            {id:'payroll_summary',name:'Payroll Summary (RPT-009)',excel:true,pdf:true,extra:{period:new Date().toISOString().slice(0,7)}},
          ].map(r=>(
            <Card key={r.id}>
              <div style={{fontSize:13,fontWeight:700,color:T.navy,marginBottom:4}}>{r.name}</div>
              <div style={{fontSize:10,fontFamily:'monospace',color:T.mgrey,marginBottom:10}}>/api/reports?report={r.id}</div>
              <div style={{display:'flex',gap:6}}>
                {r.excel&&<Btn size="sm" variant="ghost" style={{flex:1}} onClick={()=>exportReport(r.id,'excel',r.extra||{})} disabled={!!exporting}>⬇ Excel</Btn>}
                {r.pdf&&<Btn size="sm" style={{flex:1}} onClick={()=>exportReport(r.id,'pdf',r.extra||{})} disabled={!!exporting}>⬇ PDF</Btn>}
              </div>
            </Card>
          ))}
          {REPORT_LIST.filter(r=>!['aged_debtors','project_profitability','asset_register','audit_trail','payroll_summary'].includes(r.id)).map(r=>(
            <Card key={r.id} style={{cursor:'pointer'}}>
              <div style={{fontSize:13,fontWeight:600,color:T.navy,marginBottom:6}}>{r.name}</div>
              <div style={{fontSize:10,fontFamily:'monospace',color:T.mgrey,marginBottom:10}}>/api/reports?report={r.id}</div>
              <Btn size="sm" variant="ghost" style={{width:'100%'}} onClick={()=>loadReport(r.id)}>View Report</Btn>
            </Card>
          ))}
        </div>
      </>)}
    </div>
  );
}

// ── DEBTORS MODULE — Daily List + FM End-of-Day Follow-up ─────────────────────
function DebtorsModule({ api, user }) {
  const [tab,setTab]=useState('followup');
  const [data,setData]=useState({debtors:[],eod_report:{status:'pending'},total_debtors:0,recorded_count:0,all_recorded:false});
  const [allDebtors,setAllDebtors]=useState([]);
  const [loading,setLoading]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [msg,setMsg]=useState(null);
  const [statusModal,setStatusModal]=useState(null);
  const [form,setForm]=useState({status:'Promised Payment',note:'',next_followup_date:''});
  const [historyClient,setHistoryClient]=useState(null);
  const [history,setHistory]=useState([]);

  const isFM = user?.role==='cfo' || user?.role==='admin' || user?.role==='md';

  const load = async () => {
    setLoading(true);
    const r = await api.get('/api/debtors?section=today_status');
    if(r?.success) setData(r.data);
    const l = await api.get('/api/debtors?section=list');
    if(l?.success) setAllDebtors(l.data);
    setLoading(false);
  };
  useEffect(()=>{ load(); }, []);

  const openStatus = (debtor) => {
    setForm({status: debtor.status || 'Promised Payment', note: debtor.note || '', next_followup_date: debtor.next_followup_date || ''});
    setStatusModal(debtor);
  };

  const saveStatus = async () => {
    const r = await api.post('/api/debtors', {action:'record_followup', client_id: statusModal.id, ...form});
    if(r?.success){ setMsg({type:'success',text:`Status recorded for ${statusModal.name}`}); setStatusModal(null); load(); }
    else setMsg({type:'error',text:r?.error||'Failed to save'});
  };

  const submitEOD = async () => {
    setSubmitting(true);
    const r = await api.post('/api/debtors', {action:'submit_eod_report'});
    setSubmitting(false);
    if(r?.success){ setMsg({type:'success',text:`✅ End-of-day report submitted and sent to the MD — ${r.data.debtor_count} accounts.`}); load(); }
    else setMsg({type:'error',text:r?.error||'Failed to submit'});
  };

  const viewHistory = async (client) => {
    setHistoryClient(client);
    const r = await api.get(`/api/debtors?section=history&client_id=${client.id}`);
    if(r?.success) setHistory(r.data);
  };

  const statusBadge = (status) => {
    const map = {'Promised Payment':'green','Settled':'green','Partially Paid':'amber','Disputed':'red','Escalated':'red','No Response':'default'};
    return <Badge variant={map[status]||'default'}>{status}</Badge>;
  };

  return (
    <div>
      {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
      <Tabs tabs={[{id:'followup',label:'Daily Follow-up'},{id:'list',label:'All Debtors'}]} active={tab} setActive={setTab}/>

      {tab==='followup'&&(<>
        <Alert type="info"><strong>Daily process:</strong> Debtors list circulated to MD + Finance Manager at 8:00 AM. Finance Manager records a status against every overdue account, then submits by 5:00 PM — this compiles and emails the full status report to the MD automatically.</Alert>

        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
          <Stat label="Debtor Accounts Today" value={data.total_debtors} icon="📋"/>
          <Stat label="Status Recorded" value={`${data.recorded_count} / ${data.total_debtors}`} icon="✍️" variant={data.all_recorded?'green':'amber'}/>
          <Stat label="EOD Report" value={data.eod_report?.status==='submitted'?'Submitted':'Pending'} icon={data.eod_report?.status==='submitted'?'✅':'⏳'} variant={data.eod_report?.status==='submitted'?'green':'amber'}/>
          <Stat label="Deadline" value="5:00 PM" sub="Escalates to MD at 5:30 PM if missed" icon="⏰"/>
        </div>

        {loading?<Loading/>:(
          <Card style={{padding:0,overflow:'hidden',marginBottom:16}}>
            <DataTable headers={['Client','Outstanding','Today\'s Status','Note','Next Follow-up','Action']}
              rows={data.debtors.map(d=>[
                <strong style={{fontSize:12}}>{d.name}</strong>,
                <strong style={{color:T.amber}}>{fmt.kes(d.outstanding)}</strong>,
                d.status ? statusBadge(d.status) : <Badge variant="default">Not recorded</Badge>,
                <span style={{fontSize:11,color:T.mgrey,maxWidth:180,display:'block'}}>{d.note||'—'}</span>,
                d.next_followup_date ? fmt.date(d.next_followup_date) : '—',
                isFM ? <Btn size="sm" variant={d.status?'ghost':'gold'} onClick={()=>openStatus(d)}>{d.status?'Update':'Record Status'}</Btn> : <Btn size="sm" variant="ghost" onClick={()=>viewHistory(d)}>History</Btn>,
              ])}
            />
          </Card>
        )}

        {isFM && (
          <Card style={{background: data.all_recorded ? T.greenL : T.offwt, border:`1px solid ${data.all_recorded?'#86EFAC':T.lgrey}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:T.navy}}>
                  {data.eod_report?.status==='submitted' ? '✅ Today\'s report has been submitted' : data.all_recorded ? 'All accounts recorded — ready to submit' : `${data.total_debtors - data.recorded_count} account(s) still need a status before you can submit`}
                </div>
                <div style={{fontSize:11,color:T.mgrey,marginTop:3}}>Submitting compiles today's statuses into one report and emails it to the MD immediately.</div>
              </div>
              <Btn variant="gold" disabled={!data.all_recorded || data.eod_report?.status==='submitted' || submitting} onClick={submitEOD}>
                {submitting ? 'Submitting…' : data.eod_report?.status==='submitted' ? 'Submitted' : 'Submit End-of-Day Report'}
              </Btn>
            </div>
          </Card>
        )}
      </>)}

      {tab==='list'&&(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Client','Account Owner','Outstanding','Contact','Email']}
            rows={allDebtors.map(d=>[
              <strong>{d.name}</strong>, d.account_owner_name||'—',
              <strong style={{color:T.amber}}>{fmt.kes(d.outstanding)}</strong>,
              d.contact_person||'—', <span style={{fontSize:11}}>{d.email||'—'}</span>,
            ])}
          />
        </Card>
      )}

      {statusModal&&(
        <Modal title={`Record Status — ${statusModal.name}`} onClose={()=>setStatusModal(null)}>
          <div style={{background:T.offwt,padding:'10px 14px',borderRadius:8,marginBottom:14}}>
            <div style={{fontSize:11,color:T.mgrey}}>Outstanding</div>
            <div style={{fontSize:16,fontWeight:700,color:T.amber}}>{fmt.kes(statusModal.outstanding)}</div>
          </div>
          <Select label="Status" value={form.status} onChange={v=>setForm({...form,status:v})} required
            options={['Promised Payment','Disputed','Escalated','No Response','Partially Paid','Settled'].map(s=>({value:s,label:s}))}/>
          <Input label="Note" value={form.note} onChange={v=>setForm({...form,note:v})} placeholder="What happened — call outcome, dispute reason, etc."/>
          <Input label="Next Follow-up Date" value={form.next_followup_date} onChange={v=>setForm({...form,next_followup_date:v})} type="date"/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setStatusModal(null)}>Cancel</Btn>
            <Btn onClick={saveStatus}>Save Status</Btn>
          </div>
        </Modal>
      )}

      {historyClient&&(
        <Modal title={`Follow-up History — ${historyClient.name}`} onClose={()=>{setHistoryClient(null);setHistory([]);}} width={560}>
          {history.length===0?<p style={{color:T.mgrey,textAlign:'center',padding:20}}>No follow-up history yet.</p>:(
            history.map((h,i)=>(
              <div key={i} style={{padding:'10px 0',borderBottom:`1px solid ${T.lgrey}`}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:600}}>{fmt.date(h.followup_date)}</span>
                  {statusBadge(h.status)}
                </div>
                {h.note&&<div style={{fontSize:12,color:T.mgrey}}>{h.note}</div>}
                <div style={{fontSize:10,color:T.mgrey,marginTop:3}}>By {h.recorded_by_name||'—'}{h.next_followup_date?` · Next follow-up: ${fmt.date(h.next_followup_date)}`:''}</div>
              </div>
            ))
          )}
        </Modal>
      )}
    </div>
  );
}

// ── STORE REQUISITIONS MODULE (point 2) ───────────────────────────────────────
function RequisitionsModule({ api, user }) {
  const [tab,setTab]=useState('list');
  const [requisitions,setRequisitions]=useState([]);
  const [pendingApproval,setPendingApproval]=useState([]);
  const [items,setItems]=useState([]);
  const [locations,setLocations]=useState([]);
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState(null);
  const [modal,setModal]=useState(null);
  const [detail,setDetail]=useState(null);
  const [form,setForm]=useState({department:'',purpose:'',priority:'normal',lines:[{item_id:'',quantity:''}]});
  const [issueForm,setIssueForm]=useState({item_id:'',location_id:'',quantity:''});

  const load = async () => {
    setLoading(true);
    const r = await api.get('/api/requisitions?section=list');
    if(r?.success) setRequisitions(r.data);
    const p = await api.get('/api/requisitions?section=pending_my_approval');
    if(p?.success) setPendingApproval(p.data);
    const i = await api.get('/api/stores?section=items');
    if(i?.success) setItems(i.data);
    const l = await api.get('/api/stores?section=locations');
    if(l?.success) setLocations(l.data);
    setLoading(false);
  };
  useEffect(()=>{ load(); }, []);

  const viewDetail = async (req) => {
    const r = await api.get(`/api/requisitions?section=detail&id=${req.id}`);
    if(r?.success) setDetail(r.data);
  };

  const createRequisition = async () => {
    const lines = form.lines.filter(l=>l.item_id && l.quantity);
    if(!form.department || !form.purpose || lines.length===0){ setMsg({type:'error',text:'Department, purpose, and at least one item line are required'}); return; }
    const r = await api.post('/api/requisitions', {action:'create', ...form, lines: lines.map(l=>({...l, quantity: Number(l.quantity)}))});
    if(r?.success){ setMsg({type:'success',text:`Requisition ${r.data.req_no} submitted for approval.`}); setModal(null); setForm({department:'',purpose:'',priority:'normal',lines:[{item_id:'',quantity:''}]}); load(); }
    else setMsg({type:'error',text:r?.error||'Failed'});
  };

  const approve = async (id) => {
    const r = await api.post('/api/requisitions', {action:'approve', id});
    if(r?.success){ setMsg({type:'success',text: r.data.status==='approved'?'Fully approved — ready for issuance.':`Approved at this level. Awaiting ${r.data.next_approver_role}.`}); load(); if(detail)viewDetail({id}); }
    else setMsg({type:'error',text:r?.error||'Failed'});
  };

  const reject = async (id) => {
    const reason = prompt('Reason for rejection:');
    if(!reason) return;
    const r = await api.post('/api/requisitions', {action:'reject', id, reason});
    if(r?.success){ setMsg({type:'success',text:'Requisition rejected.'}); load(); setDetail(null); }
    else setMsg({type:'error',text:r?.error||'Failed'});
  };

  const issueLine = async (item_id) => {
    if(!issueForm.location_id || !issueForm.quantity){ setMsg({type:'error',text:'Select a location and quantity'}); return; }
    const r = await api.post('/api/requisitions', {action:'issue_line', requisition_id: detail.requisition.id, item_id, location_id: issueForm.location_id, quantity: Number(issueForm.quantity)});
    if(r?.success){ setMsg({type:'success',text:'Issued.'}); setIssueForm({item_id:'',location_id:'',quantity:''}); viewDetail(detail.requisition); load(); }
    else setMsg({type:'error',text:r?.error||'Failed'});
  };

  const closeRequisition = async () => {
    const r = await api.post('/api/requisitions', {action:'close', id: detail.requisition.id});
    if(r?.success){ setMsg({type:'success',text:'Requisition closed.'}); setDetail(null); load(); }
    else setMsg({type:'error',text:r?.error||'Failed'});
  };

  const statusBadge = (s) => {
    const map = {pending_approval:'amber',approved:'blue',issuing:'amber',closed:'green',rejected:'red'};
    return <Badge variant={map[s]||'default'}>{s.replace('_',' ')}</Badge>;
  };

  return (
    <div>
      {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
      <Alert type="info">Internal store requisitions — request items already in stock. Routes through approval, then the store issues against it, and it closes once every line is fully issued.</Alert>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
        <Stat label="Total Requisitions" value={requisitions.length} icon="📝"/>
        <Stat label="Pending My Approval" value={pendingApproval.length} icon="⏳" variant={pendingApproval.length?'amber':'green'}/>
        <Stat label="Approved / Issuing" value={requisitions.filter(r=>['approved','issuing'].includes(r.status)).length} icon="📦"/>
        <Stat label="Closed" value={requisitions.filter(r=>r.status==='closed').length} icon="✅" variant="green"/>
      </div>

      <Tabs tabs={[{id:'list',label:'All Requisitions'},{id:'pending',label:`Pending My Approval (${pendingApproval.length})`}]} active={tab} setActive={setTab}/>

      <div style={{display:'flex',justifyContent:'flex-end',margin:'12px 0'}}>
        <Btn size="sm" onClick={()=>setModal('create')}>+ New Requisition</Btn>
      </div>

      {loading?<Loading/>:tab==='list'?(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Req No.','Department','Purpose','Priority','Lines','Status','Created','Action']}
            rows={requisitions.map(r=>[
              <span style={{fontFamily:'monospace',fontSize:11}}>{r.req_no}</span>,
              r.department, <span style={{fontSize:12}}>{r.purpose}</span>,
              <Badge variant={r.priority==='urgent'?'red':'default'}>{r.priority}</Badge>,
              r.line_count, statusBadge(r.status), fmt.date(r.created_at),
              <Btn size="sm" variant="ghost" onClick={()=>viewDetail(r)}>View</Btn>,
            ])}
          />
        </Card>
      ):(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Req No.','Department','Requested By','Priority','Lines','Action']} empty="Nothing pending your approval."
            rows={pendingApproval.map(r=>[
              <span style={{fontFamily:'monospace',fontSize:11}}>{r.req_no}</span>,
              r.department, r.requested_by_name, <Badge variant={r.priority==='urgent'?'red':'default'}>{r.priority}</Badge>, r.line_count,
              <Btn size="sm" variant="gold" onClick={()=>viewDetail(r)}>Review</Btn>,
            ])}
          />
        </Card>
      )}

      {modal==='create'&&(
        <Modal title="New Store Requisition" onClose={()=>setModal(null)} width={620}>
          <Input label="Department" value={form.department} onChange={v=>setForm({...form,department:v})} required/>
          <Input label="Purpose" value={form.purpose} onChange={v=>setForm({...form,purpose:v})} required/>
          <Select label="Priority" value={form.priority} onChange={v=>setForm({...form,priority:v})} options={[{value:'normal',label:'Normal'},{value:'urgent',label:'Urgent'}]}/>
          <div style={{fontSize:12,fontWeight:700,color:T.navy,margin:'12px 0 6px'}}>Items Requested</div>
          {form.lines.map((line,i)=>(
            <div key={i} style={{display:'flex',gap:8,marginBottom:8,alignItems:'flex-end'}}>
              <div style={{flex:2}}><Select label={i===0?'Item':''} value={line.item_id} onChange={v=>{const ls=[...form.lines];ls[i].item_id=v;setForm({...form,lines:ls});}} options={items.map(it=>({value:it.id,label:`${it.code} — ${it.name} (${it.total_balance||0} ${it.unit} avail.)`}))}/></div>
              <div style={{flex:1}}><Input label={i===0?'Quantity':''} value={line.quantity} onChange={v=>{const ls=[...form.lines];ls[i].quantity=v;setForm({...form,lines:ls});}} type="number"/></div>
            </div>
          ))}
          <Btn size="sm" variant="ghost" onClick={()=>setForm({...form,lines:[...form.lines,{item_id:'',quantity:''}]})}>+ Add Line</Btn>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
            <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn onClick={createRequisition}>Submit for Approval</Btn>
          </div>
        </Modal>
      )}

      {detail&&(
        <Modal title={`${detail.requisition.req_no} — ${detail.requisition.department}`} onClose={()=>setDetail(null)} width={700}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:14}}>
            <div>
              <div style={{fontSize:13,color:T.mgrey}}>{detail.requisition.purpose}</div>
              <div style={{fontSize:11,color:T.mgrey,marginTop:2}}>Requested by {detail.requisition.requested_by_name} · {fmt.date(detail.requisition.created_at)}</div>
            </div>
            {statusBadge(detail.requisition.status)}
          </div>

          <SectionHeader title="Items"/>
          <DataTable headers={['Item','Requested','Issued','Available','Action']}
            rows={detail.lines.map(l=>[
              <span><strong>{l.item_code}</strong> {l.item_name}</span>,
              `${l.quantity_requested} ${l.unit}`,
              <strong style={{color:l.quantity_issued>=l.quantity_requested?T.green:T.amber}}>{l.quantity_issued||0} {l.unit}</strong>,
              l.available_stock,
              detail.requisition.status==='approved'||detail.requisition.status==='issuing' ? (
                <div style={{display:'flex',gap:4}}>
                  <select style={{fontSize:11,padding:'4px',borderRadius:4,border:`1px solid ${T.lgrey}`}} onChange={e=>setIssueForm({...issueForm,location_id:e.target.value})}>
                    <option value="">Location…</option>
                    {locations.map(loc=><option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </select>
                  <input style={{fontSize:11,padding:'4px',width:60,borderRadius:4,border:`1px solid ${T.lgrey}`}} type="number" placeholder="Qty" onChange={e=>setIssueForm({...issueForm,quantity:e.target.value})}/>
                  <Btn size="sm" onClick={()=>issueLine(l.item_id)}>Issue</Btn>
                </div>
              ) : '—',
            ])}
          />

          <SectionHeader title="Approval History" sub="Complete audit trail of every decision"/>
          {detail.approvals.length===0?<p style={{fontSize:12,color:T.mgrey}}>No approval actions yet.</p>:(
            detail.approvals.map((a,i)=>(
              <div key={i} style={{padding:'8px 0',borderBottom:`1px solid ${T.lgrey}`,fontSize:12,display:'flex',justifyContent:'space-between'}}>
                <span>{a.level} — <strong>{a.approver_name}</strong> {a.decision} {a.comments?`("${a.comments}")`:''}</span>
                <span style={{color:T.mgrey}}>{fmt.date(a.decided_at)}</span>
              </div>
            ))
          )}

          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
            {detail.requisition.status==='pending_approval'&&<>
              <Btn variant="ghost" onClick={()=>reject(detail.requisition.id)}>Reject</Btn>
              <Btn onClick={()=>approve(detail.requisition.id)}>Approve</Btn>
            </>}
            {detail.requisition.status==='issuing'&&detail.lines.every(l=>(l.quantity_issued||0)>=l.quantity_requested)&&(
              <Btn onClick={closeRequisition}>Close Requisition</Btn>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── ADMINISTRATION PANEL (point 3) ────────────────────────────────────────────
// ── SYSTEM SETTINGS REGISTRY ───────────────────────────────────────────────
// Drives the Administration → System Settings editor. Each field maps to a
// system_settings key; mirror of src/lib/settings.js DEFAULTS. Adding a field
// here makes it editable from the UI with the right input type.
const SETTINGS_REGISTRY = [
  { category:'company', label:'Company Identity', help:'Shown on invoices, certificates, payslips and PDF exports.', fields:[
    {key:'company.legal_name', label:'Legal Name', type:'text', def:'Qalibrated Systems Limited'},
    {key:'company.kra_pin',    label:'KRA PIN',    type:'text', def:'P000000001K'},
    {key:'company.address',    label:'Address',    type:'text', def:'Birdi Singh Complex, Off Mombasa Road, Nairobi'},
    {key:'company.phone',      label:'Phone',      type:'text', def:'+254 714 999 996'},
    {key:'company.email',      label:'Email',      type:'text', def:'info@qalibrated.co.ke'},
  ]},
  { category:'branding', label:'Branding & Theme', help:'Logo, colours, name and font apply across the whole app (sidebar, login, exports).', fields:[
    {key:'branding.logo_url', label:'Logo', type:'logo', def:'/logo.svg'},
    {key:'branding.company_display_name', label:'Display Name', type:'text', def:'QSL ERP'},
    {key:'branding.primary_color', label:'Primary Colour', type:'color', def:'#1B3A5C'},
    {key:'branding.accent_color',  label:'Accent Colour',  type:'color', def:'#C8960C'},
    {key:'branding.font_family',   label:'Font', type:'select', options:['Inter','system-ui','Roboto','Georgia','Arial','Helvetica'], def:'Inter'},
  ]},
  { category:'general', label:'General', fields:[
    {key:'general.default_currency',  label:'Default Currency', type:'select', options:['KES','USD','CNY'], def:'KES'},
    {key:'general.fiscal_year_start', label:'Fiscal Year Start (MM-DD)', type:'text', def:'01-01'},
  ]},
  { category:'finance', label:'Finance', fields:[
    {key:'finance.vat_rate', label:'VAT Rate', type:'percent', def:'0.16'},
    {key:'finance.imprest_retire_days', label:'Imprest Retire Days', type:'number', def:'14'},
    {key:'finance.pay_limit_staff',       label:'Payment Limit — Staff (Kshs)',        type:'number', def:'5000'},
    {key:'finance.pay_limit_dept_head',   label:'Payment Limit — Dept Head (Kshs)',    type:'number', def:'20000'},
    {key:'finance.pay_limit_finance_mgr', label:'Payment Limit — Finance Mgr (Kshs)',  type:'number', def:'100000'},
    {key:'finance.pay_limit_cfo',         label:'Payment Limit — CFO (Kshs)',          type:'number', def:'500000'},
  ]},
  { category:'msp', label:'Minimum Selling Price Margins', help:'Minimum margin by category used for the MSP floor (STK-010).', fields:[
    {key:'msp.margin_calibration',  label:'Calibration Equipment', type:'percent', def:'0.25'},
    {key:'msp.margin_construction', label:'Construction Materials', type:'percent', def:'0.15'},
    {key:'msp.margin_spare_parts',  label:'Spare Parts', type:'percent', def:'0.30'},
    {key:'msp.margin_tools',        label:'Tools', type:'percent', def:'0.20'},
    {key:'msp.margin_safety',       label:'Safety Equipment', type:'percent', def:'0.20'},
    {key:'msp.margin_imported',     label:'Imported Items', type:'percent', def:'0.30'},
  ]},
  { category:'requisitions', label:'Requisitions & Store', fields:[
    {key:'requisitions.approval_levels', label:'Approval Chain (roles, in order)', type:'csv', def:'["supervisor","store_manager"]'},
    {key:'store.low_stock_check_frequency', label:'Low-Stock Check Frequency', type:'select', options:['daily','weekly','hourly'], def:'daily'},
  ]},
  { category:'alerts', label:'Alert Windows (days before)', fields:[
    {key:'alerts.cert_expiry_days',       label:'Certificate Expiry', type:'number', def:'60'},
    {key:'alerts.debtor_escalation_days', label:'Debtor Escalation',  type:'number', def:'30'},
    {key:'alerts.insurance_alert_days',   label:'Vehicle Insurance',  type:'number', def:'30'},
    {key:'alerts.tender_alert_days',      label:'Tender Deadline',    type:'number', def:'14'},
  ]},
  { category:'commission', label:'Sales Commission Tiers (advanced)', help:'JSON array of {from,to,rate} bands on YTD % of target (COM-001).', fields:[
    {key:'commission.tiers', label:'Tiers (JSON)', type:'json', def:'[{"from":0,"to":70,"rate":0},{"from":70,"to":80,"rate":0.01},{"from":80,"to":90,"rate":0.03},{"from":90,"to":100,"rate":0.05},{"from":100,"to":9999,"rate":0.07}]'},
  ]},
];

function AdminModule({ api, user }) {
  const [tab,setTab]=useState('modules');
  const [draft,setDraft]=useState({});      // edited System Settings values (display form)
  const [modules,setModules]=useState([]);
  const [integrations,setIntegrations]=useState([]);
  const [roles,setRoles]=useState([]);
  const [permissions,setPermissions]=useState([]);
  const [users,setUsers]=useState([]);
  const [deptData,setDeptData]=useState({departments:[],branches:[]});
  const [settings,setSettings]=useState([]);
  const [companies,setCompanies]=useState([]);
  const [companyDetail,setCompanyDetail]=useState(null);
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState(null);
  const [modal,setModal]=useState(null);
  const [roleDetail,setRoleDetail]=useState(null);
  const [form,setForm]=useState({});

  const loadCompanies = async () => {
    setLoading(true);
    const r = await api.get('/api/companies?section=list');
    if(r?.success) setCompanies(r.data);
    setLoading(false);
  };

  const viewCompany = async (c) => {
    const r = await api.get(`/api/companies?section=detail&id=${c.id}`);
    if(r?.success) setCompanyDetail(r.data);
  };

  const createCompany = async () => {
    if(!form.code||!form.legal_name){ setMsg({type:'error',text:'Code and legal name are required'}); return; }
    const r = await api.post('/api/companies', {action:'create_company', ...form});
    if(r?.success){ setMsg({type:'success',text:`${form.legal_name} added.`}); setModal(null); setForm({}); loadCompanies(); }
    else setMsg({type:'error',text:r?.error||'Failed'});
  };

  const load = async (section) => {
    if(section==='companies'){ loadCompanies(); return; }
    setLoading(true);
    const r = await api.get(`/api/admin?section=${section}`);
    if(r?.success){
      if(section==='modules')setModules(r.data);
      if(section==='integrations')setIntegrations(r.data);
      if(section==='roles')setRoles(r.data);
      if(section==='permissions')setPermissions(r.data);
      if(section==='users')setUsers(r.data);
      if(section==='departments')setDeptData(r.data);
      if(section==='settings')setSettings(r.data);
    }
    setLoading(false);
  };
  useEffect(()=>{ load(tab); }, [tab]);

  // ── System Settings editor helpers ──
  const settingsMap = Object.fromEntries(settings.map(s=>[s.key, s.value]));
  // Current display value for a field: live draft edit, else stored value, else default — converted to display form.
  const dispVal = (f) => {
    if (draft[f.key] !== undefined) return draft[f.key];
    let v = settingsMap[f.key] ?? f.def;
    if (f.type === 'percent') { const n = parseFloat(v); return Number.isFinite(n) ? String(+(n*100).toFixed(4)) : v; }
    if (f.type === 'csv')     { try { const a = JSON.parse(v); if (Array.isArray(a)) return a.join(', '); } catch {} return v; }
    return v ?? '';
  };
  const setVal = (key, value) => setDraft(d=>({...d, [key]: value}));
  // Convert a display value back to the stored string form.
  const toStored = (f, display) => {
    if (f.type === 'percent') { const n = parseFloat(display); return String(Number.isFinite(n) ? n/100 : 0); }
    if (f.type === 'csv')     return JSON.stringify(String(display).split(',').map(s=>s.trim()).filter(Boolean));
    if (f.type === 'json')    { try { return JSON.stringify(JSON.parse(display)); } catch { throw new Error('Invalid JSON'); } }
    return String(display);
  };
  const saveGroup = async (group) => {
    const dirty = group.fields.filter(f => draft[f.key] !== undefined);
    if (!dirty.length) { setMsg({type:'info', text:'No changes in this section.'}); return; }
    try {
      for (const f of dirty) {
        const value = toStored(f, draft[f.key]);
        const r = await api.post('/api/admin', {action:'update_setting', key:f.key, value});
        if (!r?.success) { setMsg({type:'error', text:`Failed: ${f.label} — ${r?.error||''}`}); return; }
      }
      setMsg({type:'success', text:`${group.label}: ${dirty.length} setting(s) saved.`});
      setDraft(d=>{ const n={...d}; group.fields.forEach(f=>delete n[f.key]); return n; });
      load('settings');
    } catch (e) { setMsg({type:'error', text:e.message}); }
  };

  const toggleModule = async (module_id, enabled) => {
    const r = await api.post('/api/admin', {action:'toggle_module', module_id, enabled: !enabled});
    if(r?.success){ setMsg({type:'success',text:`Module ${enabled?'disabled':'enabled'}.`}); load('modules'); }
    else setMsg({type:'error',text:r?.error||'Failed'});
  };

  const toggleIntegration = async (id, enabled) => {
    const r = await api.post('/api/admin', {action:'toggle_integration', id, enabled: !enabled});
    if(r?.success){ setMsg({type:'success',text:`Integration ${enabled?'disabled':'enabled'}.`}); load('integrations'); }
    else setMsg({type:'error',text:r?.error||'Failed'});
  };

  const viewRole = async (role) => {
    const r = await api.get(`/api/admin?section=role_detail&id=${role.id}`);
    if(r?.success){ setRoleDetail(r.data); if(permissions.length===0) load('permissions'); }
  };

  const togglePermInRole = (code) => {
    const current = roleDetail.permissions.map(p=>p.code);
    const has = current.includes(code);
    const newPerms = has ? roleDetail.permissions.filter(p=>p.code!==code) : [...roleDetail.permissions, permissions.find(p=>p.code===code)];
    setRoleDetail({...roleDetail, permissions: newPerms});
  };

  const savePermissions = async () => {
    const r = await api.post('/api/admin', {action:'set_role_permissions', role_id: roleDetail.role.id, permission_codes: roleDetail.permissions.map(p=>p.code)});
    if(r?.success){ setMsg({type:'success',text:'Permissions updated.'}); setRoleDetail(null); load('roles'); }
    else setMsg({type:'error',text:r?.error||'Failed'});
  };

  return (
    <div>
      {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
      <Alert type="info">Modular Architecture: toggle modules on/off below to control what's available in this deployment. Core modules (Dashboard, Admin, Settings) cannot be disabled.</Alert>

      <Tabs tabs={[{id:'modules',label:'Modules'},{id:'integrations',label:'Integrations'},{id:'companies',label:'Companies'},{id:'roles',label:'Roles & Permissions'},{id:'users',label:'Users'},{id:'departments',label:'Departments & Branches'},{id:'settings',label:'System Settings'}]} active={tab} setActive={setTab}/>

      {loading?<Loading/>:tab==='modules'?(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Module','Status','Core','Action']}
            rows={modules.map(m=>[
              <strong>{m.display_name}</strong>,
              <Badge variant={m.enabled?'green':'default'}>{m.enabled?'Enabled':'Disabled'}</Badge>,
              m.is_core?<Badge variant="navy">Core</Badge>:'—',
              m.is_core?<span style={{fontSize:11,color:T.mgrey}}>Cannot disable</span>:<Btn size="sm" variant={m.enabled?'ghost':'gold'} onClick={()=>toggleModule(m.module_id,m.enabled)}>{m.enabled?'Disable':'Enable'}</Btn>,
            ])}
          />
        </Card>
      ):tab==='integrations'?(<>
        <Alert type="info">Point 6 — controlled, non-mandatory integration. Disabled by default; enable only the cross-module automations you want.</Alert>
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Source','Target','Trigger','Description','Status','Action']}
            rows={integrations.map(i=>[
              <Badge variant="navy">{i.source_module}</Badge>, <Badge variant="navy">{i.target_module}</Badge>,
              <span style={{fontSize:11,fontFamily:'monospace'}}>{i.trigger_event}</span>,
              <span style={{fontSize:11,color:T.mgrey}}>{i.config?.description||'—'}</span>,
              <Badge variant={i.enabled?'green':'default'}>{i.enabled?'Enabled':'Disabled'}</Badge>,
              <Btn size="sm" variant={i.enabled?'ghost':'gold'} onClick={()=>toggleIntegration(i.id,i.enabled)}>{i.enabled?'Disable':'Enable'}</Btn>,
            ])}
          />
        </Card>
      </>):tab==='companies'?(<>
        <Alert type="info">QSL's own staff, equipment, and systems always do the work — sister companies are contracting vehicles only, used when a client won't contract QSL directly. This registers which legal entity a project, client, or invoice is filed under, and links sister companies back to their commission profile in Inter-Company.</Alert>
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
          <Btn size="sm" onClick={()=>setModal('create_company')}>+ Add Sister Company</Btn>
        </div>
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Code','Legal Name','Type','Projects','Clients','Invoices','Status','Action']}
            rows={companies.map(c=>[
              <span style={{fontFamily:'monospace',fontSize:11}}>{c.code}</span>,
              <strong>{c.legal_name}</strong>,
              c.is_primary?<Badge variant="navy">Primary (QSL)</Badge>:<Badge variant="amber">Sister Company</Badge>,
              c.project_count, c.client_count, c.invoice_count,
              <Badge variant={c.status==='active'?'green':'default'}>{c.status}</Badge>,
              <Btn size="sm" variant="ghost" onClick={()=>viewCompany(c)}>View</Btn>,
            ])}
          />
        </Card>
      </>):tab==='roles'?(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Role','Permissions','Users','System','Action']}
            rows={roles.map(r=>[
              <strong>{r.name}</strong>, r.permission_count, r.user_count,
              r.is_system?<Badge variant="navy">System</Badge>:'—',
              <Btn size="sm" variant="ghost" onClick={()=>viewRole(r)}>{r.is_system?'View':'Edit'}</Btn>,
            ])}
          />
        </Card>
      ):tab==='users'?(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Name','Email','Department','Roles','Status']}
            rows={users.map(u=>[
              u.name||'—', <span style={{fontSize:11}}>{u.email}</span>, u.department||'—',
              <span style={{fontSize:11}}>{u.roles||u.legacy_role}</span>,
              <Badge variant={u.is_active?'green':'red'}>{u.is_active?'Active':'Inactive'}</Badge>,
            ])}
          />
        </Card>
      ):tab==='departments'?(<>
        <SectionHeader title="Branches"/>
        <Card style={{padding:0,overflow:'hidden',marginBottom:16}}>
          <DataTable headers={['Code','Name','City','Manager']}
            rows={deptData.branches.map(b=>[b.code,b.name,b.city||'—',b.manager_name||'—'])}/>
        </Card>
        <SectionHeader title="Departments"/>
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Code','Name','Branch','Head']}
            rows={deptData.departments.map(d=>[d.code,d.name,d.branch_name||'—',d.head_name||'—'])}/>
        </Card>
      </>):tab==='settings'?(<>
        <Alert type="info">Adjust system behaviour without editing code. Changes apply immediately — VAT rate, approval chain, imprest window, alert timings, MSP margins, company details and theme are all read live by the relevant modules.</Alert>
        {SETTINGS_REGISTRY.map(group=>{
          const dirty = group.fields.some(f=>draft[f.key]!==undefined);
          return (
            <Card key={group.category} style={{marginBottom:14}}>
              <SectionHeader title={group.label} sub={group.help} action={<Btn size="sm" disabled={!dirty} onClick={()=>saveGroup(group)}>{dirty?'Save Changes':'Saved'}</Btn>}/>
              <div style={{display:'grid',gridTemplateColumns:group.category==='commission'?'1fr':'1fr 1fr',gap:'12px 18px'}}>
                {group.fields.map(f=>(
                  <div key={f.key}>
                    <label style={{display:'block',fontSize:11,fontWeight:600,color:T.dgrey,marginBottom:4}}>{f.label}
                      {f.type==='percent'&&<span style={{color:T.mgrey,fontWeight:400}}> (%)</span>}
                    </label>
                    {f.type==='color'?(
                      <div style={{display:'flex',gap:8,alignItems:'center'}}>
                        <input type="color" value={dispVal(f)} onChange={e=>setVal(f.key,e.target.value)} style={{width:42,height:32,padding:0,border:`1px solid ${T.lgrey}`,borderRadius:5,cursor:'pointer'}}/>
                        <input value={dispVal(f)} onChange={e=>setVal(f.key,e.target.value)} style={{flex:1,padding:'7px 10px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:13,fontFamily:'monospace'}}/>
                      </div>
                    ):f.type==='select'?(
                      <select value={dispVal(f)} onChange={e=>setVal(f.key,e.target.value)} style={{width:'100%',padding:'8px 10px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:13,background:T.white}}>
                        {f.options.map(o=><option key={o} value={o}>{o}</option>)}
                      </select>
                    ):f.type==='json'?(
                      <textarea value={dispVal(f)} onChange={e=>setVal(f.key,e.target.value)} rows={4} style={{width:'100%',padding:'8px 10px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:12,fontFamily:'monospace'}}/>
                    ):f.type==='logo'?(
                      <div>
                        <div style={{padding:10,background:T.navyD,borderRadius:6,marginBottom:6,textAlign:'center'}}>
                          {dispVal(f)?<img src={dispVal(f)} alt="logo" style={{maxHeight:42,maxWidth:'100%'}}/>:<span style={{color:T.mgrey,fontSize:11}}>No logo</span>}
                        </div>
                        <input type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" style={{fontSize:12,marginBottom:6,display:'block'}} onChange={e=>{
                          const file=e.target.files?.[0]; if(!file)return;
                          if(file.size>512*1024){setMsg({type:'error',text:'Logo must be under 500 KB — use an SVG or small PNG'});return;}
                          const rd=new FileReader(); rd.onload=()=>setVal(f.key, rd.result); rd.readAsDataURL(file);
                        }}/>
                        {String(dispVal(f)).startsWith('data:')
                          ? <div style={{fontSize:11,color:T.green}}>✓ Custom image staged — click “Save Changes” to apply.</div>
                          : <input value={dispVal(f)} onChange={e=>setVal(f.key,e.target.value)} placeholder="/logo.svg or https://…" style={{width:'100%',padding:'7px 10px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:12}}/>}
                        <Btn size="sm" variant="ghost" style={{marginTop:6}} onClick={()=>setVal(f.key,'/logo.svg')}>Reset to default</Btn>
                      </div>
                    ):(
                      <input type={f.type==='number'||f.type==='percent'?'number':'text'} step="any" value={dispVal(f)} onChange={e=>setVal(f.key,e.target.value)} style={{width:'100%',padding:'8px 10px',border:`1px solid ${T.lgrey}`,borderRadius:6,fontSize:13}}/>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </>):null}

      {roleDetail&&(
        <Modal title={`Permissions — ${roleDetail.role.name}`} onClose={()=>setRoleDetail(null)} width={600}>
          {roleDetail.role.is_system&&<Alert type="info">System role — permissions are fixed and cannot be edited.</Alert>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,maxHeight:400,overflowY:'auto'}}>
            {permissions.map(p=>{
              const checked = roleDetail.permissions.some(rp=>rp.code===p.code);
              return (
                <label key={p.code} style={{display:'flex',gap:6,alignItems:'center',fontSize:12,padding:'4px 0',opacity:roleDetail.role.is_system?0.6:1}}>
                  <input type="checkbox" checked={checked} disabled={roleDetail.role.is_system} onChange={()=>togglePermInRole(p.code)}/>
                  <span>{p.code}</span>
                </label>
              );
            })}
          </div>
          {!roleDetail.role.is_system&&(
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
              <Btn variant="ghost" onClick={()=>setRoleDetail(null)}>Cancel</Btn>
              <Btn onClick={savePermissions}>Save Permissions</Btn>
            </div>
          )}
        </Modal>
      )}

      {modal==='create_company'&&(
        <Modal title="Add Sister Company" onClose={()=>{setModal(null);setForm({});}}>
          <Alert type="info">This registers the legal entity only — QSL's own staff and resources still do the actual work. Link it to an Inter-Company related party so the commission back to QSL can be tracked.</Alert>
          <Input label="Company Code" value={form.code||''} onChange={v=>setForm({...form,code:v})} required note="Short internal code, e.g. SISTER-A"/>
          <Input label="Legal Name" value={form.legal_name||''} onChange={v=>setForm({...form,legal_name:v})} required/>
          <Input label="KRA PIN" value={form.kra_pin||''} onChange={v=>setForm({...form,kra_pin:v})}/>
          <Input label="Registered Address" value={form.registered_address||''} onChange={v=>setForm({...form,registered_address:v})}/>
          <Input label="Related Party ID" value={form.related_party_id||''} onChange={v=>setForm({...form,related_party_id:v})} note="From Inter-Company > Entities. Leave blank to link later — but projects can't be attributed to this company until it's linked."/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>{setModal(null);setForm({});}}>Cancel</Btn>
            <Btn onClick={createCompany}>Add Company</Btn>
          </div>
        </Modal>
      )}

      {companyDetail&&(
        <Modal title={companyDetail.company.legal_name} onClose={()=>setCompanyDetail(null)} width={700}>
          <div style={{display:'flex',gap:8,marginBottom:14}}>
            {companyDetail.company.is_primary?<Badge variant="navy">Primary (QSL)</Badge>:<Badge variant="amber">Sister Company</Badge>}
            <Badge variant={companyDetail.company.status==='active'?'green':'default'}>{companyDetail.company.status}</Badge>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
            <Stat label="Projects" value={companyDetail.projects.length} icon="🏛️"/>
            <Stat label="Clients" value={companyDetail.clients.length} icon="🤝"/>
            <Stat label="Invoices" value={companyDetail.invoices.length} icon="🧾"/>
          </div>

          <SectionHeader title="Projects"/>
          <DataTable headers={['Ref','Name','Value','Status']} empty="No projects under this entity yet."
            rows={companyDetail.projects.map(p=>[p.ref_no,p.name,fmt.kes(p.contract_value),<Badge variant={p.status==='active'?'green':'default'}>{p.status}</Badge>])}/>

          <SectionHeader title="Clients"/>
          <DataTable headers={['Code','Name','Outstanding']} empty="No clients under this entity yet."
            rows={companyDetail.clients.map(c=>[c.code,c.name,fmt.kes(c.outstanding)])}/>

          {!companyDetail.company.is_primary&&(<>
            <SectionHeader title="Commission to QSL" sub="From Inter-Company — must be ICSA-verified before invoicing"/>
            <DataTable headers={['Project','Contract Value','Fee %','Status','ICSA Verified']} empty="No commission records yet."
              rows={companyDetail.commissions.map(c=>[
                c.project_ref||'—', fmt.kes(c.contract_value), `${(c.fee_pct*100).toFixed(0)}%`,
                <Badge variant={c.status==='approved'?'green':'amber'}>{c.status}</Badge>,
                c.icsa_verified?<Badge variant="green">Verified</Badge>:<Badge variant="red">Pending</Badge>,
              ])}/>
          </>)}
        </Modal>
      )}
    </div>
  );
}

// ── CRM MODULE ────────────────────────────────────────────────────────────────
function CRMModule({ api }) {
  const [tab,setTab]=useState('clients');
  const [clients,setClients]=useState([]);
  const [leads,setLeads]=useState([]);
  const [loading,setLoading]=useState(false);
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState(null);
  const [modal,setModal]=useState(null);
  const [txModal,setTxModal]=useState(null);
  const [txStep,setTxStep]=useState(0);
  const [txForm,setTxForm]=useState({to_owner_id:'',reason:''});
  const [txId,setTxId]=useState(null);
  const [signing,setSigning]=useState(false);
  const [leadForm,setLeadForm]=useState({company:'',contact_name:'',service:'Calibration Services',estimated_value:'',source:'Direct'});
  const [employees,setEmployees]=useState([]);
  const [msg,setMsg]=useState(null);

  const load=async(t=tab)=>{
    setLoading(true);
    if(t==='clients'){const r=await api.get('/api/crm?section=clients');if(r?.success)setClients(r.data);}
    if(t==='leads'){const r=await api.get('/api/crm?section=leads');if(r?.success)setLeads(r.data);}
    setLoading(false);
  };
  useEffect(()=>{load();api.get('/api/hr?section=employees').then(r=>{if(r?.success)setEmployees(r.data);});},[tab]);

  const loadDetail=async(id)=>{setSelected(id);const r=await api.get(`/api/crm?section=client&id=${id}`);if(r?.success)setDetail(r.data);};

  const initiateTransfer=async()=>{
    if(!txForm.to_owner_id||!txForm.reason)return;
    const r=await api.post('/api/crm',{action:'initiate_transfer',client_id:selected,...txForm});
    if(r?.success){setTxId(r.data.transfer_id);setTxStep(1);}else setMsg({type:'error',text:r?.error});
  };

  const signTransfer=async(role)=>{
    setSigning(true);
    const r=await api.post('/api/crm',{action:'sign_transfer',transfer_id:txId,signer_role:role,signature_key:`QSL-DS-SIG-${Date.now()}`});
    setSigning(false);
    if(r?.success){if(r.data.complete){setTxModal(null);setTxStep(0);setSelected(null);setMsg({type:'success',text:'Client ownership transferred successfully — both digital signatures applied.'});load('clients');}else setTxStep(2);}
    else setMsg({type:'error',text:r?.error});
  };

  const createLead=async()=>{
    if(!leadForm.company||!leadForm.contact_name)return;
    const r=await api.post('/api/crm',{action:'create_lead',...leadForm,estimated_value:parseFloat(leadForm.estimated_value||0)});
    if(r?.success){setMsg({type:'success',text:`Lead created — ${r.data.ref_no}`});setModal(null);load('leads');}
    else setMsg({type:'error',text:r?.error});
  };

  const totalPipeline=leads.reduce((s,l)=>s+(l.estimated_value||0),0);

  if(selected&&detail){
    const c=detail.client;
    return(<div>
      <button onClick={()=>{setSelected(null);setDetail(null);}} style={{background:'none',border:'none',color:T.navy,cursor:'pointer',fontSize:13,fontWeight:600,marginBottom:14}}>← Back to Clients</button>
      {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
      <Card style={{marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
          <div><h2 style={{fontSize:17,fontWeight:800,color:T.navy,margin:0}}>{c?.name}</h2><p style={{fontSize:12,color:T.mgrey,margin:'4px 0 0'}}>{c?.contact_person} · {c?.email}</p></div>
          <Btn size="sm" variant="outline" onClick={()=>setTxModal(true)}>Transfer Account Owner</Btn>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
          {[['Account Owner',c?.owner_name||'—'],['Outstanding',fmt.kes(c?.outstanding||0)],['Segment',c?.segment||'—']].map(([l,v])=>(
            <div key={l} style={{background:T.offwt,padding:'10px 12px',borderRadius:7}}><div style={{fontSize:9,color:T.mgrey,fontWeight:700,textTransform:'uppercase',marginBottom:3}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:T.navy}}>{v}</div></div>
          ))}
        </div>
      </Card>
      <Card>
        <SectionHeader title="Interaction History" sub="CRM-030: All touchpoints logged"/>
        {(detail.interactions||[]).length===0?<p style={{color:T.mgrey,fontSize:13,padding:'20px 0',textAlign:'center'}}>No interactions yet.</p>:(
          detail.interactions.map((i,idx)=>(
            <div key={idx} style={{display:'flex',gap:12,padding:'9px 0',borderBottom:`1px solid ${T.lgrey}`}}>
              <Badge variant={i.type==='Call'?'blue':i.type==='Email'?'amber':'green'}>{i.type}</Badge>
              <div style={{flex:1}}><div style={{fontSize:12}}>{i.summary}</div><div style={{fontSize:11,color:T.mgrey}}>{fmt.date(i.date)} · {i.done_by_name}</div></div>
            </div>
          ))
        )}
      </Card>
      {txModal&&(
        <Modal title={`Transfer — ${c?.name}`} onClose={()=>{setTxModal(null);setTxStep(0);setTxId(null);}}>
          {txStep===0&&(<>
            <Alert type="error">CRM-055: CFO + MD both must sign. Cannot be bypassed.</Alert>
            <Select label="Transfer To" value={txForm.to_owner_id} onChange={v=>setTxForm({...txForm,to_owner_id:v})} required options={[{value:'',label:'Select…'},...employees.map(e=>({value:e.id,label:`${e.first_name} ${e.last_name}`}))]}/>
            <Input label="Reason" value={txForm.reason} onChange={v=>setTxForm({...txForm,reason:v})} required placeholder="Business reason…"/>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setTxModal(null)}>Cancel</Btn><Btn onClick={initiateTransfer} disabled={!txForm.to_owner_id||!txForm.reason}>Proceed to CFO</Btn></div>
          </>)}
          {txStep===1&&(<>
            <Alert type="success">Transfer submitted. CFO signature required.</Alert>
            <div style={{background:'#F3E8FF',padding:'14px',borderRadius:8,marginBottom:14}}><div style={{fontSize:13,fontWeight:700,color:T.purple}}>🔐 CFO: Sarah Kamau · QSL-DS-SK-2024</div></div>
            <Btn style={{width:'100%'}} variant="gold" onClick={()=>signTransfer('cfo')} disabled={signing}>{signing?'Signing…':'Apply CFO Digital Signature'}</Btn>
          </>)}
          {txStep===2&&(<>
            <Alert type="success">CFO signed. MD signature required to complete.</Alert>
            <div style={{background:'#F3E8FF',padding:'14px',borderRadius:8,marginBottom:14}}><div style={{fontSize:13,fontWeight:700,color:T.purple}}>🔐 MD: Eng. Henry Adar · QSL-DS-HA-2024</div></div>
            <Btn style={{width:'100%'}} variant="danger" onClick={()=>signTransfer('md')} disabled={signing}>{signing?'Signing…':'Apply MD Signature — Finalise Transfer'}</Btn>
          </>)}
        </Modal>
      )}
    </div>);
  }

  return(<div>
    {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
    <Tabs tabs={[{id:'clients',label:'Client Register'},{id:'leads',label:'Leads & Pipeline'},{id:'payments',label:'Payment Alerts'}]} active={tab} setActive={t=>setTab(t)}/>
    {loading&&<Loading/>}
    {!loading&&tab==='clients'&&(<>
      <Alert type="info">CRM-055: Client ownership transfer requires CFO + MD digital signatures.</Alert>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:16}}>
        <Stat label="Clients" value={clients.length} icon="🤝"/>
        <Stat label="Outstanding" value={fmt.kes(clients.reduce((s,c)=>s+(c.outstanding||0),0))} icon="💰" variant="amber"/>
        <Stat label="With Balance" value={clients.filter(c=>c.outstanding>0).length} icon="🔄"/>
        <Stat label="Cleared" value={clients.filter(c=>!c.outstanding).length} icon="✅" variant="green"/>
      </div>
      <Card style={{padding:0,overflow:'hidden'}}>
        <DataTable headers={['Client','Contact','Segment','Account Owner','Outstanding','Status','Action']}
          rows={clients.map(c=>[
            <button onClick={()=>loadDetail(c.id)} style={{background:'none',border:'none',cursor:'pointer',padding:0}}><strong style={{color:T.blue,textDecoration:'underline'}}>{c.name}</strong></button>,
            <div><div style={{fontSize:12}}>{c.contact_person}</div><div style={{fontSize:11,color:T.mgrey}}>{c.email}</div></div>,
            <Badge variant="navy">{c.segment||'—'}</Badge>,
            <span style={{fontSize:12,fontWeight:600}}>{c.owner_name||'—'}</span>,
            <strong style={{color:(c.outstanding||0)>0?T.amber:T.green}}>{fmt.kes(c.outstanding||0)}</strong>,
            <Badge variant={(c.outstanding||0)>0?'amber':'green'}>{(c.outstanding||0)>0?'Outstanding':'Cleared'}</Badge>,
            <Btn size="sm" variant="ghost" onClick={()=>loadDetail(c.id)}>View</Btn>,
          ])}
        />
      </Card>
    </>)}
    {!loading&&tab==='leads'&&(<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:16}}>
        <Stat label="Open Leads" value={leads.length} icon="🎯"/>
        <Stat label="Pipeline Value" value={`Kshs ${(totalPipeline/1e6).toFixed(1)}M`} icon="💼"/>
        <Stat label="Negotiation" value={leads.filter(l=>l.stage?.toLowerCase().includes('negotiation')).length} icon="🤝" variant="green"/>
        <Stat label="Stage 2B" value={leads.filter(l=>l.stage?.includes('2b')||l.stage?.includes('2B')).length} icon="📋" variant="blue"/>
      </div>
      <SectionHeader title="Lead Register" action={<Btn onClick={()=>setModal('lead')}>+ New Lead</Btn>}/>
      <Card style={{padding:0,overflow:'hidden'}}>
        <DataTable headers={['Ref','Company','Contact','Service','Value','Stage','Owner']}
          rows={leads.map(l=>[
            <span style={{fontFamily:'monospace',fontSize:11,color:T.mgrey}}>{l.ref_no}</span>,
            <strong style={{fontSize:12}}>{l.company}</strong>,
            l.contact_name,
            <span style={{fontSize:11}}>{l.service}</span>,
            <strong>{fmt.kes(l.estimated_value)}</strong>,
            <Badge variant="amber">{l.stage}</Badge>,
            l.owner_name?.split(' ')[0]||'—',
          ])}
        />
      </Card>
    </>)}
    {!loading&&tab==='payments'&&(
      <Card style={{padding:0,overflow:'hidden'}}>
        <DataTable headers={['Client','Outstanding','Status','Action']}
          rows={clients.filter(c=>(c.outstanding||0)>0).map(c=>[
            <strong>{c.name}</strong>,
            <strong style={{color:T.amber}}>{fmt.kes(c.outstanding)}</strong>,
            <Badge variant="red">Outstanding</Badge>,
            <Btn size="sm" variant="outline">Send M-PESA</Btn>,
          ])}
        />
      </Card>
    )}
    {modal==='lead'&&(
      <Modal title="New Lead" onClose={()=>setModal(null)}>
        <Input label="Company" value={leadForm.company} onChange={v=>setLeadForm({...leadForm,company:v})} required/>
        <Input label="Contact Name" value={leadForm.contact_name} onChange={v=>setLeadForm({...leadForm,contact_name:v})} required/>
        <Select label="Service" value={leadForm.service} onChange={v=>setLeadForm({...leadForm,service:v})} options={['Calibration Services','Instrumentation Supply','Engineering Projects','Control Systems','Maintenance Contract'].map(s=>({value:s,label:s}))}/>
        <Input label="Estimated Value (Kshs)" value={leadForm.estimated_value} onChange={v=>setLeadForm({...leadForm,estimated_value:v})} type="number"/>
        <Select label="Source" value={leadForm.source} onChange={v=>setLeadForm({...leadForm,source:v})} options={['Direct','Referral','PPIP Portal','BD Event','Website'].map(s=>({value:s,label:s}))}/>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={createLead} disabled={!leadForm.company||!leadForm.contact_name}>Submit</Btn></div>
      </Modal>
    )}
  </div>);
}

// ── STORES MODULE ─────────────────────────────────────────────────────────────
// ── STORE MANAGEMENT MODULE (point 1) ─────────────────────────────────────────
function StoresModule({ api, user }) {
  const [tab,setTab]=useState('items');
  const [items,setItems]=useState([]);
  const [categories,setCategories]=useState([]);
  const [locations,setLocations]=useState([]);
  const [balances,setBalances]=useState([]);
  const [transfers,setTransfers]=useState([]);
  const [adjustments,setAdjustments]=useState([]);
  const [lowStock,setLowStock]=useState([]);
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState(null);
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({});
  const [itemDetail,setItemDetail]=useState(null);

  const load = async (section) => {
    setLoading(true);
    const r = await api.get(`/api/stores?section=${section}`);
    if(r?.success){
      if(section==='items')setItems(r.data);
      if(section==='categories')setCategories(r.data);
      if(section==='locations')setLocations(r.data);
      if(section==='balances')setBalances(r.data);
      if(section==='transfers')setTransfers(r.data);
      if(section==='adjustments')setAdjustments(r.data);
      if(section==='low_stock')setLowStock(r.data);
    }
    setLoading(false);
  };

  useEffect(()=>{ load(tab); if(tab==='items'){load('categories');load('locations');} }, [tab]);

  const submitAction = async (action, payload, onSuccess) => {
    const r = await api.post('/api/stores', {action, ...payload});
    if(r?.success){ setMsg({type:'success',text:'Done.'}); setModal(null); setForm({}); load(tab); if(onSuccess)onSuccess(r.data); }
    else setMsg({type:'error',text:r?.error||'Action failed'});
  };

  const viewItemDetail = async (item) => {
    const r = await api.get(`/api/stores?section=item_detail&id=${item.id}`);
    if(r?.success) setItemDetail(r.data);
  };

  return (
    <div>
      {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
      <Alert type="info">Real-time inventory across {locations.length||'multiple'} location(s). Receive, issue, transfer, and adjust stock here — every movement updates current balances immediately and is logged for audit.</Alert>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
        <Stat label="Active Items" value={items.length} icon="📦"/>
        <Stat label="Low Stock Alerts" value={lowStock.length} icon="⚠️" variant={lowStock.length?'red':'green'}/>
        <Stat label="Categories" value={categories.length} icon="🗂️"/>
        <Stat label="Locations" value={locations.length} icon="📍"/>
      </div>

      <Tabs tabs={[{id:'items',label:'Items'},{id:'balances',label:'Stock Balances'},{id:'transfers',label:'Transfers'},{id:'adjustments',label:'Adjustments'},{id:'low_stock',label:`Low Stock (${lowStock.length})`}]} active={tab} setActive={setTab}/>

      {tab==='items'&&(<>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginBottom:12}}>
          <Btn size="sm" variant="ghost" onClick={()=>setModal('create_category')}>+ Category</Btn>
          <Btn size="sm" variant="ghost" onClick={()=>setModal('create_location')}>+ Location</Btn>
          <Btn size="sm" onClick={()=>setModal('create_item')}>+ New Item</Btn>
        </div>
        {loading?<Loading/>:(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Code','Item Name','Category','Unit','Balance','Reorder Level','Status','Action']}
              rows={items.map(i=>[
                <span style={{fontFamily:'monospace',fontSize:11,color:T.mgrey}}>{i.code}</span>,
                <strong style={{fontSize:12}}>{i.name}</strong>,
                <Badge variant="navy">{i.category_name||i.category||'—'}</Badge>,
                i.unit,
                <strong style={{color:i.has_low_stock_alert?T.red:T.navy}}>{i.total_balance||0}</strong>,
                i.reorder_level,
                i.has_low_stock_alert?<Badge variant="red">Low Stock</Badge>:<Badge variant="green">Adequate</Badge>,
                <Btn size="sm" variant="ghost" onClick={()=>viewItemDetail(i)}>View</Btn>,
              ])}
            />
          </Card>
        )}
      </>)}

      {tab==='balances'&&(
        loading?<Loading/>:(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Item','Location','Batch','Quantity','Updated']}
              rows={balances.map(b=>[
                <span><strong>{b.item_code}</strong> {b.item_name}</span>,
                b.location_name, b.batch_no||'—',
                <strong>{b.quantity} {b.unit}</strong>,
                fmt.date(b.updated_at),
              ])}
            />
          </Card>
        )
      )}

      {tab==='transfers'&&(<>
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
          <Btn size="sm" onClick={()=>setModal('transfer_stock')}>+ New Transfer</Btn>
        </div>
        {loading?<Loading/>:(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Transfer No.','Item','Qty','From','To','Status','Action']}
              rows={transfers.map(t=>[
                <span style={{fontFamily:'monospace',fontSize:11}}>{t.transfer_no}</span>,
                t.item_name, t.quantity, t.from_location_name, t.to_location_name,
                <Badge variant={t.status==='completed'?'green':t.status==='cancelled'?'red':'amber'}>{t.status}</Badge>,
                t.status==='pending'?<Btn size="sm" onClick={()=>submitAction('approve_transfer',{id:t.id})}>Approve</Btn>:'—',
              ])}
            />
          </Card>
        )}
      </>)}

      {tab==='adjustments'&&(<>
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
          <Btn size="sm" onClick={()=>setModal('create_adjustment')}>+ New Adjustment</Btn>
        </div>
        {loading?<Loading/>:(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Adj No.','Item','Location','Variance','Reason','Status','Action']}
              rows={adjustments.map(a=>[
                <span style={{fontFamily:'monospace',fontSize:11}}>{a.adjustment_no}</span>,
                a.item_name, a.location_name,
                <strong style={{color:a.variance<0?T.red:T.green}}>{a.variance>0?'+':''}{a.variance}</strong>,
                a.reason_code,
                <Badge variant={a.status==='approved'?'green':'amber'}>{a.status}</Badge>,
                a.status==='pending'?<Btn size="sm" onClick={()=>submitAction('approve_adjustment',{id:a.id})}>Approve</Btn>:'—',
              ])}
            />
          </Card>
        )}
      </>)}

      {tab==='low_stock'&&(
        loading?<Loading/>:(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Item','Location','Current Qty','Reorder Level','Raised','Action']} empty="No open low-stock alerts."
              rows={lowStock.map(l=>[
                <span><strong>{l.item_code}</strong> {l.item_name}</span>, l.location_name,
                <strong style={{color:T.red}}>{l.current_qty}</strong>, l.reorder_level,
                fmt.date(l.created_at),
                <Btn size="sm" variant="ghost" onClick={()=>submitAction('acknowledge_alert',{id:l.id})}>Acknowledge</Btn>,
              ])}
            />
          </Card>
        )
      )}

      {modal==='create_item'&&(
        <Modal title="New Item" onClose={()=>setModal(null)}>
          <Input label="Item Code" value={form.code||''} onChange={v=>setForm({...form,code:v})} required/>
          <Input label="Item Name" value={form.name||''} onChange={v=>setForm({...form,name:v})} required/>
          <Select label="Category" value={form.category_id||''} onChange={v=>setForm({...form,category_id:v})}
            options={categories.map(c=>({value:c.id,label:c.name}))}/>
          <Input label="Unit" value={form.unit||'each'} onChange={v=>setForm({...form,unit:v})}/>
          <Input label="Reorder Level" value={form.reorder_level||''} onChange={v=>setForm({...form,reorder_level:v})} type="number"/>
          <Input label="Unit Cost (Kshs)" value={form.unit_cost||''} onChange={v=>setForm({...form,unit_cost:v})} type="number"/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn onClick={()=>submitAction('create_item',{...form,reorder_level:Number(form.reorder_level||0),unit_cost:Number(form.unit_cost||0)})}>Create</Btn>
          </div>
        </Modal>
      )}

      {modal==='create_category'&&(
        <Modal title="New Category" onClose={()=>setModal(null)}>
          <Input label="Category Code" value={form.code||''} onChange={v=>setForm({...form,code:v})} required/>
          <Input label="Category Name" value={form.name||''} onChange={v=>setForm({...form,name:v})} required/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn onClick={()=>submitAction('create_category',form)}>Create</Btn>
          </div>
        </Modal>
      )}

      {modal==='create_location'&&(
        <Modal title="New Store Location" onClose={()=>setModal(null)}>
          <Input label="Location Code" value={form.code||''} onChange={v=>setForm({...form,code:v})} required/>
          <Input label="Location Name" value={form.name||''} onChange={v=>setForm({...form,name:v})} required/>
          <Select label="Type" value={form.type||'warehouse'} onChange={v=>setForm({...form,type:v})}
            options={[{value:'warehouse',label:'Warehouse'},{value:'site',label:'Site'},{value:'vehicle',label:'Vehicle'},{value:'vendor',label:'Vendor'}]}/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn onClick={()=>submitAction('create_location',form)}>Create</Btn>
          </div>
        </Modal>
      )}

      {modal==='transfer_stock'&&(
        <Modal title="New Stock Transfer" onClose={()=>setModal(null)}>
          <Select label="Item" value={form.item_id||''} onChange={v=>setForm({...form,item_id:v})} required
            options={items.map(i=>({value:i.id,label:`${i.code} — ${i.name}`}))}/>
          <Select label="From Location" value={form.from_location_id||''} onChange={v=>setForm({...form,from_location_id:v})} required
            options={locations.map(l=>({value:l.id,label:l.name}))}/>
          <Select label="To Location" value={form.to_location_id||''} onChange={v=>setForm({...form,to_location_id:v})} required
            options={locations.map(l=>({value:l.id,label:l.name}))}/>
          <Input label="Quantity" value={form.quantity||''} onChange={v=>setForm({...form,quantity:v})} type="number" required/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn onClick={()=>submitAction('transfer_stock',{...form,quantity:Number(form.quantity||0)})}>Request Transfer</Btn>
          </div>
        </Modal>
      )}

      {modal==='create_adjustment'&&(
        <Modal title="New Stock Adjustment" onClose={()=>setModal(null)}>
          <Select label="Item" value={form.item_id||''} onChange={v=>setForm({...form,item_id:v})} required
            options={items.map(i=>({value:i.id,label:`${i.code} — ${i.name}`}))}/>
          <Select label="Location" value={form.location_id||''} onChange={v=>setForm({...form,location_id:v})} required
            options={locations.map(l=>({value:l.id,label:l.name}))}/>
          <Input label="Corrected Quantity" value={form.quantity_after||''} onChange={v=>setForm({...form,quantity_after:v})} type="number" required note="The actual quantity on hand after a physical count"/>
          <Select label="Reason" value={form.reason_code||'count_correction'} onChange={v=>setForm({...form,reason_code:v})}
            options={[{value:'count_correction',label:'Stock Count Correction'},{value:'damage',label:'Damage'},{value:'expiry',label:'Expiry'},{value:'theft',label:'Theft'},{value:'write_off',label:'Write-off'},{value:'other',label:'Other'}]}/>
          <Input label="Notes" value={form.notes||''} onChange={v=>setForm({...form,notes:v})}/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
            <Btn onClick={()=>submitAction('create_adjustment',{...form,quantity_after:Number(form.quantity_after||0)})}>Submit for Approval</Btn>
          </div>
        </Modal>
      )}

      {itemDetail&&(
        <Modal title={`${itemDetail.item.code} — ${itemDetail.item.name}`} onClose={()=>setItemDetail(null)} width={680}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
            <Stat label="Category" value={itemDetail.item.category_name||'—'} icon="🗂️"/>
            <Stat label="Unit Cost" value={fmt.kes(itemDetail.item.unit_cost)} icon="💰"/>
            <Stat label="Reorder Level" value={itemDetail.item.reorder_level} icon="📉"/>
          </div>
          <SectionHeader title="Balances by Location"/>
          <DataTable headers={['Location','Batch','Quantity']} empty="No stock at any location."
            rows={itemDetail.balances.map(b=>[b.location_name,b.batch_no||'—',<strong>{b.quantity}</strong>])}/>
          <SectionHeader title="Recent Movements" sub="Last 50"/>
          <DataTable headers={['Date','Type','Qty','Balance After','By']} empty="No movements recorded."
            rows={itemDetail.movements.slice(0,10).map(m=>[
              fmt.date(m.date), <Badge variant={m.quantity<0?'red':'green'}>{m.type}</Badge>, m.quantity, m.balance, m.done_by_name||'—'
            ])}/>
        </Modal>
      )}
    </div>
  );
}

// ── FIXED ASSETS MODULE ───────────────────────────────────────────────────────
function AssetsModule({ api }) {
  const [tab,setTab]=useState('register');
  const [data,setData]=useState({totals:null,assets:[]});
  const [depSchedule,setDepSchedule]=useState({summary:null,schedule:[]});
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [msg,setMsg]=useState(null);
  const [form,setForm]=useState({name:'',category:'Motor Vehicles',cost:'',purchase_date:'',dep_method:'straight_line',dep_rate:'0.20',serial_no:''});



  const load=async(t=tab)=>{
    setLoading(true);
    if(t==='register'){const r=await api.get('/api/assets?section=register');if(r?.success)setData(r.data);}
    if(t==='depreciation'){const r=await api.get('/api/assets?section=depreciation_schedule');if(r?.success)setDepSchedule(r.data);}
    setLoading(false);
  };
  useEffect(()=>{load();},[tab]);

  const createAsset=async()=>{
    if(!form.name||!form.cost||!form.purchase_date)return;
    const r=await api.post('/api/assets',{action:'create',...form,cost:parseFloat(form.cost),dep_rate:parseFloat(form.dep_rate)});
    if(r?.success){setMsg({type:'success',text:`Asset ${r.data.tag_no} created`});setModal(null);load('register');}
    else setMsg({type:'error',text:r?.error});
  };

  const runDep=async()=>{
    const period=new Date().toISOString().slice(0,7);
    const r=await api.post('/api/assets',{action:'run_depreciation',period});
    if(r?.success)setMsg({type:'success',text:`Depreciation run: ${r.data.processed} assets, charge ${fmt.kes(r.data.total_charge)}`});
    else setMsg({type:'error',text:r?.error});
    load('depreciation');
  };

  return(<div>
    {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
    <Tabs tabs={[{id:'register',label:'Asset Register'},{id:'depreciation',label:'Depreciation Schedule'}]} active={tab} setActive={t=>setTab(t)}/>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
      <Stat label="Total Assets" value={data.assets?.length||0} icon="🏗️"/>
      <Stat label="Original Cost" value={`Kshs ${((data.totals?.total_cost||0)/1e6).toFixed(2)}M`} icon="💰"/>
      <Stat label="Depreciation" value={`Kshs ${((data.totals?.total_depreciation||0)/1e6).toFixed(2)}M`} icon="📉" variant="amber"/>
      <Stat label="Net Book Value" value={`Kshs ${((data.totals?.total_nbv||0)/1e6).toFixed(2)}M`} icon="📊" variant="green"/>
    </div>
    <Alert type="info">ASSET-001: Capitalisation threshold = Kshs 10,000. Items below must be expensed directly.</Alert>
    {loading?<Loading/>:(
      tab==='register'?(
        <>
          <SectionHeader title="Asset Register" action={<div style={{display:'flex',gap:8}}><Btn size="sm" variant="ghost" onClick={runDep}>Run Depreciation</Btn><Btn onClick={()=>setModal('asset')}>+ Add Asset</Btn></div>}/>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Tag No','Description','Category','Cost','Method','Rate','NBV','Status']}
              rows={(data.assets||[]).map(a=>[
                <span style={{fontFamily:'monospace',fontSize:11,fontWeight:600,color:T.navy}}>{a.tag_no}</span>,
                <strong style={{fontSize:12}}>{a.name}</strong>,
                <Badge variant="navy">{a.category}</Badge>,
                fmt.kes(a.cost),
                <Badge variant={a.dep_method==='straight_line'?'blue':'purple'}>{a.dep_method==='straight_line'?'SL':'RB'}</Badge>,
                fmt.pct(a.dep_rate),
                <div><strong style={{color:T.green}}>{fmt.kes(a.nbv)}</strong><Progress value={a.cost>0?a.nbv/a.cost:0}/></div>,
                <Badge variant="green">{a.status}</Badge>,
              ])}
            />
          </Card>
        </>
      ):(
        <>
          <SectionHeader title="Depreciation Schedule" sub={`Annual total: ${fmt.kes(depSchedule.summary?.total_annual||0)}`}/>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Asset','Category','Method','Rate','Annual Charge','Monthly']}
              rows={(depSchedule.schedule||[]).map(a=>[
                <strong style={{fontSize:12}}>{a.name}</strong>,
                <Badge variant="navy">{a.category}</Badge>,
                <Badge variant={a.dep_method==='straight_line'?'blue':'purple'}>{a.dep_method==='straight_line'?'SL':'RB'}</Badge>,
                fmt.pct(a.dep_rate),
                <strong style={{color:T.amber}}>{fmt.kes(a.annual_charge||0)}</strong>,
                <span style={{color:T.mgrey}}>{fmt.kes(a.monthly_charge||0)}</span>,
              ])}
            />
          </Card>
        </>
      )
    )}
    {modal==='asset'&&(
      <Modal title="Add Fixed Asset" onClose={()=>setModal(null)}>
        <Alert type="info">Minimum: Kshs 10,000. Below this threshold must be expensed directly.</Alert>
        <Input label="Asset Description" value={form.name} onChange={v=>setForm({...form,name:v})} required/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Select label="Category" value={form.category} onChange={v=>setForm({...form,category:v})} options={['Motor Vehicles','IT Equipment','Calibration Equipment','Test Equipment','Furniture & Fittings','Plant & Machinery'].map(c=>({value:c,label:c}))}/>
          <Input label="Cost (Kshs)" value={form.cost} onChange={v=>setForm({...form,cost:v})} type="number" required note={form.cost&&parseFloat(form.cost)<10000?'⚠️ Below threshold':''} />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Input label="Purchase Date" value={form.purchase_date} onChange={v=>setForm({...form,purchase_date:v})} type="date" required/>
          <Input label="Serial Number" value={form.serial_no} onChange={v=>setForm({...form,serial_no:v})}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Select label="Depreciation Method" value={form.dep_method} onChange={v=>setForm({...form,dep_method:v})} options={[{value:'straight_line',label:'Straight Line'},{value:'reducing_balance',label:'Reducing Balance'}]}/>
          <Select label="Annual Rate" value={form.dep_rate} onChange={v=>setForm({...form,dep_rate:v})} options={['0.10','0.20','0.25','0.33'].map(r=>({value:r,label:`${parseFloat(r)*100}%`}))}/>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={createAsset} disabled={!form.name||!form.cost||parseFloat(form.cost)<10000}>Add Asset</Btn></div>
      </Modal>
    )}
  </div>);
}

// ── FLEET MODULE ─────────────────────────────────────────────────────────────
function FleetModule({ api }) {
  const [vehicles,setVehicles]=useState([]);
  const [stats,setStats]=useState(null);
  const [trips,setTrips]=useState([]);
  const [tab,setTab]=useState('vehicles');
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [tripForm,setTripForm]=useState({vehicle_id:'',purpose:'',from_location:'',to_location:'',date:new Date().toISOString().split('T')[0],fuel_litres:'',fuel_cost:''});
  const [msg,setMsg]=useState(null);
  const load=async(t=tab)=>{
    setLoading(true);
    if(t==='vehicles'){const r=await api.get('/api/fleet?section=vehicles');if(r?.success){setVehicles(r.data.vehicles||[]);setStats(r.data.stats);}}
    if(t==='trips'){const r=await api.get('/api/fleet?section=trips');if(r?.success)setTrips(r.data);}
    setLoading(false);
  };
  useEffect(()=>{load();},[tab]);
  const logTrip=async()=>{
    const r=await api.post('/api/fleet',{action:'log_trip',...tripForm,fuel_litres:parseFloat(tripForm.fuel_litres||0),fuel_cost:parseFloat(tripForm.fuel_cost||0)});
    if(r?.success){setMsg({type:'success',text:`Trip logged — ${r.data.distance}km`});setModal(null);load('trips');}
    else setMsg({type:'error',text:r?.error});
  };
  return(<div>
    {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
    <Tabs tabs={[{id:'vehicles',label:'Vehicles'},{id:'trips',label:'Trip Log'}]} active={tab} setActive={t=>setTab(t)}/>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
      <Stat label="Fleet Size" value={stats?.total||vehicles.length} icon="🚗"/>
      <Stat label="Active" value={stats?.active||0} icon="🟢" variant="green"/>
      <Stat label="Service Due" value={stats?.service_due||0} icon="🔧" variant={stats?.service_due>0?'amber':'green'}/>
      <Stat label="Insurance Expiring" value={stats?.insurance_expiring||0} icon="📋" variant={stats?.insurance_expiring>0?'red':'green'}/>
    </div>
    {loading?<Loading/>:(
      tab==='vehicles'?(
        <>
          <SectionHeader title="Fleet Register" action={<Btn size="sm" onClick={()=>setModal('trip')}>+ Log Trip</Btn>}/>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Reg No','Make','Class','Driver','Insurance Expiry','Next Service','Mileage','Status']}
              rows={vehicles.map(v=>{
                const insWarn=v.insurance_to&&new Date(v.insurance_to)<new Date(Date.now()+30*86400000);
                const svcWarn=v.service_due&&new Date(v.service_due)<new Date(Date.now()+14*86400000);
                return[<strong style={{fontFamily:'monospace'}}>{v.reg_no}</strong>,`${v.make||''} ${v.model||''}`,<Badge variant="blue">Class {v.class||'C'}</Badge>,v.driver_name||'—',<span style={{color:insWarn?T.red:T.green,fontWeight:insWarn?700:400}}>{fmt.date(v.insurance_to)}</span>,<span style={{color:svcWarn?T.amber:T.green}}>{fmt.date(v.service_due)}</span>,`${(v.mileage||0).toLocaleString()} km`,<Badge variant={v.status==='active'?'green':'amber'}>{v.status}</Badge>];
              })}
            />
          </Card>
        </>
      ):(
        <>
          <SectionHeader title="Trip Log" action={<Btn size="sm" onClick={()=>setModal('trip')}>+ Log Trip</Btn>}/>
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={['Date','Vehicle','Purpose','From','To','Distance','Fuel Cost']}
              rows={trips.slice(0,20).map(t=>[fmt.date(t.date),<strong>{t.reg_no}</strong>,<span style={{fontSize:12}}>{t.purpose}</span>,t.from_location||'—',t.to_location||'—',t.distance?`${t.distance} km`:'—',t.fuel_cost?fmt.kes(t.fuel_cost):'—'])}
            />
          </Card>
        </>
      )
    )}
    {modal==='trip'&&(
      <Modal title="Log Trip" onClose={()=>setModal(null)}>
        <Select label="Vehicle" value={tripForm.vehicle_id} onChange={v=>setTripForm({...tripForm,vehicle_id:v})} required options={[{value:'',label:'Select vehicle…'},...vehicles.map(v=>({value:v.id,label:`${v.reg_no} — ${v.make}`}))]}/>
        <Input label="Date" value={tripForm.date} onChange={v=>setTripForm({...tripForm,date:v})} type="date" required/>
        <Input label="Purpose" value={tripForm.purpose} onChange={v=>setTripForm({...tripForm,purpose:v})} required placeholder="Site visit, client meeting…"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Input label="From" value={tripForm.from_location} onChange={v=>setTripForm({...tripForm,from_location:v})}/>
          <Input label="To" value={tripForm.to_location} onChange={v=>setTripForm({...tripForm,to_location:v})}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Input label="Fuel (Litres)" value={tripForm.fuel_litres} onChange={v=>setTripForm({...tripForm,fuel_litres:v})} type="number"/>
          <Input label="Fuel Cost (Kshs)" value={tripForm.fuel_cost} onChange={v=>setTripForm({...tripForm,fuel_cost:v})} type="number"/>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={logTrip} disabled={!tripForm.vehicle_id||!tripForm.purpose}>Log Trip</Btn></div>
      </Modal>
    )}
  </div>);
}

// ── HSE MODULE ────────────────────────────────────────────────────────────────
function HSE({ api }) {
  const [tab,setTab]=useState('incidents');
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({type:'Near Miss',site:'',description:'',severity:'Low'});
  const [msg,setMsg]=useState(null);
  const [incidents,setIncidents]=useState([
    {id:'HSE001',date:'2026-05-12',type:'Near Miss',site:'Mombasa Water Treatment',description:'Worker nearly slipped on wet platform',severity:'Low',status:'Closed',capa:'Non-slip matting installed'},
    {id:'HSE002',date:'2026-06-03',type:'First Aid',site:'Nairobi HQ Workshop',description:'Minor cut on right hand — inadequate gloves',severity:'Low',status:'CAPA Pending',capa:'Glove policy review required'},
    {id:'HSE003',date:'2026-06-10',type:'Observation',site:'KPLC Substation',description:'Positive: 100% PPE compliance on site',severity:'None',status:'Closed',capa:'—'},
  ]);
  const report=()=>{
    if(!form.site||!form.description)return;
    setIncidents([{id:`HSE${Date.now().toString().slice(-3)}`,...form,date:new Date().toISOString().split('T')[0],status:'Open',capa:'Under Investigation'},...incidents]);
    setMsg({type:'success',text:'Incident reported. Supervisor notified. CAPA required within 48 hours.'});
    setModal(null);
  };
  return(<div>
    {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
    <Tabs tabs={[{id:'incidents',label:'Incident Register'},{id:'rams',label:'RAMS Status'},{id:'ppe',label:'PPE Tracker'}]} active={tab} setActive={setTab}/>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
      <Stat label="Incidents YTD" value={incidents.length} icon="🦺"/>
      <Stat label="Lost Time Injuries" value={0} sub="Zero LTI" icon="✅" variant="green"/>
      <Stat label="Open CAPAs" value={incidents.filter(i=>i.status!=='Closed').length} icon="🔧" variant="amber"/>
      <Stat label="Near Misses" value={incidents.filter(i=>i.type==='Near Miss').length} icon="⚠️" variant="amber"/>
    </div>
    <Alert type="warning">HSE-002: RAMS upload mandatory before site mobilisation. ERP blocks project start without approved RAMS.</Alert>
    {tab==='incidents'&&(<>
      <SectionHeader title="Incident Register" action={<Btn onClick={()=>setModal('inc')}>+ Report Incident</Btn>}/>
      {incidents.map(h=>(
        <Card key={h.id} style={{marginBottom:10,background:h.type==='Near Miss'?T.amberL:h.type==='First Aid'?T.redL:T.greenL}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <div style={{display:'flex',gap:8}}><Badge variant={h.type==='Near Miss'?'amber':h.type==='First Aid'?'red':'green'}>{h.type}</Badge><span style={{fontSize:11,color:T.mgrey}}>{fmt.date(h.date)} · {h.site}</span></div>
            <Badge variant={h.status==='Closed'?'green':'amber'}>{h.status}</Badge>
          </div>
          <div style={{fontSize:12}}>{h.description}</div>
          {h.capa&&h.capa!=='—'&&<div style={{fontSize:11,color:T.mgrey,marginTop:4}}>CAPA: {h.capa}</div>}
        </Card>
      ))}
    </>)}
    {tab==='rams'&&(
      <Card style={{padding:0,overflow:'hidden'}}>
        <DataTable headers={['Project','RAMS Status','Date Filed','Action']}
          rows={[['Mombasa Water Treatment','Filed','2026-04-01'],['Nairobi Hospital Medical Gas','Filed','2026-05-15'],['KPLC Substation','Filed','2026-03-10'],['SGR Weighbridge','Filed','2026-02-20'],['Kisumu Port Flow Meter','Not Filed','—']].map(([p,s,d])=>[<strong style={{fontSize:12}}>{p}</strong>,<Badge variant={s==='Filed'?'green':'red'}>{s==='Filed'?'✅ Filed':'🛑 Missing'}</Badge>,d!=='—'?fmt.date(d):<span style={{color:T.red}}>NOT UPLOADED</span>,s!=='Filed'?<Btn size="sm" variant="danger">Upload Now</Btn>:<Btn size="sm" variant="ghost">View</Btn>])}
        />
      </Card>
    )}
    {tab==='ppe'&&(
      <Card style={{padding:0,overflow:'hidden'}}>
        <DataTable headers={['PPE Item','Qty','Status']}
          rows={[['Safety Helmets',27,true],['Safety Harnesses',18,true],['Steel-toe Boots',24,true],['Hi-Vis Vests',30,true],['Safety Glasses',25,true],['Cut-Resistant Gloves',12,false],['Ear Protection',15,true]].map(([item,qty,ok])=>[<strong style={{fontSize:12}}>{item}</strong>,<span style={{fontWeight:700,color:ok?T.green:T.red}}>{qty}</span>,ok?<Badge variant="green">Adequate</Badge>:<Badge variant="red">Low — Reorder</Badge>])}
        />
      </Card>
    )}
    {modal==='inc'&&(
      <Modal title="Report Incident — HSE-001" onClose={()=>setModal(null)}>
        <Alert type="warning">Report within 24 hours. CAPA required within 48 hours.</Alert>
        <Select label="Type" value={form.type} onChange={v=>setForm({...form,type:v})} options={['Near Miss','First Aid','Medical Treatment','Lost Time Injury','Positive Observation'].map(t=>({value:t,label:t}))}/>
        <Input label="Site / Location" value={form.site} onChange={v=>setForm({...form,site:v})} required/>
        <Select label="Severity" value={form.severity} onChange={v=>setForm({...form,severity:v})} options={['None','Low','Medium','High','Critical'].map(s=>({value:s,label:s}))}/>
        <Input label="Description" value={form.description} onChange={v=>setForm({...form,description:v})} required placeholder="What happened exactly?"/>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={report} disabled={!form.site||!form.description}>Submit Report</Btn></div>
      </Modal>
    )}
  </div>);
}

// ── CALIBRATION MODULE ────────────────────────────────────────────────────────
function CalibrationModule({ api }) {
  const [tab,setTab]=useState('certificates');
  const [certs,setCerts]=useState([]);
  const [standards,setStandards]=useState([]);
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [clients,setClients]=useState([]);
  const [form,setForm]=useState({client_id:'',instrument:'',make:'',model:'',serial_no:'',range:'',uncertainty:'',ref_standard_id:'',next_cal_date:'',result:'pass'});
  const [msg,setMsg]=useState(null);
  const load=async(t=tab)=>{
    setLoading(true);
    if(t==='certificates'){const r=await api.get('/api/calibration?section=certificates');if(r?.success)setCerts(r.data);}
    if(t==='standards'){const r=await api.get('/api/calibration?section=reference_standards');if(r?.success)setStandards(r.data);}
    setLoading(false);
  };
  useEffect(()=>{load();api.get('/api/crm?section=clients').then(r=>{if(r?.success)setClients(r.data);});api.get('/api/calibration?section=reference_standards').then(r=>{if(r?.success)setStandards(r.data);});},[tab]);
  const issueCert=async()=>{
    if(!form.client_id||!form.instrument||!form.uncertainty)return;
    const r=await api.post('/api/calibration',{action:'issue_cert',...form,calibrated_at:new Date().toISOString().split('T')[0]});
    if(r?.success){setMsg({type:'success',text:`Certificate ${r.data.cert_no} issued${r.data.signed?' — RSA-2048 digital signature applied':''}`});setModal(null);load('certificates');}
    else setMsg({type:'error',text:r?.error});
  };
  return(<div>
    {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
    <Tabs tabs={[{id:'certificates',label:'Certificates'},{id:'standards',label:'Reference Standards'},{id:'uncertainty',label:'Uncertainty Budget'}]} active={tab} setActive={t=>setTab(t)}/>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
      <Stat label="Certs Issued" value={certs.length} icon="📜" variant="green"/>
      <Stat label="Passed" value={certs.filter(c=>c.result==='pass').length} icon="✅" variant="green"/>
      <Stat label="Reference Standards" value={standards.length} sub="KEBS traceable" icon="🔬"/>
      <Stat label="Expiring ≤60 days" value={certs.filter(c=>c.next_cal_date&&new Date(c.next_cal_date)<new Date(Date.now()+60*86400000)).length} icon="⚠️" variant="amber"/>
    </div>
    <Alert type="info">ISO/IEC 17025:2017: All certificates must include uncertainty (k=2, 95.45%). Technician RSA-2048 signature auto-applied on issue.</Alert>
    {loading?<Loading/>:(
      tab==='certificates'?(<>
        <SectionHeader title="Calibration Certificate Register" action={<Btn onClick={()=>setModal('cert')}>+ Issue Certificate</Btn>}/>
        {certs.length===0?<Card><p style={{color:T.mgrey,textAlign:'center',padding:30}}>No certificates yet. Issue your first certificate above.</p></Card>:(
          certs.map(c=>(
            <Card key={c.id} style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
                <div><div style={{fontSize:10,color:T.mgrey,fontFamily:'monospace',marginBottom:3}}>{c.cert_no}</div><div style={{fontSize:14,fontWeight:700,color:T.navy}}>{c.instrument}</div><div style={{fontSize:12,color:T.mgrey}}>Client: {c.client_name} · S/N: {c.serial_no||'—'}</div></div>
                <div style={{textAlign:'right'}}><Badge variant={c.result==='pass'?'green':'red'}>{c.result}</Badge><div style={{fontSize:11,color:T.mgrey,marginTop:5}}>Next: {fmt.date(c.next_cal_date)}</div></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,background:T.offwt,padding:'8px 10px',borderRadius:7,marginBottom:8}}>
                {[['Range',c.range||'—'],['Uncertainty',c.uncertainty||'—'],['Cal Date',fmt.date(c.calibrated_at)],['Technician',c.technician_name||'—']].map(([l,v])=>(
                  <div key={l}><div style={{fontSize:9,color:T.mgrey,fontWeight:700,textTransform:'uppercase'}}>{l}</div><div style={{fontSize:12,fontWeight:600,color:T.navy,marginTop:2}}>{v}</div></div>
                ))}
              </div>
              {c.tech_sig&&<div style={{background:T.greenL,padding:'6px 10px',borderRadius:6,fontSize:11,color:T.green}}>🔐 RSA-2048 signature applied</div>}
            </Card>
          ))
        )}
      </>):tab==='standards'?(<>
        <SectionHeader title="Reference Standards" sub="KEBS → BIPM traceability chain" action={<Btn size="sm" onClick={()=>api.post('/api/calibration',{action:'add_reference_standard',name:'New Standard',traceable_to:'KEBS'}).then(()=>load('standards'))}>+ Add Standard</Btn>}/>
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Standard','Traceability','Last Cal','Next Cal','Uncertainty','Status']}
            rows={standards.map(r=>[<div><strong style={{fontSize:12}}>{r.name}</strong><div style={{fontSize:10,color:T.mgrey}}>{r.make} {r.model}</div></div>,<div style={{fontSize:11}}><span style={{color:T.gold,fontWeight:700}}>QSL</span> → {r.traceable_to||'KEBS'} → BIPM</div>,fmt.date(r.last_cal_date),<span style={{color:r.status!=='current'?T.amber:T.green,fontWeight:600}}>{fmt.date(r.next_cal_date)}</span>,<span style={{fontFamily:'monospace',fontSize:11}}>{r.uncertainty||'—'}</span>,<Badge variant={r.status==='current'?'green':'amber'}>{r.status}</Badge>])}
          />
        </Card>
      </>):(
        <Card>
          <SectionHeader title="Uncertainty Budget — GUM Compliant" sub="ISO 17025 Clause 7.6 — Pressure Calibration Example"/>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr>{['Source','Distribution','Divisor','Std Uncertainty','Sensitivity','ui×ci','DoF'].map(h=><th key={h} style={{background:T.navy,color:T.white,padding:'7px 10px',textAlign:'left',fontSize:11,fontWeight:600}}>{h}</th>)}</tr></thead>
            <tbody>
              {[['Reference standard accuracy','Normal','2','0.025%','1.0','0.025%','∞'],['Resolution','Rectangular','√3','0.006%','1.0','0.006%','∞'],['Temperature effect','Normal','2','0.010%','1.0','0.010%','∞'],['Repeatability','Normal','1','0.015%','1.0','0.015%','9']].map(([src,...cells],i)=>(
                <tr key={i} style={{background:i%2===0?T.offwt:T.white}}>
                  <td style={{padding:'8px 10px',fontWeight:500,color:T.navy}}>{src}</td>
                  {cells.map((c,j)=><td key={j} style={{padding:'8px 10px',textAlign:'center',fontFamily:j>=2?'monospace':'inherit',fontSize:11}}>{c}</td>)}
                </tr>
              ))}
              <tr style={{background:T.navy}}><td colSpan={5} style={{padding:'9px 10px',fontWeight:700,color:T.white}}>Expanded Uncertainty U (k=2, 95.45%)</td><td style={{padding:'9px 10px',textAlign:'center',fontFamily:'monospace',fontWeight:800,color:T.gold,fontSize:14}}>±0.064%</td><td/></tr>
            </tbody>
          </table>
        </Card>
      )
    )}
    {modal==='cert'&&(
      <Modal title="Issue Certificate — ISO 17025" onClose={()=>setModal(null)} width={580}>
        <Alert type="info">RSA-2048 digital signature auto-applied. Certificate number auto-generated.</Alert>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Select label="Client" value={form.client_id} onChange={v=>setForm({...form,client_id:v})} required options={[{value:'',label:'Select client…'},...clients.map(c=>({value:c.id,label:c.name}))]}/>
          <Select label="Result" value={form.result} onChange={v=>setForm({...form,result:v})} options={[{value:'pass',label:'✅ Pass'},{value:'fail',label:'❌ Fail'}]}/>
        </div>
        <Input label="Instrument" value={form.instrument} onChange={v=>setForm({...form,instrument:v})} required placeholder="Make, model, type"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
          <Input label="Make" value={form.make} onChange={v=>setForm({...form,make:v})}/>
          <Input label="Model" value={form.model} onChange={v=>setForm({...form,model:v})}/>
          <Input label="Serial No." value={form.serial_no} onChange={v=>setForm({...form,serial_no:v})}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Input label="Measurement Range" value={form.range} onChange={v=>setForm({...form,range:v})} required placeholder="e.g. 0-100 bar"/>
          <Input label="Expanded Uncertainty (k=2)" value={form.uncertainty} onChange={v=>setForm({...form,uncertainty:v})} required placeholder="e.g. ±0.05%"/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Select label="Reference Standard" value={form.ref_standard_id} onChange={v=>setForm({...form,ref_standard_id:v})} options={[{value:'',label:'Select standard…'},...standards.map(r=>({value:r.id,label:r.name}))]}/>
          <Input label="Next Calibration Date" value={form.next_cal_date} onChange={v=>setForm({...form,next_cal_date:v})} type="date" required/>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={issueCert} disabled={!form.client_id||!form.instrument||!form.uncertainty}>Issue & Sign Certificate</Btn></div>
      </Modal>
    )}
  </div>);
}

// ── INSPECTION BODY MODULE (ISO/IEC 17020) ─────────────────────────────────────
function InspectionModule({ api, user }) {
  const [tab,setTab]=useState('register');
  const [rows,setRows]=useState([]);
  const [inspectors,setInspectors]=useState([]);
  const [appeals,setAppeals]=useState([]);
  const [stats,setStats]=useState(null);
  const [clients,setClients]=useState([]);
  const [employees,setEmployees]=useState([]);
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [detail,setDetail]=useState(null);
  const [msg,setMsg]=useState(null);
  const [form,setForm]=useState({type:'pre',equipment_serial:'',client_id:'',inspector_id:'',repair_by:'',scheduled_date:''});
  const [authForm,setAuthForm]=useState({employee_id:'',scope:'',renewal_date:''});
  const isQM = user && (user.role==='md'||user.role==='admin'||user.role==='qm');

  const load=async(t=tab)=>{
    setLoading(true);
    const s=await api.get('/api/inspection?section=dashboard'); if(s?.success)setStats(s.data);
    if(t==='register'){const r=await api.get('/api/inspection?section=register');if(r?.success)setRows(r.data);}
    if(t==='inspectors'){const r=await api.get('/api/inspection?section=inspectors');if(r?.success)setInspectors(r.data);}
    if(t==='appeals'){const r=await api.get('/api/inspection?section=appeals');if(r?.success)setAppeals(r.data);}
    setLoading(false);
  };
  useEffect(()=>{
    load();
    api.get('/api/crm?section=clients').then(r=>{if(r?.success)setClients(r.data);});
    api.get('/api/hr?section=employees').then(r=>{if(r?.success)setEmployees(r.data);});
    api.get('/api/inspection?section=inspectors').then(r=>{if(r?.success)setInspectors(r.data);});
  },[tab]);

  const loadDetail=async(id)=>{const r=await api.get(`/api/inspection?section=detail&id=${id}`);if(r?.success)setDetail(r.data);};
  const createInspection=async()=>{
    const r=await api.post('/api/inspection',{action:'create_inspection',...form});
    if(r?.success){setMsg({type:'success',text:`Inspection ${r.data.ins_no} opened${form.type==='civil_works'?' — 5 WE-07 hold-points created':''}`});setModal(null);load('register');}
    else setMsg({type:'error',text:r?.error});
  };
  const rule=async(inspection_id,ruling)=>{
    const r=await api.post('/api/inspection',{action:'submit_we01',inspection_id,ruling});
    if(r?.success){setMsg({type:ruling==='FAIL'?'error':'success',text:ruling==='FAIL'?`FAIL recorded — WE-04 NCR raised, equipment quarantined`:`PASS recorded${r.data.signed?' — signature applied':''}`});setDetail(null);load('register');}
    else setMsg({type:'error',text:r?.error});  // surfaces the INS-001 / INS-002 block message
  };
  const clearHP=async(holdpoint_id)=>{
    const r=await api.post('/api/inspection',{action:'clear_holdpoint',holdpoint_id});
    if(r?.success){setMsg({type:'success',text:r.data.needs_qm?'Inspector signed — awaiting QM counter-signature (HP-5)':r.data.we08_unlocked?'HP-5 cleared — WE-08 unlocked':'Hold-point cleared'});loadDetail(detail.inspection.id);}
    else setMsg({type:'error',text:r?.error});
  };
  const authoriseInspector=async()=>{
    const r=await api.post('/api/inspection',{action:'authorise_inspector',...authForm});
    if(r?.success){setMsg({type:'success',text:'Inspector authorised (REG-01)'});setModal(null);load('inspectors');}
    else setMsg({type:'error',text:r?.error});
  };

  const rulingBadge=(r)=>r==='PASS'?<Badge variant="green">PASS</Badge>:r==='FAIL'?<Badge variant="red">FAIL</Badge>:<Badge variant="amber">pending</Badge>;

  return(<div>
    {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
    <Tabs tabs={[{id:'register',label:'Inspections'},{id:'inspectors',label:'Authorisation Register'},{id:'appeals',label:'Appeals'}]} active={tab} setActive={t=>setTab(t)}/>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
      <Stat label="Open Inspections" value={stats?.stats?.open||0} icon="🔍"/>
      <Stat label="Failed / Quarantined" value={stats?.stats?.quarantined||0} sub={`${stats?.open_ncrs||0} open NCRs`} icon="⛔" variant="red"/>
      <Stat label="Open Appeals" value={stats?.open_appeals||0} icon="⚖️" variant="amber"/>
      <Stat label="Auth. Expiring ≤30d" value={stats?.expiring||0} icon="⏰" variant="amber"/>
    </div>
    <Alert type="info">ISO/IEC 17020 Type C: INS-001 — the staff member who signed the repair (WE-02) cannot sign the PASS/FAIL ruling (WE-01) on the same equipment. A FAIL auto-raises an NCR and quarantines the equipment, blocking its calibration certificate.</Alert>

    {loading?<Loading/>:tab==='register'?(<>
      <SectionHeader title="Inspection Register" action={<Btn onClick={()=>setModal('create')}>+ New Inspection</Btn>}/>
      <Card style={{padding:0,overflow:'hidden'}}>
        <DataTable headers={['Inspection No.','Type','Equipment S/N','Client','Inspector','Ruling','']}
          rows={rows.map(r=>[
            <span style={{fontFamily:'monospace',fontSize:11}}>{r.ins_no}</span>,
            <Badge>{r.type}</Badge>, r.equipment_serial||'—', r.client_name||'—', r.inspector_name||'—',
            rulingBadge(r.ruling),
            <Btn size="sm" variant="ghost" onClick={()=>loadDetail(r.id)}>Open</Btn>,
          ])}/>
      </Card>
    </>):tab==='inspectors'?(<>
      <SectionHeader title="Inspector Authorisation Register (REG-01)" sub="INS-011 — only the Quality Manager / MD may authorise or revoke" action={isQM&&<Btn onClick={()=>setModal('authorise')}>+ Authorise Inspector</Btn>}/>
      <Card style={{padding:0,overflow:'hidden'}}>
        <DataTable headers={['Inspector','Scope','Authorised By','Renewal','COI Expires','Status']}
          rows={inspectors.map(r=>{
            const authExpired=r.renewal_date&&new Date(r.renewal_date)<new Date();
            const coiBad=!r.coi_expires||new Date(r.coi_expires)<new Date(Date.now()-7*86400000);
            return [
              <strong style={{fontSize:12}}>{r.employee_name}</strong>, r.scope||'—', r.authorised_by_name||'—',
              <span style={{color:authExpired?T.red:T.green}}>{fmt.date(r.renewal_date)}</span>,
              <span style={{color:coiBad?T.red:T.green}}>{r.coi_expires?fmt.date(r.coi_expires):'⛔ none'}</span>,
              <Badge variant={r.status==='active'&&!authExpired?'green':'red'}>{authExpired?'expired':r.status}</Badge>,
            ];
          })}/>
      </Card>
    </>):(<>
      <SectionHeader title="Inspection Appeals" sub="INS-062 — reassigned to a different inspector; decided within 10 business days"/>
      <Card style={{padding:0,overflow:'hidden'}}>
        <DataTable headers={['Inspection','Grounds','Due Date','Status']}
          rows={appeals.map(r=>[<span style={{fontFamily:'monospace',fontSize:11}}>{r.ins_no}</span>,r.grounds||'—',fmt.date(r.due_date),<Badge variant={r.status==='open'?'amber':'green'}>{r.status}</Badge>])}/>
      </Card>
    </>)}

    {modal==='create'&&(
      <Modal title="Open Inspection" onClose={()=>setModal(null)} width={560}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Select label="Inspection Type" value={form.type} onChange={v=>setForm({...form,type:v})} options={[{value:'pre',label:'WE-01 Pre-Inspection'},{value:'post_service',label:'WE-05 Post-Service'},{value:'surveillance',label:'Periodic Surveillance'},{value:'civil_works',label:'WE-07 Civil Works (weighbridge)'},{value:'commissioning',label:'WE-09 Commissioning'}]}/>
          <Select label="Client" value={form.client_id} onChange={v=>setForm({...form,client_id:v})} options={[{value:'',label:'Select client…'},...clients.map(c=>({value:c.id,label:c.name}))]}/>
        </div>
        <Input label="Equipment Serial No." value={form.equipment_serial} onChange={v=>setForm({...form,equipment_serial:v})} placeholder="links to the quarantine / certificate block"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Select label="Assigned Inspector" value={form.inspector_id} onChange={v=>setForm({...form,inspector_id:v})} options={[{value:'',label:'Select inspector…'},...inspectors.map(i=>({value:i.id,label:i.employee_name}))]}/>
          <Select label="Repair Signed By (WE-02)" value={form.repair_by} onChange={v=>setForm({...form,repair_by:v})} options={[{value:'',label:'— none —'},...employees.map(e=>({value:e.id,label:`${e.first_name} ${e.last_name}`}))]}/>
        </div>
        <Alert type="info">If the repair signer is also the inspector, the WE-01 ruling will be blocked (INS-001).</Alert>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={createInspection} disabled={!form.type}>Open Inspection</Btn></div>
      </Modal>
    )}

    {modal==='authorise'&&(
      <Modal title="Authorise Inspector — REG-01" onClose={()=>setModal(null)} width={520}>
        <Alert type="info">INS-011 — only the Quality Manager (or MD) may authorise. Signing rights lapse automatically at the renewal date (INS-013).</Alert>
        <Select label="Employee" value={authForm.employee_id} onChange={v=>setAuthForm({...authForm,employee_id:v})} required options={[{value:'',label:'Select employee…'},...employees.map(e=>({value:e.id,label:`${e.first_name} ${e.last_name}`}))]}/>
        <Input label="Authorisation Scope" value={authForm.scope} onChange={v=>setAuthForm({...authForm,scope:v})} placeholder="e.g. weighbridge, pressure, dimensional"/>
        <Input label="Renewal Date" type="date" value={authForm.renewal_date} onChange={v=>setAuthForm({...authForm,renewal_date:v})} required/>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={authoriseInspector} disabled={!authForm.employee_id}>Authorise</Btn></div>
      </Modal>
    )}

    {detail&&(
      <Modal title={detail.inspection.ins_no} onClose={()=>setDetail(null)} width={620}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
          <div><div style={{fontSize:14,fontWeight:700,color:T.navy}}>{detail.inspection.type} inspection</div><div style={{fontSize:12,color:T.mgrey}}>S/N: {detail.inspection.equipment_serial||'—'} · {detail.inspection.client_name||'—'}</div></div>
          <div>{rulingBadge(detail.inspection.ruling)}</div>
        </div>
        {detail.inspection.status==='quarantined'&&<Alert type="error">⛔ Equipment quarantined — WE-04 NCR open. Calibration certificate issuance is blocked until resolved (INS-023).</Alert>}

        {detail.inspection.ruling==='pending'&&detail.inspection.type!=='civil_works'&&(
          <Card style={{marginBottom:12}}>
            <SectionHeader title="WE-01 Ruling" sub="INS-001 impartiality + INS-002/013 signing rights enforced server-side"/>
            <div style={{display:'flex',gap:8}}><Btn variant="green" onClick={()=>rule(detail.inspection.id,'PASS')}>✅ PASS & Sign</Btn><Btn variant="danger" onClick={()=>rule(detail.inspection.id,'FAIL')}>❌ FAIL (raise NCR)</Btn></div>
          </Card>
        )}

        {detail.holdpoints&&detail.holdpoints.length>0&&(
          <Card style={{marginBottom:12}}>
            <SectionHeader title="WE-07 Civil Works Hold-Points" sub="HP-5 needs dual sign-off (inspector + QM) → unlocks WE-08"/>
            {detail.holdpoints.map(hp=>(
              <div key={hp.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:`1px solid ${T.offwt}`}}>
                <div style={{fontSize:12}}><strong>HP-{hp.hp_no}</strong> {hp.description}{hp.hp_no===5&&hp.inspector_sig&&!hp.qm_sig&&<span style={{color:T.amber,marginLeft:6}}>· awaiting QM</span>}</div>
                {hp.status==='cleared'?<Badge variant="green">cleared</Badge>:<Btn size="sm" onClick={()=>clearHP(hp.id)} disabled={hp.hp_no===5&&hp.inspector_sig&&!isQM}>{hp.hp_no===5&&hp.inspector_sig?(isQM?'QM Sign':'QM only'):'Clear'}</Btn>}
              </div>
            ))}
          </Card>
        )}

        {detail.forms&&detail.forms.length>0&&(
          <Card>
            <SectionHeader title="Forms"/>
            <DataTable headers={['Form','Result','Signed']} rows={detail.forms.map(f=>[f.form_code,f.result||'—',f.sig?'🔐':'—'])}/>
          </Card>
        )}
      </Modal>
    )}
  </div>);
}

// ── BIDS MODULE ───────────────────────────────────────────────────────────────
function BidsModule({ api }) {
  const [bids,setBids]=useState([]);
  const [stats,setStats]=useState(null);
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState(null);
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({name:'',client:'',value:'',deadline:''});
  const [msg,setMsg]=useState(null);
  const load=async()=>{setLoading(true);const r=await api.get('/api/bids?section=list');if(r?.success){setBids(r.data.bids||[]);setStats(r.data.stats);}setLoading(false);};
  const loadDetail=async(id)=>{const r=await api.get(`/api/bids?section=detail&id=${id}`);if(r?.success){setSelected(id);setDetail(r.data);}};
  useEffect(()=>{load();},[]);
  const createBid=async()=>{
    const r=await api.post('/api/bids',{action:'create',...form,value:parseFloat(form.value||0)});
    if(r?.success){setMsg({type:'success',text:`Bid ${r.data.ref_no} created — Stage 2B checklist generated (12 requirements)`});setModal(null);load();}
    else setMsg({type:'error',text:r?.error});
  };
  const updateComp=async(compId,position)=>{
    const r=await api.post('/api/bids',{action:'update_compliance',bid_id:selected,compliance_id:compId,position});
    if(r?.data?.bid_stopped)setMsg({type:'error',text:`🛑 BID STOPPED: ${r.data.stopped_reason}. PSB-004 — mandatory DOES NOT MEET.`});
    else if(r?.success)setMsg({type:'success',text:'Updated'});
    loadDetail(selected);
  };
  const POSITIONS=['MEETS','WILL MEET','DOES NOT MEET','PENDING'];
  const posColor={'MEETS':T.green,'WILL MEET':T.amber,'DOES NOT MEET':T.red,'PENDING':T.mgrey};
  if(selected&&detail){
    const bid=detail.bid;
    return(<div>
      <button onClick={()=>{setSelected(null);setDetail(null);}} style={{background:'none',border:'none',color:T.navy,cursor:'pointer',fontSize:13,fontWeight:600,marginBottom:14}}>← Back to Bids</button>
      {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
      {bid.stopped&&<Alert type="error">🛑 BID STOPPED — PSB-004: Mandatory requirement DOES NOT MEET. Reason: {bid.stopped_reason}</Alert>}
      <Card style={{marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
          <div><div style={{fontSize:16,fontWeight:800,color:T.navy}}>{bid.name}</div><div style={{fontSize:12,color:T.mgrey}}>{bid.client}</div></div>
          <div style={{textAlign:'right'}}><Badge variant={bid.stopped?'red':bid.stage2b_status==='clear'?'green':'blue'}>{bid.stopped?'STOPPED':bid.stage}</Badge><div style={{fontSize:13,fontWeight:700,color:T.navy,marginTop:6}}>{fmt.kes(bid.value)}</div></div>
        </div>
      </Card>
      <Card>
        <SectionHeader title="Stage 2B Compliance Matrix — CSE-001 to CSE-012"/>
        <Alert type="warning">PSB-004: DOES NOT MEET on any mandatory item = immediate automatic STOP. Cannot be bypassed.</Alert>
        {(detail.compliance||[]).map(c=>(
          <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 12px',marginBottom:8,borderRadius:8,background:c.position==='MEETS'?T.greenL:c.position==='DOES NOT MEET'?T.redL:c.position==='WILL MEET'?T.amberL:T.offwt}}>
            <div style={{flex:1,marginRight:12}}><div style={{fontSize:12,fontWeight:600}}>{c.requirement}</div><Badge variant={c.type==='mandatory'?'red':c.type==='scored'?'blue':'amber'} style={{marginTop:4}}>{c.type}</Badge></div>
            <div style={{display:'flex',gap:4}}>
              {POSITIONS.map(p=>(
                <button key={p} onClick={()=>updateComp(c.id,p)} style={{padding:'3px 7px',borderRadius:5,fontSize:10,fontWeight:600,border:`1px solid ${c.position===p?posColor[p]:T.lgrey}`,background:c.position===p?(p==='MEETS'?T.green:p==='DOES NOT MEET'?T.red:p==='WILL MEET'?T.amber:T.lgrey):T.white,color:c.position===p?T.white:T.mgrey,cursor:'pointer'}}>{p}</button>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>);
  }
  return(<div>
    {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
    <Alert type="error">PSB-004: Stage 2B gate enforced. DOES NOT MEET on any mandatory = auto-STOP. No bypass possible.</Alert>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:16}}>
      <Stat label="Total Bids" value={stats?.total||bids.length} icon="📋"/>
      <Stat label="Pipeline" value={fmt.kes(stats?.total_value||bids.reduce((s,b)=>s+(b.value||0),0))} icon="💼"/>
      <Stat label="Stage 2B Clear" value={stats?.clear||0} icon="✅" variant="green"/>
      <Stat label="Stopped" value={stats?.stopped||bids.filter(b=>b.stopped).length} icon="🛑" variant="red"/>
    </div>
    <SectionHeader title="Bid Pipeline" action={<Btn onClick={()=>setModal('bid')}>+ New Bid</Btn>}/>
    {loading?<Loading/>:(
      <Card style={{padding:0,overflow:'hidden'}}>
        <DataTable headers={['Ref','Bid Name','Client','Value','Stage','Compliance','Deadline','Action']}
          rows={bids.map(b=>[
            <span style={{fontFamily:'monospace',fontSize:11,color:T.mgrey}}>{b.ref_no}</span>,
            <div style={{maxWidth:180}}><strong style={{fontSize:12}}>{b.name}</strong></div>,
            <span style={{fontSize:11}}>{b.client||'—'}</span>,
            <strong>{fmt.kes(b.value)}</strong>,
            <Badge variant={b.stopped?'red':b.stage2b_status==='clear'?'green':'amber'}>{b.stopped?'STOPPED':b.stage?.replace('_',' ')}</Badge>,
            <Badge variant={b.compliance_clear?'green':b.stopped?'red':'default'}>{b.compliance_clear?'✅ CLEAR':b.stopped?'🛑 STOP':'⏳ Pending'}</Badge>,
            fmt.date(b.deadline),
            <Btn size="sm" variant="ghost" onClick={()=>loadDetail(b.id)}>Stage 2B</Btn>,
          ])}
        />
      </Card>
    )}
    {modal==='bid'&&(
      <Modal title="New Bid" onClose={()=>setModal(null)}>
        <Alert type="info">12-requirement Stage 2B checklist auto-generated on creation.</Alert>
        <Input label="Bid Name" value={form.name} onChange={v=>setForm({...form,name:v})} required/>
        <Input label="Procuring Entity" value={form.client} onChange={v=>setForm({...form,client:v})} required/>
        <Input label="Estimated Value (Kshs)" value={form.value} onChange={v=>setForm({...form,value:v})} type="number"/>
        <Input label="Submission Deadline" value={form.deadline} onChange={v=>setForm({...form,deadline:v})} type="date"/>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={createBid} disabled={!form.name}>Create + Generate Checklist</Btn></div>
      </Modal>
    )}
  </div>);
}

// ── INTER-COMPANY MODULE ──────────────────────────────────────────────────────
function ICModule({ api }) {
  const [data,setData]=useState({totals:null,transactions:[]});
  const [entities,setEntities]=useState([]);
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({entity_id:'',type:'management_fee',contract_value:'',fee_pct:'5',icsa_verified:false,notes:''});
  const [msg,setMsg]=useState(null);
  useEffect(()=>{
    setLoading(true);
    Promise.all([api.get('/api/ic?section=transactions'),api.get('/api/ic?section=entities')]).then(([t,e])=>{
      if(t?.success)setData(t.data);if(e?.success)setEntities(e.data);setLoading(false);
    });
  },[]);
  const createTx=async()=>{
    if(!form.entity_id||!form.contract_value||!form.fee_pct)return;
    if(!form.icsa_verified){setMsg({type:'error',text:'ICM-002: ICSA must be verified before creating transaction'});return;}
    const r=await api.post('/api/ic',{action:'create_transaction',...form,contract_value:parseFloat(form.contract_value)});
    if(r?.success){setMsg({type:'success',text:`IC transaction created — Fee: ${fmt.kes(r.data.fee_amount)}`});setModal(null);const t2=await api.get('/api/ic?section=transactions');if(t2?.success)setData(t2.data);}
    else setMsg({type:'error',text:r?.error});
  };
  const min=form.type==='management_fee'?5:3;
  return(<div>
    {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
    <Alert type="warning">ICM-002/003: No IC transaction without signed ICSA. Min 5% management fee / 3% accreditation licence enforced.</Alert>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
      <Stat label="Total IC Fees" value={fmt.kes(data.totals?.total_fees||0)} icon="🔗"/>
      <Stat label="Collected" value={fmt.kes(data.totals?.total_collected||0)} icon="✅" variant="green"/>
      <Stat label="Outstanding" value={fmt.kes(data.totals?.outstanding||0)} icon="⏳" variant="amber"/>
      <Stat label="Transactions" value={data.totals?.count||data.transactions.length} icon="📊"/>
    </div>
    <SectionHeader title="IC Transaction Register" action={<Btn onClick={()=>setModal('tx')}>+ New IC Transaction</Btn>}/>
    {loading?<Loading/>:(
      <Card style={{padding:0,overflow:'hidden'}}>
        <DataTable headers={['Sister Company','Type','Contract Value','QSL Fee','Min Required','Collected','Outstanding','Status']}
          rows={data.transactions.map(tx=>{
            const minFee=tx.contract_value*(tx.type==='management_fee'?0.05:0.03);
            return[
              <strong style={{fontSize:12}}>{tx.entity_name}</strong>,
              <Badge variant={tx.type==='management_fee'?'blue':'purple'}>{tx.type==='management_fee'?'Management Fee':'Accreditation Licence'}</Badge>,
              fmt.kes(tx.contract_value),
              <strong style={{color:tx.fee_amount<minFee?T.red:T.navy}}>{fmt.kes(tx.fee_amount)}</strong>,
              <span style={{fontSize:11,color:T.mgrey}}>{fmt.kes(minFee)} ({tx.type==='management_fee'?'5%':'3%'})</span>,
              <span style={{color:T.green}}>{fmt.kes(tx.collected||0)}</span>,
              <strong style={{color:(tx.fee_amount-(tx.collected||0))>0?T.amber:T.green}}>{fmt.kes(tx.fee_amount-(tx.collected||0))}</strong>,
              <Badge variant={tx.status==='settled'?'green':tx.status==='partial'?'amber':'red'}>{tx.status}</Badge>,
            ];
          })}
        />
      </Card>
    )}
    {modal==='tx'&&(
      <Modal title="New IC Transaction — ICM-002/003" onClose={()=>setModal(null)}>
        <Alert type="error">ICM-002: ICSA must be on file. ICM-003: Min {form.type==='management_fee'?'5%':'3%'} fee enforced.</Alert>
        <Select label="Sister Company" value={form.entity_id} onChange={v=>setForm({...form,entity_id:v})} required options={[{value:'',label:'Select entity…'},...entities.map(e=>({value:e.id,label:`${e.name} (${e.type})`}))]}/>
        <Select label="Transaction Type" value={form.type} onChange={v=>setForm({...form,type:v,fee_pct:v==='management_fee'?'5':'3'})} options={[{value:'management_fee',label:'Management Fee (min 5%)'},{value:'accreditation_licence',label:'Accreditation Licence (min 3%)'}]}/>
        <Input label="Contract Value (Kshs)" value={form.contract_value} onChange={v=>setForm({...form,contract_value:v})} type="number" required/>
        <Input label={`Fee % (minimum ${min}%)`} value={form.fee_pct} onChange={v=>setForm({...form,fee_pct:v})} type="number" required note={parseFloat(form.fee_pct)<min?`⚠️ Below minimum ${min}% — system will reject`:form.contract_value?`Fee: ${fmt.kes(parseFloat(form.contract_value||0)*(parseFloat(form.fee_pct||0)/100))}`:''}/>
        <div style={{padding:'10px 12px',background:form.icsa_verified?T.greenL:T.amberL,borderRadius:7,marginBottom:14}}>
          <label style={{display:'flex',gap:10,alignItems:'center',cursor:'pointer',fontSize:12}}>
            <input type="checkbox" checked={form.icsa_verified} onChange={e=>setForm({...form,icsa_verified:e.target.checked})}/>
            <span style={{fontWeight:600,color:form.icsa_verified?T.green:T.amber}}>{form.icsa_verified?'✅ ICSA verified and on file':'⚠️ Confirm signed ICSA is on file (ICM-002 — mandatory)'}</span>
          </label>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={createTx} disabled={!form.entity_id||!form.contract_value||!form.icsa_verified}>Create Transaction</Btn></div>
      </Modal>
    )}
  </div>);
}

// ── COMPLIANCE MODULE ─────────────────────────────────────────────────────────
function ComplianceModule({ api }) {
  const [tab,setTab]=useState('certificates');
  const [docs,setDocs]=useState([]);
  const [calendar,setCalendar]=useState([]);
  const [tasks,setTasks]=useState([]);
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [taskForm,setTaskForm]=useState({title:'',assignee_id:'',due_date:'',priority:'high',module:'Compliance'});
  const [employees,setEmployees]=useState([]);
  const [msg,setMsg]=useState(null);
  const load=async(t=tab)=>{
    setLoading(true);
    if(t==='certificates'){const r=await api.get('/api/compliance?section=docs');if(r?.success)setDocs(r.data);}
    if(t==='calendar'){const r=await api.get('/api/compliance?section=calendar');if(r?.success)setCalendar(r.data);}
    if(t==='tasks'){const r=await api.get('/api/compliance?section=tasks');if(r?.success)setTasks(r.data);}
    setLoading(false);
  };
  useEffect(()=>{load();api.get('/api/hr?section=employees').then(r=>{if(r?.success)setEmployees(r.data);});},[tab]);
  const createTask=async()=>{
    const r=await api.post('/api/compliance',{action:'create_task',...taskForm});
    if(r?.success){setMsg({type:'success',text:'Task created'});setModal(null);load('tasks');}
    else setMsg({type:'error',text:r?.error});
  };
  const completeTask=async(id)=>{await api.post('/api/compliance',{action:'complete_task',task_id:id});setMsg({type:'success',text:'Task completed'});load('tasks');};
  return(<div>
    {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
    <Tabs tabs={[{id:'certificates',label:'Certificates'},{id:'calendar',label:'Statutory Calendar'},{id:'tasks',label:'Tasks'}]} active={tab} setActive={t=>setTab(t)}/>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
      <Stat label="Certificates" value={docs.length} icon="📄"/>
      <Stat label="Current" value={docs.filter(d=>d.status==='current').length} icon="✅" variant="green"/>
      <Stat label="Expiring ≤60 Days" value={docs.filter(d=>d.expires_at&&new Date(d.expires_at)<new Date(Date.now()+60*86400000)).length} icon="⚠️" variant="amber"/>
      <Stat label="Open Tasks" value={tasks.filter(t=>t.status!=='completed').length} icon="☑️" variant={tasks.filter(t=>t.status!=='completed').length>0?'amber':'green'}/>
    </div>
    {loading?<Loading/>:(
      tab==='certificates'?(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Certificate','Responsible','Expiry','Days Left','Status','Action']}
            rows={docs.map(d=>{
              const days=d.expires_at&&d.expires_at!=='N/A'?Math.round((new Date(d.expires_at)-new Date())/86400000):null;
              return[
                <div><strong style={{fontSize:12}}>{d.name}</strong><div style={{fontSize:10,color:T.mgrey}}>{d.type}</div></div>,
                d.responsible_name||'—',d.expires_at||'Permanent',
                days!==null?<span style={{fontWeight:700,color:days<0?T.red:days<30?T.red:days<60?T.amber:T.green}}>{days<0?`${Math.abs(days)}d expired`:`${days}d`}</span>:<span style={{color:T.mgrey}}>—</span>,
                <Badge variant={d.status==='current'?(days!==null&&days<60?'amber':'green'):'red'}>{d.status}</Badge>,
                days!==null&&days<60?<Btn size="sm" variant="gold" onClick={()=>api.post('/api/compliance',{action:'renew_cert',doc_id:d.id,new_expiry:new Date(Date.now()+365*86400000).toISOString().split('T')[0]}).then(()=>load('certificates'))}>Renew</Btn>:<Btn size="sm" variant="ghost">View</Btn>,
              ];
            })}
          />
        </Card>
      ):tab==='calendar'?(
        <Card style={{padding:0,overflow:'hidden'}}>
          <DataTable headers={['Obligation','Agency','Next Due','Frequency','Penalty']}
            rows={calendar.map(o=>[<strong style={{fontSize:12}}>{o.name}</strong>,<Badge variant="navy">{o.agency}</Badge>,<span style={{fontWeight:600,color:T.navy}}>{o.next_due||'Annual'}</span>,o.frequency,<span style={{fontSize:11,color:T.red}}>5% of tax + 2% p.m. interest</span>])}
          />
        </Card>
      ):(
        <>
          <SectionHeader title="Compliance Tasks" action={<Btn onClick={()=>setModal('task')}>+ New Task</Btn>}/>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {tasks.map(t=>{
              const days=Math.round((new Date(t.due_date)-new Date())/86400000);
              const isOv=days<0&&t.status!=='completed';
              return(<Card key={t.id} style={{border:`1px solid ${isOv?T.red:T.lgrey}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                  <div style={{flex:1}}><div style={{display:'flex',gap:8,marginBottom:6}}><Badge variant={t.priority==='critical'?'red':t.priority==='high'?'amber':'blue'}>{t.priority}</Badge><Badge variant="navy">{t.module||'General'}</Badge></div><div style={{fontSize:14,fontWeight:600,color:T.navy}}>{t.title}</div><div style={{fontSize:12,color:T.mgrey,marginTop:3}}>Assigned to: {t.assignee_name}</div></div>
                  <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:12,fontWeight:700,color:isOv?T.red:T.green}}>{isOv?`${Math.abs(days)}d overdue`:`${days}d left`}</div>{t.status!=='completed'&&<Btn size="sm" variant="green" onClick={()=>completeTask(t.id)} style={{marginTop:8}}>✓ Done</Btn>}</div>
                </div>
              </Card>);
            })}
            {tasks.length===0&&<Card><p style={{color:T.mgrey,textAlign:'center',padding:30}}>No tasks. Create compliance tasks to track regulatory obligations.</p></Card>}
          </div>
        </>
      )
    )}
    {modal==='task'&&(
      <Modal title="New Compliance Task" onClose={()=>setModal(null)}>
        <Input label="Task Title" value={taskForm.title} onChange={v=>setTaskForm({...taskForm,title:v})} required/>
        <Select label="Assign To" value={taskForm.assignee_id} onChange={v=>setTaskForm({...taskForm,assignee_id:v})} required options={[{value:'',label:'Select…'},...employees.map(e=>({value:e.id,label:`${e.first_name} ${e.last_name} — ${e.department}`}))]}/>
        <Input label="Due Date" value={taskForm.due_date} onChange={v=>setTaskForm({...taskForm,due_date:v})} type="date" required/>
        <Select label="Priority" value={taskForm.priority} onChange={v=>setTaskForm({...taskForm,priority:v})} options={['critical','high','medium','low'].map(p=>({value:p,label:p.charAt(0).toUpperCase()+p.slice(1)}))}/>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn><Btn onClick={createTask} disabled={!taskForm.title||!taskForm.assignee_id||!taskForm.due_date}>Create Task</Btn></div>
      </Modal>
    )}
  </div>);
}

// ── TASKS MODULE ──────────────────────────────────────────────────────────────
function TasksModule({ api }) {
  const [tasks,setTasks]=useState([]);
  const [filter,setFilter]=useState('all');
  const [loading,setLoading]=useState(false);
  const [modal,setModal]=useState(false);
  const [form,setForm]=useState({title:'',assignee_id:'',due_date:'',priority:'high',module:'General'});
  const [employees,setEmployees]=useState([]);
  const [msg,setMsg]=useState(null);
  const load=async()=>{setLoading(true);const url=filter==='all'?'/api/tasks':`/api/tasks?filter=${filter}`;const r=await api.get(url);if(r?.success)setTasks(r.data);setLoading(false);};
  useEffect(()=>{load();},[filter]);
  useEffect(()=>{api.get('/api/hr?section=employees').then(r=>{if(r?.success)setEmployees(r.data);});},[]);
  const create=async()=>{
    if(!form.title||!form.assignee_id||!form.due_date)return;
    const r=await api.post('/api/tasks',{action:'create',...form});
    if(r?.success){setMsg({type:'success',text:'Task created'});setModal(false);load();}
    else setMsg({type:'error',text:r?.error});
  };
  const complete=async(id)=>{await api.post('/api/tasks',{action:'complete',task_id:id});load();};
  return(<div>
    {msg&&<Alert type={msg.type}>{msg.text}</Alert>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
      <Stat label="Total" value={tasks.length} icon="☑️"/>
      <Stat label="Overdue" value={tasks.filter(t=>t.status!=='completed'&&new Date(t.due_date)<new Date()).length} icon="🔴" variant="red"/>
      <Stat label="Critical" value={tasks.filter(t=>t.priority==='critical').length} icon="⚡" variant="amber"/>
      <Stat label="Completed" value={tasks.filter(t=>t.status==='completed').length} icon="✅" variant="green"/>
    </div>
    <div style={{display:'flex',gap:8,marginBottom:18,flexWrap:'wrap'}}>
      {['all','pending','overdue','critical'].map(f=><Btn key={f} variant={filter===f?'primary':'ghost'} size="sm" onClick={()=>setFilter(f)}>{f.charAt(0).toUpperCase()+f.slice(1)}</Btn>)}
      <div style={{flex:1}}/><Btn onClick={()=>setModal(true)}>+ New Task</Btn>
    </div>
    {loading?<Loading/>:(
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {tasks.map(t=>{
          const days=Math.round((new Date(t.due_date)-new Date())/86400000);
          const isOv=days<0&&t.status!=='completed';
          return(<Card key={t.id} style={{border:`1px solid ${isOv?T.red:t.priority==='critical'&&days<2?T.amber:T.lgrey}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
              <div style={{flex:1}}>
                <div style={{display:'flex',gap:8,marginBottom:6}}>
                  <Badge variant={t.priority==='critical'?'red':t.priority==='high'?'amber':'blue'}>{t.priority}</Badge>
                  {t.module&&<Badge variant="navy">{t.module}</Badge>}
                  <Badge variant={t.status==='completed'?'green':isOv?'red':'default'}>{t.status}</Badge>
                </div>
                <div style={{fontSize:14,fontWeight:600,color:T.navy}}>{t.title}</div>
                <div style={{fontSize:11,color:T.mgrey,marginTop:3}}>Assigned to: <strong>{t.assignee_name||'—'}</strong></div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:12,fontWeight:700,color:isOv?T.red:days===0?T.amber:T.green}}>{isOv?`${Math.abs(days)}d overdue`:days===0?'Due today':`${days}d`}</div>
                <div style={{fontSize:11,color:T.mgrey}}>Due: {fmt.date(t.due_date)}</div>
                {t.status!=='completed'&&<Btn size="sm" variant="green" onClick={()=>complete(t.id)} style={{marginTop:8}}>✓ Done</Btn>}
              </div>
            </div>
          </Card>);
        })}
        {tasks.length===0&&<Card><p style={{color:T.mgrey,textAlign:'center',padding:40}}>No tasks found.</p></Card>}
      </div>
    )}
    {modal&&(
      <Modal title="New Task" onClose={()=>setModal(false)}>
        <Input label="Title" value={form.title} onChange={v=>setForm({...form,title:v})} required placeholder="Clear, actionable task"/>
        <Select label="Assign To" value={form.assignee_id} onChange={v=>setForm({...form,assignee_id:v})} required options={[{value:'',label:'Select…'},...employees.map(e=>({value:e.id,label:`${e.first_name} ${e.last_name} — ${e.department}`}))]}/>
        <Input label="Due Date" value={form.due_date} onChange={v=>setForm({...form,due_date:v})} type="date" required/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <Select label="Priority" value={form.priority} onChange={v=>setForm({...form,priority:v})} options={['critical','high','medium','low'].map(p=>({value:p,label:p.charAt(0).toUpperCase()+p.slice(1)}))}/>
          <Select label="Module" value={form.module} onChange={v=>setForm({...form,module:v})} options={['Finance','Projects','Compliance','HR','Procurement','Fleet','HSE','General'].map(m=>({value:m,label:m}))}/>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><Btn variant="ghost" onClick={()=>setModal(false)}>Cancel</Btn><Btn onClick={create} disabled={!form.title||!form.assignee_id||!form.due_date}>Create Task</Btn></div>
      </Modal>
    )}
  </div>);
}

// ── SETTINGS MODULE ───────────────────────────────────────────────────────────
function Settings({ api, user }) {
  const [sigModal,setSigModal]=useState(null);
  const [verifying,setVerifying]=useState(false);
  const [verified,setVerified]=useState(null);
  const [mfaModal,setMfaModal]=useState(null);
  const [mfaQR,setMfaQR]=useState(null);
  const [mfaToken,setMfaToken]=useState('');
  const [mfaStep,setMfaStep]=useState(0);
  const [schedulerJobs,setSchedulerJobs]=useState([]);
  const [backups,setBackups]=useState([]);
  const [schedulerMsg,setSchedulerMsg]=useState(null);
  const [settingsTab,setSettingsTab]=useState('signatures');
  const [auditLog,setAuditLog]=useState([]);
  const [auditScope,setAuditScope]=useState('own_activity_only');
  const [auditLoading,setAuditLoading]=useState(false);

  const loadAuditLog = async () => {
    setAuditLoading(true);
    const r = await api.get('/api/admin?section=audit_log&limit=100');
    if(r?.success){ setAuditLog(r.data.rows); setAuditScope(r.data.scope); }
    setAuditLoading(false);
  };
  useEffect(()=>{ if(settingsTab==='audit') loadAuditLog(); }, [settingsTab]);
  const [branding,setBranding]=useState({logo_url:null,primary_color:'#0B2545',font_family:'system-ui',company_display_name:'QSL ERP'});
  const [brandingMsg,setBrandingMsg]=useState(null);
  const [brandingSaving,setBrandingSaving]=useState(false);
  const [logoFile,setLogoFile]=useState(null);

  const loadBranding = async () => {
    const r = await api.get('/api/branding');
    if(r?.success) setBranding(r.data);
  };
  useEffect(()=>{ if(settingsTab==='branding') loadBranding(); }, [settingsTab]);

  const saveBrandingSetting = async (key, value) => {
    setBrandingSaving(true);
    const r = await api.post('/api/admin', {action:'update_setting', key:`branding.${key}`, value});
    setBrandingSaving(false);
    if(r?.success){ setBrandingMsg({type:'success',text:'Saved.'}); setBranding({...branding,[key]:value}); }
    else setBrandingMsg({type:'error',text:r?.error||'Failed to save'});
  };

  // Store the logo as a data URL in the branding.logo_url setting. The app has
  // no /uploads file server (Next only serves /public), so a data URL is the
  // reliable, persistent way to set a custom logo — it renders directly in an
  // <img> and survives in the DB across restarts.
  const uploadLogo = async () => {
    if(!logoFile){ setBrandingMsg({type:'error',text:'Choose a logo file first'}); return; }
    if(logoFile.size > 512*1024){ setBrandingMsg({type:'error',text:'Logo must be under 500 KB — use an SVG or a small PNG'}); return; }
    setBrandingSaving(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const r = await api.post('/api/admin', {action:'update_setting', key:'branding.logo_url', value:dataUrl});
      setBrandingSaving(false);
      if(r?.success){ setBrandingMsg({type:'success',text:'Logo updated — reload to see it in the sidebar.'}); setBranding({...branding,logo_url:dataUrl}); setLogoFile(null); }
      else setBrandingMsg({type:'error',text:r?.error||'Save failed'});
    };
    reader.onerror = () => { setBrandingSaving(false); setBrandingMsg({type:'error',text:'Could not read file'}); };
    reader.readAsDataURL(logoFile);
  };
  const resetLogo = async () => {
    const r = await api.post('/api/admin', {action:'update_setting', key:'branding.logo_url', value:'/logo.svg'});
    if(r?.success){ setBrandingMsg({type:'success',text:'Logo reset to the default QSL mark.'}); setBranding({...branding,logo_url:'/logo.svg'}); }
  };

  const verify = async (keyId) => {
    setVerifying(true);
    const r=await api.post('/api/auth',{action:'verify_signature',key_id:keyId});
    setVerifying(false);
    setVerified(r?.data||null);
  };

  const setupMFA = async () => {
    const r=await api.post('/api/auth',{action:'setup_mfa',user_id:user?.id});
    if(r?.success){setMfaQR(r.data.qr_code);setMfaStep(1);setMfaModal(true);}
  };
  const confirmMFA = async () => {
    const r=await api.post('/api/auth',{action:'confirm_mfa',user_id:user?.id,token:mfaToken});
    if(r?.success){setMfaStep(2);}else alert(r?.error||'Invalid code');
  };
  const loadScheduler = async () => {
    const r=await api.get('/api/scheduler?section=status');
    if(r?.success)setSchedulerJobs(r.data.jobs||[]);
    const b=await api.get('/api/scheduler?section=backup_list');
    if(b?.success)setBackups(b.data||[]);
  };
  const triggerJob = async (jobId) => {
    setSchedulerMsg(null);
    const r=await api.post('/api/scheduler',{job:jobId});
    if(r?.success)setSchedulerMsg({type:'success',text:r.data.message});
    else setSchedulerMsg({type:'error',text:r?.error||'Failed'});
  };

  useState(()=>{if(settingsTab==='scheduler')loadScheduler();},[settingsTab]);

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:18}}>
        <Stat label="Active Users" value="8" icon="👥"/>
        <Stat label="Digital Signatures" value="8 Active" icon="🔐" variant="green"/>
        <Stat label="Audit Trail" value="Immutable" icon="📋" variant="blue"/>
        <Stat label="MFA" value={user?.mfa_enabled?'Enabled':'Optional'} icon="🛡️" variant={user?.mfa_enabled?'green':'amber'}/>
      </div>
      <Tabs tabs={[{id:'signatures',label:'Digital Signatures'},{id:'mfa',label:'MFA Setup'},{id:'branding',label:'Branding'},{id:'audit',label:'Audit Log'},{id:'scheduler',label:'Scheduler & Backups'},{id:'api',label:'API Reference'}]} active={settingsTab} setActive={setSettingsTab}/>
      {schedulerMsg&&<Alert type={schedulerMsg.type}>{schedulerMsg.text}</Alert>}

      {settingsTab==='signatures'&&(<>
        <Alert type="info">ARCH-007B: Each staff member has a unique RSA-2048 digital signature. Auto-applied on all approvals. Revoked within 2 hours of separation.</Alert>
        <Card>
          <SectionHeader title="Digital Signature Registry"/>
          <DataTable headers={['Staff','Key ID','Issued','Status','Action']}
            rows={(user?[{...user,signature_key:user.signature_key||'QSL-DS-HA-2024'}]:[]).map(u=>[
              <strong>{u.name}</strong>,
              <span style={{fontFamily:'monospace',fontSize:11}}>{u.signature_key||'—'}</span>,
              fmt.date('2024-01-15'),
              <Badge variant="green">Active</Badge>,
              <Btn size="sm" onClick={()=>{setSigModal(u.signature_key);verify(u.signature_key);}}>Verify</Btn>,
            ])}
          />
        </Card>
      </>)}

      {settingsTab==='mfa'&&(<>
        <Alert type="warning">ICT-009: MFA mandatory for MD, CFO, and Finance Manager accounts. All other staff strongly recommended to enable it.</Alert>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <Card>
            <SectionHeader title="Your MFA Status"/>
            <div style={{padding:'20px',textAlign:'center'}}>
              <div style={{fontSize:44,marginBottom:12}}>🛡️</div>
              <div style={{fontSize:16,fontWeight:700,color:T.navy,marginBottom:8}}>{user?.mfa_enabled?'MFA Active':'MFA Not Enabled'}</div>
              <Badge variant={user?.mfa_enabled?'green':'amber'}>{user?.mfa_enabled?'Protected':'Recommended'}</Badge>
              {!user?.mfa_enabled&&<div style={{marginTop:16}}>
                <p style={{fontSize:12,color:T.mgrey,marginBottom:12}}>Set up Google Authenticator, Authy, or Microsoft Authenticator to protect your account.</p>
                <Btn onClick={setupMFA} style={{width:'100%'}}>Set Up MFA Now</Btn>
              </div>}
              {user?.mfa_enabled&&<div style={{marginTop:16}}><p style={{fontSize:12,color:T.green}}>✅ Your account is protected with TOTP-based MFA.</p></div>}
            </div>
          </Card>
          <Card>
            <SectionHeader title="MFA Policy (ICT-009)"/>
            {[['Managing Director','Required'],['CFO / Finance Manager','Required'],['HR Manager','Required'],['ICT Head','Required'],['Project Managers','Recommended'],['All Other Staff','Optional but encouraged']].map(([role,req])=>(
              <div key={role} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${T.lgrey}`}}>
                <span style={{fontSize:12,fontWeight:600}}>{role}</span>
                <Badge variant={req==='Required'?'red':'amber'}>{req}</Badge>
              </div>
            ))}
          </Card>
        </div>
      </>)}

      {settingsTab==='branding'&&(<>
        <Alert type="info">Logo, color theme, and font shown across the app — login screen, sidebar, and the public landing page. This does not change letterhead details on invoices/PDFs (KRA PIN, bank account) — those are managed under Admin → Companies.</Alert>
        {brandingMsg&&<Alert type={brandingMsg.type}>{brandingMsg.text}</Alert>}

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
          <Card>
            <SectionHeader title="Logo" sub="Shown in the sidebar & login — both on a dark background, so a light/gold logo works best. SVG or PNG, under 500 KB."/>
            {branding.logo_url&&(
              <div style={{padding:'16px',background:T.navyD,borderRadius:8,marginBottom:12,textAlign:'center'}}>
                <img src={branding.logo_url} alt="Current logo" style={{maxHeight:60,maxWidth:'100%'}}/>
              </div>
            )}
            <input type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" onChange={e=>setLogoFile(e.target.files?.[0]||null)} style={{fontSize:12,marginBottom:10,display:'block'}}/>
            <div style={{display:'flex',gap:8}}>
              <Btn size="sm" disabled={!logoFile||brandingSaving} onClick={uploadLogo}>{brandingSaving?'Saving…':'Update Logo'}</Btn>
              <Btn size="sm" variant="ghost" disabled={brandingSaving} onClick={resetLogo}>Reset to default</Btn>
            </div>

            <div style={{marginTop:20}}>
              <Input label="Company Display Name" value={branding.company_display_name||''} onChange={v=>setBranding({...branding,company_display_name:v})}/>
              <Btn size="sm" variant="ghost" disabled={brandingSaving} onClick={()=>saveBrandingSetting('company_display_name',branding.company_display_name)}>Save Name</Btn>
            </div>
          </Card>

          <Card>
            <SectionHeader title="Theme"/>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:600,color:T.navy,marginBottom:6}}>Primary Color</div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <input type="color" value={branding.primary_color} onChange={e=>setBranding({...branding,primary_color:e.target.value})} style={{width:44,height:32,padding:0,border:`1px solid ${T.lgrey}`,borderRadius:4}}/>
                <Input value={branding.primary_color} onChange={v=>setBranding({...branding,primary_color:v})}/>
              </div>
              <Btn size="sm" variant="ghost" disabled={brandingSaving} onClick={()=>saveBrandingSetting('primary_color',branding.primary_color)} style={{marginTop:8}}>Save Color</Btn>
            </div>

            <div>
              <Select label="Font" value={branding.font_family} onChange={v=>setBranding({...branding,font_family:v})}
                options={[
                  {value:'system-ui',label:'System Default'},
                  {value:'Georgia, serif',label:'Georgia (Serif)'},
                  {value:'\'Helvetica Neue\', Arial, sans-serif',label:'Helvetica (Sans)'},
                  {value:'\'Courier New\', monospace',label:'Courier (Monospace)'},
                ]}/>
              <Btn size="sm" variant="ghost" disabled={brandingSaving} onClick={()=>saveBrandingSetting('font_family',branding.font_family)} style={{marginTop:8}}>Save Font</Btn>
            </div>

            <div style={{marginTop:20,padding:16,borderRadius:8,border:`1px solid ${T.lgrey}`,background:T.offwt}}>
              <div style={{fontSize:11,color:T.mgrey,marginBottom:8}}>Live Preview</div>
              <div style={{fontFamily:branding.font_family,display:'flex',alignItems:'center',gap:10}}>
                {branding.logo_url&&<img src={branding.logo_url} alt="" style={{height:28}}/>}
                <strong style={{color:branding.primary_color,fontSize:16}}>{branding.company_display_name||'QSL ERP'}</strong>
              </div>
            </div>
          </Card>
        </div>
      </>)}

      {settingsTab==='audit'&&(<>
        <Alert type="info">
          {auditScope==='all_users'
            ? 'You are viewing activity for all users — visible to MD and Admin roles only.'
            : 'You are viewing your own activity only. Full cross-user audit history is restricted to MD and Admin roles.'}
        </Alert>
        {auditLoading?<Loading/>:(
          <Card style={{padding:0,overflow:'hidden'}}>
            <DataTable headers={auditScope==='all_users'?['When','User','Module','Action','Record']:['When','Module','Action','Record']} empty="No activity recorded yet."
              rows={auditLog.map(a=>auditScope==='all_users'?[
                fmt.date(a.created_at), a.user_name, <Badge variant="navy">{a.module}</Badge>, a.action, a.record_id?.slice(0,8)||'—',
              ]:[
                fmt.date(a.created_at), <Badge variant="navy">{a.module}</Badge>, a.action, a.record_id?.slice(0,8)||'—',
              ])}
            />
          </Card>
        )}
      </>)}

      {settingsTab==='scheduler'&&(<>
        <Alert type="info">All jobs run on <strong>Africa/Nairobi (EAT)</strong> timezone. Client-facing reminders are sent daily — escalation level is automatic based on days overdue.</Alert>

        {/* Client-facing jobs highlighted */}
        <Card style={{marginBottom:16,border:`2px solid ${T.gold}`,background:'#FFFBEB'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div><div style={{fontSize:14,fontWeight:800,color:T.navy}}>📧 Client-Facing Daily Reminders</div><div style={{fontSize:11,color:T.mgrey}}>These emails go directly to clients every day until overdue amounts are settled</div></div>
            <Btn size="sm" variant="ghost" onClick={loadScheduler}>Refresh</Btn>
          </div>
          {schedulerJobs.filter(j=>j.category==='client').map(j=>(
            <div key={j.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',marginBottom:8,background:T.white,borderRadius:8,border:`1px solid ${T.lgrey}`}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:T.navy}}>{j.name}</div>
                <div style={{fontSize:11,color:T.mgrey,marginTop:2}}>{j.schedule} · Auto-escalates: Friendly → Formal → Final → Legal</div>
              </div>
              <Btn size="sm" variant="gold" onClick={()=>triggerJob(j.id)}>▶ Run Now</Btn>
            </div>
          ))}
          {schedulerJobs.filter(j=>j.category==='client').length===0&&(
            <Btn onClick={loadScheduler} variant="ghost" style={{width:'100%'}}>Load Jobs</Btn>
          )}
        </Card>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <Card>
            <SectionHeader title="Internal & System Jobs"/>
            {schedulerJobs.filter(j=>j.category!=='client').map(j=>(
              <div key={j.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:`1px solid ${T.lgrey}`}}>
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:T.navy}}>{j.name}</div>
                  <div style={{fontSize:10,color:T.mgrey}}>{j.schedule}</div>
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <Badge variant={j.category==='system'?'blue':'amber'}>{j.category}</Badge>
                  <Btn size="sm" variant="ghost" onClick={()=>triggerJob(j.id)}>▶</Btn>
                </div>
              </div>
            ))}
            {schedulerJobs.length===0&&<Btn onClick={loadScheduler} variant="ghost" style={{width:'100%'}}>Load Jobs</Btn>}
          </Card>
          <Card>
            <SectionHeader title="Database Backups" action={<Btn size="sm" onClick={()=>triggerJob('db_backup')}>Backup Now</Btn>}/>
            {backups.length===0?(
              <p style={{color:T.mgrey,fontSize:12,padding:'10px 0'}}>No backups yet. Daily auto-backup runs at 02:00 EAT. Last 30 days retained.</p>
            ):(
              backups.slice(0,8).map((b,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:`1px solid ${T.lgrey}`,fontSize:11}}>
                  <span style={{fontFamily:'monospace',color:T.navy,fontSize:10}}>{b.name?.slice(0,30)}</span>
                  <span style={{color:T.mgrey}}>{b.size_kb}KB · {fmt.date(b.created)}</span>
                </div>
              ))
            )}
          </Card>
        </div>

        {/* Escalation logic explainer */}
        <Card style={{marginTop:16,background:T.navyD}}>
          <div style={{fontSize:13,fontWeight:700,color:T.gold,marginBottom:12}}>📧 Client Reminder Escalation Logic</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
            {[
              {days:'Day 1–14',tone:'Friendly Reminder',color:T.green,cc:'Account Owner only',subject:'Friendly reminder…'},
              {days:'Day 15–30',tone:'Formal Notice',color:T.amber,cc:'Account Owner + FM',subject:'Payment Notice…'},
              {days:'Day 31–60',tone:'Final Demand',color:T.red,cc:'Account Owner + FM + CFO',subject:'FINAL DEMAND…'},
              {days:'Day 60+',tone:'Legal Notice',color:'#C8960C',cc:'Account Owner + CFO + MD',subject:'LEGAL NOTICE…'},
            ].map(e=>(
              <div key={e.days} style={{background:'rgba(255,255,255,.07)',padding:'10px 12px',borderRadius:8,borderLeft:`3px solid ${e.color}`}}>
                <div style={{fontSize:10,color:'rgba(255,255,255,.5)',marginBottom:4}}>{e.days}</div>
                <div style={{fontSize:12,fontWeight:700,color:e.color,marginBottom:4}}>{e.tone}</div>
                <div style={{fontSize:10,color:'rgba(255,255,255,.4)',marginBottom:4}}>CC: {e.cc}</div>
                <div style={{fontSize:9,color:'rgba(255,255,255,.3)',fontStyle:'italic'}}>"{e.subject}"</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:12,fontSize:11,color:'rgba(255,255,255,.4)'}}>
            Calibration reminders: sent at 60 · 30 · 14 · 7 days before certificate expiry. Project payment reminders: daily until collected = invoiced.
          </div>
        </Card>

        {/* Internal debtor follow-up workflow timeline */}
        <Card style={{marginTop:16}}>
          <div style={{fontSize:13,fontWeight:700,color:T.navy,marginBottom:12}}>📋 Daily Debtor Follow-up Workflow (Internal)</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
            {[
              {time:'8:00 AM',what:'Debtors list emailed',who:'To: MD + Finance Manager',color:T.navy},
              {time:'All day',what:'FM records status per debtor',who:'Promised / Disputed / Escalated / No Response / Partially Paid / Settled',color:T.blue},
              {time:'4:00 PM',what:'Reminder if entries missing',who:'To: Finance Manager only',color:T.amber},
              {time:'5:00 PM',what:'FM submits → report emailed',who:'To: MD (compiled status report)',color:T.green},
            ].map(s=>(
              <div key={s.time} style={{background:T.offwt,padding:'10px 12px',borderRadius:8,borderLeft:`3px solid ${s.color}`}}>
                <div style={{fontSize:11,fontWeight:700,color:s.color,marginBottom:4}}>{s.time}</div>
                <div style={{fontSize:11,fontWeight:600,color:T.navy,marginBottom:3}}>{s.what}</div>
                <div style={{fontSize:10,color:T.mgrey}}>{s.who}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:10,padding:'8px 12px',background:T.redL,borderRadius:6,fontSize:11,color:T.red}}>
            ⚠️ If the report is still missing at 5:30 PM, it escalates automatically to the MD and admin — logged in the audit trail.
          </div>
        </Card>
      </>)}

      {settingsTab==='api'&&(
        <Card>
          <SectionHeader title="API Reference — All Endpoints"/>
          <Alert type="info">All endpoints require <code style={{background:T.offwt,padding:'1px 5px',borderRadius:4}}>Authorization: Bearer &lt;token&gt;</code> header except POST /api/auth.</Alert>
          <DataTable headers={['Endpoint','Methods','Auth','Description']}
            rows={[
              ['/api/auth','POST','Public','Login · MFA setup/verify/disable · Sig verify/revoke'],
              ['/api/finance','GET POST PUT','JWT','Imprest (14-day) · Payroll 3-step signing · GL · Receipts'],
              ['/api/tax','GET POST','JWT','Invoices → eTIMS · VAT return compute · PAYE · Calendar'],
              ['/api/hr','GET POST','JWT','Employees · GPS clock-in · Leave · KPI scorecards · L&D'],
              ['/api/projects','GET POST','JWT','Portfolio · Expenses (PROJ-016) · Milestones · MD override'],
              ['/api/procurement','GET POST','JWT','PRs (quota tiers) · LPOs · GRN 2-stage · GRN photo upload'],
              ['/api/crm','GET POST','JWT','Clients · Leads · CRM-055 transfer (CFO+MD)'],
              ['/api/assets','GET POST','JWT','Register · SL/RB depreciation · Disposal'],
              ['/api/fleet','GET POST','JWT','Vehicles · Trip log · Fuel tracking'],
              ['/api/calibration','GET POST','JWT','ISO 17025 certs (RSA auto-signed) · Reference standards'],
              ['/api/bids','GET POST','JWT','Stage 2B gate · PSB-004 auto-STOP · Compliance matrix'],
              ['/api/ic','GET POST','JWT','IC transactions · 5%/3% min · ICSA enforcement'],
              ['/api/compliance','GET POST','JWT','Certificates · Statutory calendar · Policy sign-offs · Tasks'],
              ['/api/reports','GET POST','JWT','GET: 16 reports | POST export: PDF/Excel (action: export)'],
              ['/api/integrations','GET POST','JWT','eTIMS · PPIP sync · M-PESA STK push · Email'],
              ['/api/scheduler','GET POST','admin/md','Job status · Manual triggers · Backup list'],
              ['/api/tasks','GET POST','JWT','CRUD · Complete · Priority/module filters'],
              ['/api/debtors','GET POST','JWT','Daily debtors list · FM status entry · EOD report submit'],
            ].map(([ep,m,a,d])=>[
              <code style={{fontFamily:'monospace',fontSize:10,color:T.navy}}>{ep}</code>,
              <Badge variant="blue">{m}</Badge>,
              <Badge variant={a==='Public'?'default':'amber'}>{a}</Badge>,
              <span style={{fontSize:11}}>{d}</span>,
            ])}
          />
        </Card>
      )}

      {sigModal&&(
        <Modal title="Verify Digital Signature" onClose={()=>{setSigModal(null);setVerified(null);}}>
          <div style={{textAlign:'center',padding:'20px 0'}}>
            <div style={{fontSize:44,marginBottom:12}}>🔐</div>
            <div style={{fontFamily:'monospace',fontSize:12,color:T.mgrey,background:T.offwt,padding:'8px 16px',borderRadius:8,display:'inline-block',marginBottom:16}}>{sigModal}</div>
            {verifying&&<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10}}><div style={{width:32,height:32,border:`4px solid ${T.lgrey}`,borderTopColor:T.navy,borderRadius:'50%',animation:'spin 1s linear infinite'}}/><span style={{fontSize:12,color:T.mgrey}}>Verifying RSA-2048 signature…</span></div>}
            {!verifying&&verified&&(
              <div style={{background:verified.valid?T.greenL:T.redL,border:`1px solid ${verified.valid?'#86EFAC':'#FCA5A5'}`,borderRadius:8,padding:'14px 18px'}}>
                <div style={{fontSize:16,fontWeight:700,color:verified.valid?T.green:T.red,marginBottom:6}}>{verified.valid?'✅ SIGNATURE VALID':'❌ INVALID'}</div>
                <div style={{fontSize:12,color:T.dgrey}}>Staff: {verified.staff_name} · Uses: {verified.uses} · Last used: {fmt.date(verified.last_used)}</div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const router   = useRouter();
  const [active, setActive]     = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser]         = useState(null);
  const [alertCount, setAlertCount] = useState(0);
  const [branding, setBranding] = useState({primary_color:'#1B3A5C',accent_color:'#C8960C',font_family:'Inter',company_display_name:'QSL ERP',logo_url:null});

  // Inline useApi to avoid import issues
  const getToken = () => typeof window!=='undefined'?localStorage.getItem('qsl_token'):null;
  const request  = useCallback(async (url, opts={}) => {
    const token = getToken();
    const headers={'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}),...(opts.headers||{})};
    try {
      const res  = await fetch(url,{...opts,headers});
      const data = await res.json();
      if(res.status===401){localStorage.removeItem('qsl_token');localStorage.removeItem('qsl_user');router.push('/login');return null;}
      return data;
    } catch(e){ return{success:false,error:'Network error'}; }
  },[router]);
  const api = { get: url=>request(url), post: (url,body)=>request(url,{method:'POST',body:JSON.stringify(body)}), put:(url,body)=>request(url,{method:'PUT',body:JSON.stringify(body)}), getUser:()=>{try{return JSON.parse(localStorage.getItem('qsl_user')||'null')}catch{return null}} };

  useEffect(()=>{
    const token=getToken();
    if(!token){router.push('/login');return;}
    const u=api.getUser();
    setUser(u);
    // Load branding so logo/colours/font apply across the whole shell
    api.get('/api/branding').then(r=>{ if(r?.success) setBranding(b=>({...b,...r.data})); });
    // Get alert count
    api.get('/api/reports?report=md_dashboard').then(r=>{
      if(r?.success){
        const d=r.data;
        setAlertCount((d.overdue_imprest?.count||0)+(d.overdue_tasks||0)+(d.expiring_docs||0));
      }
    });
  },[]);

  const logout = () => {
    localStorage.removeItem('qsl_token');
    localStorage.removeItem('qsl_user');
    router.push('/login');
  };

  const currentModule = MODULES.find(m=>m.id===active);

  const renderModule = () => {
    switch(active) {
      case 'dashboard':    return <DashboardHome api={api} setActive={setActive}/>;
      case 'finance':      return <Finance api={api}/>;
      case 'tax':          return <TaxModule api={api}/>;
      case 'projects':     return <Projects api={api}/>;
      case 'hr':           return <HR api={api}/>;
      case 'procurement':  return <Procurement api={api}/>;
      case 'integrations': return <Integrations api={api}/>;
      case 'reports':      return <Reports api={api} user={user}/>;
      case 'admin':        return <AdminModule api={api} user={user}/>;
      case 'settings':     return <Settings api={api} user={user}/>;
      case 'crm':          return <CRMModule api={api}/>;
      case 'debtors':      return <DebtorsModule api={api} user={user}/>;
      case 'stores':       return <StoresModule api={api} user={user}/>;
      case 'requisitions': return <RequisitionsModule api={api} user={user}/>;
      case 'assets':       return <AssetsModule api={api}/>;
      case 'fleet':        return <FleetModule api={api}/>;
      case 'hse':          return <HSE api={api}/>;
      case 'calibration':  return <CalibrationModule api={api}/>;
      case 'inspection':   return <InspectionModule api={api} user={user}/>;
      case 'bids':         return <BidsModule api={api}/>;
      case 'ic':           return <ICModule api={api}/>;
      case 'compliance':   return <ComplianceModule api={api}/>;
      case 'tasks':        return <TasksModule api={api}/>;
      default:             return <Card style={{textAlign:'center',padding:40}}><p style={{color:'#94A3B8'}}>Module coming soon</p></Card>;
    }
  };

  if(!user) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:T.mgrey}}>Loading QSL ERP…</div>;

  return (
    <>
      <style>{`:root{--brand:${branding.primary_color||'#1B3A5C'};--accent:${branding.accent_color||'#C8960C'};}*{box-sizing:border-box;margin:0;padding:0;}body{font-family:${branding.font_family?`'${branding.font_family}',`:''}'Inter',sans-serif;}::-webkit-scrollbar{width:6px;height:6px;}::-webkit-scrollbar-track{background:#E8ECF0;}::-webkit-scrollbar-thumb{background:#2E5F8A;border-radius:3px;}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{display:'flex',height:'100vh',overflow:'hidden'}}>
        <Sidebar active={active} setActive={setActive} collapsed={collapsed} setCollapsed={setCollapsed} user={user} branding={branding}/>
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          <TopBar title={currentModule?.label||'QSL ERP'} user={user} alertCount={alertCount} onLogout={logout}/>
          <div style={{flex:1,overflowY:'auto',padding:22}}>
            {renderModule()}
          </div>
        </div>
      </div>
    </>
  );
}
