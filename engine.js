const hex=(v,n)=>'0x'+v.toString(16).toUpperCase().padStart(n,'0');
const DEF={speed:'100',hz:'',amode:'7',addr:'0x50',op:'w',wdata:'A5 3C 7F',rlen:3,rdata:'',stop:true,aack:true,nidx:''};
const F=['speed','hz','amode','addr','op','wdata','rlen','rdata','stop','aack','nidx'];
function parseRaw(raw){const err=[],g=k=>String(raw[k]??'').trim();
 if(!['100','400','1000','custom'].includes(g('speed')))err.push('Unknown bus speed selection.');
 const khz=g('speed')==='custom'?+g('hz'):+g('speed');if(!(khz>0&&khz<=1000))err.push('Bus speed must be greater than 0 and at most 1000 kbit/s (Standard, Fast, Fast-mode Plus; High-speed mode is not supported).');
 const ten=g('amode')==='10';
 const hx=(s,max,name)=>{s=s.replace(/^0x/i,'');if(!/^[0-9a-f]+$/i.test(s)){err.push(`${name}: "${s}" is not valid hexadecimal.`);return null}const v=parseInt(s,16);if(v>max){err.push(`${name}: 0x${s.toUpperCase()} exceeds ${hex(max,1)}.`);return null}return v};
 const addr=hx(g('addr'),ten?0x3ff:0x7f,'Address'),bytes=(s,n)=>s?s.split(/[\s,]+/).map(x=>hx(x,255,n)):[];
 const op=g('op');let w=[],r=[],n=0;
 if(op!=='r'){w=bytes(g('wdata'),'Write byte');if(!w.length)err.push('Write data is empty.')}
 if(op!=='w'){n=+g('rlen');if(!Number.isInteger(n)||n<1||n>32)err.push('Read length must be an integer from 1 to 32.');
  else if(g('rdata')){r=bytes(g('rdata'),'Read data');if(r.length!==n)err.push(`Read data has ${r.length} byte(s) but read length is ${n}.`)}
  else r=Array.from({length:n},(_,i)=>(0xC0+i)&255)}
 let ni=g('nidx')===''||op==='r'?-1:+g('nidx');if(ni!==-1&&(!Number.isInteger(ni)||ni<0||ni>=w.length)){err.push(`NACK byte index must be 0–${w.length-1}.`);ni=-1}
 return{err,c:{khz,ten,addr,op,w,r,n,stop:!!raw.stop,aack:!!raw.aack,nidx:ni}}}
function build(c){
 const P=1000/c.khz,q=P/4;let t=0,bi=0,m={phase:'Idle',byte:-1,bit:'-'};const pts=[],segs=[],rows=[],notes=[];
 const emit=(s,p,ev)=>pts.push({t,scl:s,sda:p.length?0:1,pull:p,ph:m.phase,byte:m.byte,bit:m.bit,ev}),adv=()=>{t+=q};
 const bit=(v,who,ev)=>{const p=v?[]:[who];emit(0,p,ev);adv();emit(1,p,'SCL rises');adv();adv();emit(0,p,'SCL falls');adv()};
 const start=rep=>{const t0=t;m={phase:rep?'Repeated START':'START',byte:-1,bit:'-'};
  if(rep){emit(0,[],'SDA released while SCL LOW');adv();emit(1,[],'SCL released, line pulled HIGH');adv();emit(1,['M'],'Repeated START: SDA falls while SCL HIGH')}else emit(1,['M'],'START: SDA falls while SCL HIGH');
  adv();emit(0,['M'],'SCL pulled LOW');adv();segs.push({k:'start',disp:rep?'Sr':'START',t0,t1:t,rep})};
 const stop=()=>{const t0=t;m={phase:'STOP',byte:-1,bit:'-'};emit(0,['M'],'SDA pulled LOW while SCL LOW');adv();emit(1,['M'],'SCL released HIGH');adv();emit(1,[],'STOP: SDA released, rises while SCL HIGH');adv();segs.push({k:'stop',disp:'STOP',t0,t1:t});emit(1,[],'Bus idle');adv()};
 const byte=(v,tx,label,k,ack,o)=>{const rx=tx==='M'?'S':'M',idx=bi++,t0=t,rxn=rx==='S'?'slave':'master';m={phase:k==='addr'?'Address':'Data',byte:idx,bit:7};
  for(let i=7;i>=0;i--){m.bit=i;bit((v>>i)&1,tx,`${label} bit ${i} = ${(v>>i)&1}`)}
  const t1=t;m={phase:'ACK',byte:idx,bit:'ACK'};bit(ack?0:1,rx,ack?`ACK: ${rxn} pulls SDA LOW`:`NACK: ${rxn} releases SDA`);
  segs.push({k,disp:o.disp,t0,t1,v,tx,rx,idx,ack,label,info:o.info,rw:o.rw});segs.push({k:'ack',t0:t1,t1:t,ack,tx,rx,idx});
  rows.push({idx,phase:label,value:hex(v,2),dir:tx==='M'?'Master → Slave':'Slave → Master',resp:`${ack?'ACK':'NACK'} (${rxn})`})};
 const addr=(rw,full)=>{const A=c.addr,W=rw?'R':'W';
  if(!c.ten){byte((A<<1)|rw,'M','Address','addr',c.aack,{disp:`${hex(A,2)} + ${W}`,rw:W,info:`Device address ${hex(A,2)} (7-bit) → transmitted byte ${hex((A<<1)|rw,2)} = (${hex(A,2)} << 1) | ${rw}`});return c.aack}
  const hi=A>>8;byte(0xF0|(hi<<1)|rw,'M','Address byte 1','addr',c.aack,{disp:`11110${hi.toString(2).padStart(2,'0')} + ${W}`,rw:W,info:`10-bit prefix 11110 + A[9:8]=${hi.toString(2).padStart(2,'0')} + R/W; device address ${hex(A,3)}`});
  if(!c.aack)return false;
  if(full)byte(A&255,'M','Address byte 2','addr',true,{disp:hex(A&255,2),info:`Second address byte = A[7:0] of ${hex(A,3)}`});return true};
 emit(1,[],'Bus idle');adv();start(false);
 let ok=addr(c.op==='r'&&!c.ten?1:0,true);
 if(!ok)notes.push('Address NACK: slave did not acknowledge. Transfer aborted; master issues STOP.');
 else{
  if(c.op!=='r')for(let i=0;i<c.w.length;i++){const a=i!==c.nidx;byte(c.w[i],'M',c.op==='wr'?`Register/Data ${i}`:`Data ${i}`,'data',a,{disp:hex(c.w[i],2),info:'Write data'});
   if(!a){notes.push(`Data byte ${i} NACKed: remaining ${c.w.length-i-1} write byte(s) and any read phase are not sent. Master issues STOP.`);ok=false;break}}
  if(ok&&(c.op==='wr'||(c.op==='r'&&c.ten))){start(true);ok=addr(1,false);if(!ok)notes.push('Address NACK in read phase: read aborted; master issues STOP.')}
  if(ok&&c.op!=='w')for(let i=0;i<c.n;i++)byte(c.r[i],'S',`Read ${i}`,'data',i<c.n-1,{disp:hex(c.r[i],2),info:i<c.n-1?'Read data; master ACKs to continue':'Last read byte; master NACKs to end the read'})}
 if(!ok||c.stop)stop();else notes.push('No STOP issued: master keeps SCL LOW and holds the bus.');
 return{pts,segs,rows,notes,P,tEnd:t,c}}

function nextState(raw){const{err,c}=parseRaw(raw);return{err,c,tx:err.length?null:build(c)}}
function sanitizeCfg(o){const r={...DEF};if(!o||typeof o!=='object'||Array.isArray(o))return r;
 for(const k of F){if(!(k in o))continue;const v=o[k];
  if(typeof DEF[k]==='boolean'){if(typeof v==='boolean')r[k]=v}else if(typeof v==='string'||typeof v==='number')r[k]=String(v)}
 if(!['100','400','1000','custom'].includes(r.speed))r.speed=DEF.speed;
 if(!['7','10'].includes(r.amode))r.amode=DEF.amode;
 if(!['w','r','wr'].includes(r.op))r.op=DEF.op;
 return r}
function toCsv(tx){const q=s=>'"'+String(s).replace(/"/g,'""')+'"';
 return['Time_us,SCL,SDA,SDA_Pulled_By,Phase,Byte_Index,Bit_Index,Event',...tx.pts.map(p=>[p.t.toFixed(3),p.scl,p.sda,p.pull.join('+')||'none',p.ph,p.byte<0?'':p.byte,p.bit,q(p.ev)].join(','))].join('\n')}
if(typeof module!=='undefined')module.exports={hex,DEF,F,parseRaw,build,nextState,sanitizeCfg,toCsv};
