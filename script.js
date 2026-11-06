const $=s=>document.querySelector(s),el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
let sb,off=0,players=[],race={status:'idle',order:[],pause_total_ms:0},chat=[],online=new Set(),tok=sessionStorage.tok||'',curSeed=null,curve,marbles={},scene,cam,ren,camP=null,fin=false;
const cid=localStorage.cid||(localStorage.cid=crypto.randomUUID());
async function api(a,d={}){const r=await fetch('/.netlify/functions/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({a,t:tok,cid,...d})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'通信エラー');return j}
const now=()=>Date.now()+off,T=Date.now;
function rt(){if(!race.started_at||race.status==='idle')return -1;const ref=race.status==='paused'?new Date(race.paused_at).getTime():now();return(ref-new Date(race.started_at).getTime()-race.pause_total_ms)/1e3}
const rng=s=>()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const meP=()=>players.find(p=>p.client_id===cid&&p.joined);
async function load(){const[p,r,c]=await Promise.all([sb.from('players').select('*').order('created_at'),sb.from('race').select('*').eq('id',1).single(),sb.from('chat').select('*').order('id',{ascending:false}).limit(80)]);
 players=p.data||players;race=r.data||race;chat=(c.data||[]).reverse();if(race.seed!==curSeed)buildCourse(race.seed);ui()}
async function init(){const cfg=await api('config');off=cfg.now-T();sb=supabase.createClient(cfg.url,cfg.anon);
 sb.channel('db').on('postgres_changes',{event:'*',schema:'public'},()=>load()).subscribe();
 const ch=sb.channel('room',{config:{presence:{key:cid}}});ch.on('presence',{event:'sync'},()=>{online=new Set(Object.keys(ch.presenceState()));ui()}).subscribe(s=>s==='SUBSCRIBED'&&ch.track({t:T()}));
 init3d();await load();if(location.hash==='#admin')adminUI();requestAnimationFrame(loop);setInterval(()=>{if(race.status!=='idle')rankUI()},500)}
function ui(){const run=['running','paused'].includes(race.status);
 $('#stat').textContent=`🟢 オンライン ${online.size}人 ／ 参加 ${players.filter(p=>p.joined).length}人 ／ ${({idle:'開始待ち',running:'レース中',paused:'一時停止中',finished:'結果発表'})[race.status]}`;
 $('#mode').hidden=race.mode!=='show';
 const lb=$('#lobby');lb.hidden=run||race.status==='finished';if(!lb.hidden){lb.replaceChildren();lb.append(el('h2','',meP()?`待機中：${meP().name}`:'あなたのアカウントを選んでください'),el('div','','管理者が開始するまでレースは始まりません。'));
  const g=el('div','grid');players.forEach(p=>{const b=el('button','pb'+(meP()?.id===p.id?' me':''));const taken=p.joined&&p.client_id!==cid;b.disabled=p.banned||taken||!!(meP()&&meP().id!==p.id&&false);
   b.append(Object.assign(el('span','dot'+(online.has(p.client_id)?' on':'')),{}),Object.assign(el('span','sw'),{style:'background:'+p.color}),el('span','',p.name));if(p.is_test)b.append(el('span','tag','TEST'));if(p.banned)b.append(el('span','tag','BAN'));if(p.joined&&!p.is_test)b.append(el('span','tag','待機'));
   b.onclick=async()=>{try{if(meP()?.id===p.id)await api('release');else await api('claim',{name:p.name});load()}catch(e){alert(e.message)}};g.append(b)});lb.append(g)}
 const rs=$('#res');rs.hidden=race.status!=='finished';if(!rs.hidden)result();
 const m=$('#msgs'),bottom=m.scrollTop+m.clientHeight>=m.scrollHeight-20;m.replaceChildren(...chat.map(c=>{const d=el('div');d.append(el('b','',c.name),el('small','',' '+new Date(c.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})+' '),el('span','',c.body));
  if(tok){const x=el('button','',' ✕');x.style.cssText='background:0;border:0;color:#f88';x.onclick=()=>api('delChat',{id:c.id});d.append(x)}return d}));if(bottom)m.scrollTop=m.scrollHeight;rankUI();if(tok)adminUI()}
function ranking(){const t=rt();return race.order.map((o,i)=>({o,i,p:prog(o,t)})).sort((a,b)=>(b.p>=1)-(a.p>=1)||(b.p>=1?a.o.f-b.o.f:b.p-a.p))}
function prog(o,t){const u=Math.min(1,Math.max(0,(t-15)/(o.f-15)));const r=rng(o.s),a=(r()-.5)*.16,k=2+r()*4,ph=r()*6.28;return u>=1?1:Math.max(0,Math.min(1,u+a*Math.sin(6.283*k*u+ph)*Math.sin(Math.PI*u)))}
function rankUI(){const rk=$('#rank');if(!race.order.length||race.status==='idle'){rk.textContent='順位：レース開始後に表示';return}rk.replaceChildren(...ranking().map((x,n)=>{const r=el('div','r');r.append(el('i','',n+1),Object.assign(el('span','sw'),{style:'background:'+x.o.color}),el('span','',x.o.name+(x.o.test?' (TEST)':'')));return r}))}
$('#cf').onsubmit=async e=>{e.preventDefault();const v=$('#ci').value.trim();if(!v)return;$('#ci').value='';try{await api('chat',{body:v})}catch(x){alert(x.message)}};
const CAST=['先頭集団が接近しています！','ここで大きく順位が変わった！','急加速！一気に抜き去った！','カーブで大きく減速！','接戦です、誰が抜け出すのか！','螺旋コースで順位が入れ替わる！','後半戦、勝負はまだ分かりません！','ゴール目前、最後の追い上げです！','最終盤の大接戦！'];
function hud(t){const run=race.status!=='idle';$('#timer').textContent=!run?'':t<0?'':t<15?'START '+Math.ceil(15-t):'残り '+Math.max(0,Math.ceil(180-t))+'秒';
 let c='';if(run&&race.status!=='finished'){if(t<15)c='まもなくスタート！';else if(t>=150)c=t>165?'ゴール！順位確定！':CAST[7];else if(t>=150-30&&t<151&&Math.floor(t)>=150)c='';else{const r=rng(race.seed+Math.floor(t/7));c=t>=120&&t<135&&Math.floor(t)===120?'残り60秒！':t>=90?CAST[3+Math.floor(r()*6)]:CAST[Math.floor(r()*6)]}}if(race.status==='paused')c='⏸ 一時停止中';$('#cast').style.visibility=c?'visible':'hidden';$('#cast').textContent=c}
function result(){const w=race.order[0]&&race.order.find(o=>o.name===race.winner)||race.order[0];const rs=$('#res');if(rs.dataset.k===String(race.started_at))return;rs.dataset.k=race.started_at;rs.replaceChildren();
 for(let i=0;i<70;i++){const c=el('span','cf');c.style.cssText=`left:${Math.random()*100}%;background:hsl(${Math.random()*360},90%,60%);animation-duration:${2+Math.random()*3}s;animation-delay:${Math.random()*3}s`;rs.append(c)}
 const sw=el('div');sw.style.cssText=`width:90px;height:90px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff,${w.color});box-shadow:0 0 40px ${w.color}`;
 rs.append(el('h2','','CHAMPION!'),sw,el('div','w',w.name),el('div','','BRO PASS WINNER'+(race.mode==='show'?'（演出モード）':'')));
 const l=el('div');l.style.cssText='max-height:28vh;overflow:auto;margin-top:8px;font-size:14px;text-align:left';race.order.forEach((o,i)=>l.append(el('div','',`${i+1}位 ${o.name}`)));rs.append(l,el('div','','レース時間：約3分'),el('div','','もう一度行う場合は管理者のリセット後、待機画面に戻ります'))}
function init3d(){const cv=$('#cv');ren=new THREE.WebGLRenderer({canvas:cv,antialias:true});scene=new THREE.Scene();scene.background=new THREE.Color(0x060822);scene.fog=new THREE.Fog(0x060822,60,260);cam=new THREE.PerspectiveCamera(60,1,.1,600);
 scene.add(new THREE.HemisphereLight(0x9bb0ff,0x201040,1.1));const dl=new THREE.DirectionalLight(0xffffff,.9);dl.position.set(30,80,20);scene.add(dl);
 const rz=()=>{const s=$('#stage');ren.setPixelRatio(Math.min(2,devicePixelRatio));ren.setSize(s.clientWidth,s.clientHeight,false);cam.aspect=s.clientWidth/s.clientHeight;cam.updateProjectionMatrix()};addEventListener('resize',rz);rz()}
let courseGroup;function buildCourse(seed){curSeed=seed;if(courseGroup)scene.remove(courseGroup);courseGroup=new THREE.Group();const r=rng(seed||1);let h=0,x=0,y=80,z=0;const pts=[];
 for(let k=0;k<60;k++){pts.push(new THREE.Vector3(x,y,z));const helix=(k>14&&k<26)||(k>38&&k<46);h+=helix?.75:(r()-.5)*1.1;if(k>=54)h+=0;const st=helix?9:11;x+=Math.cos(h)*st;z+=Math.sin(h)*st;y-=helix?2.2:1.2+r()*1.6}
 for(let k=0;k<6;k++){x+=Math.cos(h)*14;z+=Math.sin(h)*14;pts.push(new THREE.Vector3(x,y-=.3,z))}
 curve=new THREE.CatmullRomCurve3(pts);const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,900,3.4,20,false),new THREE.MeshStandardMaterial({color:0x4a6bff,transparent:true,opacity:.22,side:THREE.DoubleSide,metalness:.3,roughness:.2}));courseGroup.add(tube);
 for(let i=0;i<70;i++){const p=i/70,q=curve.getPointAt(p),tg=curve.getTangentAt(p);const ring=new THREE.Mesh(new THREE.TorusGeometry(3.6,.12,8,28),new THREE.MeshBasicMaterial({color:i%7===0?0xffd24a:0x7c4dff}));ring.position.copy(q);ring.lookAt(q.clone().add(tg));courseGroup.add(ring)}
 const g=new THREE.Mesh(new THREE.TorusGeometry(3.8,.4,12,32),new THREE.MeshBasicMaterial({color:0xffd24a}));g.position.copy(curve.getPointAt(1));g.lookAt(g.position.clone().add(curve.getTangentAt(1)));courseGroup.add(g);scene.add(courseGroup);
 Object.values(marbles).forEach(m=>scene.remove(m));marbles={};camP=null}
function label(n){const c=document.createElement('canvas');c.width=512;c.height=96;const x=c.getContext('2d');x.font='bold 52px sans-serif';x.textAlign='center';x.lineWidth=10;x.strokeStyle='#000';x.strokeText(n,256,64);x.fillStyle='#fff';x.fillText(n,256,64);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false}));s.scale.set(7,1.3,1);s.position.y=1.8;s.renderOrder=9;return s}
function loop(){requestAnimationFrame(loop);if(!curve)return;const t=rt();hud(t);const rk=race.order.length?ranking():[];
 race.order.forEach((o,i)=>{let m=marbles[o.name];if(!m){m=new THREE.Mesh(new THREE.SphereGeometry(.75,20,20),new THREE.MeshStandardMaterial({color:o.color,emissive:o.color,emissiveIntensity:.25,metalness:.4,roughness:.2}));m.add(label(o.name));scene.add(m);marbles[o.name]=m}
  const p=t<15?0:prog(o,t),pc=Math.max(0,Math.min(1,p)),q=curve.getPointAt(pc),tg=curve.getTangentAt(pc),side=new THREE.Vector3().crossVectors(tg,new THREE.Vector3(0,1,0)).normalize(),ri=rk.findIndex(x=>x.i===i),n=race.order.length;
  const lane=((i%5)-2)*.55+Math.sin(t*1.7+o.s%7)*.25,back=t<15?-(ri*1.6):0;q.addScaledVector(side,lane).addScaledVector(tg,back);q.y-=2.2;m.position.copy(q);m.position.y+=.75-.0;m.rotation.x+=.2});
 const lead=rk[0]&&marbles[rk[0].o.name];const target=lead?lead.position.clone():curve.getPointAt(0);const pr=lead?Math.min(1,Math.max(0,t<15?0:rk[0].p)):0,tg=curve.getTangentAt(pr);
 const want=target.clone().addScaledVector(tg,-16).add(new THREE.Vector3(0,7,0));if(!camP)camP=want.clone();camP.lerp(want,.06);cam.position.copy(camP);cam.lookAt(target);ren.render(scene,cam);
 if(race.status==='running'&&race.order.length&&t>=Math.max(...race.order.map(o=>o.f))+3&&!fin){fin=true;api('finish').catch(()=>{}).finally(()=>setTimeout(()=>fin=false,3000))}}
function adminUI(){const a=$('#admin');a.hidden=false;if(!tok){if(a.dataset.m==='l')return;a.dataset.m='l';a.replaceChildren(el('h3','','管理者ログイン'));const i=Object.assign(el('input'),{type:'password',placeholder:'パスワード'}),b=el('button','a','ログイン');b.onclick=async()=>{try{tok=(await api('login',{password:i.value})).token;sessionStorage.tok=tok;a.dataset.m='';ui()}catch(e){alert(e.message)}};a.append(i,b);return}
 a.dataset.m='';a.replaceChildren(el('h3','','管理者パネル'));const row=()=>{const r=el('div','row');a.append(r);return r},act=(r,l,f)=>{const b=el('button','a',l);b.onclick=async()=>{try{await f();load()}catch(e){alert(e.message)}};r.append(b)};
 let r=row();[['start','開始'],['pause','一時停止'],['resume','再開'],['cancel','中止'],['reset','リセット']].forEach(([k,l])=>act(r,l,()=>api(k)));
 r=row();const ms=el('select');[['normal','通常モード（公平）'],['show','演出モード']].forEach(([v,l])=>ms.append(Object.assign(el('option','',l),{value:v})));ms.value=race.mode||'normal';const ts=el('select');players.forEach(p=>ts.append(Object.assign(el('option','',p.name),{value:p.name})));ts.value=race.target||'uniuni20131004';r.append(ms,ts);act(r,'モード適用',()=>api('mode',{mode:ms.value,target:ts.value}));
 r=row();const nm=Object.assign(el('input'),{placeholder:'名前'}),cl=Object.assign(el('input'),{type:'color',value:'#ffd24a'}),ts2=Object.assign(el('input'),{type:'checkbox',checked:true});r.append(nm,cl,el('label','','テスト'),ts2);act(r,'追加',()=>api('addPlayer',{name:nm.value,color:cl.value,test:ts2.checked}));
 players.forEach(p=>{const q=row();q.append(el('span','',`${p.name} ${p.is_test?'[TEST] ':''}${p.joined?'待機':''}${p.banned?' BAN':''}`));act(q,p.banned?'BAN解除':'BAN',()=>api('ban',{id:p.id,flag:!p.banned}));act(q,'削除',()=>confirm('削除しますか？')&&api('removePlayer',{id:p.id}))});
 r=row();act(r,'履歴を表示',async()=>{const h=(await api('history')).rows;const d=el('pre','',h.map(x=>`${new Date(x.created_at).toLocaleString('ja-JP')} 優勝:${x.winner} (${x.mode==='show'?'演出':'通常'})`).join('\n')||'履歴なし');a.append(d)})}
init().catch(e=>{document.body.prepend(el('div','','接続エラー: '+e.message+'（READMEの環境変数設定を確認してください）'))});
