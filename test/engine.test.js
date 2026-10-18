const test=require('node:test'),assert=require('node:assert/strict');
const{build,parseRaw,nextState,sanitizeCfg,toCsv,DEF}=require('../engine.js');
const raw=o=>({...DEF,...o}),run=o=>{const r=parseRaw(raw(o));assert.deepEqual(r.err,[]);return build(r.c)};
// Independent decoder: uses only (t,scl,sda) samples and the I2C rules, never the engine's own labels.
function decode(pts){const out=[];let bits=[],hi=null,open=false,prev=pts[0];
 const bytes=()=>{while(bits.length>=9){const b=bits.splice(0,9);let v=0;for(let i=0;i<8;i++)v=v*2+b[i];out.push({v,ack:b[8]===0})}};
 for(const p of pts.slice(1)){if(p.scl===prev.scl&&p.sda===prev.sda)continue;
  if(prev.scl&&p.scl){if(hi!==null)bits.pop();assert.equal(bits.length,0,'incomplete byte before START/STOP');hi=null;
   if(p.sda===0){out.push(open?'Sr':'S');open=true}else{out.push('P');open=false}}
  else if(!prev.scl&&p.scl){assert.equal(prev.sda,p.sda,'SDA changed with SCL rise');bits.push(p.sda);hi=p.sda}
  else if(prev.scl&&!p.scl){assert.equal(prev.sda,p.sda,'SDA changed with SCL fall');if(hi!==null)assert.equal(p.sda,hi,'SDA unstable while SCL high');hi=null;bytes()}
  prev=p}
 return out}
const B=(v,ack=true)=>({v,ack});
test('7-bit write, multi-byte',()=>assert.deepEqual(decode(run({wdata:'A5 3C 7F'}).pts),['S',B(0xA0),B(0xA5),B(0x3C),B(0x7F),'P']));
test('7-bit read: master ACK then final NACK',()=>assert.deepEqual(decode(run({op:'r',rlen:2,rdata:'12 34'}).pts),['S',B(0xA1),B(0x12),B(0x34,false),'P']));
test('write, repeated START, read (no STOP between)',()=>assert.deepEqual(decode(run({op:'wr',wdata:'10',rlen:2,rdata:'DE AD'}).pts),['S',B(0xA0),B(0x10),'Sr',B(0xA1),B(0xDE),B(0xAD,false),'P']));
test('address NACK aborts',()=>{const t=run({aack:false});assert.deepEqual(decode(t.pts),['S',B(0xA0,false),'P']);assert.equal(t.rows.length,1);assert.match(t.notes[0],/Address NACK/)});
test('data NACK aborts remaining bytes',()=>{const t=run({nidx:'1'});assert.deepEqual(decode(t.pts),['S',B(0xA0),B(0xA5),B(0x3C,false),'P']);assert.match(t.notes[0],/Data byte 1 NACKed/)});
test('address NACK in read phase of wr aborts read',()=>{const t=run({op:'wr',wdata:'10',rlen:1});assert.ok(decode(t.pts).includes('Sr'))});
test('10-bit write: 11110+A[9:8]+W, then A[7:0]',()=>assert.deepEqual(decode(run({amode:'10',addr:'0x2A5',wdata:'11'}).pts),['S',B(0xF4),B(0xA5),B(0x11),'P']));
test('10-bit read: W header, 2nd byte, Sr, R header, data',()=>assert.deepEqual(decode(run({amode:'10',addr:'0x2A5',op:'r',rlen:2,rdata:'12 34'}).pts),['S',B(0xF4),B(0xA5),'Sr',B(0xF5),B(0x12),B(0x34,false),'P']));
test('10-bit address 0x3FF and 0x000 headers',()=>{assert.equal(decode(run({amode:'10',addr:'0x3FF'}).pts)[1].v,0xF6);assert.equal(decode(run({amode:'10',addr:'0x000'}).pts)[1].v,0xF0)});
test('7-bit address extremes',()=>{assert.equal(decode(run({addr:'0x7F'}).pts)[1].v,0xFE);assert.equal(decode(run({addr:'00'}).pts)[1].v,0x00)});
test('optional STOP omitted keeps bus held',()=>{const t=run({stop:false});assert.notEqual(decode(t.pts).at(-1),'P');assert.match(t.notes.join(),/No STOP/)});
test('open-drain: SDA = LOW iff someone pulls, never two drivers; owners per phase',()=>{
 for(const o of[{},{op:'r',rlen:2,rdata:'12 34'},{amode:'10',op:'wr',addr:'0x2A5'}]){const t=run(o);
  for(const p of t.pts){assert.equal(p.sda,p.pull.length?0:1);assert.ok(p.pull.length<=1)}}
 const t=run({op:'r',rlen:2,rdata:'12 34'});
 for(const p of t.pts){if(p.ph==='Address')assert.ok(p.pull.every(w=>w==='M'));if(p.ph==='Data')assert.ok(p.pull.every(w=>w==='S'));
  if(p.ph==='ACK'&&p.byte===0)assert.ok(p.pull.every(w=>w==='S'));if(p.ph==='ACK'&&p.byte===1)assert.deepEqual(p.pull,['M']);if(p.ph==='ACK'&&p.byte===2)assert.deepEqual(p.pull,[])}});
test('ACK pulls SDA LOW on 9th clock; NACK releases',()=>{const t=run({nidx:'1'});
 const ack=t.pts.filter(p=>p.ph==='ACK'&&p.ev==='SCL rises');assert.deepEqual(ack.map(p=>p.sda),[0,0,1]);assert.equal(t.pts.filter(p=>p.ph==='ACK'&&p.ev==='SCL rises').length,3)});
for(const[khz,P]of[['100',10],['400',2.5],['1000',1]])test(`timing at ${khz} kbit/s`,()=>{
 const t=run({speed:khz,wdata:'A5 3C'}),pts=t.pts,close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
 assert.equal(t.P,P);
 for(let i=1;i<pts.length;i++)assert.ok(pts[i].t>=pts[i-1].t);
 const rise=[],fall=[];pts.forEach((p,i)=>{if(i&&!pts[i-1].scl&&p.scl)rise.push(p.t);if(i&&pts[i-1].scl&&!p.scl)fall.push(p.t)});
 assert.equal(rise.length,28);for(let i=1;i<rise.length;i++)close(rise[i]-rise[i-1],P);
 rise.slice(0,27).forEach(r=>close(fall.find(f=>f>r)-r,P/2));
 const s=pts.find(p=>p.scl===1&&p.sda===0);close(rise[0]-s.t,0.75*P);
 const last=pts.findLast(p=>p.sda===1&&p.scl===1&&p.ev.startsWith('STOP'));close(last.t-rise.at(-1),P/4);close(t.tEnd,pts.at(-1).t+P/4)});
test('validation rejects bad input without truncation',()=>{const bad={addr:['0x80','zz','','0x'],wdata:['','A5 GG','1FF','0x100'],rlen:['0','33','2.5','x',''],hz:['0','-5','1001','abc','']};
 for(const a of bad.addr)assert.ok(parseRaw(raw({addr:a})).err.length,a);
 for(const a of bad.wdata)assert.ok(parseRaw(raw({wdata:a})).err.length,a);
 for(const a of bad.rlen)assert.ok(parseRaw(raw({op:'r',rlen:a})).err.length,a);
 for(const a of bad.hz)assert.ok(parseRaw(raw({speed:'custom',hz:a})).err.length,a);
 assert.ok(parseRaw(raw({speed:'bogus'})).err.length);assert.ok(parseRaw(raw({nidx:'9'})).err.length);assert.ok(parseRaw(raw({op:'r',rlen:3,rdata:'12'})).err.length);
 assert.ok(parseRaw(raw({amode:'10',addr:'0x400'})).err.length);
 for(const a of[{addr:'0x7F'},{addr:'7f'},{amode:'10',addr:'0x3FF'},{speed:'custom',hz:'1000'},{speed:'custom',hz:'37.5'}])assert.deepEqual(parseRaw(raw(a)).err,[],JSON.stringify(a))});
test('stale-state regression: invalid input yields no transaction, valid restores',()=>{
 const a=nextState(raw({}));assert.ok(a.tx);const b=nextState(raw({addr:'0x80'}));assert.equal(b.tx,null);assert.ok(b.err.length);
 const c=nextState(raw({addr:'0x51'}));assert.ok(c.tx);assert.equal(decode(c.tx.pts)[1].v,0xA2)});
test('saved configuration recovery',()=>{
 for(const bad of[null,'x',5,[],undefined])assert.deepEqual(sanitizeCfg(bad),DEF);
 const r=sanitizeCfg({speed:'bogus',amode:'3',op:'zz',addr:5,aack:'yes',stop:false,evil:1});
 assert.equal(r.speed,'100');assert.equal(r.amode,'7');assert.equal(r.op,'w');assert.equal(r.addr,'5');assert.equal(r.aack,true);assert.equal(r.stop,false);assert.ok(!('evil' in r));
 const ok=raw({addr:'0x2A5',amode:'10',op:'r',rlen:'2',speed:'400'});assert.deepEqual(sanitizeCfg(JSON.parse(JSON.stringify(ok))),ok)});
test('CSV structure matches waveform and escapes quotes',()=>{const t=run({op:'wr',wdata:'10',rlen:1,rdata:'AA'}),lines=toCsv(t).split('\n');
 const pl=l=>{const o=[];let c='',q=false;for(let i=0;i<l.length;i++){const ch=l[i];if(q){if(ch==='"'){if(l[i+1]==='"'){c+='"';i++}else q=false}else c+=ch}else if(ch==='"')q=true;else if(ch===','){o.push(c);c=''}else c+=ch}o.push(c);return o};
 assert.equal(lines[0],'Time_us,SCL,SDA,SDA_Pulled_By,Phase,Byte_Index,Bit_Index,Event');assert.equal(lines.length,t.pts.length+1);
 lines.slice(1).forEach((l,i)=>{const f=pl(l),p=t.pts[i];assert.equal(f.length,8);assert.equal(+f[0],+p.t.toFixed(3));assert.equal(+f[1],p.scl);assert.equal(+f[2],p.sda);assert.equal(f[7],p.ev)});
 assert.equal(toCsv({pts:[{t:0,scl:1,sda:1,pull:[],ph:'x',byte:-1,bit:'-',ev:'say "hi", ok'}]}).split('\n')[1].endsWith('"say ""hi"", ok"'),true)});
