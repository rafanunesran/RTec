// Series com copia "em manutencao" ou que falha no fornecedor (casos Big Bang Theory e One Piece, 2026-11-21).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
process.env.ADMIN_PASSWORD = "secret123"; process.env.RTEC_NO_ONLINE_INFO="1"; process.env.PROXY_SECRET="x";
const { setStore } = await import("./store/index.js");
const { createMemoryStore } = await import("./store/memory.js");
setStore(createMemoryStore());
const { createApp } = await import("./app.js");
const { openUrl } = await import("./seal.js");
const plain = (l) => { const q = new URL(l, "http://x").searchParams; return q.has("u") ? openUrl("x", q.get("u")) : l; };
const ep = (id, n, title) => ({ id, episode_num: n, season: 1, title, container_extension: "mp4" });
const src = http.createServer((req,res)=>{ const q=new URL(req.url,"http://x").searchParams; const j=(d)=>res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify(d));
 switch(q.get("action")){ case null: return j({user_info:{auth:1,status:"Active",exp_date:"1893456000"}});
 case "get_series_categories": return j([{category_id:"1",category_name:"Series"},{category_id:"2",category_name:"EM MANUTENÇÃO"}]);
 case "get_series": return j([
   {series_id:10,name:"The Big Bang Theory [EM MANUTENÇÃO]",category_id:"1"},{series_id:11,name:"The Big Bang Theory",category_id:"1"},
   {series_id:20,name:"One Piece",category_id:"2"},{series_id:21,name:"One Piece",category_id:"1"},
   {series_id:30,name:"One Piece Quebrada",category_id:"1"}]);
 case "get_series_info": { const id=q.get("series_id");
   if (id==="10") return j({episodes:{1:[ep(100,1,"Em manutenção")]}});
   if (id==="11") return j({episodes:{1:[ep(110,1,"Ep 1"),ep(111,2,"Ep 2")]}});
   if (id==="20") return res.writeHead(200,{"Content-Type":"text/html"}).end("<b>Fatal error</b>: Allowed memory size exhausted");
   if (id==="21") return j({episodes:{1:[ep(210,1,"Ep 1"),ep(211,1001,"Ep 1001")]}});
   if (id==="30") return res.writeHead(500).end("x");
 } } res.end("[]"); }).listen(0);
const api = createApp().listen(0); const base=`http://127.0.0.1:${api.address().port}`; let cookie="";
const call = async (m,u,b)=>{ const r=await fetch(base+u,{method:m,headers:{"Content-Type":"application/json",cookie},body:b?JSON.stringify(b):undefined}); const sc=r.headers.get("set-cookie"); if(sc) cookie=sc.split(";")[0]; const t=await r.text(); let body; try{body=JSON.parse(t)}catch{body=t}; return {status:r.status,body}; };
await call("POST","/api/auth/login",{username:"admin",password:"secret123"});
await call("POST","/api/clients",{username:"op",password:"x1",source:{kind:"xtream",xtream_server:`http://127.0.0.1:${src.address().port}`,xtream_username:"u",xtream_password:"p"}});
cookie=""; await call("POST","/api/player/login",{username:"op",password:"x1"});
after(() => { api.close(); src.close(); });
const eps = async (id) => (await call("GET", `/api/player/xtream/series/${id}?name=x`));
const file = (l) => plain(l).split("/").pop();

test("copia em manutencao nunca fica na frente; copia que falha nao derruba a serie", async () => {
  const items = (await call("GET", "/api/player/xtream/items?section=series&category=1")).body;
  assert.deepEqual(items.map((i) => [i.series_id, i.name]), [["11", "The Big Bang Theory"], ["21", "One Piece"], ["30", "One Piece Quebrada"]]);

  const bbt = (await eps("11")).body;
  assert.deepEqual(bbt.map((e) => [e.episode, file(e.src)]), [[1, "110.mp4"], [2, "111.mp4"]], "toca o episodio bom, nao o aviso");
  assert.deepEqual(bbt[0].more.map((m) => file(m.src)), ["100.mp4"], "a copia em manutencao fica so de reserva");
  // Pelo id antigo (historico/favoritos da copia em manutencao) tambem abre a boa.
  assert.equal(file((await eps("10")).body[0].src), "110.mp4");

  const op = await eps("21");
  assert.equal(op.status, 200, "copia na categoria EM MANUTENCAO responde HTML e mesmo assim a serie abre");
  assert.deepEqual(op.body.map((e) => e.episode), [1, 1001]);

  const broken = await eps("30");
  assert.equal(broken.status, 502);
  assert.match(broken.body.error, /HTTP 500/, "o aparelho mostra o motivo");
});
