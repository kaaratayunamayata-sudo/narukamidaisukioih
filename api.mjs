import { getStore } from '@netlify/blobs';
const NAMES=['hamabenokai','ClumsyShuhei','EnjoyedBshsh','godhand1234','mandicendiiiii','rickey3326','abc315315','asaking 1218','bottikunnn','Marisakami','skYAJU114514','Chaser44','kaninekoheiryo','WearyTwiIight78','FullNiceSandwich','192837465h','dicesoe','studiousEpiccopper','AdroitSturdyCelery','Niwatori0503','JocularHappyClover','kurumi0203','osaruboy0228','blits3939','StellarNeatlyTom','Kingsrennosuke0205','uniuni20131004','02112015','#2CQOVLGLOJ','ComplexGlasses71'];
// 管理者パスワード：Netlifyの環境変数 ADMIN_PASSWORD で変更可（未設定なら narukami）
const PW=process.env.ADMIN_PASSWORD||'narukami';
const init=()=>({players:NAMES.map((name,i)=>({name,sort:i,is_test:false,banned:false})),
 race:{status:'waiting',seed:1,start_at:null,paused_at:null,mode:'designated',winner:'uniuni20131004',announce:'',results:[]},chat:[],nid:1});
const iso=m=>new Date(m).toISOString(),ms=s=>Date.parse(s);
export default async (req)=>{
 if(req.method!=='POST')return Response.json({error:'POST only'},{status:405});
 let b;try{b=JSON.parse(await req.text())}catch{return Response.json({error:'bad request'},{status:400})}
 const s=getStore({name:'marble',consistency:'strong'}),now=Date.now();
 const out=data=>Response.json({data,now}),err=e=>Response.json({error:e});
 const getM=async()=>(await s.get('main',{type:'json'}))||init(),putM=m=>s.setJSON('main',m);
 const getP=async()=>(await s.get('presence',{type:'json'}))||{},putP=p=>s.setJSON('presence',p);
 const op=b.op,n=b.p_name,k=b.p_token;
 if(op==='now_ms')return out(now);
 if(op==='state'){const m=await getM(),p=await getP();
  return Response.json({now,players:m.players,race:m.race,chat:m.chat.slice(-80),presence:Object.entries(p).map(([name,v])=>({name,last_seen:iso(v.t)}))})}
 if(op==='claim_player'){const m=await getM(),pl=m.players.find(x=>x.name===n);if(!pl)return out('notfound');if(pl.banned)return out('banned');
  const p=await getP(),e=p[n];if(e&&e.k!==k&&now-e.t<25000)return out('taken');p[n]={k,t:now};await putP(p);return out('ok')}
 if(op==='heartbeat'){const m=await getM();if(m.players.find(x=>x.name===n)?.banned)return out(false);
  const p=await getP(),e=p[n];if(!e||e.k===k||now-e.t>25000){p[n]={k,t:now};await putP(p);return out(true)}return out(false)}
 if(op==='release_player'){const p=await getP();if(p[n]?.k===k){delete p[n];await putP(p)}return out(true)}
 if(op==='send_chat'){const m=await getM(),p=await getP(),e=p[n],pl=m.players.find(x=>x.name===n);
  if(!e||e.k!==k||now-e.t>25000||!pl||pl.banned)return out('auth');
  const msg=String(b.p_msg||'').trim().slice(0,120);if(!msg)return out('empty');
  const lastMine=[...m.chat].reverse().find(c=>c.name===n);if(lastMine&&now-ms(lastMine.ts)<2000)return out('rate');
  m.chat.push({id:m.nid++,name:n,msg,ts:iso(now),deleted:false});m.chat=m.chat.slice(-300);await putM(m);return out('ok')}
 if(op==='admin'){
  if(b.p_pw!==PW)return err('パスワードが違います');
  const m=await getM(),r=m.race,a=b.p_action,x=String(b.p_arg??'');
  if(a==='ping')return out('ok');
  if(a==='start'){if(!['waiting','aborted'].includes(r.status))return out('リセットしてから開始してください');
   const act=m.players.filter(p=>!p.banned).map(p=>p.name);
   for(let i=act.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[act[i],act[j]]=[act[j],act[i]]}
   if(r.mode==='designated'){const pr=String(r.winner).split(',');const ix=q=>pr.indexOf(q)>=0?pr.indexOf(q):999;act.sort((p,q)=>ix(p)-ix(q))}
   if(act.length<2)return out('参加者が2人以上必要です');
   Object.assign(r,{status:'racing',seed:Math.floor(Math.random()*2e9),start_at:iso(now+9000),paused_at:null,results:act})}
  else if(a==='pause'){if(r.status==='racing'){r.status='paused';r.paused_at=iso(now)}}
  else if(a==='resume'){if(r.status==='paused'){r.start_at=iso(ms(r.start_at)+now-ms(r.paused_at));r.paused_at=null;r.status='racing'}}
  else if(a==='abort')r.status='aborted';
  else if(a==='reset')Object.assign(r,{status:'waiting',start_at:null,paused_at:null,results:[]});
  else if(a==='add_test'){const t=x.trim();if(t.length<1||t.length>30)return out('名前は1〜30文字');if(m.players.some(p=>p.name===t))return out('同名のプレイヤーがいます');
   m.players.push({name:t,sort:Math.max(...m.players.map(p=>p.sort),0)+1,is_test:true,banned:false})}
  else if(a==='delete'){if(['racing','paused'].includes(r.status))return out('レース中は削除できません');m.players=m.players.filter(p=>p.name!==x)}
  else if(a==='ban'||a==='unban'){const p=m.players.find(q=>q.name===x);if(p)p.banned=a==='ban';
   if(a==='ban'){const pr=await getP();delete pr[x];await putP(pr)}}
  else if(a==='set_mode'){if(['random','designated'].includes(x))r.mode=x}
  else if(a==='set_winner')r.winner=x;
  else if(a==='announce'){r.announce=x;if(x)m.chat.push({id:m.nid++,name:'📢 ADMIN',msg:x.slice(0,120),ts:iso(now),deleted:false})}
  else if(a==='del_chat'){const c=m.chat.find(q=>String(q.id)===x);if(c)c.deleted=true}
  else return out('不明な操作');
  await putM(m);return out('ok')}
 return err('unknown op');
};
