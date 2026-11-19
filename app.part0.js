
const $=id=>document.getElementById(id);
const DEF={openai:{baseUrl:"https://api.openai.com/v1",model:"gpt-4o-mini"},gemini:{baseUrl:"https://generativelanguage.googleapis.com/v1beta",model:"gemini-2.0-flash"},keyless:{baseUrl:"http://127.0.0.1:11434/v1",model:"llama3.2"}};

const PRESETS=[
  {name:"OpenAI",type:"openai",baseUrl:"https://api.openai.com/v1",model:"gpt-4o-mini"},
  {name:"OpenRouter",type:"openai",baseUrl:"https://openrouter.ai/api/v1",model:"openai/gpt-4o-mini"},
  {name:"Groq",type:"openai",baseUrl:"https://api.groq.com/openai/v1",model:"llama-3.3-70b-versatile"},
  {name:"Together",type:"openai",baseUrl:"https://api.together.xyz/v1",model:"meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"},
  {name:"Gemini",type:"gemini",baseUrl:"https://generativelanguage.googleapis.com/v1beta",model:"gemini-2.0-flash"},
  {name:"Grok",type:"openai",baseUrl:"https://api.x.ai/v1",model:"grok-4"},
  {name:"Ollama",type:"keyless",baseUrl:"http://127.0.0.1:11434/v1",model:"llama3.2"}
];

function esc(s){
  return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function md(s){
  s=esc(s);
  s=s.replace(/```([\s\S]*?)```/g,function(_,c){return "<pre><code>"+c.trim()+"</code></pre>";});
  s=s.replace(/`([^`]+)`/g,"<code>$1</code>");
  s=s.replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>");
  s=s.replace(/^### (.+)$/gm,"<b>$1</b>");
  s=s.replace(/^## (.+)$/gm,"<b>$1</b>");
  s=s.replace(/^\s*[-*] (.+)$/gm,"• $1");
  s=s.replace(/\n/g,"<br>");
  return s;
}
function showInspector(meta){
  var el=$("inspector"); if(!el)return;
  if(!meta){el.classList.remove("show");el.innerHTML="";return}

  el.classList.add("show");
  var ok=meta.ok!==false && (!meta.status || (meta.status>=200&&meta.status<300));
  el.innerHTML='<span class="chip "+(ok?"ok":"bad")+">'+esc(String(meta.status||(ok?"OK":"ERR")))+'</span>'
    +'<span><b>'+esc(String(meta.latencyMs||0))+' ms</b></span>'
    +'<span>'+esc(meta.model||"")+'</span>'
    +'<span>'+esc(meta.provider||"")+'</span>'
    +(meta.error?'<span class="bad">'+esc(meta.error).slice(0,80)+'</span>':'');
}
function copyText(t){
  t=String(t||"");
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).catch(function(){fallbackCopy(t)});
  else fallbackCopy(t);
}
function fallbackCopy(t){
  var a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();
  try{document.execCommand("copy")}catch(e){}
  document.body.removeChild(a);
}
function fillPresets(){
  var row=$("presetRow"); if(!row)return;
  row.innerHTML="";
  PRESETS.forEach(function(pr){
    var b=document.createElement("button");
    b.type="button"; b.textContent=pr.name;
    b.onclick=function(){
      $("fName").value=pr.name;
      $("fType").value=pr.type;
      $("fUrl").value=pr.baseUrl;
      $("fModel").value=pr.model;
      $("fKeyWrap").style.display=pr.type==="keyless"?"none":"block";
    };
    row.appendChild(b);
  });
}

const S={providers:[],chats:[],pid:null,cid:null,streaming:false,editId:null};
S.lastMeta=null;

const uid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
function blankP(x={}){const t=x.type||"openai",d=DEF[t];return{id:x.id||uid("p"),name:x.name||"Provider",type:t,baseUrl:x.baseUrl||d.baseUrl,apiKey:x.apiKey||"",model:x.model||d.model,models:x.models||[],temperature:(x.temperature!=null?x.temperature:.7),maxTokens:x.maxTokens||1024,stream:(x.stream!=null?x.stream:true),systemPrompt:x.systemPrompt||""}}
function blankC(pid){return{id:uid("c"),providerId:pid||S.pid,title:"New chat",messages:[],createdAt:Date.now()}}
function load(){try{const r=JSON.parse(localStorage.getItem("et-v4")||"null");if((r&&r.providers&&r.providers.length)){S.providers=r.providers.map(blankP);S.chats=r.chats||[];S.pid=r.pid&&S.providers.some(p=>p.id===r.pid)?r.pid:S.providers[0].id;S.cid=r.cid&&S.chats.some(c=>c.id===r.cid)?r.cid:null;return}const v2=JSON.parse(localStorage.getItem("endpoint-tester-v2")||"null");if((v2&&v2.profiles&&v2.profiles.length)){S.providers=v2.profiles.map(blankP);S.pid=v2.activeId||S.providers[0].id;return}}catch{}const p=blankP({name:"OpenAI"});S.providers=[p];S.pid=p.id}
function save(){localStorage.setItem("et-v4",JSON.stringify({providers:S.providers,chats:S.chats,pid:S.pid,cid:S.cid}))}
const P=()=>S.providers.find(p=>p.id===S.pid)||S.providers[0];
const C=()=>S.chats.find(c=>c.id===S.cid)||null;
function hasN(){return!!(window.NativeHttp&&window.NativeHttp.request)}
async function http(url,opts={}){url=safeUrl(url);const m=(opts.method||"GET").toUpperCase(),h=opts.headers||{},b=opts.body||null;if(hasN())return new Promise((res,rej)=>{const id="r"+Date.now();window.__nativeHttpCallbacks=window.__nativeHttpCallbacks||{};window.__nativeHttpCallbacks[id]=(e,s,body)=>{delete window.__nativeHttpCallbacks[id];if(e)return rej(new Error(e));res({ok:s>=200&&s<300,status:s,text:async()=>body||"",json:async()=>JSON.parse(body||"{}"),_n:true,_b:body||""})};try{window.NativeHttp.request(id,m,url,JSON.stringify(h),b)}catch(e){delete window.__nativeHttpCallbacks[id];rej(e)}});return fetch(url,opts)}

function safeUrl(u){
  try{
    const x=new URL(u);
    if(x.protocol!=='http:'&&x.protocol!=='https:') throw new Error('Only http/https allowed');
    return x.href;
  }catch(e){ throw new Error('Invalid URL: '+(e.message||e)); }
}
function scrub(s){ return String(s==null?'':s).replace(/\u0000/g,'').slice(0,200000); }

const join=(a,b)=>(a||"").replace(/\/+$/,"")+(b.startsWith("/")?b:"/"+b);
const host=u=>{try{return new URL(u).host}catch{return(u||"").slice(0,18)}};
const ferr=(s,b)=>{
  var raw=typeof b==="string"?b.slice(0,400):((b&&b.error&&b.error.message)||(b&&b.message)||JSON.stringify(b||"").slice(0,400));
  var txt=String(raw||"");
  if(s===502||/empty gateway/i.test(txt)){
    return "502 from the API gateway. The provider sent an empty error — usually a bad model name, a base URL that is not .../v1, or the gateway is overloaded. The app already retried once. For Grok use https://api.x.ai/v1 and a model like grok-4.";
  }
  if(s===401||s===403) return s+": key rejected. Check the API key for this provider.";
  if(s===404) return "404: that path or model was not found. Base URL should include /v1 for OpenAI-style APIs.";
  return (s?s+": ":"")+txt.slice(0,250);
};

function rP(){const L=$("providerList");L.innerHTML="";S.providers.forEach(p=>{const el=document.createElement("div");el.className="item"+(p.id===S.pid?" active":"");el.innerHTML=`<span class="dot-p"></span><div class="meta"><div class="name"></div><div class="sub"></div></div><div class="act"><button type="button" data-e title="Edit">Edit</button><button type="button" data-d class="danger" title="Delete">Del</button></div>`;el.querySelector(".name").textContent=p.name;el.querySelector(".sub").textContent=(p.model||p.type)+" · "+host(p.baseUrl);el.onclick=e=>{if(e.target.closest("[data-e]")){e.stopPropagation();openM(p.id);return}if(e.target.closest("[data-d]")){e.stopPropagation();delP(p.id);return}setP(p.id)};L.appendChild(el)});fS()}
function rC(){const L=$("chatList");L.innerHTML="";const sorted=[...S.chats].sort((a,b)=>b.createdAt-a.createdAt);if(!sorted.length){L.innerHTML='<div style="padding:8px;font-size:12px;color:var(--muted)">No chats yet</div>';return}sorted.forEach(c=>{const p=S.providers.find(x=>x.id===c.providerId);const el=document.createElement("div");el.className="item"+(c.id===S.cid?" active":"");el.innerHTML=`<div class="meta"><div class="name"></div><div class="sub"></div></div><div class="act"><button type="button" data-d class="danger">Del</button></div>`;el.querySelector(".name").textContent=c.title||"New chat";el.querySelector(".sub").textContent=p?p.name:"";el.onclick=e=>{if(e.target.closest("[data-d]")){e.stopPropagation();delC(c.id);return}setC(c.id)};L.appendChild(el)})}

function closeMenus(){
  var a=document.getElementById("menuProvider");
  var b=document.getElementById("menuModel");
  if(a)a.classList.remove("open");
  if(b)b.classList.remove("open");
}
function fS(){
  var vp=document.getElementById("valProvider");
  var vm=document.getElementById("valModel");
  var mp=document.getElementById("menuProvider");
  var mm=document.getElementById("menuModel");
  if(!S.providers||!S.providers.length){
    var d=blankP({name:"OpenAI"});
    S.providers=[d];
    S.pid=d.id;
  }
  if(!S.pid||!S.providers.some(function(p){return p.id===S.pid})){
    S.pid=S.providers[0].id;
  }
  var p=P();
  if(vp)vp.textContent=p?p.name:"Select";
  if(mp){
    mp.innerHTML="";
    S.providers.forEach(function(pr){
      var btn=document.createElement("button");
      btn.type="button";
      btn.className="picker-item"+(pr.id===S.pid?" active":"");
      btn.innerHTML="<span></span><span class=\"sub\"></span>";
      btn.querySelector("span").textContent=pr.name;
      btn.querySelector(".sub").textContent=(pr.model||pr.type||"")+" · "+(pr.baseUrl||"").replace(/^https?:\/\//,"").slice(0,28);
      btn.onclick=function(e){
        e.stopPropagation();
        setP(pr.id);
        closeMenus();
      };
      mp.appendChild(btn);
    });
  }
  var models=[];
  if(p){
    if(p.models&&p.models.length)models=p.models.slice();
    else if(p.model)models=[p.model];
    if(p.model&&models.indexOf(p.model)<0)models.unshift(p.model);
  }
  if(vm)vm.textContent=(p&&p.model)?p.model:(models[0]||"Set model");
  if(mm){
    mm.innerHTML="";
    if(!models.length){
      var empty=document.createElement("button");
      empty.type="button";empty.className="picker-item";
      empty.textContent="Edit provider to set model";
      empty.onclick=function(e){e.stopPropagation();closeMenus();var cur=P();if(cur)openM(cur.id);};
      mm.appendChild(empty);
    }else{
      models.forEach(function(m){
        var btn=document.createElement("button");
        btn.type="button";
        btn.className="picker-item"+(p&&p.model===m?" active":"");
        btn.textContent=m;
        btn.onclick=function(e){
          e.stopPropagation();
          var cur=P();
          if(cur){cur.model=m;save();fS();rP();ui();}
          closeMenus();
        };
        mm.appendChild(btn);
      });
    }
  }
}

function rM(){const inner=$("msgsInner");const c=C();inner.innerHTML="";if(!(c&&c.messages&&c.messages.length)){inner.innerHTML='<div class="empty"><div class="hero"></div><h2>Start a conversation</h2><p>Pick provider & model above, then message.</p></div>';return}c.messages.forEach((m,idx)=>{
  const row=document.createElement("div");
  if(m.role==="error"||m.role==="system"){
    row.className="msg "+(m.role==="error"?"err":"sys");
    row.innerHTML='<div class="bubble"></div>';
    row.querySelector(".bubble").textContent=m.content;
  }else{
    const u=m.role==="user";
    row.className="msg "+(u?"user":"bot")+(!u&&S.streaming&&idx===c.messages.length-1?" live":"");
    row.innerHTML='<div class="av">'+(u?"U":"AI")+'</div><div class="col" style="min-width:0"><div class="bubble"></div><div class="msg-actions"></div></div>';
    row.querySelector(".bubble").innerHTML=md(m.content||"");
    const act=row.querySelector(".msg-actions");
    const bCopy=document.createElement("button");bCopy.type="button";bCopy.textContent="Copy";
    bCopy.onclick=function(e){e.stopPropagation();copyText(m.content||"");bCopy.textContent="Copied";setTimeout(function(){bCopy.textContent="Copy"},900)};
    act.appendChild(bCopy);
    if(!u && idx===c.messages.length-1){
      const bReg=document.createElement("button");bReg.type="button";bReg.textContent="Regenerate";
      bReg.onclick=function(e){e.stopPropagation();regenerate()};
      act.appendChild(bReg);
    }
  }
  inner.appendChild(row);
});$("messages").scrollTop=$("messages").scrollHeight}
function ui(){var p=P();var ok=p&&p.baseUrl&&p.model;var inp=$("userInput");var sb=$("sendBtn");if(inp)inp.disabled=!ok||S.streaming;if(sb)sb.disabled=!ok||S.streaming;}
function setP(id){S.pid=id;fS();rP();ui();save()}
function setC(id){S.cid=id;const c=C();if((c&&c.providerId)&&S.providers.some(p=>p.id===c.providerId))S.pid=c.providerId;rC();rP();fS();rM();ui();save();closeSide()}
function newChat(){const p=P();if(!p)return;const c=blankC(p.id);S.chats.unshift(c);S.cid=c.id;rC();rM();ui();save();closeSide();$("userInput").focus()}
function delC(id){S.chats=S.chats.filter(c=>c.id!==id);if(S.cid===id)S.cid=(S.chats[0]&&S.chats[0].id)||null;rC();rM();save()}
function delP(id){if(S.providers.length<=1)return;S.providers=S.providers.filter(p=>p.id!==id);if(S.pid===id)S.pid=S.providers[0].id;S.chats=S.chats.filter(c=>c.providerId!==id);if(S.cid&&!S.chats.some(c=>c.id===S.cid))S.cid=(S.chats[0]&&S.chats[0].id)||null;rP();rC();fS();rM();ui();save()}
function openM(id){S.editId=id||null;const p=id?S.providers.find(x=>x.id===id):blankP({name:"New provider"});$("modalTitle").textContent=id?"Edit provider":"Add provider";$("fName").value=p.name;$("fType").value=p.type;$("fUrl").value=p.baseUrl;$("fKey").value=p.apiKey;$("fModel").value=p.model;$("fTemp").value=p.temperature;$("fMax").value=p.maxTokens;$("fStream").checked=p.stream;$("fSys").value=p.systemPrompt||"";$("fKeyWrap").style.display=p.type==="keyless"?"none":"block";$("providerModal").classList.add("show")}
function closeM(){$("providerModal").classList.remove("show");S.editId=null}
function form(){return{name:$("fName").value.trim()||"Provider",type:$("fType").value,baseUrl:$("fUrl").value.trim(),apiKey:$("fKey").value.trim(),model:$("fModel").value.trim(),temperature:+$("fTemp").value||.7,maxTokens:+$("fMax").value||1024,stream:$("fStream").checked,systemPrompt:$("fSys").value}}
function saveM(){const d=form();try{if(d.baseUrl)d.baseUrl=safeUrl(d.baseUrl)}catch(e){alert(e.message);return}if(S.editId){const p=S.providers.find(x=>x.id===S.editId);if(p)Object.assign(p,d);S.pid=S.editId}else{const p=blankP(d);S.providers.push(p);S.pid=p.id}if(window.__pm){const p=P();if(p)p.models=window.__pm;window.__pm=null}rP();fS();ui();save();closeM()}
$("fType").onchange=()=>{const t=$("fType").value,d=DEF[t];if(d){if(!$("fUrl").value||Object.values(DEF).some(x=>x.baseUrl===$("fUrl").value))$("fUrl").value=d.baseUrl;if(!$("fModel").value||Object.values(DEF).some(x=>x.model===$("fModel").value))$("fModel").value=d.model}$("fKeyWrap").style.display=t==="keyless"?"none":"block"};
async function fetchModels(){const d=form();try{let ids=[];if(d.type==="gemini"){if(!d.apiKey)throw new Error("API key required");const r=await http(d.baseUrl.replace(/\/+$/,"")+"/models?key="+encodeURIComponent(d.apiKey));const j=await r.json();if(!r.ok)throw new Error(ferr(r.status,j));const g=(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes("generateContent"));ids=(g.length?g:j.models||[]).map(m=>(m.name||"").replace(/^models\//,"")).filter(Boolean)}else{const h={"Content-Type":"application/json"};if(d.apiKey)h.Authorization="Bearer "+d.apiKey;const r=await http(join(d.baseUrl,"/models"),{method:"GET",headers:h});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}}if(!r.ok)throw new Error(ferr(r.status,j));ids=(j.data||[]).map(m=>m.id).filter(Boolean)}if(!ids.length)throw new Error("No models");if(!d.model||!ids.includes(d.model))$("fModel").value=ids[0];window.__pm=ids;alert("Loaded "+ids.length+" models")}catch(e){alert("Fetch failed: "+(e.message||e))}}
async function callOA(p,msgs,stream){const h={"Content-Type":"application/json"};if(p.apiKey)h.Authorization="Bearer "+p.apiKey;const use=stream&&!hasN();const r=await http(join(p.baseUrl,"/chat/completions"),{method:"POST",headers:h,body:JSON.stringify({model:p.model,messages:msgs,temperature:p.temperature,max_tokens:p.maxTokens,stream:use})});if(!r.ok){const t=r._n?r._b:await r.text();let j;try{j=JSON.parse(t)}catch{j=t}throw new Error(ferr(r.status,j))}return{res:r,streamed:use}}
async function callG(p,msgs,stream){if(!p.apiKey)throw new Error("API key required");const base=p.baseUrl.replace(/\/+$/,"");const contents=[];let sys=null;for(const m of msgs){if(m.role==="system"){sys={parts:[{text:m.content}]};continue}contents.push({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]})}const use=stream&&!hasN();const ep=use?base+"/models/"+p.model+":streamGenerateContent?alt=sse&key="+encodeURIComponent(p.apiKey):base+"/models/"+p.model+":generateContent?key="+encodeURIComponent(p.apiKey);const body={contents,generationConfig:{temperature:p.temperature,maxOutputTokens:p.maxTokens}};if(sys)body.systemInstruction=sys;const r=await http(ep,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok){const t=r._n?r._b:await r.text();let j;try{j=JSON.parse(t)}catch{j=t}throw new Error(ferr(r.status,j))}return{res:r,streamed:use}}
async function body(r,type){if(r._n){const j=JSON.parse(r._b||"{}");return type==="gemini"?((j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts&&j.candidates[0].content.parts[0]&&j.candidates[0].content.parts[0].text)||JSON.stringify(j)):((j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||JSON.stringify(j))}const j=await r.json();return type==="gemini"?((j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts&&j.candidates[0].content.parts[0]&&j.candidates[0].content.parts[0].text)||JSON.stringify(j)):((j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||JSON.stringify(j))}
function ensure(){let c=C();if(!c){c=blankC(S.pid);S.chats.unshift(c);S.cid=c.id;rC()}return c}

async function regenerate(){
  const c=C(); if(!c||S.streaming)return;
  // remove last assistant/error, resend last user
  while(c.messages.length && c.messages[c.messages.length-1].role!=="user")c.messages.pop();
  const last=c.messages[c.messages.length-1];
  if(!last||last.role!=="user")return;
  const text=last.content;
  c.messages.pop();
  rM();
  $("userInput").value=text;
  await send();
}


function streamChat(p,msgs,onDelta){
  return new Promise(function(resolve,reject){
    if(!(window.NativeHttp&&window.NativeHttp.stream)) return reject(new Error("no stream"));
    var id="s"+Date.now()+Math.floor(Math.random()*1000);
    var acc="";
    window.__streamHandlers=window.__streamHandlers||{};
    window.__streamHandlers[id]={
      delta:function(t){acc+=t;if(onDelta)onDelta(t,acc);},
      done:function(status,err){
        delete window.__streamHandlers[id];
        if(err&&!acc){
          var j=err; try{j=JSON.parse(err)}catch(e){}
          reject(new Error(ferr(status||502,j)));
        } else resolve(acc);
      }
    };
    var h={"Content-Type":"application/json"};
    if(p.apiKey)h.Authorization="Bearer "+p.apiKey;
    var body=JSON.stringify({model:p.model,messages:msgs,temperature:p.temperature,max_tokens:p.maxTokens,stream:true});
    try{
      window.NativeHttp.stream(id, join(p.baseUrl,"/chat/completions"), JSON.stringify(h), body);
    }catch(e){
      delete window.__streamHandlers[id];
      reject(e);
    }
  });
}

async function send(){
  const text=$("userInput").value.trim();if(!text||S.streaming)return;
  const p=P();if(!p)return;
  const c=ensure();
  if(c.title==="New chat")c.title=text.slice(0,40);
  c.providerId=p.id;
  const api=[];
  if(p.systemPrompt)api.push({role:"system",content:p.systemPrompt});
  for(const m of c.messages)if(m.role==="user"||m.role==="assistant")api.push(m);
  api.push({role:"user",content:text});
  c.messages.push({role:"user",content:scrub(text)});
  $("userInput").value="";
  rM();rC();
  S.streaming=true;ui();
  c.messages.push({role:"assistant",content:""});
  rM();
  var painted=0;
  function paint(){if(painted)return;painted=1;requestAnimationFrame(function(){painted=0;rM();var box=$("messages");if(box)box.scrollTop=box.scrollHeight;});}
  const t0=Date.now();
  try{
    var full="";
    if(p.type!=="gemini"&&window.NativeHttp&&window.NativeHttp.stream){
      full=await streamChat(p,api,function(){paint();});
    }else{
      const out=p.type==="gemini"?await callG(p,api,false):await callOA(p,api,false);
      full=await body(out.res,p.type)||"(empty)";
    }
    c.messages[c.messages.length-1].content=scrub(full||"(empty)");
    if(typeof showInspector==="function")showInspector({ok:true,status:200,latencyMs:Date.now()-t0,model:p.model,provider:p.name});
    rM();save();
  }catch(e){
    if(typeof showInspector==="function")showInspector({ok:false,status:0,latencyMs:Date.now()-t0,model:p.model,provider:p.name,error:e.message||String(e)});
    c.messages.pop();
    c.messages.push({role:"error",content:e.message||String(e)});
    rM();save();
  }finally{S.streaming=false;ui();rC();rM();}
}
function theme(t){document.documentElement.setAttribute("data-theme",t);localStorage.setItem("et-theme",t)}
$("themeBtn").onclick=()=>theme(document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark");
theme(localStorage.getItem("et-theme")||"dark");
function closeSide(){$("sidebar").classList.remove("open");$("overlay").classList.remove("show")}
$("menuBtn").onclick=()=>{$("sidebar").classList.add("open");$("overlay").classList.add("show")};$("overlay").onclick=closeSide;
$("btnNewChat").onclick=newChat;$("btnAddProvider").onclick=()=>openM(null);$("btnManage").onclick=()=>{const p=P();if(p)openM(p.id)};
$("modalCancel").onclick=closeM;$("modalSave").onclick=saveM;$("modalFetch").onclick=fetchModels;
$("sendBtn").onclick=send;
$("userInput").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};

function setAccent(a){
  try{
    document.documentElement.setAttribute("data-accent", a);
    localStorage.setItem("et-accent", a);
    var dots=document.querySelectorAll(".accent-dot");
    for(var i=0;i<dots.length;i++){
      var el=dots[i];
      if(el.classList) el.classList.toggle("on", el.getAttribute("data-accent")===a);
    }
  }catch(e){}
}
(function initAccent(){
  try{
    var a=localStorage.getItem("et-accent")||"violet";
    setAccent(a);
    var row=document.getElementById("accentRow");
    if(row) row.addEventListener("click",function(e){
      var t=e.target;
      while(t&&t!==row&&!(t.getAttribute&&t.getAttribute("data-accent"))) t=t.parentNode;
      if(t&&t.getAttribute){
        var acc=t.getAttribute("data-accent");
        if(acc) setAccent(acc);
      }
    });
  }catch(e){}
})();

function hasHealth(){return !!(window.NativeHealth&&typeof window.NativeHealth.configure==="function")}
function healthSettings(){
  try{return JSON.parse(localStorage.getItem("et-health")||"null")||{enabled:false,notifyOk:false,notifyDown:true,intervalMs:3600000,sound:true,vibrate:true}}catch(e){return{enabled:false,notifyOk:false,notifyDown:true,intervalMs:3600000}}
}
function saveHealthLocal(s){localStorage.setItem("et-health",JSON.stringify(s))}
function syncHealthNative(s){
  if(!hasHealth())return;
  try{
    window.NativeHealth.configure(JSON.stringify({
      enabled:!!s.enabled,notifyOk:!!s.notifyOk,notifyDown:!!s.notifyDown,intervalMs:+s.intervalMs||3600000,sound:s.sound!==false,vibrate:s.vibrate!==false
    }));
  }catch(e){}
}
function syncProvidersNative(){
  if(!hasHealth())return;
  try{
    var list=(S.providers||[]).map(function(p){return{id:p.id,name:p.name,type:p.type,baseUrl:p.baseUrl,apiKey:p.apiKey}});
    window.NativeHealth.syncProviders(JSON.stringify(list));
  }catch(e){}
}
function openSettings(){
  var s=healthSettings();
  $("hcEnabled").checked=!!s.enabled;
  $("hcNotifyOk").checked=!!s.notifyOk;
  $("hcNotifyDown").checked=s.notifyDown!==false;
  if($("hcSound"))$("hcSound").checked=s.sound!==false;
  if($("hcVibrate"))$("hcVibrate").checked=s.vibrate!==false;
  $("hcInterval").value=String(s.intervalMs||3600000);
  refreshHealthStatus();
  $("settingsPanel").classList.add("show");
  closeSide();
}
function closeSettings(){$("settingsPanel").classList.remove("show")}
function saveSettings(){
  var s={enabled:$("hcEnabled").checked,notifyOk:$("hcNotifyOk").checked,notifyDown:$("hcNotifyDown").checked,intervalMs:+$("hcInterval").value||3600000,sound:!$("hcSound")||$("hcSound").checked,vibrate:!$("hcVibrate")||$("hcVibrate").checked};
  saveHealthLocal(s);
  syncProvidersNative();
  syncHealthNative(s);
  refreshHealthStatus();
  if(!hasHealth())alert("Health checks need the Android app build. Settings saved locally.");
  else alert("Saved. Monitoring "+(s.enabled?"on":"off")+".");
}
function refreshHealthStatus(){
  var box=$("hcStatusBox");if(!box)return;
  if(!hasHealth()){box.className="status-pill";box.textContent="Web only — install APK for background checks";return}
  try{
    var st=JSON.parse(window.NativeHealth.getStatus()||"{}");
    var last=st.lastRunAt?new Date(st.lastRunAt).toLocaleString():"never";
    box.className="status-pill "+(st.enabled?"up":"");
    var skip=st.lastSkip?(" · skipped ("+st.lastSkip+")"):"";box.textContent=(st.enabled?"Monitoring on":"Monitoring off")+" · last run "+last+skip;
  }catch(e){box.textContent="Status unavailable"}
}
function runHealthNow(){
  syncProvidersNative();
  if(hasHealth()){try{window.NativeHealth.runOnce();setTimeout(refreshHealthStatus,1500);alert("Check started — watch notifications.")}catch(e){alert(String(e))}}
  else alert("Background checks require the Android APK.");
}
if($("btnSettings"))$("btnSettings").onclick=openSettings;
if($("hcClose"))$("hcClose").onclick=closeSettings;
if($("hcSave"))$("hcSave").onclick=saveSettings;
if($("hcRunNow"))$("hcRunNow").onclick=runHealthNow;
if($("settingsPanel"))$("settingsPanel").addEventListener("click",function(e){if(e.target===this)closeSettings()});
// keep native copy of providers in sync
(function(){
  var _save=save;
  save=function(){_save();try{syncProvidersNative()}catch(e){}};
  try{syncProvidersNative();syncHealthNative(healthSettings())}catch(e){}
})();


function hasData(){return !!(window.NativeData&&typeof window.NativeData.saveSnapshot==="function")}
function buildSnapshot(){
  return JSON.stringify({
    version:4,
    exportedAt:Date.now(),
    providers:S.providers||[],
    chats:S.chats||[],
    pid:S.pid||S.activeProviderId||null,
    cid:S.cid||S.activeChatId||null,
    health:healthSettings(),
    theme:localStorage.getItem("et-theme")||"dark",
    accent:localStorage.getItem("et-accent")||"violet"
  });
}
function applySnapshot(raw){
  var data=typeof raw==="string"?JSON.parse(raw):raw;
  if(!data||!Array.isArray(data.providers)||!data.providers.length)throw new Error("No providers in backup");
  S.providers=data.providers.map(blankP);
  S.chats=Array.isArray(data.chats)?data.chats:[];
  S.pid=data.pid&&S.providers.some(function(p){return p.id===data.pid})?data.pid:S.providers[0].id;
  S.activeProviderId=S.pid;
  S.cid=data.cid&&S.chats.some(function(c){return c.id===data.cid})?data.cid:null;
  S.activeChatId=S.cid;
  if(data.health)saveHealthLocal(data.health);
  if(data.theme){try{theme(data.theme)}catch(e){localStorage.setItem("et-theme",data.theme)}}
  if(data.accent){try{setAccent(data.accent)}catch(e){localStorage.setItem("et-accent",data.accent)}}
  save();
  try{syncProvidersNative();syncHealthNative(healthSettings())}catch(e){}
  try{rP();rC();fS();rM();ui()}catch(e){}
}
function autoBackup(){
  try{
    var snap=buildSnapshot();
    if(hasData())window.NativeData.saveSnapshot(snap);
  }catch(e){}
}
function exportBackup(){
  var snap=buildSnapshot();
  autoBackup();
  if(hasData()){
    try{
      var path=window.NativeData.exportToDownloads(snap);
      if(String(path).indexOf("error")===0)alert(path);
      else alert("Exported to "+path+"\n\nKeep this file. After reinstall, use Import.");
      return;
    }catch(e){}
  }
  // web fallback
  try{
    var blob=new Blob([snap],{type:"application/json"});
    var a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="endpoint-tester-backup.json";
    a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href)},2000);
    alert("Backup downloaded.");
  }catch(e){alert("Export failed: "+e)}
}
function importBackupFile(file){
  var reader=new FileReader();
  reader.onload=function(){
    try{
      applySnapshot(String(reader.result||""));
      autoBackup();
      alert("Imported "+S.providers.length+" provider(s).");
      closeSettings();
    }catch(e){alert("Import failed: "+(e.message||e))}
  };
  reader.readAsText(file);
}
function tryRestoreFromNative(){
  if(!hasData())return false;
  try{
    var snap=window.NativeData.loadSnapshot();
    if(!snap)return false;
    var data=JSON.parse(snap);
    if(!data.providers||!data.providers.length)return false;
    // only restore if local is empty/default single empty-ish
    var localEmpty=!S.providers||S.providers.length===0||(S.providers.length===1&&!(S.providers[0].apiKey||(S.providers[0].baseUrl&&S.providers[0].baseUrl.indexOf("openai.com")>=0&&!S.providers[0].apiKey)&&!(S.chats&&S.chats.length)));
    // Prefer native if local has no api keys and native has any
    var localHasKey=(S.providers||[]).some(function(p){return !!(p.apiKey&&p.apiKey.length>3)});
    var nativeHasKey=(data.providers||[]).some(function(p){return !!(p.apiKey&&p.apiKey.length>3)});
    if(!localHasKey&&nativeHasKey){
      applySnapshot(data);
      return true;
    }
  }catch(e){}
  return false;
}
if($("btnExport"))$("btnExport").onclick=exportBackup;
if($("btnImport"))$("btnImport").onclick=function(){$("importFile").click()};
if($("importFile"))$("importFile").onchange=function(e){
  var f=e.target.files&&e.target.files[0];
  if(f)importBackupFile(f);
  e.target.value="";
};
// hook save to auto-backup
(function(){
  var _save2=save;
  save=function(){
    _save2();
    try{autoBackup()}catch(e){}
  };
})();

(function wirePickers(){
  var bp=document.getElementById("btnProvider");
  var bm=document.getElementById("btnModel");
  var mp=document.getElementById("menuProvider");
  var mm=document.getElementById("menuModel");
  if(bp)bp.onclick=function(e){
    e.stopPropagation();
    var open=mp&&mp.classList.contains("open");
    closeMenus();
    if(!open&&mp){fS();mp.classList.add("open")}
  };
  if(bm)bm.onclick=function(e){
    e.stopPropagation();
    var open=mm&&mm.classList.contains("open");
    closeMenus();
    if(!open&&mm){fS();mm.classList.add("open")}
  };
  document.addEventListener("click",function(){closeMenus()});
})();

load();try{tryRestoreFromNative()}catch(e){}
rP();rC();fS();rM();ui();fS();
