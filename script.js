const PLAYERS = [
"hamabenokai","ClumsyShuhei","EnjoyedBshsh","godhand1234","mandicendiiiii","rickey3326","abc315315","asaking 1218","bottikunnn","Marisakami","skYAJU114514","Chaser44","kaninekoheiryo","WearyTwiIight78","FullNiceSandwich","192837465h","dicesoe","studiousEpiccopper","AdroitSturdyCelery","Niwatori0503","JocularHappyClover","kurumi0203","osaruboy0228","blits3939","StellarNeatlyTom","Kingsrennosuke0205","uniuni20131004","02112015","#2CQOVLGLOJ","ComplexGlasses71"
];
const COLORS=["#ff6b6b","#55d6be","#ffd166","#8d7bff","#f78cce","#6eb5ff","#b5e48c","#ff9f5a","#a0c4ff","#e5989b","#80ed99","#cdb4db","#f4a261","#90dbf4","#f7b267","#b8f2e6","#e4c1f9","#ffadad","#9bf6ff","#fdffb6","#caffbf","#ffc6ff","#a0c4ff","#d0f4de","#f1c0e8","#f6bd60","#84a59d","#f28482","#a9def9","#d5bdaf"];
const $=id=>document.getElementById(id);
const state={players:PLAYERS.map((name,i)=>({name,color:COLORS[i%COLORS.length],online:false,banned:false,test:false})),joined:null,admin:false,running:false,paused:false,startedAt:null,elapsed:0,mode:"fair",fixedWinner:"uniuni20131004",winner:null,seed:1,channel:null,supabase:null,chat:[],localId:crypto.randomUUID(),lastPresence:0,animation:0};
const SUPABASE_URL=window.RUNTIME_CONFIG?.SUPABASE_URL||"";
const SUPABASE_ANON_KEY=window.RUNTIME_CONFIG?.SUPABASE_ANON_KEY||"";
const hasSupabase=!!(SUPABASE_URL&&SUPABASE_ANON_KEY&&window.supabase);
const palette=COLORS;
let scene, camera, renderer, marbles=[], trackGroup, clockStart=0, raf=0;

function toast(msg){const el=$("toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function renderRoster(){
 $("participantCount").textContent=state.players.filter(p=>!p.banned).length;
 $("rosterCount").textContent=state.players.filter(p=>!p.banned).length+"名";
 $("roster").innerHTML=state.players.map(p=>`<div class="roster-item ${state.joined===p.name?"selected":""} ${p.banned?"banned":""}"><span class="avatar" style="background:${p.color}22;color:${p.color}">${escapeHtml(p.name.slice(0,1).toUpperCase())}</span><span class="pname" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}${p.test?' <small>(TEST)</small>':''}</span><i class="presence ${p.online?"online":""}"></i></div>`).join("");
 const select=$("playerSelect"), old=select.value;
 select.innerHTML='<option value="">アカウントを選択</option>'+state.players.filter(p=>!p.banned).map(p=>`<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join("");
 if(state.players.some(p=>p.name===old&&!p.banned))select.value=old;
 $("onlineCount").textContent=state.players.filter(p=>p.online).length+(state.joined?1:0);
}
function renderMyEntry(){
 $("myEntry").innerHTML=state.joined?`<span class="avatar" style="background:${getPlayer(state.joined)?.color}33;color:${getPlayer(state.joined)?.color}">${escapeHtml(state.joined.slice(0,1))}</span><span><b>${escapeHtml(state.joined)}</b><small>待機中 · レース開始を待っています</small></span>`:`<span class="empty-avatar">?</span><span><b>未参加</b><small>アカウントを選択してください</small></span>`;
}
function getPlayer(name){return state.players.find(p=>p.name===name)}
function setStatus(status){$("eventStatus").textContent=status;$("raceBadge").textContent=status==="WAITING"?"WAITING ROOM":status==="RACING"?"LIVE RACE":status==="PAUSED"?"PAUSED":"RACE FINISHED";$("entryState").textContent=state.running?"レース中":status==="FINISHED"?"受付終了":"受付中";$("joinBtn").disabled=state.running||status==="FINISHED"}
function join(){
 const name=$("playerSelect").value;if(!name)return toast("先にアカウントを選択してください");
 const p=getPlayer(name);if(!p||p.banned)return toast("このアカウントは参加できません");
 if(state.joined&&state.joined!==name)return toast("この端末ではすでに別のアカウントを選択しています");
 state.joined=name;p.online=true;renderRoster();renderMyEntry();publishPresence();toast(name+" で待機しました");
}
function appendChat(msg){
 if(!msg||!msg.text)return;
 const box=$("chatMessages");if(box.querySelector(".chat-empty"))box.innerHTML="";
 const row=document.createElement("div");row.className="chat-message";row.innerHTML=`<b>${escapeHtml(msg.name||"Guest")}</b>${escapeHtml(msg.text)}<time>${new Date(msg.at||Date.now()).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})}</time>`;
 box.appendChild(row);while(box.children.length>80)box.removeChild(box.firstChild);box.scrollTop=box.scrollHeight;
}
async function sendChat(e){e.preventDefault();const input=$("chatInput"),text=input.value.trim();if(!text)return;if(!state.joined)return toast("チャットには参加登録が必要です");const msg={name:state.joined,text,at:Date.now()};appendChat(msg);input.value="";if(state.channel)await state.channel.send({type:"broadcast",event:"chat",payload:msg});}
function initRealtime(){
 if(!hasSupabase){$("connectionLabel").textContent="ローカルデモ";return}
 state.supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
 state.channel=state.supabase.channel("bropass-live",{config:{presence:{key:state.localId},broadcast:{self:false}}});
 state.channel.on("presence",{event:"sync"},()=>{const presence=state.channel.presenceState();const names=new Set(Object.values(presence).flat().map(x=>x.name).filter(Boolean));state.players.forEach(p=>p.online=names.has(p.name));renderRoster();});
 state.channel.on("broadcast",{event:"chat"},({payload})=>appendChat(payload));
 state.channel.on("broadcast",{event:"race"},({payload})=>{if(payload.sender===state.localId)return;applyRemoteRace(payload)});
 state.channel.subscribe(async status=>{if(status==="SUBSCRIBED"){$("connectionLabel").textContent="REALTIME CONNECTED";await publishPresence()}else $("connectionLabel").textContent=status;});
}
async function publishPresence(){if(state.channel&&state.joined)await state.channel.track({name:state.joined,online_at:new Date().toISOString()})}
async function broadcastRace(){if(state.channel)await state.channel.send({type:"broadcast",event:"race",payload:{sender:state.localId,running:state.running,paused:state.paused,startedAt:state.startedAt,elapsed:state.elapsed,mode:state.mode,fixedWinner:state.fixedWinner,seed:state.seed,winner:state.winner}})}
function applyRemoteRace(p){if(p.running&&!state.running){state.running=true;state.paused=p.paused;state.startedAt=p.startedAt;state.elapsed=p.elapsed||0;state.seed=p.seed;state.mode=p.mode;state.fixedWinner=p.fixedWinner;startVisualRace()}else if(!p.running&&p.winner){finishRace(p.winner,p.mode)}else if(p.running&&p.paused!==state.paused){state.paused=p.paused;state.elapsed=p.elapsed;state.startedAt=p.startedAt}setStatus(state.winner?"FINISHED":state.paused?"PAUSED":state.running?"RACING":"WAITING")}

function init3D(){
 const canvas=$("raceCanvas"),wrap=$("canvasWrap");try{
 scene=new THREE.Scene();scene.fog=new THREE.Fog(0x081226,16,42);
 camera=new THREE.PerspectiveCamera(43,wrap.clientWidth/wrap.clientHeight,.1,100);camera.position.set(0,8,17);camera.lookAt(0,1,0);
 renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(wrap.clientWidth,wrap.clientHeight,false);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 scene.add(new THREE.HemisphereLight(0xa8d9ff,0x17213c,2));
 const light=new THREE.DirectionalLight(0xffffff,2.1);light.position.set(5,12,7);light.castShadow=true;scene.add(light);
 const blue=new THREE.PointLight(0x36c8ed,30,25);blue.position.set(-7,4,1);scene.add(blue);
 const gold=new THREE.PointLight(0xf6b94c,24,25);gold.position.set(7,3,-3);scene.add(gold);
 const floor=new THREE.Mesh(new THREE.CircleGeometry(13,80),new THREE.MeshStandardMaterial({color:0x101f38,metalness:.35,roughness:.75}));floor.rotation.x=-Math.PI/2;floor.position.y=-.45;floor.receiveShadow=true;scene.add(floor);
 const grid=new THREE.GridHelper(25,35,0x315178,0x1c3150);grid.position.y=-.43;scene.add(grid);
 trackGroup=new THREE.Group();scene.add(trackGroup);buildTrack();
 const stars=new THREE.BufferGeometry(),positions=[];for(let i=0;i<450;i++)positions.push((Math.random()-.5)*38,Math.random()*18-1,(Math.random()-.5)*38);stars.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));scene.add(new THREE.Points(stars,new THREE.PointsMaterial({color:0x87b9e9,size:.035,transparent:true,opacity:.65})));
 window.addEventListener("resize",resize3D);animate3D();
 }catch(e){console.error(e);$("canvasOverlay").querySelector("strong").textContent="3D VIEW UNAVAILABLE";$("canvasOverlay").querySelector("p").textContent="この端末では3D表示を利用できません";}
}
function buildTrack(){
 while(trackGroup.children.length)trackGroup.remove(trackGroup.children[0]);
 const material=new THREE.MeshStandardMaterial({color:0x355d83,metalness:.65,roughness:.3});
 // Layered, looping rails form a stylized marble-run arena.
 for(let level=0;level<3;level++){
  const pts=[];const radius=5.2-level*.85;
  for(let i=0;i<=180;i++){const t=i/180*Math.PI*2;pts.push(new THREE.Vector3(Math.cos(t)*radius,level*1.25+Math.sin(t*2+level)*.32,Math.sin(t)*radius));}
  const curve=new THREE.CatmullRomCurve3(pts);const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,240,.095,8,false),material);tube.castShadow=true;trackGroup.add(tube);
  const railMat=new THREE.MeshStandardMaterial({color:level===1?0x4ed7e8:0x536eaa,metalness:.7,roughness:.25});
  for(const side of [-1,1]){const railPts=pts.map(v=>new THREE.Vector3(v.x*(1+side*.045),v.y+.12,v.z*(1+side*.045)));trackGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts),240,.035,6,false),railMat));}
 }
 for(let i=0;i<12;i++){const a=i/12*Math.PI*2;const post=new THREE.Mesh(new THREE.CylinderGeometry(.07,.11,2.8,8),new THREE.MeshStandardMaterial({color:0x385478,metalness:.6}));post.position.set(Math.cos(a)*6.2,.8,Math.sin(a)*6.2);trackGroup.add(post);}
 const hoop=new THREE.Mesh(new THREE.TorusGeometry(1.3,.07,10,60),new THREE.MeshStandardMaterial({color:0xf5c65b,emissive:0x5c3c08,metalness:.8}));hoop.position.set(0,3.7,0);hoop.rotation.x=Math.PI/2;trackGroup.add(hoop);
}
function resize3D(){if(!renderer)return;const w=$("canvasWrap").clientWidth,h=$("canvasWrap").clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}
function seeded(n){let x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x)}
function makeMarbles(){
 marbles.forEach(m=>scene.remove(m.mesh));marbles=[];
 const list=state.players.filter(p=>!p.banned);
 list.forEach((p,i)=>{const geo=new THREE.SphereGeometry(.19,20,16);const mat=new THREE.MeshStandardMaterial({color:p.color,metalness:.28,roughness:.18,emissive:p.color,emissiveIntensity:.12});const mesh=new THREE.Mesh(geo,mat);mesh.castShadow=true;scene.add(mesh);marbles.push({name:p.name,color:p.color,mesh,index:i,offset:seeded(state.seed+i*17)*Math.PI*2,pace:.78+seeded(state.seed+i*7)*.16});});
}
function marblePosition(m,t){
 // Deterministic staggered race paths, with individual speed variation and overtakes.
 const p=Math.min(1,Math.max(0,t/180));const angle=p*Math.PI*7.2+m.offset*.16;
 const lane=((m.index%7)-3)*.105;
 const r=4.55+lane+Math.sin(p*19+m.offset)*.38;
 const x=Math.cos(angle+m.offset)*r;
 const z=Math.sin(angle+m.offset)*r;
 const y=.2+Math.sin(p*Math.PI*8+m.offset)*.75+Math.max(0,Math.sin(p*11+m.offset))*.25;
 return new THREE.Vector3(x,y,z);
}
function raceProgress(m,t){
 const jitter=(seeded(state.seed+m.index*19+Math.floor(t/3))*0.06);
 let p=(t/180)*m.pace+jitter*Math.sin(t*.17+m.offset);
 if(state.mode==="show"&&m.name===state.fixedWinner)p=Math.max(p,(t/180)*1.08);
 if(state.mode==="show"&&m.name!==state.fixedWinner)p=Math.min(p,(t/180)*.91);
 return Math.max(0,Math.min(1,p));
}
function startVisualRace(){
 $("canvasOverlay").classList.add("hidden");$("resultPlaceholder").classList.remove("hidden");$("winnerCard").classList.add("hidden");
 makeMarbles();setStatus("RACING");
 const count=$("countdown");count.textContent="GO!";setTimeout(()=>count.textContent="",900);
}
function animate3D(){
 raf=requestAnimationFrame(animate3D);if(!renderer)return;
 const now=performance.now()/1000;
 trackGroup.rotation.y=Math.sin(now*.12)*.035;
 if(state.running&&!state.paused&&!state.winner){
  const elapsed=state.startedAt?Math.max(0,(Date.now()-state.startedAt)/1000):state.elapsed;
  const t=Math.min(180,elapsed);
  $("timer").textContent=fmtTime(Math.max(0,180-t));$("progressText").textContent=Math.floor(t/180*100)+"%";$("progressBar").style.width=(t/180*100)+"%";
  marbles.forEach(m=>{const p=raceProgress(m,t);const pos=marblePosition(m,p*180);m.mesh.position.copy(pos);m.mesh.rotation.x+=.06;m.mesh.rotation.z+=.08;});
  renderLeaders(t);
  if(t>=180){const winner=calculateWinner();if(state.admin){finishRace(winner,state.mode);broadcastRace()}else if(!state.channel)finishRace(winner,state.mode)}
 }
 renderer.render(scene,camera);
}
function fmtTime(sec){const s=Math.ceil(sec);return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")}
function calculateWinner(){
 if(state.mode==="show"&&getPlayer(state.fixedWinner))return state.fixedWinner;
 const ranked=[...marbles].sort((a,b)=>raceProgress(b,180)-raceProgress(a,180));return ranked[0]?.name||state.players[0]?.name;
}
function renderLeaders(t){
 const ranked=[...marbles].sort((a,b)=>raceProgress(b,t)-raceProgress(a,t)).slice(0,8);
 $("leaderRows").innerHTML=ranked.map((m,i)=>`<div class="leader-row"><b class="rank">${String(i+1).padStart(2,"0")}</b><span>${escapeHtml(m.name)}</span><span class="distance">${Math.round(raceProgress(m,t)*100)}%</span></div>`).join("");
}
function finishRace(name,mode){
 state.running=false;state.paused=false;state.winner=name;setStatus("FINISHED");$("timer").textContent="00:00";$("progressText").textContent="100%";$("progressBar").style.width="100%";$("canvasOverlay").classList.add("hidden");
 $("resultPlaceholder").classList.add("hidden");$("winnerCard").classList.remove("hidden");$("winnerName").textContent=name;
 if(mode==="show"){$("winnerCard").querySelector("small").textContent="演出モード · DEMO RESULT"}toast("レース終了！優勝者："+name)}
}
async function adminRequest(action,extra={}) {
 const password=sessionStorage.getItem("bropass_admin_password");if(!password)return false;
 try{const r=await fetch("/.netlify/functions/admin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password,action,...extra})});const data=await r.json();if(!r.ok)throw new Error(data.error||"管理者処理に失敗しました");return data}catch(e){toast(e.message);return false}
}
async function startRace(){
 if(!state.admin)return;
 if(!hasSupabase){toast("リアルタイム設定が未完了です。READMEを確認してください");return}
 const active=state.players.filter(p=>!p.banned);if(active.length<2)return toast("参加者が2名以上必要です");
 state.mode=$("raceMode").value;state.fixedWinner=$("fixedWinner").value.trim();if(state.mode==="show"&&!getPlayer(state.fixedWinner))return toast("指定優勝者が参加者一覧にいません");
 state.seed=Math.floor(Math.random()*1e9);state.startedAt=Date.now()+4000;state.elapsed=0;state.running=true;state.paused=false;state.winner=null;
 await adminRequest("race",{race:{running:true,paused:false,startedAt:state.startedAt,elapsed:0,mode:state.mode,fixedWinner:state.fixedWinner,seed:state.seed,winner:null}});
 startVisualRace();broadcastRace();toast("4秒後にレースを開始します");
}
async function togglePause(){if(!state.admin||!state.running)return;state.paused=!state.paused;if(state.paused){state.elapsed=Math.max(0,(Date.now()-state.startedAt)/1000);state.startedAt=null}else state.startedAt=Date.now()-state.elapsed*1000;await broadcastRace();setStatus(state.paused?"PAUSED":"RACING")}
async function resetRace(){if(!state.admin)return;state.running=false;state.paused=false;state.winner=null;state.startedAt=null;state.elapsed=0;marbles.forEach(m=>scene.remove(m.mesh));marbles=[];$("timer").textContent="03:00";$("progressText").textContent="0%";$("progressBar").style.width="0%";$("leaderRows").innerHTML='<div class="leader-empty">レース開始後に順位が表示されます。</div>';$("canvasOverlay").classList.remove("hidden");$("resultPlaceholder").classList.remove("hidden");$("winnerCard").classList.add("hidden");setStatus("WAITING");await broadcastRace();await adminRequest("reset");}
function renderAdminPlayers(){$("adminPlayerList").innerHTML=state.players.map(p=>`<div class="admin-player"><span>${escapeHtml(p.name)} ${p.test?"(TEST)":""}</span><button class="ban-btn" data-name="${escapeHtml(p.name)}">${p.banned?"BAN解除":"BAN"}</button></div>`).join("");$("adminPlayerList").querySelectorAll("button").forEach(b=>b.onclick=()=>{const p=getPlayer(b.dataset.name);p.banned=!p.banned;if(state.joined===p.name&&p.banned){state.joined=null;renderMyEntry()}renderRoster();renderAdminPlayers();toast(p.name+(p.banned?" をBANしました":" のBANを解除しました"));});}
async function loginAdmin(){const pass=$("adminPassword").value;if(!pass)return;try{const r=await fetch("/.netlify/functions/admin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pass,action:"login"})});const data=await r.json();if(!r.ok)throw new Error(data.error||"ログインできません");state.admin=true;sessionStorage.setItem("bropass_admin_password",pass);$("adminLogin").classList.add("hidden");$("adminControls").classList.remove("hidden");renderAdminPlayers();toast("管理者ログインしました")}catch(e){$("adminError").textContent=e.message}}
function logoutAdmin(){state.admin=false;sessionStorage.removeItem("bropass_admin_password");$("adminLogin").classList.remove("hidden");$("adminControls").classList.add("hidden")}
function addTest(){if(!state.admin)return;const name=$("testName").value.trim();if(!name)return;if(state.players.some(p=>p.name===name))return toast("同じ名前がすでに存在します");state.players.push({name,color:COLORS[state.players.length%COLORS.length],online:false,banned:false,test:true});$("testName").value="";renderRoster();renderAdminPlayers();toast("テストプレイヤーを追加しました")}
function init(){
 renderRoster();renderMyEntry();setStatus("WAITING");init3D();initRealtime();
 $("joinBtn").onclick=join;$("chatForm").onsubmit=sendChat;
 $("adminOpen").onclick=()=>$("adminModal").classList.remove("hidden");$("adminClose").onclick=()=>$("adminModal").classList.add("hidden");
 $("adminLoginBtn").onclick=loginAdmin;$("adminLogout").onclick=logoutAdmin;
 $("startRace").onclick=startRace;$("pauseRace").onclick=togglePause;$("resetRace").onclick=resetRace;$("addTest").onclick=addTest;
 if(sessionStorage.getItem("bropass_admin_password")){$("adminPassword").value=sessionStorage.getItem("bropass_admin_password");}
}
init();
