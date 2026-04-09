export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent-king</title>
<style>
:root{--bg:#0d1117;--bg2:#161b22;--bg3:#21262d;--border:#30363d;--text:#e6edf3;--text2:#8b949e;--text3:#484f58;--blue:#58a6ff;--green:#3fb950;--yellow:#d29922;--red:#f85149;--purple:#bc8cff}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.header{background:var(--bg2);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100}
.header h1{font-size:20px;font-weight:600}
.meta{color:var(--text2);font-size:13px;display:flex;gap:16px;align-items:center}
.dl{width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--green);animation:bl 2s infinite}
.dd{width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--red)}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.3}}
.ct{max-width:1400px;margin:0 auto;padding:20px}
.g{display:grid;gap:16px}.g1{grid-template-columns:repeat(4,1fr)}.g2{grid-template-columns:2fr 1fr}.g3{grid-template-columns:1fr 1fr}
@media(max-width:900px){.g1,.g2,.g3{grid-template-columns:1fr}}
.c{background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.h{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.h h2{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text2)}
.b{padding:18px}.b0{padding:0}
.sc{text-align:center;padding:20px 16px}.sc .v{font-size:42px;font-weight:700;line-height:1}.sc .l{font-size:12px;color:var(--text2);margin-top:6px;text-transform:uppercase;letter-spacing:1px}
.sc.dn .v{color:var(--green)}.sc.dg .v{color:var(--blue)}.sc.td .v{color:var(--yellow)}.sc.er .v{color:var(--red)}
.pr{position:relative;width:120px;height:120px;margin:0 auto 12px}.pr svg{transform:rotate(-90deg)}.pr circle{fill:none;stroke-width:8}.pr .bg{stroke:var(--bg3)}.pr .fg{stroke:var(--green);stroke-linecap:round;transition:stroke-dashoffset .6s}.pr .t{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:28px;font-weight:700;color:var(--green)}
.pb{height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;margin:8px 0}.pb .f{height:100%;border-radius:3px;transition:width .5s;background:var(--green)}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 16px;font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);background:var(--bg2);position:sticky;top:0}
td{padding:10px 16px;border-bottom:1px solid var(--border);font-size:14px}
tr:hover{background:rgba(88,166,255,.04)}.tdg{background:rgba(88,166,255,.08)}.ter{background:rgba(248,81,73,.08)}.tdn{opacity:.6}
.bg{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
.bg.done{background:rgba(63,185,80,.1);color:var(--green)}.bg.doing{background:rgba(88,166,255,.1);color:var(--blue)}.bg.todo{background:rgba(210,153,34,.1);color:var(--yellow)}.bg.error{background:rgba(248,81,73,.1);color:var(--red)}.bg.skipped{background:var(--bg3);color:var(--text3)}
.wc{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--border)}.wc:last-child{border:none}
.wi{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px}
.wi.idle{background:var(--bg3);color:var(--text3)}.wi.busy{background:rgba(63,185,80,.1);color:var(--green);animation:pg 2s infinite}.wi.error{background:rgba(248,81,73,.1);color:var(--red)}
@keyframes pg{0%,100%{box-shadow:0 0 0 0 rgba(63,185,80,.3)}50%{box-shadow:0 0 0 6px rgba(63,185,80,0)}}
.el{font-family:monospace;font-size:12px;max-height:400px;overflow-y:auto}
.ei{padding:8px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px}.ei:hover{background:rgba(88,166,255,.04)}
.et{color:var(--text3);white-space:nowrap;min-width:70px}.em{flex:1;word-break:break-all}
.el::-webkit-scrollbar{width:6px}.el::-webkit-scrollbar-thumb{background:var(--bg3);border-radius:3px}
.ab{position:fixed;top:0;left:0;right:0;padding:14px 20px;color:#fff;text-align:center;font-weight:600;font-size:14px;z-index:999;transform:translateY(-100%);transition:transform .3s;box-shadow:0 4px 12px rgba(0,0,0,.3)}
.ab.show{transform:translateY(0)}
.btn{padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:12px;cursor:pointer;transition:all .2s}.btn:hover{background:var(--border)}
.btn-d{border-color:var(--red);color:var(--red)}.btn-d:hover{background:rgba(248,81,73,.1)}
.btn-p{border-color:var(--blue);color:var(--blue)}.btn-p:hover{background:rgba(88,166,255,.1)}
.empty{text-align:center;padding:40px 20px;color:var(--text3)}
.sec{margin-bottom:20px}
.tl{padding:0 18px 18px}.ti{display:flex;gap:12px;padding:8px 0}.tdot{width:10px;height:10px;border-radius:50%;margin-top:5px;flex-shrink:0}.tc{flex:1}.tt{font-size:13px;font-weight:500}.ts{font-size:11px;color:var(--text2);margin-top:2px}
</style>
</head>
<body>
<div class="ab" id="ab"><span style="float:right;cursor:pointer;opacity:.8" onclick="this.parentElement.classList.remove('show')">&times;</span><span id="at"></span></div>
<div class="header">
<h1>&#x1F451; Agent-king <span style="font-size:12px;color:var(--text3);font-weight:400">v0.1.1</span></h1>
<div class="meta"><span><span id="cd"></span> <span id="ct"></span></span><span id="ck"></span></div>
</div>
<div class="ct">
<div class="g g1 sec">
<div class="c sc dn"><div class="v" id="s0">0</div><div class="l">&#x2705; 完成</div></div>
<div class="c sc dg"><div class="v" id="s1">0</div><div class="l">&#x1F504; 进行中</div></div>
<div class="c sc td"><div class="v" id="s2">0</div><div class="l">&#x23F3; 待执行</div></div>
<div class="c sc er"><div class="v" id="s3">0</div><div class="l">&#x274C; 失败</div></div>
</div>
<div class="g g2 sec">
<div class="c"><div class="h"><h2>&#x1F4CB; 任务列表</h2><span style="font-size:12px;color:var(--text3)" id="tm"></span></div>
<div class="b0" style="max-height:500px;overflow-y:auto"><table><thead><tr><th>ID</th><th>任务</th><th>优先级</th><th>状态</th><th>Worker</th><th>操作</th></tr></thead><tbody id="tb"></tbody></table></div></div>
<div>
<div class="c sec"><div class="h"><h2>&#x1F4CA; 总体进度</h2></div><div class="b" style="text-align:center">
<div class="pr"><svg width="120" height="120"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" id="ring" cx="60" cy="60" r="52" stroke-dasharray="326.7" stroke-dashoffset="326.7"/></svg><div class="t" id="pct">0%</div></div>
<div class="pb"><div class="f" id="pbar" style="width:0%"></div></div>
<div style="font-size:12px;color:var(--text2);margin-top:8px" id="pm">...</div></div></div>
<div class="c"><div class="h"><h2>&#x1F916; Workers</h2></div><div class="b0" id="wl"><div class="empty">...</div></div></div>
</div></div>
<div class="g g3 sec">
<div class="c"><div class="h"><h2>&#x1F4E1; 实时事件</h2><button class="btn" onclick="clr()">清空</button></div><div class="el" id="el"><div class="empty">...</div></div></div>
<div class="c"><div class="h"><h2>&#x23F1; 最近活动</h2></div><div class="tl" id="tl"><div class="empty">...</div></div></div>
</div></div>
<script>
var T=[],W=[],ec=0,ti=[];
setInterval(function(){document.getElementById('ck').textContent=new Date().toLocaleTimeString('zh-CN')},1000);
function conn(){
var w=new WebSocket('ws://'+location.host+'/ws');
w.onopen=function(){document.getElementById('cd').className='dl';document.getElementById('ct').textContent='\u5DF2\u8FDE\u63A5'};
w.onclose=function(){document.getElementById('cd').className='dd';document.getElementById('ct').textContent='\u91CD\u8FDE...';setTimeout(conn,3000)};
w.onerror=function(){document.getElementById('cd').className='dd';document.getElementById('ct').textContent='\u9519\u8BEF'};
w.onmessage=function(e){var m=JSON.parse(e.data);if(m.type==='init'||m.type==='progress'){T=m.tasks||[];W=m.workers||[];rr();rw();rs()}if(m.type==='task_update')rf();if(m.type==='event'){ae(m.data);at(m.data)}if(m.type==='alert')sal(m.level,m.message)}
}conn();
function rf(){fetch('/api/tasks').then(function(r){return r.json()}).then(function(t){T=t;rr();rs()}).catch(function(){});fetch('/api/workers').then(function(r){return r.json()}).then(function(w){W=w;rw()}).catch(function(){})}
function rs(){
var d=T.filter(function(t){return t.status==='done'}).length,g=T.filter(function(t){return t.status==='doing'}).length,td=T.filter(function(t){return t.status==='todo'}).length,er=T.filter(function(t){return t.status==='error'}).length,tt=T.length;
document.getElementById('s0').textContent=d;document.getElementById('s1').textContent=g;document.getElementById('s2').textContent=td;document.getElementById('s3').textContent=er;
var p=tt>0?Math.round(d/tt*100):0;document.getElementById('ring').style.strokeDashoffset=326.7-p/100*326.7;
document.getElementById('pct').textContent=p+'%';document.getElementById('pbar').style.width=p+'%';
document.getElementById('pm').textContent=tt>0?d+'/'+tt+' \u5B8C\u6210 \xB7 '+td+' \u5F85\u6267\u884C'+(er>0?' \xB7 '+er+' \u5931\u8D25':''):'...';
document.getElementById('tm').textContent=tt>0?tt+' \u4E2A\u4EFB\u52A1':'';
}
function rr(){
var b=document.getElementById('tb');
if(T.length===0){b.innerHTML='<tr><td colspan="6"><div class="empty">\u6682\u65E0\u4EFB\u52A1</div></td></tr>';return}
var pr={high:'&#x1F534;',medium:'&#x1F7E1;',low:'&#x1F7E2;'};
var sl={done:'\u5B8C\u6210',doing:'\u8FDB\u884C\u4E2D',todo:'\u5F85\u6267\u884C',error:'\u5931\u8D25',skipped:'\u8DF3\u8FC7'};
b.innerHTML=T.map(function(t){
var c=t.status==='doing'?'tdg':t.status==='error'?'ter':t.status==='done'?'tdn':'';
var a=t.status==='error'?'<button class="btn btn-p" onclick="rt(\\''+t.id+'\\')">\u91CD\u8BD5</button> <button class="btn btn-d" onclick="sk(\\''+t.id+'\\')">\u8DF3\u8FC7</button>':'';
return '<tr class="'+c+'"><td style="font-family:monospace;font-size:12px;color:var(--text2)">'+t.id+'</td><td><div style="font-weight:500">'+t.title+'</div>'+(t.last_error?'<div style="font-size:11px;color:var(--red);margin-top:2px">'+t.last_error+'</div>':'')+'</td><td>'+(pr[t.priority]||'')+'</td><td><span class="bg '+t.status+'">'+(sl[t.status]||t.status)+'</span></td><td style="font-size:12px;color:var(--text2)">'+(t.assigned_worker||'-')+'</td><td>'+a+'</td></tr>'}).join('');
}
function rw(){
var e=document.getElementById('wl');
if(W.length===0){e.innerHTML='<div class="empty">...</div>';return}
e.innerHTML=W.map(function(w){
var ic=w.status==='busy'?'&#x26A1;':w.status==='error'?'&#x1F480;':'&#x1F634;';
var t=T.find(function(x){return x.id===w.current_task});
return '<div class="wc"><div class="wi '+w.status+'">'+ic+'</div><div style="flex:1"><div style="font-weight:600;font-size:14px">'+w.id+' <span class="bg '+w.status+'" style="margin-left:8px">'+w.status+'</span></div>'+(t?'<div style="font-size:12px;color:var(--text2);margin-top:2px">'+t.title+'</div>':'<div style="font-size:12px;color:var(--text3);margin-top:2px">\u7A7A\u95F2</div>')+'</div></div>'}).join('');
}
var ic2={start:'&#x1F680;',pre_tool_use:'&#x1F527;',post_tool_use:'&#x2705;',stop:'&#x1F3C1;',error:'&#x274C;',notification:'&#x1F514;'};
function ae(ev){ec++;var e=document.getElementById('el');if(ec===1)e.innerHTML='';
var t=new Date(ev.timestamp).toLocaleTimeString('zh-CN');
var d=document.createElement('div');d.className='ei';
d.innerHTML='<span class="et">'+t+'</span><span class="em"><b>'+(ev.worker_id||'?')+'</b> '+ev.event+(ev.tool?' <span style="color:var(--purple)">'+ev.tool+'</span>':'')+'</span>';
e.prepend(d);while(e.children.length>200)e.removeChild(e.lastChild)}
function clr(){document.getElementById('el').innerHTML='<div class="empty">\u5DF2\u6E05\u7A7A</div>';ec=0}
var tc={start:'var(--blue)',stop:'var(--green)',error:'var(--red)',pre_tool_use:'var(--yellow)',post_tool_use:'var(--green)'};
function at(ev){var t=new Date(ev.timestamp).toLocaleTimeString('zh-CN');
ti.unshift({d:tc[ev.event]||'var(--text3)',i:ic2[ev.event]||'&#x1F4CC;',t:(ev.worker_id||'?')+' \u2014 '+ev.event+(ev.tool?' '+ev.tool:''),s:t});
if(ti.length>50)ti.pop();
document.getElementById('tl').innerHTML=ti.map(function(x){return '<div class="ti"><div class="tdot" style="background:'+x.d+'"></div><div class="tc"><div class="tt">'+x.i+' '+x.t+'</div><div class="ts">'+x.s+'</div></div></div>'}).join('')}
function rt(id){fetch('/api/tasks/'+id+'/retry',{method:'POST'}).then(rf)}
function sk(id){fetch('/api/tasks/'+id,{method:'DELETE'}).then(rf)}
function sal(lv,msg){var b=document.getElementById('ab'),tx=document.getElementById('at');
var cs={error:'linear-gradient(135deg,#da3633,#f85149)',warn:'linear-gradient(135deg,#9e6a03,#d29922)',info:'linear-gradient(135deg,#1f6feb,#58a6ff)'};
b.style.background=cs[lv]||cs.error;tx.textContent=(lv==='error'?'&#x1F534;':lv==='warn'?'&#x1F7E1;':'&#x1F535;')+' '+msg;
b.classList.add('show');setTimeout(function(){b.classList.remove('show')},8000)}
setInterval(rf,30000);rf();
</script></body></html>`;
