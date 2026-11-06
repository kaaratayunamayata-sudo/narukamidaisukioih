const {createClient}=require('@supabase/supabase-js');const crypto=require('crypto');
const E=process.env,sb=createClient(E.SUPABASE_URL||'http://x',E.SUPABASE_SERVICE_KEY||'x');
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const mac=b=>crypto.createHmac('sha256',E.TOKEN_SECRET||'').update(b).digest('base64url');
const sign=p=>{const b=b64(p);return b+'.'+mac(b)};
const same=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const verify=t=>{try{const[b,s]=t.split('.');return same(s,mac(b))&&JSON.parse(Buffer.from(b,'base64url')).exp>Date.now()}catch{return false}};
const bad=(m,c=400)=>{const e=new Error(m);e.code=c;throw e};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const one=async(q)=>{const{data,error}=await q;if(error)bad(error.message,500);return data};
exports.handler=async ev=>{const R=(c,o)=>({statusCode:c,headers:{'content-type':'application/json'},body:JSON.stringify(o)});
 try{return R(200,await run(JSON.parse(ev.body||'{}')))}catch(e){return R(e.code||400,{error:e.message})}};
async function run(d){const a=d.a,cid=String(d.cid||'');
 if(a==='config')return{url:E.SUPABASE_URL,anon:E.SUPABASE_ANON_KEY,now:Date.now()};
 if(a==='login'){const p=E.ADMIN_PASSWORD||'',q=String(d.password||'');if(!p||!same(q,p))bad('パスワードが違います',401);return{token:sign({exp:Date.now()+6*36e5})}}
 if(a==='claim'){const pl=await one(sb.from('players').select('*').eq('name',d.name).maybeSingle());if(!pl)bad('参加者が見つかりません');if(pl.banned)bad('BANされています',403);
  const st=await one(sb.from('race').select('status').eq('id',1).single());if(st.status==='running'||st.status==='paused')bad('レース中は参加できません');
  if(pl.joined&&pl.client_id===cid)return{ok:1};
  await sb.from('players').update({joined:false,client_id:null}).eq('client_id',cid).eq('is_test',false).eq('banned',false);
  const up=await one(sb.from('players').update({joined:true,client_id:cid}).eq('id',pl.id).eq('joined',false).select());if(!up.length)bad('その名前はすでに選ばれています');return{ok:1}}
 if(a==='release'){await sb.from('players').update({joined:false,client_id:null}).eq('client_id',cid).eq('is_test',false).eq('banned',false);return{ok:1}}
 if(a==='chat'){const body=String(d.body||'').trim().slice(0,200);if(!body)bad('empty');const pl=await one(sb.from('players').select('name,banned').eq('client_id',cid).limit(1));
  if(pl[0]&&pl[0].banned)bad('送信が制限されています',403);await one(sb.from('chat').insert({name:pl[0]?pl[0].name:'観戦者',body}));return{ok:1}}
 if(a==='finish'){const r=await one(sb.from('race').select('*').eq('id',1).single());if(r.status!=='running')return{ok:1};
  const t=(Date.now()-new Date(r.started_at))/1e3-r.pause_total_ms/1e3,mf=Math.max(...r.order.map(o=>o.f));if(t<mf)bad('not yet');
  const up=await one(sb.from('race').update({status:'finished',winner:r.order[0].name}).eq('id',1).eq('status','running').select());
  if(up.length)await sb.from('history').insert({winner:r.order[0].name,mode:r.mode,order:r.order});return{ok:1}}
 if(!verify(d.t||''))bad('管理者認証が必要です',401);
 const iso=new Date().toISOString();
 if(a==='start'){const r=await one(sb.from('race').select('*').eq('id',1).single());if(r.status==='running'||r.status==='paused')bad('レース中です');
  const ps=await one(sb.from('players').select('*').eq('joined',true).eq('banned',false));if(ps.length<2)bad('参加者が2名以上必要です');
  let o=shuffle([...ps]);if(r.mode==='show'){const i=o.findIndex(p=>p.name===r.target);if(i<0)bad('演出モードの指定プレイヤーが待機していません');o.unshift(o.splice(i,1)[0])}
  const n=o.length,order=o.map((p,k)=>({name:p.name,color:p.color,test:p.is_test,f:+(160+(k/(n-1))*14+Math.random()*.3).toFixed(2),s:crypto.randomInt(1e9)}));
  await one(sb.from('race').update({status:'running',seed:crypto.randomInt(1e9),started_at:iso,paused_at:null,pause_total_ms:0,order,winner:null}).eq('id',1).select());return{ok:1}}
 if(a==='pause')await one(sb.from('race').update({status:'paused',paused_at:iso}).eq('id',1).eq('status','running').select());
 if(a==='resume'){const r=await one(sb.from('race').select('*').eq('id',1).single());if(r.status==='paused')await sb.from('race').update({status:'running',paused_at:null,pause_total_ms:Number(r.pause_total_ms)+Date.now()-new Date(r.paused_at)}).eq('id',1)}
 if(a==='cancel'||a==='reset')await sb.from('race').update({status:'idle',order:[],winner:null,started_at:null,paused_at:null,pause_total_ms:0}).eq('id',1);
 if(a==='mode'){const r=await one(sb.from('race').select('status').eq('id',1).single());if(r.status==='running'||r.status==='paused')bad('レース中は変更できません');await sb.from('race').update({mode:d.mode==='show'?'show':'normal',target:d.target||'uniuni20131004'}).eq('id',1)}
 if(a==='addPlayer'){const name=String(d.name||'').trim();if(!name)bad('名前が必要です');await one(sb.from('players').insert({name,color:d.color||'#ffd24a',is_test:!!d.test,joined:!!d.test}))}
 if(a==='removePlayer')await sb.from('players').delete().eq('id',d.id);
 if(a==='ban')await sb.from('players').update(d.flag?{banned:true,joined:false}:{banned:false}).eq('id',d.id);
 if(a==='delChat')await sb.from('chat').delete().eq('id',d.id);
 if(a==='history')return{rows:await one(sb.from('history').select('*').order('id',{ascending:false}).limit(20))};
 return{ok:1}}
