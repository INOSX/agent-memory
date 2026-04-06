/**
 * Standalone memory viewer — lightweight HTTP server with inline HTML/CSS/JS.
 *
 * Launched via `agent-memory viewer` CLI command.
 * Zero extra dependencies — uses only Node built-ins + createMemory().
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import type { AgentMemory } from "./index.js";

interface ViewerOptions {
  mem: AgentMemory;
  port: number;
  open: boolean;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseRequest(url: string): { pathname: string; query: Record<string, string> } {
  const u = new URL(url, "http://localhost");
  const query: Record<string, string> = {};
  for (const [k, v] of u.searchParams) query[k] = v;
  return { pathname: u.pathname, query };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
}

async function handleAPI(
  mem: AgentMemory,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: Record<string, string>,
): Promise<void> {
  try {
    if (pathname === "/api/agents" && req.method === "GET") {
      const agents = await mem.vault.listAgents();
      return json(res, { agents });
    }

    if (pathname === "/api/vault" && req.method === "GET") {
      const { agent, category } = query;
      if (!agent || !category) return json(res, { error: "agent & category required" }, 400);
      const entries = await mem.vault.read(agent, category);
      return json(res, { entries });
    }

    if (pathname === "/api/vault" && req.method === "POST") {
      const body = await readBody(req);
      const entry = await mem.vault.append(
        body.agent as string,
        body.category as string,
        body.content as string,
        body.tags as string[] | undefined,
      );
      return json(res, { entry });
    }

    if (pathname === "/api/vault" && req.method === "PUT") {
      const body = await readBody(req);
      await mem.vault.update(
        body.agent as string,
        body.category as string,
        body.id as string,
        body.content as string,
      );
      return json(res, { ok: true });
    }

    if (pathname === "/api/vault" && req.method === "DELETE") {
      const body = await readBody(req);
      await mem.vault.remove(body.agent as string, body.category as string, body.id as string);
      return json(res, { ok: true });
    }

    if (pathname === "/api/counts" && req.method === "GET") {
      const { agent } = query;
      if (!agent) return json(res, { error: "agent required" }, 400);
      const counts = await mem.vault.getCategoryCounts(agent);
      return json(res, { counts });
    }

    if (pathname === "/api/search" && req.method === "GET") {
      const { q, limit } = query;
      if (!q) return json(res, { results: [] });
      const results = await mem.search.search(q, { limit: parseInt(limit ?? "20", 10) });
      return json(res, { results });
    }

    if (pathname === "/api/project" && req.method === "GET") {
      let content = "";
      try {
        content = readFileSync(
          resolve(mem.config.dir, mem.config.projectContextFile),
          "utf8",
        );
      } catch {
        /* no project file */
      }
      return json(res, { content });
    }

    if (pathname === "/api/compact" && req.method === "POST") {
      const result = await mem.compact.run();
      return json(res, result);
    }

    if (pathname === "/api/stats" && req.method === "GET") {
      const agents = await mem.vault.listAgents();
      let totalEntries = 0;
      const agentStats: Array<{ agentId: string; counts: Record<string, number>; total: number }> =
        [];
      for (const agentId of agents) {
        const counts = await mem.vault.getCategoryCounts(agentId);
        const sum = Object.values(counts).reduce((a, b) => a + b, 0);
        totalEntries += sum;
        agentStats.push({ agentId, counts, total: sum });
      }
      agentStats.sort((a, b) => b.total - a.total);
      return json(res, { totalAgents: agents.length, totalEntries, agentStats });
    }

    return json(res, { error: "Not found" }, 404);
  } catch (e) {
    return json(res, { error: String(e) }, 500);
  }
}

function buildHTML(memDir: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Memory Viewer</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0e17;
    --surface: #111827;
    --surface2: #1a2236;
    --border: #1e293b;
    --border-active: #3b82f6;
    --text: #e2e8f0;
    --text-muted: #64748b;
    --text-dim: #475569;
    --accent: #3b82f6;
    --accent-glow: rgba(59, 130, 246, 0.15);
    --green: #22c55e;
    --yellow: #eab308;
    --red: #ef4444;
    --purple: #a855f7;
    --cyan: #06b6d4;
    --orange: #f97316;
    --radius: 8px;
    --font-mono: 'JetBrains Mono', monospace;
    --font-sans: 'Inter', system-ui, sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--font-sans); background: var(--bg); color: var(--text); height: 100vh; overflow: hidden; }
  .app { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
  .header { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1.25rem; background: var(--surface); border-bottom: 1px solid var(--border); }
  .header-logo { font-family: var(--font-mono); font-weight: 700; font-size: 0.9rem; letter-spacing: 0.05em; color: var(--accent); }
  .header-dir { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-dim); background: var(--bg); padding: 0.2rem 0.5rem; border-radius: 4px; }
  .header-stats { margin-left: auto; display: flex; gap: 1rem; font-size: 0.75rem; color: var(--text-muted); }
  .stat-pill { display: flex; align-items: center; gap: 0.3rem; }
  .stat-dot { width: 6px; height: 6px; border-radius: 50%; }
  .main { display: grid; grid-template-columns: 260px 1fr; overflow: hidden; }
  .sidebar { background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
  .sidebar-search { padding: 0.75rem; border-bottom: 1px solid var(--border); }
  .sidebar-search input { width: 100%; padding: 0.5rem 0.75rem; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-family: var(--font-mono); font-size: 0.75rem; outline: none; transition: border-color 0.2s; }
  .sidebar-search input:focus { border-color: var(--accent); }
  .sidebar-search input::placeholder { color: var(--text-dim); }
  .agents-list { flex: 1; overflow-y: auto; padding: 0.5rem; }
  .agent-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.65rem; border-radius: 6px; cursor: pointer; font-size: 0.78rem; color: var(--text-muted); transition: all 0.15s; border: 1px solid transparent; }
  .agent-item:hover { background: var(--surface2); color: var(--text); }
  .agent-item.active { background: var(--accent-glow); color: var(--accent); border-color: var(--border-active); font-weight: 500; }
  .agent-badge { margin-left: auto; font-family: var(--font-mono); font-size: 0.65rem; min-width: 1.4rem; text-align: center; padding: 0.1rem 0.3rem; border-radius: 4px; background: var(--bg); color: var(--text-dim); }
  .agent-item.active .agent-badge { background: var(--accent); color: #fff; }
  .categories { border-top: 1px solid var(--border); padding: 0.5rem; }
  .cat-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); padding: 0.3rem 0.5rem; }
  .cat-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.65rem; border-radius: 6px; cursor: pointer; font-size: 0.75rem; color: var(--text-muted); transition: all 0.15s; border: 1px solid transparent; }
  .cat-item:hover { background: var(--surface2); color: var(--text); }
  .cat-item.active { background: var(--accent-glow); color: var(--accent); border-color: var(--border-active); font-weight: 500; }
  .cat-dot { width: 8px; height: 8px; border-radius: 2px; }
  .cat-dot.decisions { background: var(--green); }
  .cat-dot.lessons { background: var(--yellow); }
  .cat-dot.tasks { background: var(--orange); }
  .cat-dot.projects { background: var(--purple); }
  .cat-dot.handoffs { background: var(--cyan); }
  .cat-count { margin-left: auto; font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-dim); }
  .sidebar-actions { border-top: 1px solid var(--border); padding: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; }
  .action-btn { width: 100%; padding: 0.45rem; border-radius: 6px; background: var(--bg); border: 1px solid var(--border); color: var(--text-muted); font-size: 0.72rem; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; text-align: center; }
  .action-btn:hover { border-color: var(--accent); color: var(--accent); }
  .action-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .action-btn.primary:hover { opacity: 0.9; }
  .content { display: flex; flex-direction: column; overflow: hidden; }
  .content-header { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--border); background: var(--surface); }
  .breadcrumb { font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted); }
  .breadcrumb strong { color: var(--text); font-weight: 600; }
  .content-header .search-global { margin-left: auto; display: flex; align-items: center; gap: 0.5rem; }
  .content-header .search-global input { width: 220px; padding: 0.4rem 0.7rem; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-family: var(--font-mono); font-size: 0.72rem; outline: none; }
  .content-header .search-global input:focus { border-color: var(--accent); }
  .entries { flex: 1; overflow-y: auto; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .entry { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; transition: border-color 0.2s; }
  .entry:hover { border-color: var(--border-active); }
  .entry-meta { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; font-size: 0.68rem; }
  .entry-date { font-family: var(--font-mono); color: var(--text-dim); }
  .entry-tag { padding: 0.1rem 0.4rem; border-radius: 3px; background: var(--surface2); color: var(--cyan); font-family: var(--font-mono); font-size: 0.62rem; }
  .entry-origin { color: var(--purple); font-family: var(--font-mono); margin-left: auto; }
  .entry-content { font-size: 0.82rem; line-height: 1.6; color: var(--text); white-space: pre-wrap; font-family: var(--font-mono); font-weight: 300; }
  .entry-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .entry-actions button { background: none; border: none; color: var(--text-dim); font-size: 0.68rem; cursor: pointer; padding: 0.15rem 0.3rem; border-radius: 3px; transition: all 0.15s; }
  .entry-actions button:hover { color: var(--accent); background: var(--accent-glow); }
  .entry-actions button.danger:hover { color: var(--red); background: rgba(239,68,68,0.1); }
  .empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-dim); gap: 0.5rem; }
  .empty-state .icon { font-size: 2rem; opacity: 0.3; }
  .empty-state p { font-size: 0.8rem; }
  .new-form { background: var(--surface); border: 1px solid var(--accent); border-radius: var(--radius); padding: 1rem; }
  .new-form textarea { width: 100%; min-height: 80px; padding: 0.6rem; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--font-mono); font-size: 0.78rem; resize: vertical; outline: none; }
  .new-form textarea:focus { border-color: var(--accent); }
  .new-form .form-row { display: flex; gap: 0.5rem; margin-top: 0.5rem; align-items: center; }
  .new-form input { flex: 1; padding: 0.4rem 0.6rem; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--font-mono); font-size: 0.72rem; outline: none; }
  .new-form button { padding: 0.4rem 1rem; border-radius: 6px; font-size: 0.72rem; cursor: pointer; border: none; font-family: var(--font-sans); }
  .btn-save { background: var(--accent); color: #fff; }
  .btn-cancel { background: var(--surface2); color: var(--text-muted); border: 1px solid var(--border) !important; }
  .edit-area { width: 100%; min-height: 60px; padding: 0.5rem; background: var(--bg); border: 1px solid var(--accent); border-radius: 6px; color: var(--text); font-family: var(--font-mono); font-size: 0.78rem; resize: vertical; outline: none; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { width: min(90vw, 700px); max-height: 80vh; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; display: flex; flex-direction: column; }
  .modal-header { display: flex; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); }
  .modal-header h3 { font-size: 0.85rem; font-weight: 600; }
  .modal-header button { margin-left: auto; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1rem; }
  .modal-body { flex: 1; overflow-y: auto; padding: 1rem; font-family: var(--font-mono); font-size: 0.75rem; line-height: 1.7; white-space: pre-wrap; color: var(--text); }
  .toast { position: fixed; bottom: 1.5rem; right: 1.5rem; padding: 0.6rem 1rem; border-radius: 6px; font-size: 0.75rem; font-family: var(--font-sans); background: var(--green); color: #000; font-weight: 500; opacity: 0; transition: opacity 0.3s; z-index: 200; }
  .toast.show { opacity: 1; }
  .loading { text-align: center; padding: 2rem; color: var(--text-dim); font-size: 0.8rem; }
  @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
  .loading { animation: pulse 1.5s infinite; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }
</style>
</head>
<body>
<div class="app" id="app">
  <div class="header">
    <span class="header-logo">AGENT MEMORY VIEWER</span>
    <span class="header-dir" id="memDir">${memDir}</span>
    <div class="header-stats" id="headerStats"></div>
  </div>
  <div class="main">
    <div class="sidebar">
      <div class="sidebar-search"><input type="text" id="agentFilter" placeholder="Filter agents..."></div>
      <div class="agents-list" id="agentsList"></div>
      <div class="categories" id="categoriesPanel"><div class="cat-label">Categories</div></div>
      <div class="sidebar-actions">
        <button class="action-btn" id="btnProject">_project.md</button>
        <button class="action-btn" id="btnCompact">Compact</button>
      </div>
    </div>
    <div class="content">
      <div class="content-header">
        <span class="breadcrumb" id="breadcrumb"></span>
        <div class="search-global"><input type="text" id="globalSearch" placeholder="BM25 search cross-agent..."></div>
      </div>
      <div class="entries" id="entriesPanel"></div>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
const CATEGORIES=["decisions","lessons","tasks","projects","handoffs"];
let state={agents:[],filteredAgents:[],selectedAgent:null,selectedCategory:"decisions",counts:{},entries:[],searchMode:false,searchResults:[],showingNew:false,editingId:null};
const $=id=>document.getElementById(id);
async function api(p,o){return(await fetch(p,o)).json()}
function toast(m){const e=$("toast");e.textContent=m;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),2500)}
function labelFor(id){return id.replace(/-/g," ").replace(/\\b\\w/g,c=>c.toUpperCase())}
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}

async function loadAgents(){
  const d=await api("/api/agents");
  state.agents=(d.agents||[]).map(id=>({id,label:labelFor(id)}));
  state.agents.sort((a,b)=>a.label.localeCompare(b.label));
  state.filteredAgents=[...state.agents];
  if(!state.selectedAgent&&state.agents.length)state.selectedAgent=state.agents[0].id;
  renderAgents();await loadStats();await loadCounts();await loadEntries();
}

async function loadStats(){
  const d=await api("/api/stats");
  $("headerStats").innerHTML='<span class="stat-pill"><span class="stat-dot" style="background:var(--accent)"></span>'+d.totalAgents+' agents</span><span class="stat-pill"><span class="stat-dot" style="background:var(--green)"></span>'+d.totalEntries+' entries</span>';
}

async function loadCounts(){
  if(!state.selectedAgent)return;
  const d=await api("/api/counts?agent="+encodeURIComponent(state.selectedAgent));
  state.counts=d.counts||{};renderCategories();
}

async function loadEntries(){
  if(!state.selectedAgent)return;state.searchMode=false;
  const d=await api("/api/vault?agent="+encodeURIComponent(state.selectedAgent)+"&category="+state.selectedCategory);
  state.entries=d.entries||[];renderEntries();updateBreadcrumb();
}

function renderAgents(){
  const c=$("agentsList");
  c.innerHTML=state.filteredAgents.map(a=>'<div class="agent-item'+(a.id===state.selectedAgent?' active':'')+'" data-id="'+a.id+'"><span>'+esc(a.label)+'</span></div>').join("");
  c.querySelectorAll(".agent-item").forEach(el=>{el.addEventListener("click",async()=>{state.selectedAgent=el.dataset.id;state.showingNew=false;state.editingId=null;$("globalSearch").value="";renderAgents();await loadCounts();await loadEntries()})});
}

function renderCategories(){
  const p=$("categoriesPanel");
  p.innerHTML='<div class="cat-label">Categories</div>'+CATEGORIES.map(cat=>'<div class="cat-item'+(cat===state.selectedCategory?' active':'')+'" data-cat="'+cat+'"><span class="cat-dot '+cat+'"></span><span>'+cat+'</span><span class="cat-count">'+(state.counts[cat]||0)+'</span></div>').join("");
  p.querySelectorAll(".cat-item").forEach(el=>{el.addEventListener("click",async()=>{state.selectedCategory=el.dataset.cat;state.showingNew=false;state.editingId=null;$("globalSearch").value="";renderCategories();await loadEntries()})});
}

function updateBreadcrumb(){
  if(state.searchMode)$("breadcrumb").innerHTML='Search results <strong>'+esc($("globalSearch").value)+'</strong> ('+state.searchResults.length+')';
  else $("breadcrumb").innerHTML='<strong>'+esc(state.selectedAgent||"")+'</strong> / '+state.selectedCategory;
}

function renderEntries(){
  const panel=$("entriesPanel");const items=state.searchMode?state.searchResults:state.entries;
  if(!items.length&&!state.showingNew){
    panel.innerHTML='<div class="empty-state"><div class="icon">\\u{1F4ED}</div><p>No entries found</p></div>';
    if(!state.searchMode)panel.innerHTML+='<div style="text-align:center;margin-top:0.5rem"><button class="action-btn primary" style="width:auto;display:inline-block;padding:0.4rem 1.2rem" id="emptyNew">+ New entry</button></div>';
    const b=panel.querySelector("#emptyNew");if(b)b.onclick=()=>{state.showingNew=true;renderEntries()};return;
  }
  let h="";
  if(!state.searchMode){
    if(state.showingNew)h+='<div class="new-form"><textarea id="newContent" placeholder="Entry content..."></textarea><div class="form-row"><input id="newTags" placeholder="tags (comma separated)"><button class="btn-save" id="btnSaveNew">Save</button><button class="btn-cancel" id="btnCancelNew">Cancel</button></div></div>';
    else h+='<div style="margin-bottom:0.25rem"><button class="action-btn primary" style="width:auto;display:inline-block;padding:0.35rem 1rem;font-size:0.72rem" id="btnNewEntry">+ New entry</button></div>';
  }
  for(const item of items){
    const e=state.searchMode?item.entry:item;const isEd=state.editingId===e.id;
    h+='<div class="entry"><div class="entry-meta"><span class="entry-date">'+esc(e.date||"")+'</span>';
    if(e.tags)e.tags.forEach(t=>{h+='<span class="entry-tag">#'+esc(t)+'</span>'});
    if(state.searchMode)h+='<span class="entry-origin">'+esc(e.agentId)+' \\u00B7 '+esc(e.category)+'</span>';
    h+='</div>';
    if(isEd){h+='<textarea class="edit-area" id="editArea">'+esc(e.content)+'</textarea><div class="entry-actions" style="margin-top:0.5rem"><button class="btn-save" data-save="'+e.id+'" style="padding:0.3rem 0.8rem;border-radius:4px;border:none;cursor:pointer;background:var(--accent);color:#fff;font-size:0.7rem">Save</button><button class="btn-cancel" data-cancel="1" style="padding:0.3rem 0.8rem;border-radius:4px;border:1px solid var(--border);cursor:pointer;background:var(--surface2);color:var(--text-muted);font-size:0.7rem">Cancel</button></div>'}
    else{h+='<div class="entry-content">'+esc(e.content)+'</div>';if(!state.searchMode)h+='<div class="entry-actions"><button data-edit="'+e.id+'">edit</button><button class="danger" data-del="'+e.id+'">delete</button></div>'}
    h+='</div>';
  }
  panel.innerHTML=h;
  const bN=panel.querySelector("#btnNewEntry");if(bN)bN.onclick=()=>{state.showingNew=true;renderEntries()};
  const bS=panel.querySelector("#btnSaveNew");if(bS)bS.onclick=async()=>{const c=panel.querySelector("#newContent").value.trim();if(!c)return;const t=panel.querySelector("#newTags").value.split(",").map(s=>s.trim()).filter(Boolean);await api("/api/vault",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent:state.selectedAgent,category:state.selectedCategory,content:c,tags:t})});state.showingNew=false;toast("Entry created");await loadCounts();await loadEntries();await loadStats()};
  const bC=panel.querySelector("#btnCancelNew");if(bC)bC.onclick=()=>{state.showingNew=false;renderEntries()};
  panel.querySelectorAll("[data-edit]").forEach(b=>{b.onclick=()=>{state.editingId=b.dataset.edit;renderEntries()}});
  panel.querySelectorAll("[data-save]").forEach(b=>{b.onclick=async()=>{const c=panel.querySelector("#editArea").value.trim();if(!c)return;await api("/api/vault",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent:state.selectedAgent,category:state.selectedCategory,id:b.dataset.save,content:c})});state.editingId=null;toast("Entry updated");await loadEntries()}});
  panel.querySelectorAll("[data-cancel]").forEach(b=>{b.onclick=()=>{state.editingId=null;renderEntries()}});
  panel.querySelectorAll("[data-del]").forEach(b=>{b.onclick=async()=>{if(!confirm("Delete this entry?"))return;await api("/api/vault",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent:state.selectedAgent,category:state.selectedCategory,id:b.dataset.del})});toast("Entry removed");await loadCounts();await loadEntries();await loadStats()}});
}

let searchTimer=null;
$("globalSearch").addEventListener("input",e=>{clearTimeout(searchTimer);const q=e.target.value.trim();if(!q){state.searchMode=false;loadEntries();return}searchTimer=setTimeout(async()=>{const d=await api("/api/search?q="+encodeURIComponent(q)+"&limit=30");state.searchMode=true;state.searchResults=d.results||[];updateBreadcrumb();renderEntries()},350)});
$("agentFilter").addEventListener("input",e=>{const q=e.target.value.toLowerCase();state.filteredAgents=state.agents.filter(a=>a.label.toLowerCase().includes(q)||a.id.includes(q));renderAgents()});
$("btnProject").addEventListener("click",async()=>{const d=await api("/api/project");const o=document.createElement("div");o.className="modal-overlay";o.innerHTML='<div class="modal"><div class="modal-header"><h3>_project.md</h3><button id="closeModal">\\u2715</button></div><div class="modal-body">'+esc(d.content||"(empty)")+'</div></div>';document.body.appendChild(o);o.querySelector("#closeModal").onclick=()=>o.remove();o.addEventListener("click",e=>{if(e.target===o)o.remove()})});
$("btnCompact").addEventListener("click",async()=>{$("btnCompact").textContent="Compacting...";$("btnCompact").disabled=true;try{const d=await api("/api/compact",{method:"POST"});toast("Compaction: "+(d.checkpointsCleaned||0)+" checkpoints, "+(d.vaultEntriesMerged||0)+" merged, index "+(d.indexRebuilt?"rebuilt":"ok"));await loadCounts();await loadEntries();await loadStats()}catch(e){toast("Error: "+e.message)}$("btnCompact").textContent="Compact";$("btnCompact").disabled=false});
loadAgents();
</script>
</body>
</html>`;
}

export function startViewer({ mem, port, open }: ViewerOptions): void {
  const html = buildHTML(mem.config.dir);

  const server = createServer(async (req, res) => {
    const { pathname, query } = parseRequest(req.url ?? "/");
    if (pathname.startsWith("/api/")) return handleAPI(mem, req, res, pathname, query);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    const dirDisplay = mem.config.dir.length > 30 ? `…${mem.config.dir.slice(-28)}` : mem.config.dir;
    console.log("");
    console.log(`  \x1b[36m┌─────────────────────────────────────────┐\x1b[0m`);
    console.log(`  \x1b[36m│\x1b[0m  \x1b[1mAGENT MEMORY VIEWER\x1b[0m                     \x1b[36m│\x1b[0m`);
    console.log(`  \x1b[36m│\x1b[0m                                          \x1b[36m│\x1b[0m`);
    console.log(`  \x1b[36m│\x1b[0m  Local:  \x1b[32m${url.padEnd(30)}\x1b[0m\x1b[36m│\x1b[0m`);
    console.log(`  \x1b[36m│\x1b[0m  Dir:    ${dirDisplay.padEnd(30)}\x1b[36m│\x1b[0m`);
    console.log(`  \x1b[36m│\x1b[0m                                          \x1b[36m│\x1b[0m`);
    console.log(`  \x1b[36m│\x1b[0m  Ctrl+C to stop                          \x1b[36m│\x1b[0m`);
    console.log(`  \x1b[36m└─────────────────────────────────────────┘\x1b[0m`);
    console.log("");

    if (open) {
      try {
        const cmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        execSync(`${cmd} ${url}`, { stdio: "ignore" });
      } catch {
        /* couldn't open browser */
      }
    }
  });
}
