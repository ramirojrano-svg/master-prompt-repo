// Prototipo interactivo de Kinetika. Todo el estado vive en memoria: recargar la página
// vuelve a los datos de ejemplo. Las vistas usan htm (JSX en template strings), igual que
// el prototipo original, así no hace falta un paso de JSX.
import React,{useState,useMemo,useEffect} from 'react';
import htm from 'htm';

const html=htm.bind(React.createElement);
const LOGO='/logo.png';
const ICONS={
Activity:`<path d="M3 12h4l3-8 4 16 3-8h4"/>`,
ArrowRight:`<path d="M5 12h14M13 6l6 6-6 6"/>`,
Bandage:`<rect x="2" y="8" width="20" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M10 10h.01M14 14h.01M10 14h.01M14 10h.01"/>`,
Bot:`<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V5M9 13v2M15 13v2"/><circle cx="12" cy="4" r="1"/>`,
Building2:`<rect x="5" y="3" width="10" height="18" rx="1"/><path d="M15 9h4v12h-4M9 7h2M9 11h2M9 15h2"/>`,
CalendarCheck:`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4"/>`,
CalendarDays:`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>`,
Check:`<path d="M5 12l5 5 9-10"/>`,
CheckCircle2:`<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>`,
ChevronDown:`<path d="M6 9l6 6 6-6"/>`,
ChevronUp:`<path d="M6 15l6-6 6 6"/>`,
ClipboardList:`<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6M9 15h6"/>`,
ClipboardPlus:`<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M12 10v6M9 13h6"/>`,
Dumbbell:`<path d="M6 6v12M18 6v12M3 9v6M21 9v6M6 12h12"/>`,
FileCheck:`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14l2 2 4-4"/>`,
FileSignature:`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 17c1-3 2-3 3 0s2 0 4-1"/><path d="M9 9h3"/>`,
FileText:`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6M9 9h2"/>`,
Footprints:`<path d="M8 4c2 0 3 2 3 5s-1 4-3 4-3-1-3-4 1-5 3-5zM5.5 16h5v2.5a2.5 2.5 0 0 1-5 0zM16 7c2 0 3 2 3 5s-1 4-3 4-3-1-3-4 1-5 3-5zM13.5 19h5v1a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2z"/>`,
Gift:`<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8c-2-4-6-3-5 0M12 8c2-4 6-3 5 0"/>`,
Globe:`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>`,
Hand:`<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.5-1.5L8 14"/>`,
HeartPulse:`<path d="M12 20S3 14.5 3 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9 2.5C21 14.5 12 20 12 20z"/><path d="M6 12h3l1.5-3 3 6 1.5-3h3"/>`,
Home:`<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>`,
Image:`<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-9 9"/>`,
LayoutGrid:`<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`,
LineChart:`<path d="M3 3v18h18M7 15l4-5 3 3 5-7"/>`,
Loader2:`<path d="M12 3a9 9 0 1 0 9 9"/>`,
Lock:`<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
LogOut:`<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9"/>`,
Mail:`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>`,
Megaphone:`<path d="M3 11v3a1 1 0 0 0 1 1h2l8 4V6L6 10H4a1 1 0 0 0-1 1zM18 9a4 4 0 0 1 0 6"/>`,
Menu:`<path d="M4 6h16M4 12h16M4 18h16"/>`,
MessageCircle:`<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z"/>`,
MessageSquare:`<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z"/>`,
Mic:`<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>`,
MousePointerClick:`<path d="M9 9l5 12 2-5 5-2z"/><path d="M5 5l2 2M3 10h3M10 3v3"/>`,
Package:`<path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>`,
Percent:`<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>`,
Plug:`<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>`,
Plus:`<path d="M12 5v14M5 12h14"/>`,
QrCode:`<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4"/>`,
Receipt:`<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>`,
RefreshCw:`<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>`,
Ruler:`<rect x="2" y="8" width="20" height="8" rx="1"/><path d="M6 8v3M10 8v4M14 8v3M18 8v4"/>`,
Save:`<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>`,
ScanLine:`<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M3 12h18"/>`,
Search:`<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>`,
Settings:`<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>`,
Share2:`<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 11l7.6-4M8.2 13l7.6 4"/>`,
ShieldCheck:`<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>`,
Sparkles:`<path d="M10 4l1.8 4.7 4.7 1.8-4.7 1.8L10 17l-1.8-4.7L3.5 10.5l4.7-1.8z"/><path d="M18 3v4M16 5h4M18 15v4M16 17h4"/>`,
Stethoscope:`<path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>`,
Tag:`<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1.2"/>`,
Upload:`<path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/>`,
UserCircle:`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18c1-3 3-4 5.5-4s4.5 1 5.5 4"/>`,
UserPlus:`<circle cx="9" cy="8" r="4"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6"/>`,
Users:`<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c3 0 5 2 5 5"/>`,
Video:`<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>`,
Wallet:`<path d="M4 7a2 2 0 0 1 2-2h12v4M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1"/>`,
X:`<path d="M6 6l12 12M18 6L6 18"/>`};
const I=({n,s=18,c=''})=>{const m=ICONS[n];if(m)return html`<svg width=${s} height=${s} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className=${c} aria-hidden='true' dangerouslySetInnerHTML=${{__html:m}}/>`;return null};

const GROUPS=[{g:'Columna Vertebral y Tronco',ic:'Activity',items:[{b:'cervical',l:'Cervical',p:['Cervicalgia','Contractura trapecio','Cefalea cervicogénica','Latigazo cervical','Hernia discal C5-C6']},{b:'dorsal',l:'Dorsal',p:['Dorsalgia','Escoliosis','Hipercifosis','Dolor costal']},{b:'lumbar',l:'Lumbar',p:['Lumbalgia mecánica','Lumbociatalgia','Hernia discal L4-L5','Espondilolistesis']},{b:'sacro',l:'Sacro / Cadera',p:['Sacroiliitis','Disfunción sacroilíaca','Coccigodinia','Síndrome del piriforme']}]},{g:'Miembro Superior',ic:'Hand',items:[{b:'hombro',l:'Hombro',lat:1,p:['Tendinopatía manguito','Síndrome subacromial','Capsulitis adhesiva','Post-op manguito','Luxación']},{b:'codo',l:'Codo',lat:1,p:['Epicondilitis','Epitrocleítis','Bursitis olecraniana','Post-fractura']},{b:'muneca',l:'Muñeca / Mano',lat:1,p:['Túnel carpiano','Tendinitis De Quervain','Esguince de muñeca','Dedo en gatillo']}]},{g:'Miembro Inferior',ic:'Footprints',items:[{b:'cadera',l:'Cadera',lat:1,p:['Coxartrosis','Bursitis trocantérea','Pinzamiento femoroacetabular','Post-prótesis']},{b:'rodilla',l:'Rodilla',lat:1,p:['Gonartrosis','Lesión de LCA','Lesión meniscal','Condromalacia','Post-op rodilla']},{b:'tobillo',l:'Tobillo / Pie',lat:1,p:['Esguince de tobillo','Fascitis plantar','Tendinopatía aquiliana','Pie plano']}]},{g:'Otras Áreas Clínicas',ic:'HeartPulse',items:[{b:'suelo',l:'Suelo Pélvico',p:['Incontinencia urinaria','Dolor pélvico','Prolapso','Preparación al parto']},{b:'resp',l:'Respiratorio / Neurológico',p:['EPOC','Post-COVID','ACV / hemiparesia','Parkinson','Neuropatía periférica']}]}];
const ZONES=[];
const SPOTS=[['cervical',100,60],['dorsal',100,115],['hombroI',134,84],['hombroD',66,84],['codoI',149,130],['codoD',51,130],['munecaI',149,184],['munecaD',51,184],['lumbar',100,165],['caderaI',112,212],['caderaD',88,212],['rodillaI',112,285],['rodillaD',88,285],['tobilloI',112,368],['tobilloD',88,368]];
const BASE=k=>k.replace(/[ID]$/,'');
const SIDE=k=>/[ID]$/.test(k)?k.slice(-1):'';
const ITEMS=GROUPS.flatMap(g=>g.items);
const zi=b=>ITEMS.find(i=>i.b===b)||{l:b,b};
const zl=k=>{const i=zi(BASE(k)),s=SIDE(k);return i.lat?i.l+(s==='I'?' izq.':s==='D'?' der.':''):i.l};

const P0=[
{id:1,n:'Juan Pérez',a:34,t:'11 5234-8891',os:'OSDE 310',e:'Activo',u:'22/10/2026',m:'Lumbalgia mecánica'},
{id:2,n:'María González',a:52,t:'11 6012-3345',os:'Swiss Medical',e:'Activo',u:'23/10/2026',m:'Post-op rodilla'},
{id:3,n:'Carlos Rodríguez',a:45,t:'11 4455-7712',os:'PAMI',e:'Pausa',u:'09/10/2026',m:'Tendinitis hombro'},
{id:4,n:'Lucía Fernández',a:28,t:'11 3901-2287',os:'Particular',e:'Activo',u:'24/10/2026',m:'Esguince tobillo'},
{id:5,n:'Roberto Díaz',a:67,t:'11 5588-0934',os:'PAMI',e:'Alta',u:'30/09/2026',m:'Cervicalgia'},
{id:6,n:'Ana Martínez',a:39,t:'11 6677-4120',os:'Galeno',e:'Activo',u:'21/10/2026',m:'Rehabilitación LCA'},
{id:7,n:'Sofía López',a:31,t:'11 2290-5563',os:'Medifé',e:'Pausa',u:'12/10/2026',m:'Contractura trapecio'}];
const EV0={1:[
{id:1,d:'22/10/2026',z:'lumbar',x:'Refiere dolor EVA 2/5, mejoría respecto a la sesión previa. Se realiza TENS 15 min, termoterapia y ejercicios de estabilización lumbopélvica. Buena tolerancia.'},
{id:2,d:'19/10/2026',z:'lumbar',x:'Dolor EVA 3/5 con la flexión de tronco. Se aplica terapia manual, movilización y elongación de isquiotibiales. Se indican ejercicios domiciliarios.'},
{id:3,d:'15/10/2026',z:'cervical',x:'Contractura de trapecio superior bilateral asociada a trabajo de escritorio. Masoterapia, estiramientos y pautas ergonómicas.'},
{id:4,d:'12/10/2026',z:'rodillaD',x:'Leve dolor en rodilla derecha al subir escaleras. Se evalúa sin signos de inestabilidad. Fortalecimiento de cuádriceps.'},
{id:5,d:'08/10/2026',z:'hombroI',x:'Evaluación inicial hombro izquierdo: arco de movilidad completo, dolor en abducción a 90°. Se plantea plan de 8 sesiones.'}]};
const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS=['Lun','Mar','Mié','Jue','Vie','Sáb'];
const HRS=Array.from({length:12},(_,i)=>8+i);
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const pd=k=>{const [y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d)};
const addD=(d,n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);
const mondayOf=d=>addD(d,-((d.getDay()+6)%7));
const TODAY='2026-10-27';
const cap=t=>t[0].toUpperCase()+t.slice(1);
const dkey=d=>{const m=/^(\d+)\/(\d+)\/(\d+)$/.exec(d||'');return m?Number(m[3])*10000+Number(m[2])*100+Number(m[1]):0};
const lastSes=(p,evs)=>[p.u,...(evs||[]).map(e=>e.d)].filter(d=>dkey(d)).sort((a,b)=>dkey(b)-dkey(a))[0]||'—';
const APPTS0=[['2026-10-26',9,1,'Lumbalgia'],['2026-10-26',10,4,'Esguince'],['2026-10-26',12,2,'Post-op rodilla'],['2026-10-26',15,6,'LCA'],['2026-10-27',9,3,'Hombro'],['2026-10-27',11,5,'Cervical'],['2026-10-27',14,1,'Lumbalgia'],['2026-10-28',10,2,'Post-op rodilla'],['2026-10-28',12,7,'Trapecio'],['2026-10-28',16,4,'Esguince'],['2026-10-29',9,6,'LCA'],['2026-10-29',11,1,'Lumbalgia'],['2026-10-29',15,3,'Hombro'],['2026-10-30',10,4,'Esguince'],['2026-10-30',12,2,'Post-op rodilla'],['2026-10-30',14,5,'Alta'],['2026-10-31',9,4,'Control'],['2026-10-31',11,6,'LCA'],['2026-11-03',10,1,'Lumbalgia'],['2026-11-05',9,2,'Post-op rodilla'],['2026-11-10',16,3,'Hombro'],['2026-12-02',18,6,'Control LCA']].map((a,i)=>({id:i+1,date:a[0],h:a[1],p:a[2],t:a[3]}));

const badge={Activo:'bg-emerald-50 text-emerald-700 ring-emerald-200',Pausa:'bg-amber-50 text-amber-700 ring-amber-200',Alta:'bg-slate-100 text-slate-600 ring-slate-200'};

function LIcon({k,ai}){
 const B='#2563eb',G='#10b981',V='#6366f1';
 const art={
 'Agenda de turnos':html`<g><rect x='11' y='7' width='27' height='35' rx='4' fill='#fff' stroke=${B} strokeWidth='2.5'/><path d='M7 15h8M7 24h8M7 33h8' stroke=${B} strokeWidth='2.5' strokeLinecap='round'/><path d='M21 16h11M21 23h11M21 30h6' stroke='#93c5fd' strokeWidth='2.5' strokeLinecap='round'/><circle cx='36' cy='36' r='8' fill=${G}/><path d='M32.5 36l2.5 2.5 4.5-5' stroke='#fff' strokeWidth='2.5' fill='none' strokeLinecap='round' strokeLinejoin='round'/></g>`,
 'CRM de pacientes':html`<g><circle cx='19' cy='17' r='6.5' fill='#dbeafe' stroke=${B} strokeWidth='2.5'/><path d='M7 40c0-8 5-12 12-12s12 4 12 12z' fill='#dbeafe' stroke=${B} strokeWidth='2.5' strokeLinejoin='round'/><circle cx='34' cy='19' r='5' fill='#d1fae5' stroke=${G} strokeWidth='2.5'/><path d='M33 28c6 0 10 3 10 9h-8' fill='none' stroke=${G} strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'/></g>`,
 'Ficha clínica digital':html`<g><path d='M12 6h16l8 8v28H12z' fill='#fff' stroke=${B} strokeWidth='2.5' strokeLinejoin='round'/><path d='M28 6v8h8' fill='none' stroke=${B} strokeWidth='2.5' strokeLinejoin='round'/><path d='M24 22v12M18 28h12' stroke=${G} strokeWidth='3.5' strokeLinecap='round'/><path d='M17 15h6' stroke='#93c5fd' strokeWidth='2.5' strokeLinecap='round'/></g>`,
 'Mapa corporal':html`<g fill='#dbeafe' stroke=${B} strokeWidth='2.3' strokeLinejoin='round'><circle cx='24' cy='9' r='5'/><rect x='16.5' y='16' width='15' height='15' rx='6'/><rect x='8' y='17' width='6' height='15' rx='3'/><rect x='34' y='17' width='6' height='15' rx='3'/><rect x='17.5' y='30' width='6' height='14' rx='3'/><rect x='24.5' y='30' width='6' height='14' rx='3'/><circle cx='24' cy='24' r='3' fill=${G} stroke='none'/><circle cx='21' cy='38' r='2.5' fill=${G} stroke='none'/></g>`,
 'Dictado con IA':html`<g><rect x='17.5' y='6' width='13' height='22' rx='6.5' fill=${V}/><path d='M11 23a13 13 0 0 0 26 0M24 36v6M18 42h12' stroke=${V} strokeWidth='2.8' fill='none' strokeLinecap='round'/><path d='M39 4l1.8 4.6 4.6 1.8-4.6 1.8L39 17l-1.8-4.8-4.6-1.8 4.6-1.8z' fill='#a78bfa'/></g>`,
 'Datos seguros':html`<g><path d='M24 5l15 6v12c0 10-6 17-15 20-9-3-15-10-15-20V11z' fill='#d1fae5' stroke=${G} strokeWidth='2.8' strokeLinejoin='round'/><path d='M17 24l5 5 9-10' stroke=${G} strokeWidth='3.2' fill='none' strokeLinecap='round' strokeLinejoin='round'/></g>`}[k];
 return html`<div className=${'w-14 h-14 rounded-2xl grid place-items-center '+(ai?'bg-indigo-50':'bg-blue-50')}><svg viewBox='0 0 48 48' width='34' height='34' role='img' aria-label=${k}>${art}</svg></div>`;
}

function Auth({mode,setMode,go}){
 const [st,setSt]=useState(1),[f,setF]=useState({n:'',e:'',t:'',ok:false,p:'',p2:''});
 const set=k=>e=>setF({...f,[k]:e.target.type==='checkbox'?e.target.checked:e.target.value});
 const close=()=>setMode(null);
 const inp='w-full mt-1.5 px-4 py-3 rounded-xl border border-slate-200 shadow-sm text-[15px] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';
 const lab='block text-[15px] font-medium text-slate-900 mt-4';
 const mailOk=/^\S+@\S+\.\S+$/.test(f.e);
 const btn='w-full mt-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40';
 return html`<div className='fixed inset-0 z-50 bg-slate-900/50 grid place-items-center p-4 overflow-y-auto' onClick=${close}>
  <div className='bg-white rounded-3xl w-full max-w-md p-7 shadow-2xl relative' onClick=${e=>e.stopPropagation()}>
   <button onClick=${close} className='absolute top-5 right-5 text-slate-500 hover:text-slate-800' title='Cerrar'><${I} n='X' s=${22}/></button>
   ${mode==='login'?html`<div>
    <h2 className='text-2xl font-bold text-slate-900'>Iniciar sesión</h2><p className='text-slate-500 mt-1'>Entrá a tu consultorio.</p>
    <label className=${lab}>Email<input type='email' className=${inp} placeholder='vos@consultorio.com' value=${f.e} onChange=${set('e')}/></label>
    <label className=${lab}>Contraseña<input type='password' className=${inp} placeholder='Tu contraseña' value=${f.p} onChange=${set('p')}/></label>
    <button disabled=${!mailOk||!f.p} onClick=${()=>go('patients')} className=${btn}><${I} n='ArrowRight' s=${18}/>Ingresar</button>
    <p className='text-center text-sm text-slate-500 mt-4'>¿No tenés cuenta? <button onClick=${()=>{setSt(1);setMode('signup')}} className='text-blue-600 font-semibold hover:underline'>Creá tu usuario gratis</button></p>
   </div>`:st===1?html`<div>
    <p className='text-sm text-blue-600'>Paso 1 de 2</p>
    <h2 className='text-2xl font-bold text-slate-900 mt-2'>Empezá gratis</h2>
    <p className='text-slate-500 mt-1'>Gestionar tu consultorio es gratis para siempre y sin límite de pacientes. Sin tarjeta.</p>
    <label className=${lab}>Nombre<input className=${inp} placeholder='Lic. Ana Pérez' value=${f.n} onChange=${set('n')}/></label>
    <label className=${lab}>Email<input type='email' className=${inp} placeholder='vos@consultorio.com' value=${f.e} onChange=${set('e')}/></label>
    <label className=${lab}>WhatsApp / teléfono<input className=${inp} placeholder='Con código de país, ej. +54 …' value=${f.t} onChange=${set('t')}/></label>
    <p className='text-xs text-slate-500 mt-2'>Para ayudarte a arrancar si te trabás. Sin spam.</p>
    <label className='flex items-start gap-2 mt-3 text-sm text-slate-500'><input type='checkbox' className='mt-1' checked=${f.ok} onChange=${set('ok')}/>Acepto que Kinetika me cuente por WhatsApp novedades y ofertas. Puedo darme de baja respondiendo BAJA.</label>
    <button disabled=${!f.n.trim()||!mailOk} onClick=${()=>setSt(2)} className=${btn}><${I} n='ArrowRight' s=${18}/>Continuar</button>
    <p className='text-center text-xs text-slate-500 mt-4'>En el paso 2 elegís tu contraseña y la cuenta queda creada.</p>
    <p className='text-center text-sm text-slate-500 mt-3'>¿Ya tenés cuenta? <button onClick=${()=>setMode('login')} className='text-blue-600 font-semibold hover:underline'>Iniciar sesión</button></p>
   </div>`:html`<div>
    <p className='text-sm text-blue-600'>Paso 2 de 2</p>
    <h2 className='text-2xl font-bold text-slate-900 mt-2'>Elegí tu contraseña</h2>
    <p className='text-slate-500 mt-1'>Ya casi está, ${f.n.trim().split(' ').slice(-1)[0]}. Con esto tu cuenta queda creada.</p>
    <label className=${lab}>Contraseña<input type='password' className=${inp} placeholder='Mínimo 6 caracteres' value=${f.p} onChange=${set('p')}/></label>
    <label className=${lab}>Repetir contraseña<input type='password' className=${inp} value=${f.p2} onChange=${set('p2')}/></label>
    ${f.p2&&f.p!==f.p2?html`<p className='text-xs text-red-600 mt-2'>Las contraseñas no coinciden.</p>`:null}
    <button disabled=${f.p.length<6||f.p!==f.p2} onClick=${()=>go('patients')} className=${btn}><${I} n='Check' s=${18}/>Crear cuenta e ingresar</button>
    <p className='text-center text-sm mt-4'><button onClick=${()=>setSt(1)} className='text-slate-500 hover:text-slate-800'>← Volver al paso 1</button></p>
   </div>`}
  </div></div>`;
}

function Landing({go}){
 const [am,setAm]=useState(null);
 const F=[['CalendarDays','Agenda de turnos','Calendario diario y semanal. Sin límite de turnos.'],['Users','CRM de pacientes','Todos tus pacientes, obras sociales y contactos en un lugar.'],['FileText','Ficha clínica digital','Evoluciones ordenadas por fecha y por zona corporal.'],['Activity','Mapa corporal','Filtrá notas por cervical, lumbar, hombro, rodilla y más.'],['Sparkles','Dictado con IA','Hablá y Kinetika redacta la evolución en formato formal.',1],['ShieldCheck','Datos seguros','Información clínica cifrada y respaldada automáticamente.']];
 return html`<div>
 ${am?html`<${Auth} mode=${am} setMode=${setAm} go=${go}/>`:null}
 <div style=${{backgroundImage:'radial-gradient(ellipse 90% 60% at 50% 0%,#dbeafe 0%,rgba(219,234,254,0) 70%),radial-gradient(#cbd5e1 1px,transparent 1px)',backgroundSize:'100% 100%,24px 24px'}}>
 <header className="max-w-6xl mx-auto flex items-center justify-between px-5 py-4">
  <div className="flex items-center gap-2 font-bold text-lg text-slate-800"><img src=${LOGO} alt="Kinetika" className="h-9 w-auto"/>Kinetika</div>
  <div className="flex items-center gap-2 sm:gap-3 text-sm"><button onClick=${()=>setAm('login')} className="px-4 py-2 rounded-lg text-slate-700 font-medium hover:bg-slate-100">Iniciar sesión</button><button onClick=${()=>setAm('signup')} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Sumarme gratis</button></div>
 </header>
 <section className="max-w-4xl mx-auto text-center px-5 pt-10 pb-16">
  <span className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-300"><${I} n="Sparkles" s=${14}/>Software para consultorios kinesiológicos</span>
  <h1 className="mt-6 text-5xl md:text-7xl font-extrabold tracking-tight text-slate-900 leading-[1.05]">Software y fichas clínicas para kinesiólogos. <span style=${{backgroundImage:'linear-gradient(90deg,#2563eb,#22b8cf)',WebkitBackgroundClip:'text',backgroundClip:'text',color:'transparent'}}>Adiós al papel.</span></h1>
  <p className="mt-6 text-lg text-slate-500 max-w-2xl mx-auto">Un CRM simple para consultorios de kinesiología. La gestión de turnos y pacientes es <b className="text-slate-900">100% gratis, sin límite de pacientes.</b></p>
  <div className="mt-8 max-w-md mx-auto bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm px-5 py-3.5 flex items-center justify-between gap-4 text-sm"><b className="text-slate-900">100% gratis</b><span className="text-slate-500 text-right">turnos y pacientes, sin límite</span></div>
  <div className="mt-8 flex flex-wrap gap-3 justify-center">
   <button onClick=${()=>setAm('signup')} className="px-8 py-3.5 rounded-xl text-white font-semibold shadow-lg shadow-blue-500/25 flex items-center gap-2" style=${{backgroundImage:'linear-gradient(90deg,#2f6fe4,#2bbfd6)'}}>Crear mi cuenta gratis <${I} n="ArrowRight" s=${18}/></button>
   <button onClick=${()=>go('features')} className="px-8 py-3.5 rounded-xl bg-white ring-1 ring-slate-200 text-slate-800 font-medium shadow-sm hover:bg-slate-50">Quiero más info</button>
  </div>
  <p className="mt-5 text-sm"><button onClick=${()=>go('patients')} className="text-blue-600 hover:underline font-medium">o ingresá al demo sin registrarte →</button></p>
 </section>
 </div>
 <section className="max-w-6xl mx-auto px-5 pb-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
  ${F.map(([ic,t,d,ai])=>html`<div key=${t} className=${'rounded-2xl p-5 bg-white ring-1 '+(ai?'ring-indigo-200':'ring-slate-200')}>
   <${LIcon} k=${t} ai=${ai}/>
   <h3 className="mt-3 font-semibold text-slate-900 flex items-center gap-2">${t}${ai?html`<span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">IA</span>`:null}</h3>
   <p className="mt-1 text-sm text-slate-600">${d}</p></div>`)}
 </section>
 <footer className="text-center text-xs text-slate-400 pb-8">© 2026 Kinetika · Prototipo interactivo</footer>
 </div>`;
}

function Modal({onClose,onSave}){
 const [f,setF]=useState({n:'',a:'',t:'',os:'Particular',m:''});
 const set=k=>e=>setF({...f,[k]:e.target.value});
 const inp='w-full mt-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
 return html`<div className="fixed inset-0 z-50 bg-slate-900/50 grid place-items-center p-4" onClick=${onClose}>
  <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl" onClick=${e=>e.stopPropagation()}>
   <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold">Nuevo paciente</h3><button onClick=${onClose} className="text-slate-400"><${I} n="X"/></button></div>
   <div className="space-y-3">
    <label className="block text-sm font-medium text-slate-700">Nombre completo<input className=${inp} value=${f.n} onChange=${set('n')} placeholder="Ej: Laura Gómez"/></label>
    <div className="grid grid-cols-2 gap-3">
     <label className="block text-sm font-medium text-slate-700">Edad<input type="number" className=${inp} value=${f.a} onChange=${set('a')}/></label>
     <label className="block text-sm font-medium text-slate-700">Teléfono<input className=${inp} value=${f.t} onChange=${set('t')}/></label></div>
    <label className="block text-sm font-medium text-slate-700">Obra social / Prepaga<select className=${inp} value=${f.os} onChange=${set('os')}>${['Particular','OSDE 310','Swiss Medical','Galeno','Medifé','PAMI'].map(o=>html`<option key=${o}>${o}</option>`)}</select></label>
    <label className="block text-sm font-medium text-slate-700">Motivo de consulta<input className=${inp} value=${f.m} onChange=${set('m')}/></label>
   </div>
   <div className="mt-5 flex justify-end gap-2"><button onClick=${onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600">Cancelar</button>
   <button disabled=${!f.n.trim()} onClick=${()=>onSave(f)} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium disabled:opacity-40">Guardar paciente</button></div>
  </div></div>`;
}

function Patients({pts,open,onNew}){
 const [q,setQ]=useState(''),[st,setSt]=useState('Todos');
 const list=useMemo(()=>pts.filter(p=>(st==='Todos'||p.e===st)&&(p.n+p.os+p.t).toLowerCase().includes(q.toLowerCase())),[pts,q,st]);
 return html`<div>
  <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
   <div><h1 className="text-2xl font-bold">Pacientes</h1><p className="text-sm text-slate-500">${pts.length} pacientes registrados · sin límite en el plan gratuito</p></div>
   <button onClick=${onNew} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-2"><${I} n="Plus" s=${16}/>Nuevo Paciente</button>
  </div>
  <div className="flex flex-wrap gap-3 mb-4">
   <div className="relative flex-1 min-w-[220px]"><span className="absolute left-3 top-2.5 text-slate-400"><${I} n="Search" s=${16}/></span>
   <input value=${q} onChange=${e=>setQ(e.target.value)} placeholder="Buscar por nombre, teléfono u obra social…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
   <div className="flex gap-1 bg-white p-1 rounded-lg ring-1 ring-slate-200">${['Todos','Activo','Pausa','Alta'].map(s=>html`<button key=${s} onClick=${()=>setSt(s)} className=${'px-3 py-1 text-sm rounded-md '+(st===s?'bg-blue-600 text-white':'text-slate-600 hover:bg-slate-100')}>${s}</button>`)}</div>
  </div>
  <div className="bg-white rounded-xl ring-1 ring-slate-200 overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
   <thead className="bg-slate-50 text-slate-500 text-left text-xs uppercase"><tr>${['Paciente','Teléfono','Obra Social / Prepaga','Estado','Última sesión'].map(h=>html`<th key=${h} className="px-4 py-3 font-semibold">${h}</th>`)}</tr></thead>
   <tbody>${list.map(p=>html`<tr key=${p.id} onClick=${()=>open(p.id)} className="border-t border-slate-100 hover:bg-blue-50/50 cursor-pointer">
    <td className="px-4 py-3"><div className="flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 grid place-items-center text-xs font-bold">${p.n.split(' ').map(w=>w[0]).slice(0,2).join('')}</span><div><div className="font-medium">${p.n}</div><div className="text-xs text-slate-500">${p.a} años · ${p.m||'—'}</div></div></div></td>
    <td className="px-4 py-3 text-slate-600">${p.t||'—'}</td><td className="px-4 py-3 text-slate-600">${p.os}</td>
    <td className="px-4 py-3"><span className=${'px-2 py-0.5 rounded-full text-xs font-medium ring-1 '+badge[p.e]}>${p.e}</span></td>
    <td className="px-4 py-3 text-slate-600">${p.u}</td></tr>`)}
    ${list.length?null:html`<tr><td colSpan="5" className="px-4 py-10 text-center text-slate-400">Sin resultados</td></tr>`}</tbody></table></div>
 </div>`;
}

function Body({isSel,toggle,counts}){
 return html`<svg viewBox="0 0 200 400" className="w-full max-w-[220px] mx-auto">
  <g fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.5">
   <circle cx="100" cy="30" r="18"/><rect x="92" y="46" width="16" height="16" rx="4"/>
   <rect x="68" y="66" width="64" height="130" rx="22"/><rect x="40" y="70" width="22" height="120" rx="11"/><rect x="138" y="70" width="22" height="120" rx="11"/>
   <rect x="74" y="196" width="26" height="185" rx="12"/><rect x="100" y="196" width="26" height="185" rx="12"/></g>
  ${SPOTS.map(([k,x,y],i)=>html`<g key=${i} onClick=${()=>toggle(k)} style=${{cursor:'pointer'}}>
   <circle cx=${x} cy=${y} r=${isSel(k)?15:12} fill=${isSel(k)?'#2563eb':'#fff'} stroke="#2563eb" strokeWidth="2" opacity=${isSel(k)?1:.9}/>
   <text x=${x} y=${y+4} textAnchor="middle" fontSize="11" fontWeight="700" fill=${isSel(k)?'#fff':'#2563eb'}>${counts[k]||0}</text></g>`)}
 </svg>`;
}

const INFORMAL='"Hoy Juan vino mucho mejor, dice que el dolor bajó a un 2. Le hice TENS, calor y ejercicios de estabilización. Lo toleró bárbaro. Que siga con los ejercicios en casa."';
function Chart({p,evs,addEv}){
 const [zs,setZs]=useState([]),[og,setOg]=useState({});
 const [ai,setAi]=useState('idle'),[tx,setTx]=useState(''),[draft,setDraft]=useState('');
 const mk=(b,side)=>({id:Date.now()+Math.random(),b,side,pat:'',eva:3,nota:''});
 const zkey=x=>x.b+x.side;
 const list=(evs||[]).filter(e=>!zs.length||zs.some(x=>x.b===BASE(e.z)&&(!x.side||SIDE(e.z)===x.side)));
 const counts={},bc={};(evs||[]).forEach(e=>{counts[e.z]=(counts[e.z]||0)+1;bc[BASE(e.z)]=(bc[BASE(e.z)]||0)+1});
 const isSel=k=>zs.some(x=>x.b===BASE(k)&&(!x.side||x.side===SIDE(k)));
 const toggleKey=k=>{const hit=zs.filter(x=>x.b===BASE(k)&&(!x.side||x.side===SIDE(k)));if(hit.length)setZs(zs.filter(x=>!hit.includes(x)));else setZs([...zs,mk(BASE(k),SIDE(k))])};
 const toggleBase=b=>{if(zs.some(x=>x.b===b))setZs(zs.filter(x=>x.b!==b));else setZs([...zs,mk(b,'')])};
 const upd=(id,patch)=>setZs(zs.map(x=>x.id===id?{...x,...patch}:x));
 const rem=id=>setZs(zs.filter(x=>x.id!==id));
 const zn=zs.length?zkey(zs[0]):'lumbar';
 const zlabel=zs.length?zs.map(x=>zl(zkey(x))).join(' + '):'Lumbar (por defecto)';
 const okAll=zs.length>0&&zs.every(x=>x.pat.trim());
 const saveRg=()=>{addEv(zs.map(x=>({id:Date.now()+Math.random(),d:'27/10/2026',z:zkey(x),x:x.nota.trim()||'Registro de patología / motivo de consulta.',pat:x.pat.trim(),eva:x.eva})));setZs([])};
 const isOpen=gi=>og[gi]!==false;
 const acc=html`<div className='mt-3 space-y-2'>${GROUPS.map((g,gi)=>html`<div key=${g.g} className='rounded-lg ring-1 ring-slate-200 overflow-hidden'><button onClick=${()=>setOg({...og,[gi]:!isOpen(gi)})} className='w-full flex items-center gap-2 px-3 py-2 bg-slate-50 text-xs font-semibold text-slate-700'><${I} n=${g.ic} s=${14} c='text-blue-600'/><span className='flex-1 text-left'>${g.g}</span><${I} n=${isOpen(gi)?'ChevronUp':'ChevronDown'} s=${14}/></button>${isOpen(gi)?html`<div className='p-2 flex flex-wrap gap-1.5'>${g.items.map(i=>html`<button key=${i.b} onClick=${()=>toggleBase(i.b)} className=${'px-2.5 py-1 rounded-full text-xs ring-1 flex items-center gap-1 '+(zs.some(x=>x.b===i.b)?'bg-blue-600 text-white ring-blue-600':'ring-slate-300 text-slate-600 hover:bg-blue-50')}>${zs.some(x=>x.b===i.b)?html`<${I} n='Check' s=${12}/>`:null}${i.l}${bc[i.b]?' · '+bc[i.b]:''}</button>`)}</div>`:null}</div>`)}</div>`;
 const reg=!zs.length?html`<div className='rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-slate-500 flex items-center gap-2'><${I} n='MousePointerClick' s=${18}/>Elegí una o más zonas anatómicas (mapa o menú) para registrar cada dolor o motivo de consulta.</div>`:html`<div className='bg-white rounded-xl ring-1 ring-blue-200 p-5'>
  <div className='flex items-center justify-between gap-2'><h3 className='font-semibold flex items-center gap-2'><${I} n='ClipboardPlus' s=${18} c='text-blue-600'/>Registro rápido · <span className='text-blue-700'>${zs.length} zona${zs.length>1?'s':''}</span></h3><button onClick=${()=>setZs([])} className='text-xs text-slate-500 hover:text-slate-800'>Limpiar todo</button></div>
  <div className='mt-3 space-y-4'>${zs.map(x=>{const it=zi(x.b);return html`<div key=${x.id} className='rounded-lg border border-slate-200 p-4'>
   <div className='flex flex-wrap items-center justify-between gap-2'><span className='font-semibold text-sm text-blue-700'>${zl(zkey(x))}</span><div className='flex items-center gap-2'>${it.lat?html`<div className='flex gap-1 p-0.5 bg-slate-100 rounded-lg text-xs'>${[['I','Izq.'],['D','Der.'],['','Ambos']].map(([sd,l])=>html`<button key=${l} onClick=${()=>upd(x.id,{side:sd})} className=${'px-2.5 py-1 rounded-md '+(x.side===sd?'bg-white shadow text-blue-700 font-medium':'text-slate-500')}>${l}</button>`)}</div>`:null}<button onClick=${()=>rem(x.id)} title='Quitar zona' className='p-1 rounded text-slate-400 hover:text-red-600'><${I} n='X' s=${16}/></button></div></div>
   <p className='text-xs text-slate-500 mt-3 mb-1.5'>Patologías frecuentes</p>
   <div className='flex flex-wrap gap-1.5'>${(it.p||[]).map(t=>html`<button key=${t} onClick=${()=>upd(x.id,{pat:t})} className=${'px-2.5 py-1 rounded-full text-xs ring-1 '+(x.pat===t?'bg-emerald-600 text-white ring-emerald-600':'ring-slate-300 text-slate-600 hover:bg-slate-50')}>${t}</button>`)}</div>
   <input value=${x.pat} onChange=${e=>upd(x.id,{pat:e.target.value})} placeholder='Patología o motivo de consulta (podés escribir uno propio)' className='w-full mt-3 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'/>
   <div className='mt-3 flex items-center gap-3 text-sm'><span className='text-slate-600 w-28'>Dolor EVA: <b>${x.eva}/5</b></span><input type='range' min='0' max='5' value=${x.eva} onChange=${e=>upd(x.id,{eva:+e.target.value})} className='flex-1 accent-blue-600'/></div>
   <textarea rows='2' value=${x.nota} onChange=${e=>upd(x.id,{nota:e.target.value})} placeholder='Nota breve (opcional): hallazgos, tratamiento, indicaciones…' className='w-full mt-3 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'></textarea></div>`})}</div>
  <div className='flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-slate-100'><span className='text-xs text-slate-500'>${okAll?'Todo listo para guardar.':'Completá la patología de cada zona para guardar.'}</span><button disabled=${!okAll} onClick=${saveRg} className='px-6 py-2.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-40 flex items-center gap-2'><${I} n='Save' s=${16}/>GUARDAR${zs.length>1?' ('+zs.length+')':''}</button></div></div>`;
 useEffect(()=>{
  if(ai==='rec'){let i=0;const iv=setInterval(()=>{i+=3;setTx(INFORMAL.slice(0,i));if(i>=INFORMAL.length){clearInterval(iv);setTimeout(()=>setAi('proc'),500)}},40);return()=>clearInterval(iv)}
  if(ai==='proc'){const t=setTimeout(()=>{setDraft(`Paciente refiere disminución del dolor en región ${zl(zn).toLowerCase()} (EVA 2/5). Se aplica TENS analgésico durante 15 minutos y termoterapia superficial. Se realizan ejercicios de estabilización lumbopélvica con buena tolerancia y sin eventos adversos. Se indica continuidad de ejercicios domiciliarios. Plan: control en próxima sesión.`);setAi('done')},1800);return()=>clearTimeout(t)}
 },[ai]);
 const save=()=>{addEv({id:Date.now(),d:'27/10/2026',z:zn,x:draft});setAi('idle');setTx('');setDraft('')};
 if(!p)return html`<div className="text-slate-500">Seleccioná un paciente.</div>`;
 return html`<div>
  <div className="bg-white rounded-xl ring-1 ring-slate-200 p-5 flex flex-wrap items-center gap-4 mb-5">
   <span className="w-14 h-14 rounded-full bg-blue-600 text-white grid place-items-center text-lg font-bold">${p.n.split(' ').map(w=>w[0]).slice(0,2).join('')}</span>
   <div className="flex-1 min-w-[200px]"><h1 className="text-xl font-bold">${p.n} - ${p.a} años</h1>
    <p className="text-sm text-slate-500">${p.os} · ${p.t||'Sin teléfono'} · Motivo: ${p.m||'—'}</p></div>
   <span className=${'px-2.5 py-1 rounded-full text-xs font-medium ring-1 '+badge[p.e]}>${p.e}</span>
  </div>
  <div className="grid lg:grid-cols-[300px_1fr] gap-5">
   <div className="bg-white rounded-xl ring-1 ring-slate-200 p-4 h-fit">
    <h3 className="font-semibold text-sm mb-2">Zona corporal</h3>
    <${Body} isSel=${isSel} toggle=${toggleKey} counts=${counts}/>${acc}
    ${zs.length?html`<button onClick=${()=>setZs([])} className='mt-3 w-full px-3 py-1.5 rounded-lg text-xs font-medium ring-1 ring-slate-300 text-slate-600 hover:bg-slate-50'>Limpiar selección (${zs.length})</button>`:html`<p className='mt-3 text-[11px] text-slate-400'>Tocá una o varias zonas para registrar más de un dolor.</p>`}
   </div>
   <div className="space-y-5">${reg}
    <div className="rounded-xl p-5 bg-gradient-to-br from-indigo-50 to-violet-50 ring-1 ring-indigo-200">
     <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold text-indigo-900 flex items-center gap-2"><${I} n="Sparkles" s=${18} c="text-indigo-600"/>Asistente de IA <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white">PRO</span></h3>
      <p className="text-sm text-indigo-800/70">Nueva nota en: <b>${zlabel}</b></p></div>
      ${ai==='idle'?html`<button onClick=${()=>setAi('rec')} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/25"><${I} n="Mic" s=${16}/>Dictar evolución con IA (Demo)</button>`:null}
     </div>
     ${ai==='rec'?html`<div className="mt-4 bg-white rounded-lg p-4"><div className="flex items-center gap-3 text-sm font-medium text-red-600"><span className="flex items-end gap-1 h-7">${[0,1,2,3,4,5].map(i=>html`<span key=${i} className="bar" style=${{animationDelay:i*.12+'s'}}></span>`)}</span>Escuchando al profesional…</div><p className="mt-2 text-sm text-slate-600 italic">${tx}</p></div>`:null}
     ${ai==='proc'?html`<div className="mt-4 bg-white rounded-lg p-4 flex items-center gap-3 text-sm text-indigo-700"><span className="animate-spin"><${I} n="Loader2" s=${18}/></span>Redactando nota clínica en formato formal…</div>`:null}
     ${ai==='done'?html`<div className="mt-4 bg-white rounded-lg p-4"><div className="text-xs font-semibold text-emerald-700 flex items-center gap-1 mb-2"><${I} n="CheckCircle2" s=${14}/>Nota generada · revisá y editá antes de guardar</div>
      <textarea value=${draft} onChange=${e=>setDraft(e.target.value)} rows="5" className="w-full text-sm p-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
      <div className="flex justify-end gap-2 mt-2"><button onClick=${()=>{setAi('idle');setTx('')}} className="px-3 py-1.5 text-sm text-slate-600">Descartar</button><button onClick=${save} className="px-4 py-1.5 text-sm rounded-lg bg-emerald-600 text-white font-medium">Guardar evolución</button></div></div>`:null}
    </div>
    <div className="bg-white rounded-xl ring-1 ring-slate-200 p-5">
     <h3 className="font-semibold mb-4 flex items-center justify-between">Historial de evoluciones<span className="text-xs font-normal text-slate-500">${list.length} nota${list.length===1?'':'s'}${zs.length?' · '+zlabel:''}</span></h3>
     ${list.length?html`<ol className="relative border-l-2 border-slate-200 ml-2 space-y-5">${list.map(e=>html`<li key=${e.id} className="pl-5 relative"><span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-blue-600 ring-4 ring-white"></span>
      <div className="flex items-center gap-2 text-xs"><span className="font-semibold text-slate-700">${e.d}</span><span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">${zl(e.z)}</span>${e.pat?html`<span className='px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 font-medium'>${e.pat}</span>`:null}${e.eva!=null?html`<span className='text-slate-500'>EVA ${e.eva}/5</span>`:null}</div>
      <p className="mt-1 text-sm text-slate-600">${e.x}</p></li>`)}</ol>`:html`<p className="text-sm text-slate-400 py-6 text-center">Sin evoluciones registradas${zs.length?' para la selección':''}.</p>`}
    </div>
   </div>
  </div>
 </div>`;
}

function ApptModal({init,pts,appts,onClose,onSave,onDelete,onOpen}){
 const [f,setF]=useState({date:init.date,h:init.h,p:init.p||pts[0].id,t:init.t||''});
 const edit=!!init.id;
 const pat=pts.find(p=>p.id===+f.p)||{};
 const taken=appts.some(a=>a.date===f.date&&a.h===+f.h&&a.id!==init.id);
 const err=!f.date?'Elegí una fecha.':pd(f.date).getDay()===0?'El consultorio atiende de lunes a sábado.':taken?'Ya hay un turno en ese horario.':'';
 const inp='w-full mt-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
 const set=k=>e=>setF({...f,[k]:e.target.value});
 return html`<div className='fixed inset-0 z-50 bg-slate-900/50 grid place-items-center p-4' onClick=${onClose}>
  <div className='bg-white rounded-2xl w-full max-w-md p-6 shadow-xl' onClick=${e=>e.stopPropagation()}>
   <div className='flex justify-between items-center mb-4'><h3 className='text-lg font-bold'>${edit?'Turno agendado':'Nuevo turno'}</h3><button onClick=${onClose} className='text-slate-400 hover:text-slate-700'><${I} n='X'/></button></div>
   <div className='space-y-3'>
    <label className='block text-sm font-medium text-slate-700'>Paciente<select className=${inp} value=${f.p} onChange=${set('p')}>${pts.map(p=>html`<option key=${p.id} value=${p.id}>${p.n}</option>`)}</select></label>
    <div className='grid grid-cols-2 gap-3'>
     <label className='block text-sm font-medium text-slate-700'>Fecha<input type='date' className=${inp} value=${f.date} onChange=${set('date')}/></label>
     <label className='block text-sm font-medium text-slate-700'>Hora<select className=${inp} value=${f.h} onChange=${set('h')}>${HRS.map(h=>html`<option key=${h} value=${h}>${h}:00</option>`)}</select></label></div>
    <label className='block text-sm font-medium text-slate-700'>Motivo / tratamiento<input className=${inp} value=${f.t} onChange=${set('t')} placeholder=${pat.m||'Sesión de kinesiología'}/></label>
    ${err?html`<p className='text-sm text-red-600 flex items-center gap-1.5'><${I} n='X' s=${14}/>${err}</p>`:null}
   </div>
   <div className='mt-5 flex flex-wrap justify-between gap-2'>
    <div className='flex gap-2'>${edit?html`<button onClick=${()=>onDelete(init.id)} className='px-3 py-2 text-sm rounded-lg text-red-600 hover:bg-red-50'>Eliminar</button><button onClick=${()=>onOpen(+f.p)} className='px-3 py-2 text-sm rounded-lg text-blue-600 hover:bg-blue-50'>Abrir ficha</button>`:null}</div>
    <div className='flex gap-2'><button onClick=${onClose} className='px-4 py-2 text-sm rounded-lg text-slate-600'>Cancelar</button><button disabled=${!!err} onClick=${()=>onSave({id:init.id,date:f.date,h:+f.h,p:+f.p,t:f.t.trim()||pat.m||'Sesión'})} className='px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium disabled:opacity-40'>${edit?'Guardar cambios':'Agendar turno'}</button></div>
   </div></div></div>`;
}

function Agenda({pts,open,appts,setAppts}){
 const [view,setView]=useState('week'),[anc,setAnc]=useState(pd(TODAY)),[dayI,setDayI]=useState(1),[mod,setMod]=useState(null);
 const nm=id=>(pts.find(p=>p.id===id)||{n:'?'}).n;
 const by={};appts.forEach(a=>{(by[a.date]=by[a.date]||[]).push(a)});
 const mon=mondayOf(anc),wk=DIAS.map((_,i)=>addD(mon,i));
 const y=anc.getFullYear(),mo=anc.getMonth();
 const step=n=>setAnc(view==='week'?addD(anc,7*n):new Date(y,mo+n,1));
 const first=new Date(y,mo,1),off=(first.getDay()+6)%7,dim=new Date(y,mo+1,0).getDate(),rows=Math.ceil((off+dim)/7);
 const start=mondayOf(first);
 const label=view==='week'?wk[0].getDate()+' '+MESES[wk[0].getMonth()].slice(0,3)+' – '+wk[5].getDate()+' '+MESES[wk[5].getMonth()].slice(0,3)+' '+wk[5].getFullYear():cap(MESES[mo])+' '+y;
 const count=view==='week'?wk.reduce((a,d)=>a+(by[ymd(d)]||[]).length,0):appts.filter(a=>a.date.startsWith(y+'-'+pad(mo+1))).length;
 const save=a=>{if(a.id)setAppts(appts.map(x=>x.id===a.id?a:x));else setAppts([...appts,{...a,id:Date.now()}]);setMod(null)};
 const del=id=>{setAppts(appts.filter(x=>x.id!==id));setMod(null)};
 const nuevo=(date,h)=>setMod({date,h:h||8});
 const tab=(v,l)=>html`<button key=${v} onClick=${()=>setView(v)} className=${'px-3.5 py-1.5 text-sm rounded-md '+(view===v?'bg-blue-600 text-white':'text-slate-600 hover:bg-slate-100')}>${l}</button>`;
 return html`<div>
  <div className='flex flex-wrap items-center justify-between gap-3 mb-4'>
   <div><h1 className='text-2xl font-bold'>Agenda de turnos</h1><p className='text-sm text-slate-500'>Lunes a sábados de 8:00 a 20:00 hs</p></div>
   <div className='flex flex-wrap items-center gap-2'>
    <span className='text-xs px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'>${count} turnos ${view==='week'?'esta semana':'en el mes'}</span>
    <button onClick=${()=>nuevo(view==='week'&&ymd(wk[dayI])||TODAY)} className='px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-2'><${I} n='Plus' s=${16}/>Nuevo turno</button></div>
  </div>
  <div className='flex flex-wrap items-center justify-between gap-3 mb-3'>
   <div className='flex gap-1 bg-white p-1 rounded-lg ring-1 ring-slate-200'>${tab('week','Semana')}${tab('month','Mes')}</div>
   <div className='flex items-center gap-2'>
    <button onClick=${()=>step(-1)} className='p-2 rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50' title='Anterior'><${I} n='ArrowRight' s=${16} c='rotate-180'/></button>
    <span className='min-w-[170px] text-center font-semibold text-slate-800'>${label}</span>
    <button onClick=${()=>step(1)} className='p-2 rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50' title='Siguiente'><${I} n='ArrowRight' s=${16}/></button>
    <button onClick=${()=>{setAnc(pd(TODAY));setDayI(1)}} className='px-3 py-2 text-sm rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50'>Hoy</button></div>
  </div>
  <div className='flex gap-1 mb-3 overflow-x-auto'>${MESES.map((n,i)=>html`<button key=${n} onClick=${()=>{setAnc(new Date(y,i,1));setView('month')}} className=${'px-3 py-1 text-xs rounded-full ring-1 whitespace-nowrap '+(i===mo?'bg-slate-900 text-white ring-slate-900':'bg-white ring-slate-200 text-slate-600 hover:bg-slate-50')}>${cap(n.slice(0,3))}</button>`)}
   <span className='flex items-center gap-1 ml-2 text-xs text-slate-500'><button onClick=${()=>setAnc(new Date(y-1,mo,1))} className='px-1.5 hover:text-slate-900'>‹</button>${y}<button onClick=${()=>setAnc(new Date(y+1,mo,1))} className='px-1.5 hover:text-slate-900'>›</button></span></div>
  ${view==='week'?html`<div>
   <div className='flex gap-1 mb-3 md:hidden'>${wk.map((d,i)=>html`<button key=${i} onClick=${()=>setDayI(i)} className=${'flex-1 py-1.5 text-xs rounded-md '+(dayI===i?'bg-blue-600 text-white':'bg-white ring-1 ring-slate-200')}>${DIAS[i]} ${d.getDate()}</button>`)}</div>
   <div className='bg-white rounded-xl ring-1 ring-slate-200 overflow-x-auto'><div className='grid min-w-[300px] md:min-w-[780px]' style=${{gridTemplateColumns:'56px repeat(6,minmax(0,1fr))'}}>
    <div></div>${wk.map((d,i)=>{const t=ymd(d)===TODAY;return html`<div key=${i} className=${'text-center text-sm font-semibold py-3 border-b border-slate-200 '+(i===dayI?'':'max-md:hidden ')+(t?'text-blue-700 bg-blue-50':'')}>${DIAS[i]} ${d.getDate()}${t?html`<span className='block text-[10px] font-medium text-blue-500'>HOY</span>`:null}</div>`})}
    ${HRS.map(h=>html`<${React.Fragment} key=${h}><div className='text-xs text-slate-400 text-right pr-2 pt-2 border-b border-slate-100 h-14'>${h}:00</div>
     ${wk.map((d,i)=>{const k=ymd(d),a=(by[k]||[]).find(x=>x.h===h);return html`<div key=${i} className=${'border-b border-l border-slate-100 p-1 h-14 '+(i===dayI?'':'max-md:hidden')}>
      ${a?html`<button onClick=${()=>setMod(a)} className='w-full h-full text-left rounded-lg bg-blue-50 border-l-4 border-blue-600 px-2 py-1 hover:bg-blue-100 overflow-hidden'><div className='text-xs font-semibold text-blue-900 truncate'>${nm(a.p)}</div><div className='text-[11px] text-blue-700/70 truncate'>${a.t}</div></button>`:html`<button onClick=${()=>nuevo(k,h)} title='Agendar turno' className='w-full h-full rounded-lg text-slate-300 opacity-0 hover:opacity-100 hover:bg-slate-50 grid place-items-center'><${I} n='Plus' s=${16}/></button>`}</div>`})}<//>`)}
   </div></div></div>`:html`<div className='bg-white rounded-xl ring-1 ring-slate-200 overflow-x-auto'><div className='min-w-[640px]'>
   <div className='grid grid-cols-6 border-b border-slate-200'>${DIAS.map(d=>html`<div key=${d} className='text-center text-xs font-semibold text-slate-500 py-2.5'>${d}</div>`)}</div>
   ${Array.from({length:rows}).map((_,r)=>html`<div key=${r} className='grid grid-cols-6'>${DIAS.map((_,c)=>{const d=addD(start,r*7+c),k=ymd(d),inM=d.getMonth()===mo,list=(by[k]||[]).sort((a,b)=>a.h-b.h);return html`<div key=${c} onClick=${()=>nuevo(k)} className=${'min-h-[104px] p-1.5 border-b border-l border-slate-100 cursor-pointer hover:bg-slate-50 '+(inM?'':'bg-slate-50/60')}>
     <div className='flex items-center justify-between'><button onClick=${e=>{e.stopPropagation();setAnc(d);setDayI(c);setView('week')}} title='Ver semana' className=${'text-xs w-6 h-6 rounded-full grid place-items-center hover:bg-blue-100 '+(k===TODAY?'bg-blue-600 text-white hover:bg-blue-600':inM?'text-slate-700':'text-slate-300')}>${d.getDate()}</button></div>
     <div className='mt-1 space-y-1'>${list.slice(0,3).map(a=>html`<button key=${a.id} onClick=${e=>{e.stopPropagation();setMod(a)}} className='w-full text-left text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-900 border-l-2 border-blue-600 truncate hover:bg-blue-100'>${a.h}:00 ${nm(a.p).split(' ')[0]}</button>`)}${list.length>3?html`<div className='text-[10px] text-slate-500 px-1'>+${list.length-3} más</div>`:null}</div></div>`})}</div>`)}
  </div></div>`}
  <p className='text-xs text-slate-400 mt-3'>Tocá un horario libre o un día del mes para agendar un turno manual. Tocá un turno para ver, editar o eliminar.</p>
  ${mod?html`<${ApptModal} init=${mod} pts=${pts} appts=${appts} onClose=${()=>setMod(null)} onSave=${save} onDelete=${del} onOpen=${open}/>`:null}
 </div>`;
}

const FCATS=[
['Atendé a más pacientes','Llená tu agenda y hacé que sacar turno sea simple.','CalendarDays',[
['CalendarDays','Agenda de turnos','Vista día, semana y mes, con varios profesionales y sesiones recurrentes.','G','agenda'],
['CalendarCheck','Reserva online','Una página propia donde tus pacientes sacan turno solos, sin llamar.','G'],
['RefreshCw','Sincronización de calendario','Tus turnos en Google, Apple u Outlook, y el calendario de cada profesional dentro de tu agenda.','G'],
['QrCode','Ficha por QR','El paciente completa sus datos y antecedentes desde el celular; vos aprobás antes de guardar.','G'],
['UserCircle','Portal del paciente','Un link por paciente con sus turnos, sesiones restantes, saldo y ejercicios indicados.','G']]],
['Mejorá tu atención','Toda la historia clínica de tus pacientes, ordenada y a mano.','Activity',[
['FileText','Ficha clínica','Antecedentes, cirugías, alergias y evoluciones fechadas de cada paciente.','G','chart'],
['Activity','Mapa corporal','Registrá patologías por región anatómica, de la cervical al pie, con lateralidad.','G','chart'],
['ClipboardList','Evoluciones por sesión','Cada sesión con su fecha y profesional, correcciones que no borran y firma del paciente.','G','chart'],
['Ruler','Evaluación funcional','Goniometría, fuerza muscular y evaluación postural guardadas con fecha para comparar.','G'],
['LineChart','Escalas y test','EVA, Oswestry, DASH, LEFS y más, con gráfico de evolución entre controles.','G'],
['Dumbbell','Plan de ejercicios','Armá rutinas con video y repeticiones y enviáselas al paciente para hacer en casa.','G'],
['Bandage','Rehabilitación post-quirúrgica','Protocolos por cirugía (LCA, manguito, prótesis) con fases y criterios de progresión.','G'],
['Image','Fotos y archivos','Radiografías, resonancias, ecografías, fotos posturales y videos de marcha en la ficha.','G'],
['Video','Análisis de movimiento','Compará videos de marcha o de gesto deportivo antes y después del tratamiento.','G']]],
['Concretá más tratamientos','Del plan de sesiones al cobro, sin planillas sueltas.','Wallet',[
['Receipt','Planes y paquetes de sesiones','Armá el plan por sesiones, que lo firmen desde el celular y descontá cada sesión realizada.','G'],
['Tag','Lista de prestaciones','Cargá tus prácticas con precio y duración, listas para presupuestar y dar turnos.','G'],
['HeartPulse','Programas especializados','Suelo pélvico, respiratoria, neurológica y deportiva, con fichas y protocolos propios.','G','chart'],
['Wallet','Caja y reportes','Cobros y gastos, con cuánto te quedás, cómo te pagan y quién te debe.','G'],
['ShieldCheck','Obras sociales y prepagas','Cobertura por práctica, órdenes y sesiones autorizadas, copago y saldos pendientes.','G','patients'],
['Percent','Comisiones y liquidaciones','El % de cada profesional sobre lo cobrado, lo ya pagado y lo que le debés.','G'],
['Stethoscope','Derivaciones y médicos','Registrá al médico derivante y la orden, y enviale informes de evolución.','G']]],
['Ordená tu consultorio','Pacientes, documentos y equipo en un solo lugar.','Building2',[
['Users','Pacientes (CRM)','Cargá y encontrá a tus pacientes en segundos, con su ficha siempre a mano.','G','patients'],
['FileSignature','Documentos y firma','Consentimientos (terapia manual, punción seca) firmados desde el celular, sin imprimir.','G'],
['UserPlus','Equipo y profesionales','Alta de cada profesional con su horario y su color.','G'],
['Package','Insumos y equipamiento','Catálogo de insumos (vendas, kinesiotape, geles) con unidad y costo.','G'],
['Upload','Importar tus datos','Traé pacientes, historias y saldos desde un CSV, con vista previa antes de crear nada.','G'],
['Lock','Roles y permisos','Usuario propio para cada uno y secretaría sin acceso a facturación ni a historias.','G'],
['Building2','Sedes y sucursales','Varias sedes en una cuenta, con horarios y agenda por sede.','G'],
['MessageSquare','Mensajes del equipo','Un chat interno para avisar quién llegó o qué cobrar, sin usar tu WhatsApp.','IA'],
['Plug','Conectar Claude o ChatGPT','Consultá tu agenda, tus pacientes y tus números desde tu propio asistente.','IA']]],
['Comunicá y crecé','Tu web, WhatsApp y emails a pacientes, y recomendá Kinetika a colegas.','Megaphone',[
['MessageCircle','Recordatorios por WhatsApp','El recordatorio listo para enviar, o automático desde tu número o el de Kinetika.','IA'],
['Globe','Página web del consultorio','Tu propia página con los servicios y el equipo que ya cargaste en el sistema.','G'],
['Mail','Campañas de email','Recordatorios, cumpleaños y seguimientos firmados con el nombre de tu consultorio.','G'],
['Gift','Programa de partners','Recomendá Kinetika con tu link y ganá una comisión por tus referidos.','P']]],
['Tu clínica con IA','La inteligencia artificial que te ahorra tiempo. Cada uso consume créditos.','Sparkles',[
['Mic','Notas clínicas con IA','Grabás la sesión y te vuelve la nota formal, con opciones de plan según tu lista de prestaciones.','IA','chart'],
['Sparkles','Dictado y redacción IA','Dictá la evolución y pedile a la IA textos para el paciente: indicaciones e informes.','IA','chart'],
['Bot','Asistente del consultorio','Preguntale por pacientes, agenda y números, pedile que cargue por vos y pasale tus fichas en papel.','IA'],
['FileCheck','Informes para obra social','Informes de evolución y justificación de sesiones generados en segundos.','IA'],
['ScanLine','Análisis de imágenes con IA','Sugiere zonas a revisar en tus estudios por imágenes. El diagnóstico sigue siendo tuyo.','IA'],
['Share2','Contenido para redes','Posts con la identidad de tu consultorio: la imagen, el texto y la frase.','IA']]]];

function Features({go}){
 const [cat,setCat]=useState(-1);
 const tg={G:['Gratis','bg-emerald-50 text-emerald-700 ring-emerald-200'],IA:['Plan IA','bg-indigo-50 text-indigo-700 ring-indigo-200'],P:['Pronto','bg-amber-50 text-amber-700 ring-amber-200']};
 const total=FCATS.reduce((a,c)=>a+c[3].length,0);
 return html`<div>
  <div className='text-center max-w-2xl mx-auto mb-6'><h1 className='text-3xl font-bold'>Todo tu consultorio, en un solo lugar</h1><p className='mt-2 text-slate-600'>${total} funcionalidades pensadas para kinesiólogos y fisioterapeutas. La gestión es gratis y sin límite de pacientes; la IA se paga aparte.</p></div>
  <div className='flex flex-wrap gap-1.5 justify-center mb-8'>${[['Todas',-1]].concat(FCATS.map((c,i)=>[c[0],i])).map(([l,i])=>html`<button key=${l} onClick=${()=>setCat(i)} className=${'px-3 py-1.5 rounded-full text-xs font-medium ring-1 '+(cat===i?(i===5?'bg-indigo-600 text-white ring-indigo-600':'bg-blue-600 text-white ring-blue-600'):'bg-white ring-slate-300 text-slate-600 hover:bg-slate-50')}>${l}</button>`)}</div>
  ${FCATS.map((c,ci)=>cat===-1||cat===ci?html`<section key=${c[0]} className='mb-9'>
   <div className='flex items-center gap-2'><span className=${'w-8 h-8 rounded-lg grid place-items-center '+(ci===5?'bg-indigo-100 text-indigo-600':'bg-blue-100 text-blue-600')}><${I} n=${c[2]} s=${17}/></span><h2 className='text-lg font-bold'>${c[0]}</h2></div>
   <p className='text-sm text-slate-500 mt-1 mb-3'>${c[1]}</p>
   <div className='grid sm:grid-cols-2 xl:grid-cols-3 gap-3'>${c[3].map(f=>html`<div key=${f[1]} className=${'bg-white rounded-xl p-4 ring-1 flex flex-col '+(ci===5?'ring-indigo-200':'ring-slate-200')}>
    <div className='flex items-start justify-between'><span className=${'w-12 h-12 rounded-xl grid place-items-center '+(f[3]==='G'?'bg-blue-50 text-blue-600':f[3]==='IA'?'bg-indigo-50 text-indigo-600':'bg-amber-50 text-amber-600')}><${I} n=${f[0]} s=${24}/></span><span className=${'text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 '+tg[f[3]][1]}>${tg[f[3]][0]}</span></div>
    <h3 className='mt-3 font-semibold text-slate-900'>${f[1]}</h3><p className='mt-1 text-sm text-slate-600 flex-1'>${f[2]}</p>
    ${f[4]?html`<button onClick=${()=>go(f[4])} className='mt-3 text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 self-start'>Ver en el demo <${I} n='ArrowRight' s=${14}/></button>`:null}</div>`)}</div></section>`:null)}
  <div className='rounded-2xl bg-slate-900 text-white p-6 text-center'><h3 className='text-xl font-bold'>Empezá gratis con todas estas funciones</h3><p className='text-sm text-slate-300 mt-1'>Sin tarjeta y sin límite de pacientes. La IA y el WhatsApp automático se pagan aparte.</p><button onClick=${()=>go('pricing')} className='mt-4 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 font-semibold text-sm'>Ver planes</button></div>
 </div>`;
}

function Pricing({go}){
 const [yr,setYr]=useState(false);
 const R=[['Agenda de turnos ilimitada',1,1],['Pacientes ilimitados',1,1],['CRM y obras sociales',1,1],['Ficha clínica y evoluciones',1,1],['Mapa corporal interactivo',1,1],['Dictado por voz → nota clínica',0,1],['Resumen automático del historial',0,1],['Informes para obra social con IA',0,1],['Sugerencia de plan de ejercicios',0,1],['Recordatorios inteligentes por WhatsApp',0,1]];
 const price=yr?'$11.900':'$14.900';
 return html`<div>
  <div className="text-center max-w-2xl mx-auto mb-8"><h1 className="text-3xl font-bold">Gratis para gestionar. IA solo si la necesitás.</h1><p className="mt-2 text-slate-600">La gestión de turnos y pacientes nunca tiene costo. Activá el módulo de inteligencia artificial cuando quieras ahorrar tiempo.</p>
   <div className="inline-flex mt-5 p-1 bg-white ring-1 ring-slate-200 rounded-lg text-sm">${[['Mensual',false],['Anual −20%',true]].map(([l,v])=>html`<button key=${l} onClick=${()=>setYr(v)} className=${'px-4 py-1.5 rounded-md '+(yr===v?'bg-slate-900 text-white':'text-slate-600')}>${l}</button>`)}</div></div>
  <div className="grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">
   <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6"><h3 className="font-bold text-lg">Kinetika Gratis</h3><div className="mt-2 text-4xl font-extrabold">$0<span className="text-base font-medium text-slate-500"> / siempre</span></div>
    <ul className="mt-5 space-y-2.5 text-sm">${R.map(([t,f])=>html`<li key=${t} className=${'flex gap-2 '+(f?'':'text-slate-400')}><span className=${f?'text-emerald-600':'text-slate-300'}><${I} n=${f?'CheckCircle2':'Lock'} s=${17}/></span>${t}</li>`)}</ul>
    <button onClick=${()=>go('patients')} className="mt-6 w-full py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm">Empezar gratis</button></div>
   <div className="bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl p-6 shadow-xl shadow-indigo-600/20 relative"><span className="absolute top-4 right-4 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/20">MÁS ELEGIDO</span>
    <h3 className="font-bold text-lg flex items-center gap-2"><${I} n="Sparkles" s=${18}/>Kinetika IA</h3><div className="mt-2 text-4xl font-extrabold">${price}<span className="text-base font-medium text-indigo-200"> / mes</span></div>
    <p className="text-xs text-indigo-200 mt-1">${yr?'Facturado anualmente':'Cancelá cuando quieras'} · Todo lo del plan gratis, más:</p>
    <ul className="mt-5 space-y-2.5 text-sm">${R.map(([t,f,p])=>html`<li key=${t} className="flex gap-2"><span className=${f?'text-indigo-300':'text-emerald-300'}><${I} n="CheckCircle2" s=${17}/></span>${t}${f?'':html`<span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/20 h-fit">IA</span>`}</li>`)}</ul>
    <button onClick=${()=>go('chart')} className="mt-6 w-full py-2.5 rounded-xl bg-white text-indigo-700 font-semibold text-sm">Probar la IA en la demo</button></div>
  </div></div>`;
}

function App(){
 const [view,setView]=useState('landing'),[col,setCol]=useState(false),[modal,setModal]=useState(false);
 const [appts,setAppts]=useState(APPTS0),[pts,setPts]=useState(P0),[sel,setSel]=useState(1),[ev,setEv]=useState(EV0);
 const go=v=>{setView(v);window.scrollTo(0,0)};
 const open=id=>{setSel(id);go('chart')};
 const add=f=>{const id=Date.now();setPts([{id,n:f.n,a:+f.a||0,t:f.t,os:f.os,e:'Activo',u:'27/10/2026',m:f.m},...pts]);setModal(false);open(id)};
 const addEv=e=>setEv(v=>({...v,[sel]:[...[].concat(e),...(v[sel]||[])]}));
 if(view==='landing')return html`<${Landing} go=${go}/>`;
 const nav=[['landing','Home','Inicio'],['patients','Users','Pacientes'],['chart','FileText','Ficha clínica'],['agenda','CalendarDays','Agenda'],['features','LayoutGrid','Funcionalidades'],['pricing','Sparkles','Planes e IA']];
 return html`<div className="flex min-h-screen">
  <aside className=${'sticky top-0 h-screen bg-white border-r border-slate-200 text-slate-600 flex flex-col transition-all shrink-0 '+(col?'w-[68px]':'w-56')}>
   <div className="flex items-center gap-2 px-3 h-14 text-slate-900 font-semibold text-sm">${col?null:html`<img src=${LOGO} alt="Kinetika" className="h-7 w-auto shrink-0"/>`}${col?null:'Kinetika'}<button onClick=${()=>setCol(!col)} title="Menú" className=${'p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 '+(col?'mx-auto':'ml-auto')}><${I} n="Menu" s=${18}/></button></div>
   <nav className="flex-1 px-2.5 pt-2 space-y-0.5">${nav.map(([k,ic,l])=>html`<button key=${k} onClick=${()=>go(k)} title=${l} className=${'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] '+(view===k?'bg-slate-100 text-slate-900 font-medium':'hover:bg-slate-50')}><span className=${'shrink-0 '+(k==='pricing'?'text-indigo-500':view===k?'text-slate-700':'text-slate-400')}><${I} n=${ic} s=${16}/></span>${col?null:l}</button>`)}</nav>
   <div className="p-2.5 space-y-0.5">
    <button className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] hover:bg-slate-50" title="Configuración"><span className="text-slate-400 shrink-0"><${I} n="Settings" s=${16}/></span>${col?null:'Configuración'}</button>
    ${col?null:html`<div className="px-2.5 pt-1 text-[11px] text-slate-400">Lic. Ana Pérez</div>`}
    <button onClick=${()=>go('landing')} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] hover:bg-slate-50" title="Salir"><span className="text-slate-400 shrink-0"><${I} n="LogOut" s=${16}/></span>${col?null:'Salir'}</button>
   </div>
  </aside>
  <main className="flex-1 min-w-0 p-4 md:p-8 max-w-6xl">
   ${view==='patients'?html`<${Patients} pts=${pts.map(p=>({...p,u:lastSes(p,ev[p.id])}))} open=${open} onNew=${()=>setModal(true)}/>`:null}
   ${view==='chart'?html`<${Chart} key=${sel} p=${pts.find(p=>p.id===sel)} evs=${ev[sel]} addEv=${addEv}/>`:null}
   ${view==='agenda'?html`<${Agenda} pts=${pts} open=${open} appts=${appts} setAppts=${setAppts}/>`:null}
   ${view==='pricing'?html`<${Pricing} go=${go}/>`:null}
   ${view==='features'?html`<${Features} go=${go}/>`:null}
  </main>
  ${modal?html`<${Modal} onClose=${()=>setModal(false)} onSave=${add}/>`:null}
 </div>`;
}

export default App;
