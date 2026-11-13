
const state = { messages: [], streaming: false, models: [] };
const $ = id => document.getElementById(id);
const P=$("provider"),U=$("baseUrl"),K=$("apiKey"),M=$("model"),T=$("temperature"),MT=$("maxTokens"),S=$("stream"),SP=$("systemPrompt");
const msgs=$("messages"),empty=$("emptyState"),input=$("userInput"),send=$("sendBtn"),dot=$("statusDot"),st=$("statusText"),hdr=$("headerModel");
const defaults={openai:{baseUrl:"https://api.openai.com/v1",model:"gpt-4o-mini"},gemini:{baseUrl:"https://generativelanguage.googleapis.com/v1beta",model:"gemini-2.0-flash"},keyless:{baseUrl:"http://127.0.0.1:11434/v1",model:"llama3.2"}};

function hasNative(){return !!(window.NativeHttp && typeof window.NativeHttp.request==="function")}
async function httpRequest(url, options={}){
  const method=(options.method||"GET").toUpperCase();
  const headers=options.headers||{};
  const body=options.body||null;
  if(hasNative()){
    return new Promise((resolve,reject)=>{
      const id="r_"+Date.now()+"_"+Math.random().toString(36).slice(2,8);
      window.__nativeHttpCallbacks=window.__nativeHttpCallbacks||{};
      window.__nativeHttpCallbacks[id]=(err,status,respBody,respHeadersJson)=>{
        delete window.__nativeHttpCallbacks[id];
        if(err){reject(new Error(err));return}
        resolve({ok:status>=200&&status<300,status,headers:{get:(k)=>{try{const h=JSON.parse(respHeadersJson||"{}");return h[k.toLowerCase()]||h[k]||null}catch{return null}}},text:async()=>respBody||"",json:async()=>JSON.parse(respBody||"{}"),body:null,_native:true,_body:respBody||""});
      };
      try{window.NativeHttp.request(id,method,url,JSON.stringify(headers),body)}catch(e){delete window.__nativeHttpCallbacks[id];reject(e)}
    });
  }
  return fetch(url,options);
}
function joinUrl(base,path){const b=(base||"").replace(/\/+$/,"");const p=path.startsWith("/")?path:"/"+path;return b+p}
function theme(t){document.documentElement.setAttribute("data-theme",t);$("themeBtn").textContent=t==="dark"?"\u2600\uFE0F":"\uD83C\uDF19";localStorage.setItem("et-theme",t)}
$("themeBtn").onclick=()=>theme(document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark");
theme(localStorage.getItem("et-theme")||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"));
$("menuBtn").onclick=()=>{$("sidebar").classList.add("open");$("overlay").classList.add("show")};
$("overlay").onclick=()=>{$("sidebar").classList.remove("open");$("overlay").classList.remove("show")};
function load(){try{const s=JSON.parse(localStorage.getItem("endpoint-tester")||"{}");if(s.provider)P.value=s.provider;if(s.baseUrl)U.value=s.baseUrl;if(s.apiKey)K.value=s.apiKey;if(s.model)M.value=s.model;if(s.temperature!=null)T.value=s.temperature;if(s.maxTokens)MT.value=s.maxTokens;if(s.stream!=null)S.checked=s.stream;if(s.systemPrompt)SP.value=s.systemPrompt;if(Array.isArray(s.models)){state.models=s.models;fillModelList(s.models)}}catch{}apply(false);ui()}
function save(){localStorage.setItem("endpoint-tester",JSON.stringify({provider:P.value,baseUrl:U.value.trim(),apiKey:K.value.trim(),model:M.value.trim(),temperature:+T.value||.7,maxTokens:+MT.value||1024,stream:S.checked,systemPrompt:SP.value,models:state.models}));status("ok","Saved");setTimeout(()=>status("","Ready"),1200)}
function apply(force=true){const d=defaults[P.value];if(force||!U.value)U.value=d.baseUrl;if(force||!M.value)M.value=d.model;$("keyField").style.display=P.value==="keyless"?"none":"block";ui()}
P.onchange=()=>apply(true);
function ui(){const r=U.value.trim()&&M.value.trim();input.disabled=!r||state.streaming;send.disabled=!r||state.streaming;const l={openai:"OpenAI-compat",gemini:"Gemini",keyless:"Custom"}[P.value];hdr.textContent=r?l+" \u00B7 "+M.value.trim():"Configure an endpoint"}
["baseUrl","model","apiKey"].forEach(id=>$(id).oninput=ui);
function status(t,x){dot.className="dot"+(t?" "+t:"");st.textContent=x}
function add(role,c){empty.style.display="none";const d=document.createElement("div");d.className="msg "+role;d.textContent=c;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d}
function clear(){state.messages=[];msgs.innerHTML="";msgs.appendChild(empty);empty.style.display="flex"}
function fillModelList(ids){const dl=$("modelList");dl.innerHTML="";(ids||[]).forEach(id=>{const o=document.createElement("option");o.value=id;dl.appendChild(o)})}
function formatErr(status,body){if(typeof body==="string")return status+": "+body.slice(0,400);const msg=body?.error?.message||body?.error?.code||body?.message||JSON.stringify(body).slice(0,400);return status+": "+msg}
async function fetchModels(){status("loading","Fetching models\u2026");try{const provider=P.value;const base=U.value.trim().replace(/\/+$/,"");const key=K.value.trim();let ids=[];if(provider==="gemini"){if(!key)throw new Error("API key required for Gemini");const url=base+"/models?key="+encodeURIComponent(key);const r=await httpRequest(url,{method:"GET"});const j=await r.json();if(!r.ok)throw new Error(formatErr(r.status,j));const gen=(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes("generateContent"));ids=(gen.length?gen:(j.models||[])).map(m=>(m.name||"").replace(/^models\//,"")).filter(Boolean)}else{const url=joinUrl(base,"/models");const headers={"Content-Type":"application/json"};if(key)headers.Authorization="Bearer "+key;const r=await httpRequest(url,{method:"GET",headers});const text=await r.text();let j;try{j=JSON.parse(text)}catch{j={raw:text}}if(!r.ok)throw new Error(formatErr(r.status,j));ids=(j.data||[]).map(m=>m.id).filter(Boolean)}if(!ids.length)throw new Error("No models returned");state.models=ids;fillModelList(ids);if(!M.value.trim()||!ids.includes(M.value.trim()))M.value=ids[0];save();ui();status("ok",ids.length+" models");add("system","Loaded "+ids.length+" models. First: "+ids[0])}catch(err){status("err","Models failed");add("error","Fetch models failed: "+(err.message||err))}}
async function callOA(messages,stream){const base=U.value.trim().replace(/\/+$/,"");const headers={"Content-Type":"application/json"};const key=K.value.trim();if(key)headers.Authorization="Bearer "+key;const useStream=stream&&!hasNative();const r=await httpRequest(joinUrl(base,"/chat/completions"),{method:"POST",headers,body:JSON.stringify({model:M.value.trim(),messages,temperature:+T.value||.7,max_tokens:+MT.value||1024,stream:useStream})});if(!r.ok){const t=r._native?r._body:await r.text();let j;try{j=JSON.parse(t)}catch{j=t}throw new Error(formatErr(r.status,j))}return{res:r,streamed:useStream}}
async function callG(messages,stream){const base=U.value.trim().replace(/\/+$/,"");const model=M.value.trim();const key=K.value.trim();if(!key)throw new Error("API key required for Gemini");const contents=[];let sys=null;for(const m of messages){if(m.role==="system"){sys={parts:[{text:m.content}]};continue}contents.push({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]})}const useStream=stream&&!hasNative();const ep=useStream?base+"/models/"+model+":streamGenerateContent?alt=sse&key="+encodeURIComponent(key):base+"/models/"+model+":generateContent?key="+encodeURIComponent(key);const body={contents,generationConfig:{temperature:+T.value||.7,maxOutputTokens:+MT.value||1024}};if(sys)body.systemInstruction=sys;const r=await httpRequest(ep,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok){const t=r._native?r._body:await r.text();let j;try{j=JSON.parse(t)}catch{j=t}throw new Error(formatErr(r.status,j))}return{res:r,streamed:useStream}}
async function streamOA(r,on){if(r._native){const j=JSON.parse(r._body||"{}");return j.choices?.[0]?.message?.content||""}const reader=r.body.getReader();const dec=new TextDecoder();let buf="",full="";while(true){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split("\n");buf=lines.pop()||"";for(const line of lines){const t=line.trim();if(!t.startsWith("data:"))continue;const data=t.slice(5).trim();if(data==="[DONE]")continue;try{const d=JSON.parse(data).choices?.[0]?.delta?.content||"";if(d){full+=d;on(full)}}catch{}}}return full}
async function streamG(r,on){if(r._native){const j=JSON.parse(r._body||"{}");return j.candidates?.[0]?.content?.parts?.[0]?.text||""}const reader=r.body.getReader();const dec=new TextDecoder();let buf="",full="";while(true){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split("\n");buf=lines.pop()||"";for(const line of lines){const t=line.trim();if(!t.startsWith("data:"))continue;const data=t.slice(5).trim();if(!data)continue;try{const tx=JSON.parse(data).candidates?.[0]?.content?.parts?.[0]?.text||"";if(tx){full+=tx;on(full)}}catch{}}}return full}
async function nonStream(r,p){if(r._native){const j=JSON.parse(r._body||"{}");return p==="gemini"?(j.candidates?.[0]?.content?.parts?.[0]?.text||JSON.stringify(j)):(j.choices?.[0]?.message?.content||JSON.stringify(j))}const j=await r.json();return p==="gemini"?(j.candidates?.[0]?.content?.parts?.[0]?.text||JSON.stringify(j)):(j.choices?.[0]?.message?.content||JSON.stringify(j))}
async function sendMsg(){const text=input.value.trim();if(!text||state.streaming)return;const provider=P.value;const useStream=S.checked;const m=[];const sys=SP.value.trim();if(sys)m.push({role:"system",content:sys});for(const x of state.messages)if(x.role==="user"||x.role==="assistant")m.push(x);m.push({role:"user",content:text});add("user",text);state.messages.push({role:"user",content:text});input.value="";input.style.height="auto";state.streaming=true;ui();status("loading","Generating\u2026");const el=add("assistant",useStream&&!hasNative()?"":"\u2026");try{const{res,streamed}=provider==="gemini"?await callG(m,useStream):await callOA(m,useStream);let full="";if(streamed){const handler=provider==="gemini"?streamG:streamOA;full=await handler(res,partial=>{el.textContent=partial;msgs.scrollTop=msgs.scrollHeight})}else{full=await nonStream(res,provider);el.textContent=full}if(!full)full="(empty response)";el.textContent=full;state.messages.push({role:"assistant",content:full});status("ok","Done")}catch(err){el.remove();add("error",err.message||String(err));status("err","Error")}finally{state.streaming=false;ui();setTimeout(()=>status("","Ready"),2500)}}
async function testConn(){status("loading","Testing\u2026");try{const provider=P.value;const m=[{role:"user",content:"Reply with exactly: ok"}];const{res}=provider==="gemini"?await callG(m,false):await callOA(m,false);const text=await nonStream(res,provider);status("ok","OK \u00B7 "+(text||"").slice(0,40));add("system","Connection OK \u2014 "+((text||"").slice(0,120)))}catch(err){status("err","Failed");add("error","Connection test failed: "+(err.message||err))}}
send.onclick=sendMsg;
input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg()}};
input.oninput=()=>{input.style.height="auto";input.style.height=Math.min(input.scrollHeight,120)+"px"};
$("clearChat").onclick=clear;$("saveSettings").onclick=save;$("testConn").onclick=testConn;$("fetchModels").onclick=fetchModels;
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
load();
if(hasNative()){status("ok","Native HTTP ready");setTimeout(()=>status("","Ready"),1500)}
