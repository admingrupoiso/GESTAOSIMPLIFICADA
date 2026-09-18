const HOJE = new Date();
const fmtN = n => (n==null||isNaN(n)) ? '—' : n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtI = n => (n==null||isNaN(n)) ? '—' : Math.round(n).toLocaleString('pt-BR');
const fmtP = n => n==null ? '—' : (n*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
const fmtD = d => d ? d.toLocaleDateString('pt-BR') : '—';
const soma = (arr,k) => arr.reduce((s,r)=>s+(r[k]||0),0);
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function q(s){ return String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function extensao(nome){ const m=/\.([a-zA-Z0-9]+)$/.exec(nome||''); return m?m[1].toUpperCase():'ARQ'; }
function fmtBytes(n){
  if(n<1024) return n+' B';
  if(n<1024*1024) return (n/1024).toFixed(1)+' KB';
  return (n/1024/1024).toFixed(2)+' MB';
}

// ---- Catálogo de Produtos (Adubo, Calcário, Herbicida, Outros) ----
function catalogoDefault(){
  return [
    {id:'calcario', nome:'Calcário', categoria:'Calcário', unidade:'ton/ha'},
    {id:'map', nome:'MAP', categoria:'Adubo', unidade:'kg/ha'},
  ];
}
let catalogoProdutos = catalogoDefault();
function modulosRegistradosDefault(){ return [...MODULOS]; }
let modulosRegistrados = modulosRegistradosDefault();
function moduloEmUso(nome){ return todos().some(r=>r.modulo===nome); }
function produtoPorId(id){ return catalogoProdutos.find(p=>p.id===id); }
function produtoEmUso(id){ return todos().some(r=>(r.aplicacoes||[]).some(a=>a.produtoId===id)); }

// ---- Modelo: cada pasto vira objeto com fórmulas vivas ----
// Migração fiel: as colunas originais "calcario ton/há" e "MAP kg/há" da planilha
// viram, automaticamente, as duas primeiras aplicações do novo modelo de produtos.
function montar(a, origem){
  const o = {
    pasto:a[0], manejo:a[1], modulo:a[2], sistema:a[3], areaTotal:a[4]||0,
    classificacao:a[5], capim:a[6], aguada:a[7], cocho:a[8], qtCocho:a[9],
    obs:a[10], qtdAnimais:null, pesoMedio:null, aplicacoes:[], origem
  };
  if(a[11]!=null) o.aplicacoes.push({produtoId:'calcario', quantidadeHa:a[11]});
  if(a[12]!=null) o.aplicacoes.push({produtoId:'map', quantidadeHa:a[12]});
  recalc(o);
  return o;
}
// Fórmulas: Área Empastada (%) = VLOOKUP(Classificação) · Área Útil = Total × %
// UA = (Qtd. Animais × Peso Médio) ÷ 450 · Taxa de Lotação = UA ÷ Área Útil (SEMPRE área útil)
// Total de cada produto = Quantidade/há × Área Total (SEMPRE área total, nunca a útil)
function recalc(o){
  const cl = CLASSIF.find(c=>c[0]===o.classificacao);
  o.pctEmpastada = cl ? cl[1] : null;
  o.areaUtil = o.pctEmpastada!=null ? (o.areaTotal||0)*o.pctEmpastada : 0;
  o.ua = (o.qtdAnimais && o.pesoMedio) ? (o.qtdAnimais*o.pesoMedio)/450 : 0;
  o.taxaLotacao = o.areaUtil>0 ? o.ua/o.areaUtil : null;
  (o.aplicacoes||[]).forEach(ap=>{ ap.total = (ap.quantidadeHa||0)*(o.areaTotal||0); });
}
function resumoAplicacoes(r){
  if(!r.aplicacoes || !r.aplicacoes.length) return '—';
  return r.aplicacoes.map(a=>{
    const p=produtoPorId(a.produtoId);
    return escapeHtml((p?p.nome:'produto removido')+' '+fmtN(a.quantidadeHa)+(p?('/'+p.unidade.split('/')[0]):''));
  }).join('; ');
}
// ---- Cores de manejo (recriadas da formatação condicional oculta da planilha original) ----
// A planilha colorpa a coluna "Ação de Manejo" por palavra-chave: Reforma=vermelho/urgente,
// Herbicida=azul, Calagem=dourado, Adubo=verde, Roçada=laranja. Reconstruído aqui como etiquetas,
// cobrindo também combinações (ex.: "Herbicida+Adubo") que a formatação original deixava sem cor.
const MANEJO_CORES=[
  {chave:'Reforma', cor:'#E5484D', urgente:true},
  {chave:'Herbicida', cor:'#5B9BD5'},
  {chave:'Calagem', cor:'#FFC000'},
  {chave:'Adubo', cor:'#70AD47'},
  {chave:'Roçada', cor:'#ED7D31'},
];
function badgesManejo(texto){
  if(!texto) return '—';
  const achados=MANEJO_CORES.filter(m=>texto.toLowerCase().includes(m.chave.toLowerCase()));
  if(!achados.length) return escapeHtml(texto);
  return achados.map(m=>`<span class="badge-manejo" style="background:${m.cor}${m.urgente?';font-weight:800':''}">${escapeHtml(m.chave)}</span>`).join('')+
    (achados.length===1 && achados[0].chave===texto ? '' : `<div class="dica" style="display:block;margin-top:2px">${escapeHtml(texto)}</div>`);
}

let baseRows = RAW_ROWS.map(a=>montar(a,'base'));
let extras = [];
let edicoes = {};
// Controla se os pastos de exemplo (Vista Alegre, embutidos no arquivo) aparecem.
// Instalação nova = começa vazia (sem carga). "Limpar Tudo" também esconde a base,
// pra virar um zero de verdade — não só reverter pro exemplo.
let ocultarBase = true;
function clienteDefault(){
  return {nome:'',fazenda:'',consultor:'',telefone:'',email:'',municipio:'',mapa:'',anexos:[],observacoes:[]};
}
let cliente = clienteDefault();
// `vista` guarda onde o usuário estava olhando (centro + zoom). É o que faz o mapa
// voltar exatamente no mesmo enquadramento depois de marcar um piquete, em vez de
// reenquadrar a fazenda inteira toda vez (o que dava a sensação de "ir diminuindo").
function mapaPropDefault(){
  return {arquivoNome:'', dataUpload:'', kmlTexto:'', talhoes:[], vista:null, mostrarRotulos:true};
}
let mapaProp = mapaPropDefault();
const filtros = {modulo:'', manejo:'', classificacao:'', capim:'', aguada:'', cocho:''};

const LS_KEY='controle_pastagem_vista_alegre_v1';
// Armazenamento seguro: usa localStorage quando o navegador permite;
// em ambientes restritos (ex.: visualizador embutido) cai para memória sem lançar erro.
const armazem=(function(){
  const mem={};
  let ls=null;
  try{ ls=window.localStorage; ls.setItem('__t','1'); ls.removeItem('__t'); }catch(e){ ls=null; }
  return {
    get k(){return ls?'disco':'memoria'},
    ler(k){ try{return ls?ls.getItem(k):(mem[k]??null)}catch(e){return mem[k]??null} },
    gravar(k,v){ try{ if(ls){ls.setItem(k,v);return} }catch(e){} mem[k]=v; }
  };
})();
try{
  const raw = armazem.ler(LS_KEY);
  if(raw){
    const s = JSON.parse(raw||'{}');
    // Compatibilidade: quem já tinha dados salvos de uma versão anterior a este controle
    // continua vendo a base normalmente, a não ser que já tivesse escondido explicitamente.
    ocultarBase = (s.ocultarBase!==undefined) ? s.ocultarBase : false;
    catalogoProdutos = (s.catalogoProdutos && s.catalogoProdutos.length) ? s.catalogoProdutos : catalogoDefault();
    modulosRegistrados = (s.modulosRegistrados && s.modulosRegistrados.length) ? s.modulosRegistrados : modulosRegistradosDefault();
    (s.extras||[]).forEach(e=>{recalc(e);extras.push(e)});
    edicoes = s.edicoes||{};
    Object.values(edicoes).forEach(e=>recalc(e));
    cliente = Object.assign(clienteDefault(), s.cliente||{});
    cliente.anexos = cliente.anexos||[]; cliente.observacoes = cliente.observacoes||[];
    mapaProp = Object.assign(mapaPropDefault(), s.mapaProp||{});
    mapaProp.talhoes = mapaProp.talhoes||[];
    Object.assign(filtros, s.filtros||{});
  }
  // raw nulo (primeira vez neste navegador) -> ocultarBase fica no default (true, começa vazio)
}catch(e){}
// Auto-descoberta: qualquer módulo já usado em algum pasto (inclusive digitado à mão
// ou vindo de uma importação) entra no cadastro de módulos, mesmo que não estivesse na lista original.
(function descobrirModulosUsados(){
  const usados=new Set(todos().map(r=>r.modulo).filter(Boolean));
  usados.forEach(m=>{ if(!modulosRegistrados.includes(m)) modulosRegistrados.push(m); });
})();
function persistir(){
  try{ armazem.gravar(LS_KEY, JSON.stringify({extras, edicoes, cliente, mapaProp, catalogoProdutos, modulosRegistrados, ocultarBase, filtros})); }catch(e){}
}
function todos(){
  const base = ocultarBase ? [] : baseRows.map(r=>edicoes[r.pasto]||r);
  return base.concat(extras);
}
function carregarDadosExemplo(){
  ocultarBase=false;
  if(!cliente.fazenda) cliente.fazenda='Vista Alegre';
  persistir(); atualizarTudo(); carregarCliente();
  toast('Dados de exemplo carregados — '+fmtI(baseRows.length)+' pastos da Fazenda Vista Alegre.');
}
function resumoModulo(nomeModulo){
  const alvo=normalizarTxt(nomeModulo);
  const rs=todos().filter(r=>r.modulo && normalizarTxt(r.modulo)===alvo);
  const areaTotal=soma(rs,'areaTotal'), areaUtil=soma(rs,'areaUtil');
  const qtdAnimais=soma(rs,'qtdAnimais');
  const somaPesoXQtd=rs.reduce((s,r)=>s+((r.qtdAnimais||0)*(r.pesoMedio||0)),0);
  const pesoMedio=qtdAnimais? somaPesoXQtd/qtdAnimais : null;
  const ua=soma(rs,'ua');
  const lotacao=areaUtil? ua/areaUtil : null;
  const areaPorClassif={};
  rs.forEach(r=>{ if(r.classificacao) areaPorClassif[r.classificacao]=(areaPorClassif[r.classificacao]||0)+r.areaTotal; });
  let classifPredominante=null, maiorArea=0;
  Object.entries(areaPorClassif).forEach(([c,a])=>{ if(a>maiorArea){ maiorArea=a; classifPredominante=c; } });
  const areaClassificada=Object.values(areaPorClassif).reduce((s,a)=>s+a,0);
  const pctAreaClassificada = areaTotal? areaClassificada/areaTotal*100 : 0;
  // Aproveitamento do pasto = quanto da área total é área útil empastada (a mesma
  // conta da coluna "% Empastada" da planilha, agregada por módulo).
  const pctAproveitamento = areaTotal? areaUtil/areaTotal*100 : null;
  return {rs, nPastos:rs.length, areaTotal, areaUtil, qtdAnimais, pesoMedio, ua, lotacao, classifPredominante, pctAreaClassificada, pctAproveitamento};
}
// ---- Cores por Classificação do Pasto (semáforo: vermelho/laranja = degradado, verde = produtivo) ----
const CLASSIF_CORES={
  'Degradação 1':'#F2A65A', 'Degradação 2':'#E8794B', 'Degradação 3':'#E5484D',
  'Produtivo 1':'#B8D98D', 'Produtivo 2':'#8FC966', 'Produtivo 3':'#5FAE46', 'Produtivo 4':'#2B4D1A',
};
function corClassificacao(nome){ return CLASSIF_CORES[nome] || '#9a9478'; }

// ---- Filtros ----
const defs = [
  ['modulo','Módulo / Talhão', ()=>uniq('modulo')],
  ['manejo','Ação de Manejo', ()=>uniq('manejo')],
  ['classificacao','Classificação', ()=>uniq('classificacao')],
  ['capim','Espécie do Capim', ()=>uniq('capim')],
  ['aguada','Tipo de Aguada', ()=>uniq('aguada')],
  ['cocho','Tipo de Cocho', ()=>uniq('cocho')],
];
function uniq(k){
  const vals = todos().map(r=> (r[k]==null||r[k]==='') ? '(Não informado)' : r[k]);
  return [...new Set(vals)].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
}
function renderFiltros(idDiv){
  const div=document.getElementById(idDiv); div.innerHTML='';
  defs.forEach(([k,rotulo,ops])=>{
    const w=document.createElement('div'); w.className='filtro';
    w.innerHTML=`<label>${rotulo}</label>`;
    const sel=document.createElement('select');
    sel.innerHTML=`<option value="">(Tudo)</option>`+ops().map(o=>`<option ${filtros[k]===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
    sel.onchange=()=>{filtros[k]=sel.value;atualizarTudo()};
    w.appendChild(sel); div.appendChild(w);
  });
  const limpar=document.createElement('button'); limpar.className='btn fantasma'; limpar.textContent='Limpar filtros';
  limpar.onclick=()=>{Object.keys(filtros).forEach(k=>filtros[k]='');atualizarTudo()};
  div.appendChild(limpar);
}
function filtrar(){
  const t=todos();
  return t.filter(r=>Object.entries(filtros).every(([k,v])=>{
    if(!v) return true;
    const val = (r[k]==null||r[k]==='') ? '(Não informado)' : r[k];
    return String(val)===v;
  }));
}

// ---- KPIs ----
function renderKpis(rs, targetId, clicavel){
  targetId = targetId || 'kpis';
  clicavel = clicavel!==false;
  const areaTotal=soma(rs,'areaTotal'), areaUtil=soma(rs,'areaUtil');
  const uaTotal=soma(rs,'ua');
  const classificados=rs.filter(r=>r.classificacao).length;
  const nModulos=new Set(rs.map(r=>r.modulo).filter(Boolean)).size;
  const pctMedio = areaTotal? areaUtil/areaTotal*100 : 0;
  const lotacaoMedia = areaUtil? uaTotal/areaUtil : null;
  const kpis=[
    ['Nº de Pastos', fmtI(rs.length), nModulos+' módulos/talhões'],
    ['Área Total', fmtN(areaTotal)+' ha', 'média '+fmtN(rs.length?areaTotal/rs.length:0)+' ha/pasto'],
    ['Área Útil', fmtN(areaUtil)+' ha', fmtN(pctMedio)+'% empastada'],
    ['Classificados', fmtI(classificados)+' / '+fmtI(rs.length), fmtI(rs.length-classificados)+' pendentes'],
    ['UA Total', fmtN(uaTotal)+' UA', fmtI(rs.filter(r=>r.qtdAnimais).length)+' pastos com animais'],
    ['Taxa de Lotação', (lotacaoMedia!=null?fmtN(lotacaoMedia):'—')+' UA/ha', 'sobre a área útil'],
  ];
  const classe = clicavel ? 'kpi' : 'kpi parado';
  const attrs = clicavel ? ' onclick="irParaRelatorio()" title="Ver no relatório completo"' : '';
  document.getElementById(targetId).innerHTML=kpis.map(([r,v,e])=>
    `<div class="${classe}"${attrs}><div class="rotulo">${r}</div><div class="valor">${v}</div><div class="extra">${e}</div></div>`).join('');
}
function irParaRelatorio(){
  const btn=document.querySelector('nav button[data-aba="relatorios"]');
  if(btn) btn.click();
}

// ---- Mini engine de gráficos (canvas puro) ----
const CORES=['#D4A820','#7fb95a','#c0563e','#5a8db9','#b97fb0','#e0c068','#6db9a8','#9a9478','#d4742a','#88a050','#c0a0d0'];
// Lê a cor ATUAL da variável CSS (muda sozinho com o tema claro/escuro — sem duplicar paleta aqui)
function corVar(nome, fallback){
  try{ const v=getComputedStyle(document.documentElement).getPropertyValue('--'+nome).trim(); return v||fallback; }catch(e){ return fallback; }
}
function prepCanvas(id){
  const c=document.getElementById(id); if(!c) return null;
  const dpr=window.devicePixelRatio||1;
  const w=c.clientWidth||c.parentElement.clientWidth-36||400, h=+c.getAttribute('height');
  if(w<=0) return null;
  c.width=w*dpr; c.height=h*dpr; c.style.height=h+'px';
  const ctx=c.getContext&&c.getContext('2d'); if(!ctx) return null;
  ctx.scale(dpr,dpr); ctx.clearRect(0,0,w,h);
  ctx.font='11px Inter'; return [ctx,w,h];
}
function donut(id, pares, rotuloCentro, semLegendaCanvas){
  rotuloCentro = rotuloCentro || 'PASTOS';
  const p0=prepCanvas(id); if(!p0)return; const [ctx,w,h]=p0;
  const corMudo=corVar('mudo','#9a9478'), corCreme=corVar('creme','#F5EAC8'), corTexto=corVar('texto','#e8e2cc');
  if(!pares.length){ctx.fillStyle=corMudo;ctx.fillText('Sem dados no filtro atual',20,40);return}
  const total=pares.reduce((s,p)=>s+p[1],0)||1;
  const R=h/2-20, r=R*0.6;
  const cx = semLegendaCanvas ? w/2 : h/2+10, cy=h/2;
  let ang=-Math.PI/2;
  pares.forEach((p,i)=>{
    const a2=ang+2*Math.PI*p[1]/total;
    ctx.beginPath(); ctx.arc(cx,cy,R,ang,a2); ctx.arc(cx,cy,r,a2,ang,true); ctx.closePath();
    ctx.fillStyle=CORES[i%CORES.length]; ctx.fill(); ang=a2;
  });
  ctx.fillStyle=corCreme; ctx.font='26px Bebas Neue'; ctx.textAlign='center';
  ctx.fillText(fmtI(total),cx,cy+2); ctx.font='9px Inter'; ctx.fillStyle=corMudo; ctx.fillText(rotuloCentro,cx,cy+16);
  if(semLegendaCanvas) return;
  ctx.textAlign='left'; let y=Math.max(20,(h-pares.length*20)/2);
  pares.forEach((p,i)=>{
    ctx.fillStyle=CORES[i%CORES.length]; ctx.fillRect(cx+R+24,y-8,10,10);
    ctx.fillStyle=corTexto; ctx.font='11.5px Inter';
    ctx.fillText(`${String(p[0]).slice(0,26)} — ${fmtI(p[1])} (${(p[1]/total*100).toFixed(1)}%)`,cx+R+40,y+1); y+=20;
  });
}
function barras(id, pares, fmt){
  fmt = fmt || fmtI;
  const p0=prepCanvas(id); if(!p0)return; const [ctx,w,h]=p0;
  const corMudo=corVar('mudo','#9a9478'), corCreme=corVar('creme','#F5EAC8');
  if(!pares.length){ctx.fillStyle=corMudo;ctx.fillText('Sem dados no filtro atual',20,40);return}
  const max=Math.max(...pares.map(p=>p[1]))||1;
  const bh=Math.min(22,(h-10)/pares.length-6), esq=Math.min(150, Math.max(...pares.map(p=>ctx.measureText(String(p[0])).width))+14);
  pares.forEach((p,i)=>{
    const y=8+i*((h-16)/pares.length), bw=(w-esq-70)*p[1]/max;
    ctx.fillStyle=corMudo; ctx.textAlign='right'; ctx.fillText(String(p[0]).slice(0,24),esq-8,y+bh/2+4);
    const g=ctx.createLinearGradient(esq,0,esq+bw,0); g.addColorStop(0,'#2B4D1A'); g.addColorStop(1,'#D4A820');
    ctx.fillStyle=g; ctx.fillRect(esq,y,Math.max(bw,2),bh);
    ctx.fillStyle=corCreme; ctx.textAlign='left'; ctx.fillText(fmt(p[1]),esq+bw+6,y+bh/2+4);
  });
}
function somaGrupo(rs,k,vk){
  const m={};
  rs.forEach(r=>{ const g=(r[k]==null||r[k]==='')?'Não informado':r[k]; m[g]=(m[g]||0)+(r[vk]||0); });
  return Object.entries(m).sort((a,b)=>b[1]-a[1]);
}
function contarGrupo(rs,k){
  const m={};
  rs.forEach(r=>{ const g=(r[k]==null||r[k]==='')?'Não informado':r[k]; m[g]=(m[g]||0)+1; });
  return Object.entries(m).sort((a,b)=>b[1]-a[1]);
}
function classifPares(rs){
  const m={}; CLASSIF.forEach(c=>m[c[0]]=0); let semClassif=0;
  rs.forEach(r=>{ if(r.classificacao && m.hasOwnProperty(r.classificacao)) m[r.classificacao]++; else semClassif++; });
  const pares = CLASSIF.map(c=>[c[0], m[c[0]]]).filter(p=>p[1]>0);
  if(semClassif>0) pares.push(['Não Classificado', semClassif]);
  return pares;
}
function renderGraficos(rs, sufixo){
  sufixo = sufixo || '';
  const semLegendaCanvas = !sufixo; // Painel: legenda vira HTML clicável embaixo · Relatório: mantém no canvas (impressão)
  barras('gModulo'+sufixo, somaGrupo(rs,'modulo','areaTotal').slice(0,15), v=>fmtN(v));
  donut('gClassif'+sufixo, classifPares(rs), 'PASTOS', semLegendaCanvas);
  donut('gManejo'+sufixo, contarGrupo(rs,'manejo'), 'PASTOS', semLegendaCanvas);
  barras('gCapim'+sufixo, somaGrupo(rs,'capim','areaTotal').slice(0,15), v=>fmtN(v));
  donut('gAguada'+sufixo, contarGrupo(rs,'aguada'), 'PASTOS', semLegendaCanvas);
  donut('gCocho'+sufixo, contarGrupo(rs,'cocho'), 'PASTOS', semLegendaCanvas);
  if(!sufixo){
    renderLegendaHtml('legClassif', classifPares(rs), 'classificacao', corClassificacao);
    renderLegendaHtml('legManejo', contarGrupo(rs,'manejo'), 'manejo');
    renderLegendaHtml('legAguada', contarGrupo(rs,'aguada'), 'aguada');
    renderLegendaHtml('legCocho', contarGrupo(rs,'cocho'), 'cocho');
  }
}
// Legenda em HTML de verdade (não desenhada no canvas) — clicável: clicar em qualquer
// linha filtra a tabela de Pastos por aquele valor e já leva pra lá.
function renderLegendaHtml(divId, pares, campo, corFn){
  const div=document.getElementById(divId); if(!div) return;
  if(!pares.length){ div.innerHTML=''; return; }
  const total=pares.reduce((s,p)=>s+p[1],0)||1;
  div.innerHTML=pares.map((p,i)=>{
    const cor = corFn ? corFn(p[0]==='Não Classificado'?null:p[0]) : CORES[i%CORES.length];
    const valorFiltro = (p[0]==='Não Classificado'||p[0]==='Não informado') ? '(Não informado)' : p[0];
    return `<div class="item-legenda" onclick="filtrarEIrPastos('${escapeHtml(campo)}','${q(valorFiltro)}')" title="Ver esses pastos na tabela">
      <span class="dot-legenda" style="background:${cor}"></span>
      <span>${escapeHtml(String(p[0]).slice(0,30))} — ${fmtI(p[1])} (${(p[1]/total*100).toFixed(1)}%)</span>
    </div>`;
  }).join('');
}
function filtrarEIrPastos(campo, valor){
  filtros[campo]=valor;
  pagina=0;
  atualizarTudo();
  const btn=document.querySelector('nav button[data-aba="pastos"]');
  if(btn) btn.click();
}

// ---- Tabela ----
const COLS=[
  ['pasto','Pasto',r=>escapeHtml(r.pasto)],
  ['manejo','Manejo',r=>badgesManejo(r.manejo)],
  ['modulo','Módulo',r=>escapeHtml(r.modulo||'—')],
  ['sistema','Sistema',r=>escapeHtml(r.sistema||'—')],
  ['areaTotal','Área Total (ha)',r=>fmtN(r.areaTotal)],
  ['classificacao','Classificação',r=>r.classificacao ? `<span class="etiqueta" style="background:${corClassificacao(r.classificacao)}2e;color:${corClassificacao(r.classificacao)}">${escapeHtml(r.classificacao)}</span>` : `<span class="etiqueta et-pendente">Pendente</span>`],
  ['pctEmpastada','% Empastada',r=>fmtP(r.pctEmpastada)],
  ['areaUtil','Área Útil (ha)',r=>fmtN(r.areaUtil)],
  ['capim','Capim',r=>escapeHtml(r.capim||'—')],
  ['aguada','Aguada',r=>escapeHtml(r.aguada||'—')],
  ['cocho','Cocho',r=>escapeHtml(r.cocho||'—')],
  ['qtCocho','Qt. Cocho (m)',r=>r.qtCocho!=null?fmtN(r.qtCocho):'—'],
  ['obs','OBS',r=>escapeHtml(r.obs||'—')],
  ['qtdAnimais','Qtd. Animais',r=>r.qtdAnimais!=null?fmtI(r.qtdAnimais):'—'],
  ['pesoMedio','Peso Médio (kg)',r=>r.pesoMedio!=null?fmtN(r.pesoMedio):'—'],
  ['ua','UA',r=>r.ua?fmtN(r.ua):'—'],
  ['taxaLotacao','Lotação (UA/ha)',r=>r.taxaLotacao!=null?fmtN(r.taxaLotacao):'—'],
  ['aplicacoes','Aplicações (produto/ha)',r=>resumoAplicacoes(r)],
];
let pagina=0, PAG=50, ordem={k:'pasto',asc:true};
document.getElementById('cabecalho').innerHTML=COLS.map(c=>`<th data-k="${c[0]}">${c[1]}</th>`).join('')+'<th>✎</th><th>🗺</th>';
document.querySelectorAll('#cabecalho th[data-k]').forEach(th=>th.onclick=()=>{
  const k=th.dataset.k; ordem.asc = ordem.k===k ? !ordem.asc : true; ordem.k=k; renderTabela();
});
function renderTabela(){
  const qtxt=document.getElementById('busca').value.toLowerCase();
  let rs=filtrar();
  if(qtxt) rs=rs.filter(r=>(String(r.pasto)+' '+(r.manejo||'')+' '+(r.modulo||'')+' '+(r.capim||'')+' '+(r.obs||'')).toLowerCase().includes(qtxt));
  rs=rs.slice().sort((a,b)=>{
    let va=a[ordem.k], vb=b[ordem.k];
    if(va==null)return 1; if(vb==null)return -1;
    if(typeof va==='string'&&!isNaN(+va)&&va!==''&&!isNaN(+vb)&&vb!==''){va=+va;vb=+vb}
    const c = va<vb?-1:va>vb?1:0; return ordem.asc?c:-c;
  });
  const tot=rs.length, maxPag=Math.max(Math.ceil(tot/PAG)-1,0);
  pagina=Math.min(pagina,maxPag);
  const fatia=rs.slice(pagina*PAG,(pagina+1)*PAG);
  document.getElementById('corpo').innerHTML=fatia.map(r=>
    '<tr>'+COLS.map(c=>`<td>${c[2](r)}</td>`).join('')+
    `<td class="acao" onclick="editar('${q(r.pasto)}')">editar</td>`+
    `<td class="acao" onclick="verModuloNoMapa('${q(r.modulo||'')}')" title="Destacar módulo no mapa">mapa</td></tr>`).join('');
  document.getElementById('infoPag').textContent=`${fmtI(tot)} pastos · página ${pagina+1} de ${maxPag+1}`;
  document.getElementById('pAnt').disabled=pagina===0;
  document.getElementById('pProx').disabled=pagina>=maxPag;
}
document.getElementById('pAnt').onclick=()=>{pagina--;renderTabela()};
document.getElementById('pProx').onclick=()=>{pagina++;renderTabela()};
document.getElementById('busca').addEventListener('input',()=>{pagina=0;renderTabela()});

// ---- Cadastro ----
function opts(arr){ return `<option value="">— selecione / deixe em branco —</option>` + arr.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join(''); }
function preencherSelects(){
  document.getElementById('fManejo').innerHTML = opts(MANEJOS);
  document.getElementById('fModulo').innerHTML = opts(modulosRegistrados);
  document.getElementById('fSistema').innerHTML = opts(SISTEMAS);
  document.getElementById('fCapim').innerHTML = opts(CAPINS);
  document.getElementById('fAguada').innerHTML = opts(AGUADAS);
  document.getElementById('fCocho').innerHTML = opts(COCHOS);
  document.getElementById('fClassif').innerHTML = `<option value="">— Não classificado —</option>` +
    CLASSIF.map(c=>`<option value="${escapeHtml(c[0])}">${escapeHtml(c[0])} (${Math.round(c[1]*100)}%)</option>`).join('');
}
function valorComNovo(selId,novoId){
  const nv=document.getElementById(novoId).value.trim();
  return nv || document.getElementById(selId).value;
}
function setSelectOuNovo(selId,novoId,val,lista){
  const sel=document.getElementById(selId);
  if(val && lista.includes(val)){ sel.value=val; document.getElementById(novoId).value=''; }
  else { sel.value=''; document.getElementById(novoId).value = val||''; }
}
function calcVivo(){
  const area=parseFloat(document.getElementById('fArea').value)||0;
  const classifNome=document.getElementById('fClassif').value;
  const cl=CLASSIF.find(c=>c[0]===classifNome);
  const pct=cl?cl[1]:null;
  document.getElementById('cPct').innerHTML = (pct!=null? fmtP(pct):'—')+'<small>=VLOOKUP(Classificação)</small>';
  const areaUtil = pct!=null? area*pct : 0;
  document.getElementById('cAreaUtil').innerHTML = fmtN(areaUtil)+' ha<small>=Área Total × % Empastada</small>';
  const qtd=parseFloat(document.getElementById('fQtdAnimais').value)||0;
  const peso=parseFloat(document.getElementById('fPesoMedio').value)||0;
  const ua=(qtd&&peso) ? (qtd*peso)/450 : 0;
  document.getElementById('cUA').innerHTML = fmtN(ua)+' UA<small>=(Qtd. × Peso) ÷ 450</small>';
  const lot = areaUtil>0 ? ua/areaUtil : null;
  document.getElementById('cLotacao').innerHTML = (lot!=null?fmtN(lot):'—')+' UA/ha<small>=UA ÷ Área Útil</small>';
  renderFormAplicacoes();
}
// ---- Aplicações de Produtos (lista dinâmica dentro do Cadastro) ----
let formAplicacoes=[];
function renderFormAplicacoes(){
  const div=document.getElementById('listaAplicacoesForm'); if(!div) return;
  const area=parseFloat(document.getElementById('fArea').value)||0;
  if(!formAplicacoes.length){ div.innerHTML='<div class="dica" style="display:block">Nenhum produto adicionado a este pasto ainda.</div>'; return; }
  div.innerHTML=formAplicacoes.map((a,i)=>{
    const p=produtoPorId(a.produtoId);
    const total=(a.quantidadeHa||0)*area;
    return `<div class="talhao-item">
      <select onchange="atualizarAplicacaoForm(${i},'produtoId',this.value)" style="min-width:170px">
        <option value="">— escolha o produto —</option>
        ${catalogoProdutos.map(pr=>`<option value="${escapeHtml(pr.id)}" ${a.produtoId===pr.id?'selected':''}>${escapeHtml(pr.nome)} (${escapeHtml(pr.unidade)})</option>`).join('')}
      </select>
      <input type="number" step="0.01" placeholder="quantidade/há" style="max-width:130px" value="${a.quantidadeHa??''}" oninput="atualizarAplicacaoForm(${i},'quantidadeHa',this.value)">
      <span class="dica" style="min-width:150px">${p? ('total: '+fmtN(total)+' '+p.unidade.split('/')[0]) : '—'}</span>
      <button class="btn perigo" onclick="removerAplicacaoForm(${i})">remover</button>
    </div>`;
  }).join('');
}
function adicionarAplicacaoForm(){ formAplicacoes.push({produtoId:'', quantidadeHa:null}); renderFormAplicacoes(); }
function removerAplicacaoForm(i){ formAplicacoes.splice(i,1); renderFormAplicacoes(); }
function atualizarAplicacaoForm(i,campo,valor){
  formAplicacoes[i][campo] = campo==='quantidadeHa' ? (valor===''?null:parseFloat(valor)) : valor;
  renderFormAplicacoes();
}
// ---- Catálogo de Produtos ----
function renderCatalogoProdutos(){
  const div=document.getElementById('listaProdutos'); if(!div) return;
  if(!catalogoProdutos.length){ div.innerHTML='<div class="dica" style="display:block">Nenhum produto cadastrado.</div>'; return; }
  div.innerHTML=catalogoProdutos.map(p=>`
    <div class="talhao-item">
      <div style="flex:1"><b style="color:var(--creme)">${escapeHtml(p.nome)}</b> <span class="dica">${escapeHtml(p.categoria)} · ${escapeHtml(p.unidade)}</span></div>
      <button class="btn perigo" onclick="excluirProduto('${q(p.id)}')">excluir</button>
    </div>`).join('');
}
function adicionarProduto(){
  const nome=document.getElementById('pNome').value.trim();
  const categoria=document.getElementById('pCategoria').value;
  const unidade=document.getElementById('pUnidade').value;
  if(!nome) return toast('Informe o nome do produto.', true);
  catalogoProdutos.push({id:'p'+Date.now(), nome, categoria, unidade});
  persistir(); renderCatalogoProdutos(); renderFormAplicacoes();
  document.getElementById('pNome').value='';
  toast('Produto adicionado ao catálogo.');
}
function excluirProduto(id){
  if(produtoEmUso(id)) return toast('Esse produto está em uso em algum pasto — remova as aplicações dele antes de excluir.', true);
  catalogoProdutos=catalogoProdutos.filter(p=>p.id!==id);
  persistir(); renderCatalogoProdutos(); renderFormAplicacoes();
  toast('Produto removido do catálogo.');
}

// ---- Cadastro de Módulos (entidade própria — lista, renomear em bloco, cadastrar antes de ter pasto) ----
function renderModulosRegistrados(){
  const div=document.getElementById('listaModulosRegistrados'); if(!div) return;
  const cont=document.getElementById('contagemModulos');
  if(cont) cont.textContent = modulosRegistrados.length ? '('+fmtI(modulosRegistrados.length)+')' : '';
  if(!modulosRegistrados.length){ div.innerHTML='<div class="dica" style="display:block">Nenhum módulo cadastrado ainda.</div>'; return; }
  const ordenados=[...modulosRegistrados].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
  div.innerHTML=ordenados.map(m=>{
    const rm=resumoModulo(m);
    const info = rm.nPastos ? `${fmtI(rm.nPastos)} pasto(s) · ${fmtN(rm.areaTotal)} ha`+(rm.qtdAnimais?` · ${fmtI(rm.qtdAnimais)} animais`:'') : 'nenhum pasto ainda';
    return `<div class="talhao-item">
      <input type="text" value="${escapeHtml(m)}" onchange="renomearModulo('${q(m)}', this.value)" style="min-width:190px">
      <span class="dica" style="min-width:260px">${escapeHtml(info)}</span>
      <button class="btn perigo" onclick="excluirModulo('${q(m)}')">excluir</button>
    </div>`;
  }).join('');
}
function adicionarModulo(){
  const nome=document.getElementById('mNome').value.trim();
  if(!nome) return toast('Informe o nome do módulo.', true);
  if(modulosRegistrados.some(m=>normalizarTxt(m)===normalizarTxt(nome))) return toast('Esse módulo já está cadastrado.', true);
  modulosRegistrados.push(nome);
  persistir(); renderModulosRegistrados(); atualizarDatalistModulos(); preencherSelects();
  document.getElementById('mNome').value='';
  toast('Módulo cadastrado.');
}
function excluirModulo(nome){
  if(moduloEmUso(nome)) return toast('Esse módulo está em uso em algum pasto — mude o módulo desses pastos antes de excluir.', true);
  modulosRegistrados=modulosRegistrados.filter(m=>m!==nome);
  persistir(); renderModulosRegistrados(); atualizarDatalistModulos(); preencherSelects();
  toast('Módulo removido do cadastro.');
}
function renomearModulo(nomeAntigo, nomeNovo){
  nomeNovo=(nomeNovo||'').trim();
  if(!nomeNovo || nomeNovo===nomeAntigo){ renderModulosRegistrados(); return; }
  if(modulosRegistrados.some(m=>m!==nomeAntigo && normalizarTxt(m)===normalizarTxt(nomeNovo))) { toast('Já existe um módulo com esse nome.', true); renderModulosRegistrados(); return; }
  let atualizados=0;
  if(!ocultarBase){
    baseRows.forEach(r=>{
      const atual=edicoes[r.pasto]||r;
      if(atual.modulo===nomeAntigo){
        const clone=Object.assign({}, atual, {modulo:nomeNovo});
        recalc(clone); edicoes[r.pasto]=clone; atualizados++;
      }
    });
  }
  extras.forEach(e=>{ if(e.modulo===nomeAntigo){ e.modulo=nomeNovo; recalc(e); atualizados++; } });
  const idx=modulosRegistrados.indexOf(nomeAntigo);
  if(idx>=0) modulosRegistrados[idx]=nomeNovo; else modulosRegistrados.push(nomeNovo);
  mapaProp.talhoes.forEach(t=>{ if(t.nomeModulo===nomeAntigo) t.nomeModulo=nomeNovo; });
  persistir(); atualizarTudo(); renderModulosRegistrados(); renderTalhoes(); atualizarTooltipsMapa(); atualizarDatalistModulos(); preencherSelects();
  toast('Módulo renomeado — '+fmtI(atualizados)+' pasto(s) atualizado(s).');
}

// ---- Importar Pastos de Planilha (XLSX/XLS/CSV) com mapeamento de colunas ----
const CAMPOS_IMPORTAVEIS=[
  ['pasto','Pasto (identificação)'],
  ['modulo','Módulo / Talhão'],
  ['sistema','Sistema de Produção'],
  ['areaTotal','Área Total (ha)'],
  ['classificacao','Classificação do Pasto'],
  ['capim','Espécie do Capim'],
  ['aguada','Tipo de Aguada'],
  ['cocho','Tipo de Cocho'],
  ['qtCocho','Quant. Cocho (m)'],
  ['qtdAnimais','Quantidade de Animais'],
  ['pesoMedio','Peso Médio (kg)'],
  ['manejo','Ação de Manejo'],
  ['obs','OBS'],
];
const CAMPOS_NUM_IMPORT=new Set(['areaTotal','qtCocho','qtdAnimais','pesoMedio']);
let importState=null;
function bibliotecaImportDisponivel(){ return typeof XLSX!=='undefined'; }
async function carregarArquivoImportar(ev){
  const file=ev.target.files[0]; if(!file) return;
  if(!bibliotecaImportDisponivel()){
    toast('Aguardando o carregamento da biblioteca de importação…');
    const ok=await aguardarBibliotecasPromise(['xlsx'], 14);
    if(!ok){
      toast('Não foi possível carregar a biblioteca de importação mesmo com os provedores alternativos — verifique sua conexão ou tente numa rede diferente.', true);
      ev.target.value=''; return;
    }
  }
  try{
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array'});
    const sheet=wb.Sheets[wb.SheetNames[0]];
    const linhas=XLSX.utils.sheet_to_json(sheet,{header:1, raw:true, defval:null});
    if(!linhas.length) throw new Error('planilha vazia');
    const headers=linhas[0].map((h,i)=> (h!=null && String(h).trim()!=='') ? String(h).trim() : ('Coluna '+(i+1)));
    const dados=linhas.slice(1).filter(r=>r.some(v=>v!=null && String(v).trim()!==''));
    if(!dados.length) throw new Error('nenhuma linha de dados encontrada abaixo do cabeçalho');
    importState={headers, dados, mapeamento:{}};
    headers.forEach((h,i)=>{
      const hn=normalizarTxt(h);
      const campo=CAMPOS_IMPORTAVEIS.find(([k,rot])=>{
        const rn=normalizarTxt(rot), kn=normalizarTxt(k);
        return hn===rn || hn===kn || hn.includes(rn) || rn.includes(hn) || hn.includes(kn);
      });
      if(campo) importState.mapeamento[i]=campo[0];
    });
    renderMapeamentoImportar();
    document.getElementById('infoImportarArquivo').textContent=file.name+' · '+dados.length+' linha(s) encontrada(s)';
    document.getElementById('areaMapeamentoImportar').style.display='block';
  }catch(e){
    toast('Não consegui ler essa planilha: '+e.message, true);
  }
  ev.target.value='';
}
function atualizarMapeamentoImportar(idx, valor){ if(importState) importState.mapeamento[idx]=valor; }
function renderMapeamentoImportar(){
  const div=document.getElementById('listaMapeamento'); if(!div || !importState) return;
  const optsCampos=CAMPOS_IMPORTAVEIS.map(([k,rot])=>`<option value="${k}">${escapeHtml(rot)}</option>`).join('');
  const optsProdutos=catalogoProdutos.map(p=>`<option value="produto:${p.id}">Produto: ${escapeHtml(p.nome)} (qtd/há)</option>`).join('');
  div.innerHTML=importState.headers.map((h,i)=>{
    const amostraVal=importState.dados.map(r=>r[i]).find(v=>v!=null && String(v).trim()!=='');
    const atual=importState.mapeamento[i]||'';
    return `<div class="talhao-item">
      <div style="min-width:220px;flex:1"><b style="color:var(--creme)">${escapeHtml(h)}</b><br><span class="dica">ex.: ${amostraVal!=null?escapeHtml(String(amostraVal)):'—'}</span></div>
      <select onchange="atualizarMapeamentoImportar(${i}, this.value)" style="min-width:220px">
        <option value="">— ignorar esta coluna —</option>
        <optgroup label="Campos do Pasto">${optsCampos}</optgroup>
        ${catalogoProdutos.length?('<optgroup label="Produtos (qtd/há)">'+optsProdutos+'</optgroup>'):''}
      </select>
    </div>`;
  }).join('');
  [...div.querySelectorAll('select')].forEach((sel,i)=>{ sel.value=importState.mapeamento[i]||''; });
}
function cancelarImportacao(){
  importState=null;
  document.getElementById('areaMapeamentoImportar').style.display='none';
  document.getElementById('infoImportarArquivo').textContent='';
}
function normalizarNumeroImport(v){
  if(v==null) return null;
  if(typeof v==='number') return v;
  let s=String(v).trim(); if(s==='') return null;
  if(s.includes(',')) s=s.replace(/\./g,'').replace(',', '.');
  const n=parseFloat(s);
  return isNaN(n) ? null : n;
}
function executarImportacao(){
  if(!importState) return;
  const mapa=importState.mapeamento;
  const temPasto=Object.values(mapa).includes('pasto');
  if(!temPasto) return toast('Mapeie ao menos a coluna "Pasto (identificação)" antes de importar.', true);
  let novos=0, atualizados=0, ignorados=0;
  importState.dados.forEach(linha=>{
    const parcial={}; const aplicacoesImport=[];
    Object.entries(mapa).forEach(([iStr,destino])=>{
      if(!destino) return;
      const valorBruto=linha[+iStr];
      if(destino.indexOf('produto:')===0){
        const produtoId=destino.slice(8);
        const qtd=normalizarNumeroImport(valorBruto);
        if(qtd!=null) aplicacoesImport.push({produtoId, quantidadeHa:qtd});
      } else if(CAMPOS_NUM_IMPORT.has(destino)){
        const n=normalizarNumeroImport(valorBruto);
        if(n!=null) parcial[destino]=n;
      } else if(valorBruto!=null && String(valorBruto).trim()!==''){
        parcial[destino]=String(valorBruto).trim();
      }
    });
    if(!parcial.pasto){ ignorados++; return; }
    const nomePasto=String(parcial.pasto).trim();
    const existente=todos().find(r=>normalizarTxt(r.pasto)===normalizarTxt(nomePasto));
    if(existente){
      const atualizado=Object.assign({}, existente, parcial);
      atualizado.pasto=existente.pasto;
      if(aplicacoesImport.length){
        const porProduto={}; (existente.aplicacoes||[]).forEach(a=>porProduto[a.produtoId]=a);
        aplicacoesImport.forEach(a=>porProduto[a.produtoId]=a);
        atualizado.aplicacoes=Object.values(porProduto);
      }
      recalc(atualizado);
      const ehBase=baseRows.some(r=>r.pasto===existente.pasto);
      if(ehBase) edicoes[existente.pasto]=atualizado;
      else { extras=extras.filter(e=>e.pasto!==existente.pasto); extras.push(atualizado); }
      atualizados++;
    } else {
      if(!parcial.areaTotal){ ignorados++; return; }
      const novo=Object.assign({
        pasto:nomePasto, manejo:null, modulo:null, sistema:null, areaTotal:0, classificacao:null,
        capim:null, aguada:null, cocho:null, qtCocho:null, obs:null, qtdAnimais:null, pesoMedio:null,
        aplicacoes:[], origem:'novo'
      }, parcial);
      novo.aplicacoes=aplicacoesImport;
      recalc(novo);
      extras.push(novo);
      novos++;
    }
  });
  persistir(); atualizarTudo(); cancelarImportacao();
  toast(`Importação concluída: ${novos} pasto(s) novo(s), ${atualizados} atualizado(s)`+(ignorados?(', '+ignorados+' ignorado(s) (sem nome ou sem área)'):'')+'.');
}

let editandoPasto=null;
function lerForm(){
  const g=id=>document.getElementById(id);
  return {
    pasto: g('fPasto').value.trim(),
    manejo: valorComNovo('fManejo','fManejoNovo') || null,
    modulo: valorComNovo('fModulo','fModuloNovo') || null,
    sistema: valorComNovo('fSistema','fSistemaNovo') || null,
    areaTotal: parseFloat(g('fArea').value)||0,
    classificacao: g('fClassif').value || null,
    capim: valorComNovo('fCapim','fCapimNovo') || null,
    aguada: valorComNovo('fAguada','fAguadaNovo') || null,
    cocho: valorComNovo('fCocho','fCochoNovo') || null,
    qtCocho: g('fQtCocho').value!==''? parseFloat(g('fQtCocho').value): null,
    obs: g('fObs').value.trim() || null,
    qtdAnimais: g('fQtdAnimais').value!==''? parseFloat(g('fQtdAnimais').value): null,
    pesoMedio: g('fPesoMedio').value!==''? parseFloat(g('fPesoMedio').value): null,
    aplicacoes: formAplicacoes.filter(a=>a.produtoId && a.quantidadeHa!=null).map(a=>({produtoId:a.produtoId, quantidadeHa:a.quantidadeHa})),
  };
}
function salvarPasto(){
  const o=lerForm();
  if(!o.pasto) return toast('Informe a identificação do Pasto.',true);
  if(!o.areaTotal) return toast('Informe a Área Total (ha).',true);
  recalc(o);
  const t=todos();
  if(editandoPasto){
    const ehBase = baseRows.some(r=>r.pasto===editandoPasto);
    if(editandoPasto!==o.pasto && t.some(r=>r.pasto===o.pasto)) return toast('Já existe um pasto com esse nome.',true);
    o.origem='editado';
    if(ehBase){ edicoes[editandoPasto]=o; }
    else { extras=extras.filter(e=>e.pasto!==editandoPasto); extras.push(o); }
  } else {
    if(t.some(r=>r.pasto===o.pasto)) return toast('Já existe um pasto com esse nome.',true);
    o.origem='novo'; extras.push(o);
  }
  persistir(); limparForm(); atualizarTudo();
  toast(armazem.k==='disco' ? 'Pasto salvo. Dados persistidos neste navegador.' : 'Pasto salvo nesta sessão. Para guardar permanentemente, use Backup JSON (este visualizador bloqueia armazenamento local).');
}
function editar(p){
  const r=todos().find(x=>x.pasto===p); if(!r)return;
  editandoPasto=p;
  const s=(id,v)=>document.getElementById(id).value=v??'';
  s('fPasto', r.pasto);
  setSelectOuNovo('fManejo','fManejoNovo', r.manejo, MANEJOS);
  setSelectOuNovo('fModulo','fModuloNovo', r.modulo, modulosRegistrados);
  setSelectOuNovo('fSistema','fSistemaNovo', r.sistema, SISTEMAS);
  s('fArea', r.areaTotal);
  s('fClassif', r.classificacao||'');
  setSelectOuNovo('fCapim','fCapimNovo', r.capim, CAPINS);
  setSelectOuNovo('fAguada','fAguadaNovo', r.aguada, AGUADAS);
  setSelectOuNovo('fCocho','fCochoNovo', r.cocho, COCHOS);
  s('fQtCocho', r.qtCocho);
  s('fObs', r.obs);
  s('fQtdAnimais', r.qtdAnimais);
  s('fPesoMedio', r.pesoMedio);
  formAplicacoes = (r.aplicacoes||[]).map(a=>({produtoId:a.produtoId, quantidadeHa:a.quantidadeHa}));
  document.getElementById('tituloForm').textContent='Editando '+r.pasto;
  document.getElementById('btnSalvar').textContent='Salvar Alterações';
  document.getElementById('btnExcluir').style.display='inline-block';
  calcVivo();
  const btnCad=document.querySelector('.nav-dropdown-menu button[data-subaba="sub-pastos"]');
  if(btnCad) btnCad.click();
}
function excluirPasto(){
  if(!editandoPasto)return;
  if(edicoes[editandoPasto]){delete edicoes[editandoPasto];toast('Edição descartada — registro original da planilha restaurado.')}
  else {extras=extras.filter(e=>e.pasto!==editandoPasto);toast('Registro excluído.')}
  persistir(); limparForm(); atualizarTudo();
}
function limparForm(){
  editandoPasto=null;
  document.querySelectorAll('#cadastro input[type=text],#cadastro input[type=number]').forEach(i=>i.value='');
  document.querySelectorAll('#cadastro select').forEach(s=>s.value='');
  formAplicacoes=[];
  document.getElementById('tituloForm').textContent='Novo Pasto';
  document.getElementById('btnSalvar').textContent='Salvar Pasto';
  document.getElementById('btnExcluir').style.display='none';
  calcVivo();
}
['fArea','fQtdAnimais','fPesoMedio'].forEach(id=>document.getElementById(id).addEventListener('input',calcVivo));
document.getElementById('fClassif').addEventListener('change',calcVivo);

// ---- Cliente & Fazenda ----
function carregarCliente(){
  const c=cliente;
  document.getElementById('clNome').value=c.nome||'';
  document.getElementById('clFazenda').value=c.fazenda||'';
  document.getElementById('clConsultor').value=c.consultor||'';
  document.getElementById('clTelefone').value=c.telefone||'';
  document.getElementById('clEmail').value=c.email||'';
  document.getElementById('clMunicipio').value=c.municipio||'';
  document.getElementById('clMapa').value=c.mapa||'';
  atualizarCabecalhoFazenda();
  document.getElementById('respTec').value=c.consultor||'';
  document.getElementById('respCliente').value=c.nome||'';
  renderAnexos(); renderObservacoes(); atualizarBotaoMapa();
}
function atualizarCabecalhoFazenda(){
  document.getElementById('subFazenda').textContent = (cliente.fazenda?('Fazenda '+cliente.fazenda+' · Manutenção de Pasto'):'Cadastre a fazenda na aba Cliente & Fazenda');
}
function salvarCliente(){
  cliente.nome=document.getElementById('clNome').value.trim();
  cliente.fazenda=document.getElementById('clFazenda').value.trim();
  cliente.consultor=document.getElementById('clConsultor').value.trim();
  cliente.telefone=document.getElementById('clTelefone').value.trim();
  cliente.email=document.getElementById('clEmail').value.trim();
  cliente.municipio=document.getElementById('clMunicipio').value.trim();
  cliente.mapa=document.getElementById('clMapa').value.trim();
  persistir();
  atualizarCabecalhoFazenda();
  document.getElementById('respTec').value=cliente.consultor||'';
  document.getElementById('respCliente').value=cliente.nome||'';
  atualizarBotaoMapa();
  atualizarCapaRelatorio(filtrar());
  toast('Dados do cliente salvos.');
}
function atualizarBotaoMapa(){
  document.getElementById('btnAbrirMapa').disabled = !cliente.mapa;
}
function abrirMapa(){
  if(cliente.mapa) window.open(cliente.mapa,'_blank','noopener');
}

// ---- Anexos ----
let uploadSeq=0;
function anexarArquivos(ev){
  const files=[...ev.target.files]; if(!files.length) return;
  let restantes=files.length;
  files.forEach(f=>{
    const r=new FileReader();
    r.onload=()=>{
      cliente.anexos.push({id:'a'+Date.now()+'_'+(uploadSeq++), nome:f.name, tamanho:f.size, dataUpload:new Date().toISOString(), conteudo:r.result});
      restantes--;
      if(restantes===0){ persistir(); renderAnexos(); toast('Anexo(s) salvo(s).'); }
    };
    r.onerror=()=>{ restantes--; toast('Falha ao ler o arquivo '+f.name,true); if(restantes===0){persistir();renderAnexos();} };
    r.readAsDataURL(f);
  });
  ev.target.value='';
}
function salvarComoAnexo(file){
  const r=new FileReader();
  r.onload=()=>{
    cliente.anexos.push({id:'a'+Date.now()+'_'+(uploadSeq++), nome:file.name, tamanho:file.size, dataUpload:new Date().toISOString(), conteudo:r.result});
    persistir(); renderAnexos();
  };
  r.readAsDataURL(file);
}
function excluirAnexo(id){
  cliente.anexos=cliente.anexos.filter(a=>a.id!==id);
  persistir(); renderAnexos(); toast('Anexo removido.');
}
function renderAnexos(){
  const div=document.getElementById('listaAnexos');
  if(!cliente.anexos.length){ div.innerHTML='<div style="color:var(--mudo);font-size:12.5px">Nenhum arquivo anexado ainda.</div>'; }
  else {
    div.innerHTML = cliente.anexos.map(a=>`
      <div class="anexo">
        <div class="nome">${escapeHtml(a.nome)}</div>
        <div class="meta">${extensao(a.nome)} · ${fmtBytes(a.tamanho)} · ${fmtD(new Date(a.dataUpload))}</div>
        <div class="acoes">
          <a href="${a.conteudo}" download="${escapeHtml(a.nome)}">baixar</a>
          <span class="excluir" onclick="excluirAnexo('${q(a.id)}')">excluir</span>
        </div>
      </div>`).join('');
  }
  atualizarBarraArmazenamento();
}
function atualizarBarraArmazenamento(){
  const tamanho = JSON.stringify({extras,edicoes,cliente,mapaProp,catalogoProdutos}).length;
  const limiteAviso = 4*1024*1024;
  const limiteAlvo = 5*1024*1024;
  const pct = Math.min(100, tamanho/limiteAlvo*100);
  document.getElementById('barraArmazFill').style.width=pct.toFixed(1)+'%';
  document.getElementById('barraArmazFill').style.background = tamanho>limiteAviso ? 'var(--ruim)' : '';
  document.getElementById('infoArmazenamento').textContent = fmtBytes(tamanho)+' usados neste navegador'+(tamanho>limiteAviso?' — próximo do limite, exporte um backup':'');
}

// ---- Observações do consultor ----
function adicionarObservacao(){
  const t=document.getElementById('notaTexto').value.trim();
  if(!t) return toast('Escreva uma observação antes de adicionar.',true);
  cliente.observacoes.unshift({id:'o'+Date.now(), data:new Date().toISOString(), texto:t});
  document.getElementById('notaTexto').value='';
  persistir(); renderObservacoes(); toast('Observação adicionada.');
}
function excluirObservacao(id){
  cliente.observacoes=cliente.observacoes.filter(o=>o.id!==id);
  persistir(); renderObservacoes(); toast('Observação removida.');
}
function renderObservacoes(){
  const div=document.getElementById('listaObservacoes');
  if(!cliente.observacoes.length){ div.innerHTML='<div style="color:var(--mudo);font-size:12.5px">Nenhuma observação registrada ainda.</div>'; return; }
  div.innerHTML = cliente.observacoes.map(o=>{
    const dt=new Date(o.data);
    return `<div class="nota">
      <div class="cab"><span>${fmtD(dt)} às ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span><span class="del" onclick="excluirObservacao('${q(o.id)}')">excluir</span></div>
      <div class="txt">${escapeHtml(o.texto)}</div>
    </div>`;
  }).join('');
}

// ---- Mapa da Propriedade (KMZ/KML) ----
let leafletMap=null, geoLayer=null, mapaInicializado=false, talhaoSelecionado=null;
// Qual arquivo está DESENHADO no mapa neste momento. Enquanto for o mesmo, voltar pra
// aba não recria a camada nem mexe no zoom — só atualiza cor e rótulo.
let assinaturaMapaDesenhado=null;
let observadorTamanhoMapa=null, timerVista=null;
const MSG_FALHA_MAPA='Não foi possível carregar o componente de mapa mesmo após tentar os provedores alternativos — a rede deste computador parece estar bloqueando os endereços externos (jsdelivr.net, cdnjs.cloudflare.com, unpkg.com). Tente numa rede diferente (ex.: 4G do celular) ou recarregue a página. Enquanto isso, o resto da ferramenta funciona normalmente.';
function bibliotecasMapaDisponiveis(){
  return typeof L!=='undefined' && typeof JSZip!=='undefined' && typeof toGeoJSON!=='undefined';
}
// Espera as bibliotecas terminarem de carregar (inclusive pelos CDNs alternativos)
// antes de desistir — evita declarar "falhou" enquanto o fallback ainda está tentando.
function aguardarBibliotecas(nomes, tentativasRestantes, cb){
  if(nomes.every(n=>window.LIBS_STATUS[n]==='ok' || (n==='leaflet'&&typeof L!=='undefined') || (n==='jszip'&&typeof JSZip!=='undefined') || (n==='togeojson'&&typeof toGeoJSON!=='undefined') || (n==='xlsx'&&typeof XLSX!=='undefined'))){
    cb(true); return;
  }
  if(nomes.every(n=>window.LIBS_STATUS[n]==='falhou') || tentativasRestantes<=0){ cb(false); return; }
  setTimeout(()=>aguardarBibliotecas(nomes, tentativasRestantes-1, cb), 350);
}
function mostrarAvisoMapa(msg){
  const el=document.getElementById('mapaAviso'); if(!el) return;
  if(msg){ el.textContent=msg; el.style.display='block'; } else { el.style.display='none'; }
}
// ---- Tamanho e enquadramento do mapa ----------------------------------------
// O Leaflet desenha em cima de um tamanho que ele MEDIU uma vez. Se a medida for
// feita enquanto a aba ainda está escondida (display:none), ou se o container mudar
// de altura depois (janela redimensionada, teclado do celular abrindo/fechando,
// fonte web terminando de carregar), o mapa continua desenhando no tamanho velho —
// é daí que vem a sensação de que "o mapa foi diminuindo". Por isso a medida é
// refeita em três momentos: agora, no próximo quadro do navegador e, por segurança,
// 120 ms depois. `pan:false` impede que a correção arraste a vista de lugar.
function quadro(cb){
  if(typeof requestAnimationFrame==='function') return requestAnimationFrame(cb);
  return setTimeout(cb,16);
}
function ajustarTamanhoMapa(){
  if(!leafletMap) return;
  const medir=()=>{ if(!leafletMap) return; try{ leafletMap.invalidateSize({pan:false}); }catch(e){} };
  medir();
  quadro(()=>quadro(medir));
  setTimeout(medir,120);
}
let vigiaTamanhoLigada=false;
function vigiarTamanhoMapa(el){
  if(vigiaTamanhoLigada || !el) return;
  vigiaTamanhoLigada=true;
  if(typeof ResizeObserver!=='undefined'){
    try{
      observadorTamanhoMapa=new ResizeObserver(()=>{ if(leafletMap){ try{ leafletMap.invalidateSize({pan:false}); }catch(e){} } });
      observadorTamanhoMapa.observe(el);
    }catch(e){ observadorTamanhoMapa=null; }
  }
  // Navegadores sem ResizeObserver (ou embutidos em apps) ainda avisam do resize da janela.
  window.addEventListener('resize', ()=>{ if(abaMapaVisivel()) ajustarTamanhoMapa(); });
  window.addEventListener('orientationchange', ()=>{ if(abaMapaVisivel()) ajustarTamanhoMapa(); });
}
function abaMapaVisivel(){
  const s=document.getElementById('mapa');
  return !!(s && s.classList.contains('ativa'));
}
function assinaturaMapa(){
  return (mapaProp.arquivoNome||'')+'§'+(mapaProp.dataUpload||'')+'§'+(mapaProp.kmlTexto||'').length;
}
function gravarVistaMapa(){
  if(!leafletMap || !leafletMap.getCenter || !leafletMap.getZoom) return;
  try{
    const c=leafletMap.getCenter(), z=leafletMap.getZoom();
    if(!c || c.lat==null || z==null) return;
    mapaProp.vista={lat:c.lat, lng:c.lng, zoom:z};
  }catch(e){}
}
function agendarGravacaoVista(){
  gravarVistaMapa();
  clearTimeout(timerVista);
  timerVista=setTimeout(()=>{ try{ persistir(); }catch(e){} }, 600);
}
function restaurarVistaMapa(){
  const v=mapaProp.vista;
  if(!leafletMap || !v || v.lat==null || v.zoom==null) return false;
  try{ leafletMap.setView([v.lat,v.lng], v.zoom, {animate:false}); return true; }catch(e){ return false; }
}
function enquadrarTudo(){
  if(!leafletMap || !geoLayer || !geoLayer.getBounds) return false;
  try{
    const b=geoLayer.getBounds();
    if(b && b.isValid && b.isValid()){ leafletMap.fitBounds(b,{padding:[24,24]}); gravarVistaMapa(); return true; }
  }catch(e){}
  return false;
}
// Botão "Enquadrar tudo": o único lugar onde o usuário pede, de propósito, pra voltar
// a ver a fazenda inteira.
function enquadrarMapaTudo(){
  if(!leafletMap){ toast('O mapa ainda não está pronto.', true); return; }
  ajustarTamanhoMapa();
  if(!enquadrarTudo()) toast('Carregue um mapa (KMZ/KML) primeiro.', true);
}
function inicializarMapaSeNecessario(){
  if(mapaInicializado) return;
  mapaInicializado=true;
  const el=document.getElementById('mapaLeaflet');
  if(!el || typeof L==='undefined'){
    mostrarAvisoMapa(MSG_FALHA_MAPA);
    return;
  }
  try{
    leafletMap=L.map(el,{scrollWheelZoom:true}).setView([-15.79,-47.93],4);
    // Guarda o enquadramento que o usuário deixou (e reavalia o tamanho real do
    // container sempre que ele mudar — container medido errado é o que faz o
    // desenho aparecer encolhido dentro da moldura).
    if(leafletMap.on){
      leafletMap.on('moveend', agendarGravacaoVista);
      leafletMap.on('zoomend', agendarGravacaoVista);
    }
    vigiarTamanhoMapa(el);
    const satelite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles &copy; Esri'});
    const ruas=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'});
    satelite.addTo(leafletMap);
    L.control.layers({'Satélite':satelite,'Mapa':ruas}).addTo(leafletMap);
    // Se as imagens de satélite não carregarem nesta rede (bloqueio comum em algumas redes
    // corporativas/públicas), troca sozinho pro provedor alternativo depois de várias falhas.
    let falhasTile=0, trocouProvedor=false;
    satelite.on('tileerror',()=>{
      falhasTile++;
      if(falhasTile>=6 && !trocouProvedor && leafletMap.hasLayer(satelite)){
        trocouProvedor=true;
        leafletMap.removeLayer(satelite); ruas.addTo(leafletMap);
        toast('As imagens de satélite não carregaram nesta rede — usando o mapa padrão (OpenStreetMap).', true);
      }
    });
  }catch(e){ mostrarAvisoMapa('Erro ao iniciar o mapa: '+e.message); leafletMap=null; }
}
// Volta pra aba Mapa: remede o container e redesenha SÓ se o arquivo mudou —
// nunca reenquadra por conta própria.
function sincronizarMapaVisivel(){
  if(!leafletMap) return;
  ajustarTamanhoMapa();
  if(mapaProp.kmlTexto) renderizarMapa();
}
function ativarAbaMapa(){
  if(mapaInicializado){
    sincronizarMapaVisivel();
    return;
  }
  if(bibliotecasMapaDisponiveis()){
    inicializarMapaSeNecessario();
    sincronizarMapaVisivel();
    return;
  }
  mostrarAvisoMapa('Carregando o componente de mapa… isso pode levar alguns segundos na primeira vez (ou um pouco mais se o provedor principal estiver indisponível e for preciso usar um alternativo).');
  aguardarBibliotecas(['leaflet','jszip','togeojson'], 14, (ok)=>{
    if(ok){
      inicializarMapaSeNecessario();
      if(leafletMap) mostrarAvisoMapa(null);
      sincronizarMapaVisivel();
    } else {
      mapaInicializado=true;
      mostrarAvisoMapa(MSG_FALHA_MAPA);
    }
  });
}
function estiloTalhao(destacado, nomeModulo){
  const rm = nomeModulo ? resumoModulo(nomeModulo) : null;
  const corBase = (rm && rm.classifPredominante) ? corClassificacao(rm.classifPredominante) : '#9a9478';
  return destacado
    ? {color:'#F5EAC8',weight:4,fillColor:corBase,fillOpacity:.55}
    : {color:corBase,weight:3,fillColor:corBase,fillOpacity:.28};
}
function nomeModuloDoTalhao(idx){
  const t=mapaProp.talhoes[idx]; return t ? (t.nomeModulo||t.nomeOriginal) : null;
}
// Mantém qualquer geometria que representa um talhão de verdade — inclusive linhas
// (muita cerca elétrica é registrada como um traçado de linha, não um polígono fechado).
// Só descarta pelo NOME quando é claramente uma régua de medir distância do Google Earth
// (ex.: "Medida da linha"), não pelo tipo de geometria.
function featuresValidasTalhao(gj){
  return gj.features.filter(f=>{
    if(!f.geometry) return false;
    const tipo=f.geometry.type;
    if(!['Polygon','MultiPolygon','Point','LineString','MultiLineString'].includes(tipo)) return false;
    const nome=(f.properties && (f.properties.name||f.properties.Name)) || '';
    const nomeNorm=normalizarTxt(nome);
    const pareceMedida = /^medid|^regua|^distanc|^escala/.test(nomeNorm);
    return !pareceMedida;
  });
}
// Cerca elétrica é normalmente caminhada com GPS até fechar o piquete — o traçado (LineString)
// começa e termina quase no mesmo ponto. Quando é o caso, tratamos como área (Polygon) pra
// pintar o piquete preenchido, não só o contorno — senão fica "só o perímetro" no mapa.
function distanciaCoord(a,b){ const dx=a[0]-b[0], dy=a[1]-b[1]; return Math.sqrt(dx*dx+dy*dy); }
function normalizarGeometriaTalhao(feature){
  const geom=feature.geometry;
  if(geom && geom.type==='LineString' && geom.coordinates.length>=3){
    const primeiro=geom.coordinates[0], ultimo=geom.coordinates[geom.coordinates.length-1];
    if(distanciaCoord(primeiro,ultimo) < 0.0006){ // ~60m de tolerância em graus — cerca "fechada"
      return Object.assign({}, feature, {geometry:{type:'Polygon', coordinates:[geom.coordinates]}});
    }
  }
  return feature;
}
// Área geodésica aproximada (fórmula esférica, igual a que ferramentas de GPS/Google Earth usam)
// a partir de um anel de coordenadas [lon,lat] do GeoJSON. Retorna hectares.
function areaGeodesicaHa(coordenadas){
  if(!coordenadas || coordenadas.length<3) return null;
  const R=6378137; // raio médio da Terra (WGS84), em metros
  let area=0;
  const n=coordenadas.length;
  for(let i=0;i<n;i++){
    const [lon1,lat1]=coordenadas[i];
    const [lon2,lat2]=coordenadas[(i+1)%n];
    area += (lon2-lon1)*Math.PI/180 * (2 + Math.sin(lat1*Math.PI/180) + Math.sin(lat2*Math.PI/180));
  }
  area = area*R*R/2;
  return Math.abs(area)/10000; // m² -> hectares
}
// Tenta calcular a área de um talhão: fecha a cerca (se for o caso) e mede o anel externo.
function areaTalhaoHa(feature){
  const norm=normalizarGeometriaTalhao(feature);
  if(!norm.geometry) return null;
  if(norm.geometry.type==='Polygon') return areaGeodesicaHa(norm.geometry.coordinates[0]);
  if(norm.geometry.type==='MultiPolygon') return areaGeodesicaHa(norm.geometry.coordinates[0][0]);
  return null;
}
// ---- Rótulo fixo desenhado sobre o talhão -----------------------------------
// Em tamanho de legenda, com as duas informações que a Renata olha primeiro no
// mapa: quantos animais estão naquele lote e quanto do pasto é aproveitável
// (área útil ÷ área total, a mesma conta da coluna "% Empastada").
function rotulosLigados(){ return mapaProp.mostrarRotulos!==false; }
function rotuloTalhao(idx){
  const nome=nomeModuloDoTalhao(idx) || ('Talhão '+(idx+1));
  const rm=resumoModulo(nome);
  const animais = rm.qtdAnimais ? (fmtI(rm.qtdAnimais)+' animais') : 'sem animais';
  // Sem classificação não existe área útil — mostrar "0,00%" aqui faria o pasto
  // parecer perdido quando o que falta é classificar.
  const aprov = (rm.pctAproveitamento!=null && rm.pctAreaClassificada>0)
    ? (fmtN(rm.pctAproveitamento)+'% aproveit.')
    : 'a classificar';
  return '<span class="rt-nome">'+escapeHtml(nome)+'</span>'+
         '<span class="rt-dado">'+escapeHtml(animais)+' · '+escapeHtml(aprov)+'</span>';
}
// Caixinha de detalhe no canto do mapa — substitui o antigo tooltip de passar o
// mouse, que agora dá lugar ao rótulo fixo (o Leaflet só aceita um por camada).
const DICA_DETALHE='<span class="vazio">Passe o mouse (ou toque) num talhão para ver os números dele aqui.</span>';
function mostrarDetalheTalhao(idx){
  const el=document.getElementById('mapaDetalhe'); if(!el) return;
  el.innerHTML=detalheTalhao(idx);
  el.classList.add('com-dado');
}
function limparDetalheTalhao(){
  const el=document.getElementById('mapaDetalhe'); if(!el) return;
  el.innerHTML=DICA_DETALHE;
  el.classList.remove('com-dado');
}
// Deixa o checkbox de rótulos coerente com o que está salvo (backup, versão restaurada…).
function sincronizarControlesMapa(){
  const chk=document.getElementById('chkRotulosMapa');
  if(chk) chk.checked=rotulosLigados();
}
function detalheTalhao(idx){
  const nome=nomeModuloDoTalhao(idx) || ('Talhão '+(idx+1));
  const t=mapaProp.talhoes[idx];
  const rm=resumoModulo(nome);
  let html='<b>'+escapeHtml(nome)+'</b><br>'+fmtI(rm.nPastos)+' pasto(s) · '+fmtN(rm.areaTotal)+' ha total · '+fmtN(rm.areaUtil)+' ha útil';
  if(rm.pctAproveitamento!=null && rm.pctAreaClassificada>0) html+='<br>Aproveitamento do pasto: <b>'+fmtN(rm.pctAproveitamento)+'%</b> (área útil ÷ área total)';
  if(t && t.areaHa!=null) html+='<br>Área medida no mapa: '+fmtN(t.areaHa)+' ha';
  if(rm.classifPredominante){
    html+='<br>Classificação predominante: <span style="color:'+corClassificacao(rm.classifPredominante)+'">'+escapeHtml(rm.classifPredominante)+'</span> ('+fmtN(rm.pctAreaClassificada)+'% da área classificada)';
  } else {
    html+='<br><span style="opacity:.7">ainda sem classificação</span>';
  }
  if(rm.qtdAnimais){
    html+='<br>'+fmtI(rm.qtdAnimais)+' animais · '+fmtN(rm.pesoMedio)+' kg méd.'+
      '<br>'+fmtN(rm.ua)+' UA · '+(rm.lotacao!=null?fmtN(rm.lotacao)+' UA/ha':'—');
  } else {
    html+='<br><span style="opacity:.7">sem animais lançados</span>';
  }
  html+='<br><span style="opacity:.7">clique no talhão para abrir no Cadastro</span>';
  return html;
}
// Clicar no talhão do mapa já leva pro Cadastro: edita o pasto existente que usa esse módulo
// (se houver) ou monta um rascunho novo com Módulo e Área já preenchidos a partir do mapa.
function abrirCadastroDoTalhao(idx){
  const t=mapaProp.talhoes[idx]; if(!t) return;
  const nomeModulo=t.nomeModulo||t.nomeOriginal;
  const existente=todos().find(r=>r.modulo && normalizarTxt(r.modulo)===normalizarTxt(nomeModulo));
  if(existente){
    editar(existente.pasto);
    toast('Abrindo o pasto "'+existente.pasto+'" (módulo "'+nomeModulo+'").');
    return;
  }
  limparForm();
  const btnCad=document.querySelector('.nav-dropdown-menu button[data-subaba="sub-pastos"]');
  if(btnCad) btnCad.click();
  if(modulosRegistrados.some(m=>normalizarTxt(m)===normalizarTxt(nomeModulo))){
    document.getElementById('fModulo').value=nomeModulo;
  } else {
    document.getElementById('fModuloNovo').value=nomeModulo;
  }
  if(t.areaHa!=null){ document.getElementById('fArea').value=t.areaHa.toFixed(2); }
  calcVivo();
  toast('Novo pasto pronto pra preencher — módulo "'+nomeModulo+'"'+(t.areaHa!=null?' e '+fmtN(t.areaHa)+' ha já calculados do mapa':'')+'.');
}
// Redesenha os talhões.
//
// Por padrão PRESERVA o enquadramento atual. Antes, toda volta pra aba Mapa (e todo
// salvamento de pasto) recriava a camada e chamava fitBounds de novo: quem estava
// marcando piquete por piquete via o mapa "encolher" — voltava pro zoom da fazenda
// inteira a cada marcação, e quando a medida do container ainda estava desatualizada
// o reenquadramento saía menor do que o anterior, acumulando a cada ida e volta.
// Agora só reenquadra quando não há vista guardada ou quando o usuário pede
// (`{enquadrar:true}`, do botão "Enquadrar tudo" e do upload de um arquivo novo).
function renderizarMapa(opcoes){
  opcoes=opcoes||{};
  if(!leafletMap || !mapaProp.kmlTexto) return;
  const assinatura=assinaturaMapa();
  // Mesmo arquivo já desenhado: só atualiza cor e rótulo, sem recriar nada nem tocar no zoom.
  if(!opcoes.enquadrar && geoLayer && assinatura===assinaturaMapaDesenhado){
    atualizarTooltipsMapa();
    return;
  }
  try{
    if(geoLayer){ leafletMap.removeLayer(geoLayer); geoLayer=null; }
    const xml=new DOMParser().parseFromString(mapaProp.kmlTexto,'text/xml');
    if(xml.querySelector('parsererror')) throw new Error('arquivo KML inválido');
    const gjBruto=toGeoJSON.kml(xml);
    const validas=featuresValidasTalhao(gjBruto);
    const paraRenderizar=validas.map((f,i)=>{
      const norm=normalizarGeometriaTalhao(f);
      norm._idxTalhao=i;
      return norm;
    });
    const gj={type:'FeatureCollection', features:paraRenderizar};
    geoLayer=L.geoJSON(gj,{
      style: (feature)=>estiloTalhao(false, nomeModuloDoTalhao(feature._idxTalhao)),
      pointToLayer:(f,latlng)=>L.circleMarker(latlng, Object.assign({radius:6}, estiloTalhao(false, nomeModuloDoTalhao(f._idxTalhao)))),
      onEachFeature:(feature,layer)=>{
        const idx=feature._idxTalhao;
        layer._talhaoIdx=idx;
        layer.on('click',()=>abrirCadastroDoTalhao(idx));
        layer.on('mouseover',()=>mostrarDetalheTalhao(idx));
      }
    }).addTo(leafletMap);
    assinaturaMapaDesenhado=assinatura;
    aplicarRotulos();
    if(opcoes.enquadrar || !restaurarVistaMapa()) enquadrarTudo();
    mostrarAvisoMapa(null);
  }catch(e){ mostrarAvisoMapa('Erro ao desenhar o mapa: '+e.message); }
}
// Liga/desliga os rótulos fixos e mantém o texto deles em dia. O rótulo é um tooltip
// permanente ancorado no centro do talhão — por isso o detalhe completo foi pro
// quadro do canto (o Leaflet só permite um tooltip por camada).
function aplicarRotulos(){
  if(!geoLayer) return;
  const ligados=rotulosLigados();
  geoLayer.eachLayer(layer=>{
    const idx=layer._talhaoIdx; if(idx==null) return;
    if(ligados){
      const texto=rotuloTalhao(idx);
      const jaTem = layer.getTooltip ? layer.getTooltip() : null;
      if(jaTem && layer.setTooltipContent) layer.setTooltipContent(texto);
      else if(layer.bindTooltip) layer.bindTooltip(texto,{permanent:true, direction:'center', className:'rotulo-talhao', opacity:1});
    } else if(layer.unbindTooltip){
      layer.unbindTooltip();
    }
  });
}
function alternarRotulosMapa(ligado){
  mapaProp.mostrarRotulos = !!ligado;
  persistir();
  aplicarRotulos();
  toast(ligado ? 'Rótulos ligados — animais e aproveitamento aparecem sobre cada talhão.' : 'Rótulos desligados.');
}
function atualizarTooltipsMapa(){
  if(!geoLayer) return;
  aplicarRotulos();
  geoLayer.eachLayer(layer=>{
    if(layer._talhaoIdx!=null && layer.setStyle && talhaoSelecionado!==layer._talhaoIdx) layer.setStyle(estiloTalhao(false, nomeModuloDoTalhao(layer._talhaoIdx)));
  });
}
function selecionarTalhao(idx){
  talhaoSelecionado=idx;
  if(geoLayer){
    geoLayer.eachLayer(layer=>{
      const destacado = layer._talhaoIdx===idx;
      if(layer.setStyle) layer.setStyle(estiloTalhao(destacado, nomeModuloDoTalhao(layer._talhaoIdx)));
      if(destacado){
        if(layer.getBounds){ try{ leafletMap.fitBounds(layer.getBounds(),{padding:[60,60],maxZoom:16}); }catch(e){} }
        else if(layer.getLatLng){ leafletMap.setView(layer.getLatLng(), Math.max(leafletMap.getZoom(),15)); }
        if(layer.openTooltip) layer.openTooltip();
        mostrarDetalheTalhao(idx);
        gravarVistaMapa();
      }
    });
  }
  renderTalhoes();
  const row=document.querySelector('.talhao-item[data-idx="'+idx+'"]');
  if(row && typeof row.scrollIntoView==='function'){ try{ row.scrollIntoView({block:'nearest',behavior:'smooth'}); }catch(e){ try{ row.scrollIntoView(); }catch(e2){} } }
}
function renderTalhoes(){
  const div=document.getElementById('listaTalhoes');
  const cont=document.getElementById('contagemTalhoes');
  if(cont) cont.textContent = mapaProp.talhoes.length ? (mapaProp.talhoes.length+' talhões') : '';
  if(!div) return;
  if(!mapaProp.talhoes.length){
    div.innerHTML='<div style="color:var(--mudo);font-size:12.5px">Nenhum mapa carregado ainda. Envie um arquivo KMZ ou KML acima.</div>';
    return;
  }
  div.innerHTML=mapaProp.talhoes.map((t,idx)=>{
    const rm=resumoModulo(t.nomeModulo);
    const aprov = (rm.pctAproveitamento!=null && rm.pctAreaClassificada>0) ? (' · '+fmtN(rm.pctAproveitamento)+'% aproveit.') : '';
    const infoAnimais = (rm.qtdAnimais ? (fmtI(rm.qtdAnimais)+' animais · '+fmtN(rm.pesoMedio)+' kg méd. · '+fmtN(rm.ua)+' UA') : (rm.nPastos? 'sem animais lançados' : 'módulo não usado em nenhum pasto ainda')) + aprov;
    return `<div class="talhao-item${idx===talhaoSelecionado?' selecionado':''}" data-idx="${idx}">
      <div class="talhao-original">${escapeHtml(t.nomeOriginal)}</div>
      <input type="text" list="listaModulosDatalist" value="${escapeHtml(t.nomeModulo)}" onchange="renomearTalhao(${idx}, this.value)" placeholder="Nome do Módulo">
      <span class="dica" style="min-width:260px">${escapeHtml(infoAnimais)}</span>
      <button class="btn fantasma" onclick="selecionarTalhao(${idx})">Destacar no mapa</button>
      <button class="btn fantasma" onclick="verModuloNaTabela('${q(t.nomeModulo)}')">Ver pastos na tabela →</button>
    </div>`;
  }).join('');
}
function renomearTalhao(idx, novoNome){
  if(!mapaProp.talhoes[idx]) return;
  mapaProp.talhoes[idx].nomeModulo = novoNome.trim() || mapaProp.talhoes[idx].nomeOriginal;
  persistir();
  atualizarDatalistModulos();
  atualizarTooltipsMapa();
  renderTalhoes();
  toast('Nome do módulo atualizado.');
}
function atualizarInfoArquivoMapa(){
  const el=document.getElementById('infoMapaArquivo'); if(!el) return;
  el.textContent = mapaProp.arquivoNome ? (mapaProp.arquivoNome+' · carregado em '+fmtD(new Date(mapaProp.dataUpload))) : '';
}
function atualizarDatalistModulos(){
  const set=new Set(modulosRegistrados);
  todos().forEach(r=>{ if(r.modulo) set.add(r.modulo); });
  mapaProp.talhoes.forEach(t=>{ if(t.nomeModulo) set.add(t.nomeModulo); });
  const dl=document.getElementById('listaModulosDatalist');
  if(dl) dl.innerHTML=[...set].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR')).map(m=>`<option value="${escapeHtml(m)}">`).join('');
}
function aguardarBibliotecasPromise(nomes, tentativas){
  return new Promise(resolve=>aguardarBibliotecas(nomes, tentativas, resolve));
}
async function carregarArquivoMapa(ev){
  const file=ev.target.files[0]; if(!file) return;
  if(!bibliotecasMapaDisponiveis()){
    toast('Aguardando o carregamento das bibliotecas do mapa…');
    const ok=await aguardarBibliotecasPromise(['leaflet','jszip','togeojson'], 14);
    if(!ok){
      toast('Não foi possível carregar as bibliotecas do mapa mesmo com os provedores alternativos — verifique sua conexão ou tente numa rede diferente.', true);
      ev.target.value=''; return;
    }
  }
  try{
    let kmlText;
    if(/\.kmz$/i.test(file.name)){
      const buf=await file.arrayBuffer();
      const zip=await JSZip.loadAsync(buf);
      const entry=Object.values(zip.files).find(f=>/\.kml$/i.test(f.name) && !f.dir);
      if(!entry) throw new Error('nenhum arquivo .kml encontrado dentro do KMZ');
      kmlText=await entry.async('text');
    } else if(/\.kml$/i.test(file.name)){
      kmlText=await file.text();
    } else {
      throw new Error('envie um arquivo .kmz ou .kml');
    }
    const xml=new DOMParser().parseFromString(kmlText,'text/xml');
    if(xml.querySelector('parsererror')) throw new Error('arquivo KML inválido');
    const gj=toGeoJSON.kml(xml);
    const validas=featuresValidasTalhao(gj);
    if(!validas.length) throw new Error('nenhum talhão (polígono) encontrado no arquivo — só foram encontradas linhas/medidas, que não são pastos');
    mapaProp.arquivoNome=file.name;
    mapaProp.dataUpload=new Date().toISOString();
    mapaProp.kmlTexto=kmlText;
    mapaProp.talhoes=validas.map((f,i)=>{
      const nome=(f.properties && (f.properties.name||f.properties.Name)) || ('Talhão '+(i+1));
      return {id:'t'+i, nomeOriginal:nome, nomeModulo:nome, areaHa:areaTalhaoHa(f)};
    });
    talhaoSelecionado=null;
    mapaProp.vista=null;          // arquivo novo: enquadra a fazenda inteira uma vez
    assinaturaMapaDesenhado=null;
    persistir();
    atualizarInfoArquivoMapa();
    renderTalhoes();
    atualizarDatalistModulos();
    inicializarMapaSeNecessario();
    ajustarTamanhoMapa();
    renderizarMapa({enquadrar:true});
    salvarComoAnexo(file);
    toast(mapaProp.talhoes.length+' talhão(ões) carregado(s) do mapa.');
  }catch(e){
    toast('Não consegui ler esse arquivo: '+e.message, true);
  }
  ev.target.value='';
}
function removerMapa(){
  const rotulos=rotulosLigados();
  mapaProp=mapaPropDefault();
  mapaProp.mostrarRotulos=rotulos;   // preferência do usuário sobrevive ao arquivo
  talhaoSelecionado=null;
  assinaturaMapaDesenhado=null;
  if(geoLayer && leafletMap){ leafletMap.removeLayer(geoLayer); geoLayer=null; }
  limparDetalheTalhao();
  persistir(); atualizarInfoArquivoMapa(); renderTalhoes(); mostrarAvisoMapa(null);
  toast('Mapa removido.');
}
function normalizarTxt(s){ return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function encontrarTalhaoPorModulo(nomeModulo){
  const alvo=normalizarTxt(nomeModulo); if(!alvo) return null;
  const i=mapaProp.talhoes.findIndex(t=>normalizarTxt(t.nomeModulo)===alvo);
  return i>=0 ? i : null;
}
function verModuloNoMapa(nomeModulo){
  if(!nomeModulo) return toast('Este pasto não tem módulo definido.', true);
  if(!mapaProp.talhoes.length) return toast('Nenhum mapa carregado ainda. Envie o KMZ na aba Mapa.', true);
  const idx=encontrarTalhaoPorModulo(nomeModulo);
  if(idx==null) return toast('Nenhum talhão do mapa está vinculado ao módulo "'+nomeModulo+'" ainda.', true);
  const btn=document.querySelector('nav button[data-aba="mapa"]');
  if(btn) btn.click();
  setTimeout(()=>selecionarTalhao(idx), 80);
}
function verModuloNaTabela(nomeModulo){
  const alvo=normalizarTxt(nomeModulo);
  const real = todos().map(r=>r.modulo).find(m=>m && normalizarTxt(m)===alvo);
  const btn=document.querySelector('nav button[data-aba="pastos"]');
  if(btn) btn.click();
  if(!real){ toast('Nenhum pasto cadastrado usa o módulo "'+nomeModulo+'" ainda.', true); return; }
  filtros.modulo = real;
  pagina=0;
  atualizarTudo();
  toast('Tabela filtrada pelo módulo "'+real+'".');
}

// ---- Relatórios ----
function atualizarCapaRelatorio(rs){
  const g=(id,v)=>{const el=document.getElementById(id); if(el) el.textContent=v;};
  g('capaFazenda', cliente.fazenda || '—');
  g('capaData', fmtD(HOJE));
  g('capaCliente', cliente.nome || '—');
  g('capaConsultor', cliente.consultor || '—');
  g('capaMunicipio', cliente.municipio || '—');
  g('capaTotalPastos', fmtI(rs.length));
  g('capaAreaTotal', fmtN(soma(rs,'areaTotal'))+' ha');
  const linkEl=document.getElementById('capaMapaLink');
  if(linkEl){
    if(cliente.mapa){ linkEl.href=cliente.mapa; linkEl.textContent='Abrir localização ↗'; }
    else { linkEl.href='#'; linkEl.textContent='Não informada'; }
  }
}
function renderRelatorios(rs){
  renderGraficos(rs,'Rel');
  renderKpis(rs,'kpisRel',false);
  atualizarCapaRelatorio(rs);
  const areaTotal=soma(rs,'areaTotal'), areaUtil=soma(rs,'areaUtil');
  const uaTotal=soma(rs,'ua');
  const lotacaoMedia = areaUtil? uaTotal/areaUtil : null;
  const classificados=rs.filter(r=>r.classificacao).length;
  const pctEmpMedio = areaTotal? areaUtil/areaTotal*100 : 0;
  document.getElementById('relResumo').innerHTML=
    `A seleção filtrada soma <b style="color:var(--ouro)">${fmtI(rs.length)} pastos</b> e <b style="color:var(--ouro)">${fmtN(areaTotal)} ha</b> de área total,
     dos quais <b style="color:var(--ouro)">${fmtN(areaUtil)} ha</b> (${fmtN(pctEmpMedio)}%) estão hoje classificados como área útil empastada.
     ${fmtI(classificados)} de ${fmtI(rs.length)} pastos já têm a Classificação do Pasto preenchida; ${fmtI(rs.length-classificados)} seguem pendentes de avaliação em campo.
     A lotação atual soma <b style="color:var(--ouro)">${fmtN(uaTotal)} UA</b>, uma taxa média de <b style="color:var(--ouro)">${lotacaoMedia!=null?fmtN(lotacaoMedia):'—'} UA/ha</b> sobre a área útil.
     Consulte a Compra Consolidada abaixo para as quantidades de insumo a adquirir.
     As tabelas replicam as tabelas dinâmicas da planilha original, recalculadas ao vivo conforme os filtros do Painel.`;
  pivot('relModulo', rs, 'modulo', 'Módulo', true);
  pivot('relManejo', rs, 'manejo', 'Ação de Manejo', false);
  pivotClassif(rs);
  pivotCapim(rs);
  pivotCompra(rs);
}
function pivot(id, rs, chave, rotulo, comLotacao){
  const grupos={};
  rs.forEach(r=>{const g=r[chave]||'Não informado';(grupos[g]=grupos[g]||[]).push(r)});
  const entradas=Object.entries(grupos).sort((a,b)=>soma(b[1],'areaTotal')-soma(a[1],'areaTotal'));
  let cab, linhas;
  if(comLotacao){
    const linhaCalc=arr=>{
      const areaUtil=soma(arr,'areaUtil'), ua=soma(arr,'ua');
      return `<td>${fmtN(areaUtil)}</td><td>${fmtN(ua)}</td><td>${areaUtil?fmtN(ua/areaUtil):'—'}</td>`;
    };
    cab=`<th>${rotulo}</th><th>Nº Pastos</th><th>Área Total (ha)</th><th>Área Útil (ha)</th><th>UA</th><th>Lotação (UA/ha)</th>`;
    linhas=entradas.map(([g,arr])=>`<tr><td>${escapeHtml(g)}</td><td>${fmtI(arr.length)}</td><td>${fmtN(soma(arr,'areaTotal'))}</td>${linhaCalc(arr)}</tr>`).join('');
    const tot=`<tr style="font-weight:700"><td>Total Geral</td><td>${fmtI(rs.length)}</td><td>${fmtN(soma(rs,'areaTotal'))}</td>${linhaCalc(rs)}</tr>`;
    document.getElementById(id).innerHTML=`<thead><tr>${cab}</tr></thead><tbody>${linhas}${tot}</tbody>`;
  } else {
    const areaTotalGeral = soma(rs,'areaTotal')||1;
    cab=`<th>${rotulo}</th><th>Nº Pastos</th><th>Área Total (ha)</th><th>% da Área</th>`;
    linhas=entradas.map(([g,arr])=>`<tr><td>${escapeHtml(g)}</td><td>${fmtI(arr.length)}</td><td>${fmtN(soma(arr,'areaTotal'))}</td><td>${(soma(arr,'areaTotal')/areaTotalGeral*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</td></tr>`).join('');
    const tot=`<tr style="font-weight:700"><td>Total Geral</td><td>${fmtI(rs.length)}</td><td>${fmtN(soma(rs,'areaTotal'))}</td><td>100%</td></tr>`;
    document.getElementById(id).innerHTML=`<thead><tr>${cab}</tr></thead><tbody>${linhas}${tot}</tbody>`;
  }
}
function pivotCompra(rs){
  const el=document.getElementById('relCompra'); if(!el) return;
  const porProduto={};
  rs.forEach(r=>(r.aplicacoes||[]).forEach(a=>{
    if(!a.produtoId) return;
    porProduto[a.produtoId]=porProduto[a.produtoId]||{total:0,nPastos:0};
    porProduto[a.produtoId].total += (a.total||0);
    porProduto[a.produtoId].nPastos += 1;
  }));
  const ids=Object.keys(porProduto);
  if(!ids.length){ el.innerHTML='<thead><tr><th>Produto</th></tr></thead><tbody><tr><td>Nenhuma aplicação de produto lançada nos pastos filtrados.</td></tr></tbody>'; return; }
  const linhas=ids.map(id=>{
    const p=produtoPorId(id); const info=porProduto[id];
    const unidadeBase = p? p.unidade.split('/')[0] : 'un';
    return `<tr><td>${p?escapeHtml(p.nome):'Produto removido'}</td><td>${p?escapeHtml(p.categoria):'—'}</td><td>${fmtI(info.nPastos)}</td><td>${fmtN(info.total)} ${unidadeBase}</td></tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>Produto</th><th>Categoria</th><th>Nº Pastos</th><th>Total a Comprar</th></tr></thead><tbody>${linhas}</tbody>`;
}
function pivotClassif(rs){
  const grupos={};
  CLASSIF.forEach(c=>grupos[c[0]]=[]);
  const pend=[];
  rs.forEach(r=>{ if(r.classificacao && grupos[r.classificacao]) grupos[r.classificacao].push(r); else pend.push(r); });
  let linhas=CLASSIF.map(c=>{
    const arr=grupos[c[0]]; if(!arr.length) return '';
    return `<tr><td>${escapeHtml(c[0])}</td><td>${fmtI(arr.length)}</td><td>${fmtN(soma(arr,'areaTotal'))}</td><td>${(c[1]*100).toFixed(0)}%</td></tr>`;
  }).join('');
  if(pend.length) linhas+=`<tr><td>Não Classificado</td><td>${fmtI(pend.length)}</td><td>${fmtN(soma(pend,'areaTotal'))}</td><td>—</td></tr>`;
  const tot=`<tr style="font-weight:700"><td>Total Geral</td><td>${fmtI(rs.length)}</td><td>${fmtN(soma(rs,'areaTotal'))}</td><td>${rs.length?fmtN(soma(rs,'areaUtil')/(soma(rs,'areaTotal')||1)*100):'—'}%</td></tr>`;
  document.getElementById('relClassif').innerHTML=`<thead><tr><th>Classificação</th><th>Nº Pastos</th><th>Área Total (ha)</th><th>% Empastada</th></tr></thead><tbody>${linhas}${tot}</tbody>`;
}
function pivotCapim(rs){
  const grupos={};
  rs.forEach(r=>{const g=r.capim||'Não informado';(grupos[g]=grupos[g]||[]).push(r)});
  const entradas=Object.entries(grupos).sort((a,b)=>soma(b[1],'areaTotal')-soma(a[1],'areaTotal'));
  const linhas=entradas.map(([g,arr])=>`<tr><td>${escapeHtml(g)}</td><td>${fmtI(arr.length)}</td><td>${fmtN(soma(arr,'areaTotal'))}</td></tr>`).join('');
  const tot=`<tr style="font-weight:700"><td>Total Geral</td><td>${fmtI(rs.length)}</td><td>${fmtN(soma(rs,'areaTotal'))}</td></tr>`;
  document.getElementById('relCapim').innerHTML=`<thead><tr><th>Espécie do Capim</th><th>Nº Pastos</th><th>Área Total (ha)</th></tr></thead><tbody>${linhas}${tot}</tbody>`;
}

// ---- Export / Import ----
function exportarCSV(){
  const rs=filtrar();
  const cab=['Pasto','Ação de Manejo','Módulo','Sistema de Produção','Área Total (ha)','Classificação do Pasto','% Área Empastada','Área Útil (ha)','Espécie do Capim','Tipo de Aguada','Tipo de Cocho','Quant. Cocho (m)','OBS','Qtd. Animais','Peso Médio (kg)','UA','Taxa de Lotação (UA/ha)','Aplicações (produto/ha)'];
  const lin=rs.map(r=>[r.pasto,r.manejo,r.modulo,r.sistema,r.areaTotal,r.classificacao,
    r.pctEmpastada!=null?(r.pctEmpastada*100).toFixed(1)+'%':'', r.areaUtil!=null?r.areaUtil.toFixed(2):'',
    r.capim,r.aguada,r.cocho,r.qtCocho,r.obs,
    r.qtdAnimais,r.pesoMedio,r.ua?r.ua.toFixed(2):'',r.taxaLotacao!=null?r.taxaLotacao.toFixed(2):'',
    (r.aplicacoes||[]).map(a=>{const p=produtoPorId(a.produtoId);return (p?p.nome:'?')+' '+a.quantidadeHa+(p?'/'+p.unidade.split('/')[0]:'')}).join(' | ')]
    .map(v=>v==null?'':String(v).replace(/;/g,',')).join(';'));
  baixar('controle_pastagem_vista_alegre.csv','\ufeff'+cab.join(';')+'\n'+lin.join('\n'),'text/csv');
  toast('CSV exportado com '+fmtI(rs.length)+' pastos.');
}
// ---- Versões Salvas (histórico de cenários, biblioteca exportável) ----
const LS_KEY_VERSOES='controle_pastagem_versoes_v1';
let versoesSalvas=(function(){
  try{ return JSON.parse(armazem.ler(LS_KEY_VERSOES)||'[]'); }catch(e){ return []; }
})();
function persistirVersoes(){
  try{ armazem.gravar(LS_KEY_VERSOES, JSON.stringify(versoesSalvas)); }catch(e){}
}
function snapshotAtual(){
  return {extras, edicoes, cliente, mapaProp, catalogoProdutos, modulosRegistrados, ocultarBase, filtros:Object.assign({},filtros)};
}
function salvarVersaoAtual(){
  const campo=document.getElementById('nomeVersaoNova');
  const digitado=campo? campo.value.trim() : '';
  const sugestao=(cliente.fazenda?('Fazenda '+cliente.fazenda+' — '):'')+fmtD(new Date());
  const nome=digitado || sugestao;
  versoesSalvas.unshift({id:'v'+Date.now()+'_'+Math.random().toString(36).slice(2,8), nome, data:new Date().toISOString(), snapshot:JSON.parse(JSON.stringify(snapshotAtual()))});
  persistirVersoes(); renderVersoesSalvas();
  if(campo) campo.value='';
  toast('Versão salva: "'+nome+'".');
}
// Confirmação por clique duplo — evita depender de confirm()/prompt() nativos,
// que alguns navegadores embutidos (apps, webviews) bloqueiam ou ignoram silenciosamente.
function exigirDoisCliques(botao, textoConfirmar, nomeFuncao, arg){
  if(botao.dataset.confirmando==='1'){
    delete botao.dataset.confirmando;
    clearTimeout(botao._timeoutConfirmacao);
    botao.textContent=botao.dataset.textoOriginal;
    window[nomeFuncao](arg);
  } else {
    botao.dataset.confirmando='1';
    botao.dataset.textoOriginal=botao.textContent;
    botao.textContent=textoConfirmar;
    botao._timeoutConfirmacao=setTimeout(()=>{
      if(botao.dataset.confirmando==='1'){ delete botao.dataset.confirmando; botao.textContent=botao.dataset.textoOriginal; }
    },4000);
  }
}
function carregarVersao(id){
  const v=versoesSalvas.find(x=>x.id===id); if(!v) return;
  const s=v.snapshot;
  extras=(s.extras||[]).map(e=>{recalc(e);return e});
  edicoes=s.edicoes||{}; Object.values(edicoes).forEach(e=>recalc(e));
  cliente=Object.assign(clienteDefault(), s.cliente||{});
  cliente.anexos=cliente.anexos||[]; cliente.observacoes=cliente.observacoes||[];
  mapaProp=Object.assign(mapaPropDefault(), s.mapaProp||{});
  mapaProp.talhoes=mapaProp.talhoes||[];
  catalogoProdutos=(s.catalogoProdutos && s.catalogoProdutos.length) ? s.catalogoProdutos : catalogoDefault();
  modulosRegistrados=(s.modulosRegistrados && s.modulosRegistrados.length) ? s.modulosRegistrados : modulosRegistradosDefault();
  ocultarBase = (s.ocultarBase!==undefined) ? s.ocultarBase : false;
  Object.keys(filtros).forEach(k=>filtros[k]='');
  Object.assign(filtros, s.filtros||{});
  if(geoLayer && leafletMap){ leafletMap.removeLayer(geoLayer); geoLayer=null; }
  assinaturaMapaDesenhado=null; limparDetalheTalhao(); sincronizarControlesMapa();
  persistir(); atualizarTudo(); carregarCliente();
  atualizarInfoArquivoMapa(); renderTalhoes(); atualizarDatalistModulos();
  renderCatalogoProdutos(); renderFormAplicacoes(); renderModulosRegistrados();
  if(document.getElementById('mapa').classList.contains('ativa')) ativarAbaMapa();
  toast('Versão "'+v.nome+'" carregada.');
}
function excluirVersao(id){
  const v=versoesSalvas.find(x=>x.id===id); if(!v) return;
  versoesSalvas=versoesSalvas.filter(x=>x.id!==id);
  persistirVersoes(); renderVersoesSalvas();
  toast('Versão excluída.');
}
function renderVersoesSalvas(){
  const div=document.getElementById('listaVersoes'); if(!div) return;
  if(!versoesSalvas.length){ div.innerHTML='<div class="dica" style="display:block">Nenhuma versão salva ainda. Clique em "Salvar Versão Atual" para guardar o momento de agora e poder voltar a ele depois.</div>'; return; }
  div.innerHTML=versoesSalvas.map(v=>{
    const dt=new Date(v.data);
    return `<div class="talhao-item">
      <div style="flex:1;min-width:220px"><b style="color:var(--creme)">${escapeHtml(v.nome)}</b><br><span class="dica">${fmtD(dt)} às ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span></div>
      <button class="btn fantasma" onclick="exigirDoisCliques(this,'Clique de novo p/ confirmar','carregarVersao','${q(v.id)}')">Carregar esta Versão</button>
      <button class="btn perigo" onclick="exigirDoisCliques(this,'Confirma exclusão?','excluirVersao','${q(v.id)}')">excluir</button>
    </div>`;
  }).join('');
}
function exportarBibliotecaVersoes(){
  baixar('controle_pastagem_biblioteca_versoes.json', JSON.stringify(versoesSalvas), 'application/json');
  toast('Biblioteca exportada ('+fmtI(versoesSalvas.length)+' versão(ões)).');
}
function importarBibliotecaVersoes(ev){
  const f=ev.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{
    const lista=JSON.parse(r.result);
    if(!Array.isArray(lista)) throw new Error('formato inválido');
    const idsExistentes=new Set(versoesSalvas.map(v=>v.id));
    let novas=0;
    lista.forEach(v=>{ if(v && v.id && !idsExistentes.has(v.id)){ versoesSalvas.push(v); novas++; } });
    versoesSalvas.sort((a,b)=>new Date(b.data)-new Date(a.data));
    persistirVersoes(); renderVersoesSalvas();
    toast(novas+' versão(ões) nova(s) importada(s) da biblioteca.');
  }catch(e){ toast('Arquivo de biblioteca inválido.', true); } };
  r.readAsText(f); ev.target.value='';
}

function pedirConfirmacaoLimpar(){
  document.getElementById('confirmacaoLimpar').style.display='block';
  document.getElementById('btnLimparDados').style.display='none';
}
function cancelarLimpar(){
  const div=document.getElementById('confirmacaoLimpar'); if(div) div.style.display='none';
  const btn=document.getElementById('btnLimparDados'); if(btn) btn.style.display='inline-block';
}
function limparTodosDados(){
  extras=[]; edicoes={};
  ocultarBase=true;
  cliente=clienteDefault();
  mapaProp=mapaPropDefault();
  catalogoProdutos=catalogoDefault();
  modulosRegistrados=modulosRegistradosDefault();
  if(geoLayer && leafletMap){ leafletMap.removeLayer(geoLayer); geoLayer=null; }
  talhaoSelecionado=null;
  persistir();
  atualizarTudo(); carregarCliente();
  atualizarInfoArquivoMapa(); renderTalhoes(); atualizarDatalistModulos();
  renderCatalogoProdutos(); renderFormAplicacoes(); renderModulosRegistrados();
  mostrarAvisoMapa(null);
  cancelarLimpar();
  toast('Tudo apagado — a ferramenta está zerada.');
}
function exportarJSON(){
  baixar('controle_pastagem_backup.json', JSON.stringify({extras,edicoes,cliente,mapaProp,catalogoProdutos,modulosRegistrados,ocultarBase,filtros}), 'application/json');
  toast('Backup completo exportado (pastos + cliente + anexos + observações + mapa + produtos + módulos).');
}
function importarJSON(ev){
  const f=ev.target.files[0]; if(!f)return;
  const r=new FileReader();
  r.onload=()=>{try{
    const s=JSON.parse(r.result);
    catalogoProdutos=(s.catalogoProdutos && s.catalogoProdutos.length) ? s.catalogoProdutos : catalogoDefault();
    modulosRegistrados=(s.modulosRegistrados && s.modulosRegistrados.length) ? s.modulosRegistrados : modulosRegistradosDefault();
    ocultarBase=(s.ocultarBase!==undefined) ? s.ocultarBase : false;
    extras=(s.extras||[]).map(e=>{recalc(e);return e});
    edicoes=s.edicoes||{}; Object.values(edicoes).forEach(e=>recalc(e));
    cliente=Object.assign(clienteDefault(), s.cliente||{});
    cliente.anexos=cliente.anexos||[]; cliente.observacoes=cliente.observacoes||[];
    mapaProp=Object.assign(mapaPropDefault(), s.mapaProp||{});
    mapaProp.talhoes=mapaProp.talhoes||[];
    Object.keys(filtros).forEach(k=>filtros[k]='');
    Object.assign(filtros, s.filtros||{});
    assinaturaMapaDesenhado=null; limparDetalheTalhao(); sincronizarControlesMapa();
    persistir(); atualizarTudo(); carregarCliente();
    atualizarInfoArquivoMapa(); renderTalhoes(); atualizarDatalistModulos();
    renderCatalogoProdutos(); renderFormAplicacoes(); renderModulosRegistrados();
    if(document.getElementById('mapa').classList.contains('ativa')) ativarAbaMapa();
    toast('Backup importado.');
  }catch(e){toast('Arquivo inválido.',true)}};
  r.readAsText(f); ev.target.value='';
}
function baixar(nome,conteudo,tipo){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([conteudo],{type:tipo})); a.download=nome; a.click();
}
function toast(msg,erro){
  const t=document.getElementById('toast'); t.textContent=msg;
  t.style.background=erro?'#5a2418':'var(--verde-campo)';
  t.classList.add('mostrar'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('mostrar'),3400);
}

// ---- Navegação / boot ----
document.querySelectorAll('nav button[data-aba]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('nav button[data-aba]').forEach(x=>x.classList.remove('ativo'));
  document.querySelectorAll('.aba').forEach(x=>x.classList.remove('ativa'));
  const dd=document.getElementById('dropdownCadastros');
  if(dd) dd.classList.remove('ativo','aberto');
  b.classList.add('ativo');
  document.getElementById(b.dataset.aba).classList.add('ativa');
  if(b.dataset.subaba){
    if(dd) dd.classList.add('ativo');
    mostrarSubCadastro(b.dataset.subaba);
  }
  if(b.dataset.aba==='painel') renderGraficos(filtrar());
  if(b.dataset.aba==='relatorios') renderRelatorios(filtrar());
  if(b.dataset.aba==='mapa') ativarAbaMapa();
});
function alternarMenuCadastros(ev){
  if(ev) ev.stopPropagation();
  const dd=document.getElementById('dropdownCadastros');
  if(dd) dd.classList.toggle('aberto');
}
document.addEventListener('click',(ev)=>{
  const dd=document.getElementById('dropdownCadastros');
  if(dd && !dd.contains(ev.target)) dd.classList.remove('aberto');
});
function mostrarSubCadastro(subId){
  document.querySelectorAll('.subaba').forEach(x=>x.classList.remove('subaba-ativa'));
  document.querySelectorAll('.subnav-cadastros button').forEach(x=>x.classList.remove('ativo'));
  document.querySelectorAll('.nav-dropdown-menu button').forEach(x=>x.classList.remove('subativo'));
  const painel=document.getElementById(subId); if(painel) painel.classList.add('subaba-ativa');
  const botaoSubnav=document.querySelector('.subnav-cadastros button[data-subaba="'+subId+'"]'); if(botaoSubnav) botaoSubnav.classList.add('ativo');
  const botaoMenu=document.querySelector('.nav-dropdown-menu button[data-subaba="'+subId+'"]'); if(botaoMenu) botaoMenu.classList.add('subativo');
}
function irParaSubCadastro(subId){
  mostrarSubCadastro(subId);
}
function atualizarTudo(){
  const rs=filtrar();
  renderFiltros('filtrosPainel'); renderFiltros('filtrosTabela');
  renderKpis(rs); renderGraficos(rs); renderTabela(); renderRelatorios(rs);
  document.getElementById('totalGeral').textContent=fmtI(todos().length);
  atualizarDatalistModulos();
  atualizarTooltipsMapa();
}
// ---- Tema claro/escuro ----
function aplicarTema(tema){
  document.documentElement.setAttribute('data-tema', tema);
  const btn=document.getElementById('btnTema');
  if(btn) btn.textContent = tema==='claro' ? '🌙 Modo Escuro' : '☀️ Modo Claro';
  try{ armazem.gravar('pastagem_tema_v1', tema); }catch(e){}
  renderGraficos(filtrar());
  if(document.getElementById('relatorios') && document.getElementById('relatorios').classList.contains('ativa')) renderGraficos(filtrar(),'Rel');
}
function alternarTema(){
  const atual=document.documentElement.getAttribute('data-tema')||'escuro';
  aplicarTema(atual==='escuro' ? 'claro' : 'escuro');
}
(function restaurarTema(){
  let salvo='escuro';
  try{ salvo=armazem.ler('pastagem_tema_v1')||'escuro'; }catch(e){}
  document.documentElement.setAttribute('data-tema', salvo);
  const btn=document.getElementById('btnTema');
  if(btn) btn.textContent = salvo==='claro' ? '🌙 Modo Escuro' : '☀️ Modo Claro';
})();

document.getElementById('hoje').textContent=fmtD(HOJE);
document.getElementById('dataEmissao').textContent=fmtD(HOJE);
preencherSelects();
carregarCliente();
renderCatalogoProdutos();
renderFormAplicacoes();
renderModulosRegistrados();
renderVersoesSalvas();
atualizarInfoArquivoMapa();
renderTalhoes();
atualizarDatalistModulos();
limparDetalheTalhao();
sincronizarControlesMapa();
atualizarTudo(); calcVivo();
window.addEventListener('resize',()=>{ renderGraficos(filtrar()); if(document.getElementById('relatorios').classList.contains('ativa')) renderGraficos(filtrar(),'Rel'); });
window.addEventListener('beforeprint',()=>renderGraficos(filtrar(),'Rel'));
