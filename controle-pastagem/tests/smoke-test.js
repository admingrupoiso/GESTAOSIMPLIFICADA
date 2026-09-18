// Teste de fumaça: sobe o HTML final num navegador simulado (jsdom) e passa
// pelos fluxos principais com CLIQUE REAL (não chamada de função direto),
// pra pegar bug de verdade — não só "a lógica funciona se eu chamar certo".
//
// Duas pegadinhas de jsdom que valem a pena guardar (já caí nas duas):
//
// 1) `runScripts: 'outside-only'` NÃO executa atributos onclick="" — nem os
//    que já estavam no HTML, nem os inseridos depois via innerHTML. Só
//    funciona pra chamar função direto (w.minhaFuncao(...)). Pra testar
//    clique de verdade, precisa `runScripts: 'dangerously'` — mas aí as
//    <script src=...> tags externas (Leaflet/JSZip/XLSX/togeojson) tentam
//    baixar de verdade e travam se não tiver rede, então a gente remove
//    essas tags antes (ver removerScriptsExternos abaixo) e injeta os
//    mocks/libs reais como globals antes de rodar.
//
// 2) jsdom não tem timer real, então depois de qualquer clique que dispara
//    um setTimeout(...) interno (tipo o debounce de 30ms do mapa), espera
//    um pouco (`await esperar(150)`) antes de checar o resultado.
//
// Rodar: node tests/smoke-test.js  (depois de `npm install` e `./build.sh`)

const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const JSZipLib = require('jszip');
const toGeoJSONLib = require('@mapbox/togeojson');
const XLSXLib = require('xlsx');
const { makeMockLeaflet } = require('./mock_leaflet.js');

const DIST = path.join(__dirname, '..', 'dist', 'controle-pastagem.html');

function removerScriptsExternos(html) {
  return html.replace(/<script src=[^>]*><\/script>\n?/g, '');
}

function novaJanela() {
  const html = removerScriptsExternos(fs.readFileSync(DIST, 'utf-8'));
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Could not load/.test(e.message)) errors.push('jsdomError: ' + e.message); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc, url: 'https://exemplo.local/' });
  const w = dom.window, doc = w.document;
  w.onerror = (m, s, l, c, e) => errors.push('onerror: ' + m + '\n' + (e && e.stack));
  // Bibliotecas externas reais (não mocks) — só o Leaflet é mockado, porque
  // ele precisa de layout de verdade (canvas/DOM) que o jsdom não calcula.
  w.LIBS_STATUS = { leaflet: 'ok', jszip: 'ok', togeojson: 'ok', xlsx: 'ok' };
  w.JSZip = JSZipLib;
  w.toGeoJSON = toGeoJSONLib;
  w.XLSX = XLSXLib;
  w.L = makeMockLeaflet();
  return { dom, w, doc, errors };
}

function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  let falhas = 0;
  function checar(nome, condicao) {
    const ok = !!condicao;
    console.log((ok ? '✓' : '✗ FALHOU') + ' — ' + nome);
    if (!ok) falhas++;
    return ok;
  }

  const { w, doc, errors } = novaJanela();
  await esperar(300); // deixa o boot terminar

  // ---- 1. Estado inicial: começa vazio, Painel é a aba padrão ----
  checar('aba ativa ao carregar é o Painel', doc.querySelector('.aba.ativa').id === 'painel');
  checar('começa com 0 pastos (sem carga por padrão)', doc.getElementById('totalGeral').textContent === '0');

  // ---- 2. Carregar dados de exemplo (Vista Alegre) ----
  doc.querySelector('.nav-dropdown-btn').click();
  doc.querySelector('.nav-dropdown-menu button[data-subaba="sub-cliente"]').click();
  const btnExemplo = doc.querySelector('button[onclick="carregarDadosExemplo()"]');
  checar('botão "Carregar Dados de Exemplo" existe', !!btnExemplo);
  btnExemplo.click();
  checar('106 pastos após carregar o exemplo', doc.getElementById('totalGeral').textContent === '106');

  // ---- 3. Menu Cadastros (dropdown com sub-abas) ----
  doc.querySelector('.nav-dropdown-menu button[data-subaba="sub-pastos"]').click();
  checar('sub-aba Pastos/Piquetes fica ativa', doc.getElementById('sub-pastos').classList.contains('subaba-ativa'));
  checar('campo fPasto existe nessa sub-aba', !!doc.getElementById('fPasto'));

  // ---- 4. Editar um pasto, salvar, conferir cálculo de UA/Lotação ----
  const linhaEditar = [...doc.querySelectorAll('#corpo tr')].find(() => true) || null;
  doc.querySelector('nav button[data-aba="pastos"]').click();
  const primeiraLinhaEditar = doc.querySelector('#corpo tr td.acao');
  primeiraLinhaEditar.click();
  doc.getElementById('fQtdAnimais').value = '30';
  doc.getElementById('fQtdAnimais').dispatchEvent(new w.Event('input'));
  doc.getElementById('fPesoMedio').value = '450';
  doc.getElementById('fPesoMedio').dispatchEvent(new w.Event('input'));
  checar('UA calculada ao vivo (30 × 450 ÷ 450 = 30)', doc.getElementById('cUA').textContent.includes('30,00'));
  doc.querySelector('button[onclick="salvarPasto()"]').click();

  // ---- 5. Tema claro/escuro ----
  const temaAntes = doc.documentElement.getAttribute('data-tema');
  doc.getElementById('btnTema').click();
  checar('tema alterna ao clicar no botão', doc.documentElement.getAttribute('data-tema') !== temaAntes);

  // ---- 6. Mapa: upload de KMZ, cor por classificação, clique leva pro Cadastro ----
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Piquete Teste</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
-47.10,-15.10,0 -47.09,-15.10,0 -47.09,-15.09,0 -47.10,-15.09,0 -47.10,-15.10,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Medida da linha</name><LineString><coordinates>-47.095,-15.095,0 -47.085,-15.085,0</coordinates></LineString></Placemark>
</Document></kml>`;
  const zip = new JSZipLib();
  zip.file('doc.kml', kml);
  const kmzBuf = await zip.generateAsync({ type: 'nodebuffer' });
  const file = new w.File([kmzBuf], 'teste.kmz', { type: 'application/vnd.google-earth.kmz' });

  doc.querySelector('nav button[data-aba="mapa"]').click();
  await w.carregarArquivoMapa({ target: { files: [file], value: '' } });
  await esperar(150);
  checar('KMZ: só o polígono vira talhão (régua de medida é ignorada)', doc.querySelectorAll('#listaTalhoes .talhao-item').length === 1);

  // Rótulo fixo: nome do módulo + animais do lote + % de aproveitamento do pasto.
  // O talhão se chama "Piquete Teste" e ainda não é módulo de nenhum pasto, então
  // primeiro amarramos ele ao pasto que recebeu os 30 animais no bloco 4.
  const mapaMock = w.L.__debug.maps[0];
  const camadaTalhao = w.L.__debug.geoJSONLayers[w.L.__debug.geoJSONLayers.length - 1]._mockLayers[0];
  checar('rótulo do talhão é tooltip permanente (não some ao tirar o mouse)',
    camadaTalhao._tooltipOpts && camadaTalhao._tooltipOpts.permanent === true);

  const lerRotulo = () => w.L.__debug.geoJSONLayers[w.L.__debug.geoJSONLayers.length - 1]._mockLayers[0]._tooltip || '';

  doc.querySelector('nav button[data-aba="pastos"]').click();
  doc.querySelector('#corpo tr td.acao').click();
  doc.getElementById('fModuloNovo').value = 'Piquete Teste';
  doc.querySelector('button[onclick="salvarPasto()"]').click();
  doc.querySelector('nav button[data-aba="mapa"]').click();
  await esperar(150);

  const rotuloSemClassif = lerRotulo();
  checar('rótulo mostra o nome do módulo', rotuloSemClassif.includes('Piquete Teste'));
  checar('rótulo mostra a quantidade de animais do lote', /30\s*animais/.test(rotuloSemClassif));
  // Sem classificação não há área útil: mostrar "0,00%" faria o pasto parecer perdido.
  checar('pasto sem classificação pede classificação, não mostra 0%', /a classificar/.test(rotuloSemClassif) && !/aproveit/.test(rotuloSemClassif));

  doc.querySelector('nav button[data-aba="pastos"]').click();
  doc.querySelector('#corpo tr td.acao').click();
  doc.getElementById('fClassif').value = 'Produtivo 2';  // 80% de área útil pela tabela da planilha
  doc.querySelector('button[onclick="salvarPasto()"]').click();
  doc.querySelector('nav button[data-aba="mapa"]').click();
  await esperar(150);
  checar('rótulo mostra o % de aproveitamento do pasto (Produtivo 2 = 80%)', /80,00%\s*aproveit/.test(lerRotulo()));

  // Regressão do bug "o mapa vai diminuindo": marcar pasto e voltar pra aba Mapa
  // não pode reenquadrar (fitBounds) de novo — o zoom da pessoa tem que ficar de pé.
  const fitAntes = mapaMock._fitBounds;
  const zoomAntes = mapaMock.getZoom();
  doc.querySelector('nav button[data-aba="pastos"]').click();
  doc.querySelector('#corpo tr td.acao').click();
  doc.getElementById('fQtdAnimais').value = '45';
  doc.getElementById('fQtdAnimais').dispatchEvent(new w.Event('input'));
  doc.querySelector('button[onclick="salvarPasto()"]').click();
  doc.querySelector('nav button[data-aba="mapa"]').click();
  await esperar(150);
  checar('voltar pra aba Mapa não reenquadra sozinho (zoom preservado)', mapaMock._fitBounds === fitAntes && mapaMock.getZoom() === zoomAntes);
  checar('mas o rótulo acompanha o novo número de animais', /45\s*animais/.test(lerRotulo()));
  checar('o tamanho do container é remedido a cada volta pra aba', mapaMock._invalidateSize > 0);

  // "Enquadrar tudo" continua sendo o jeito de voltar pra fazenda inteira.
  w.enquadrarMapaTudo();
  checar('botão "Enquadrar tudo" reenquadra quando o usuário pede', mapaMock._fitBounds === fitAntes + 1);

  // Desligar os rótulos tira o texto do mapa (e liga de volta).
  w.alternarRotulosMapa(false);
  checar('rótulos podem ser desligados', !lerRotulo());
  w.alternarRotulosMapa(true);
  checar('e ligados de novo', /aproveit/.test(lerRotulo()));

  w.abrirCadastroDoTalhao(0);
  checar('clicar no talhão leva pro Cadastro', doc.getElementById('cadastros').classList.contains('ativa'));
  checar('área calculada do polígono preenchida', parseFloat(doc.getElementById('fArea').value) > 0);

  // ---- 7. Versões Salvas ----
  doc.querySelector('.nav-dropdown-btn').click();
  doc.querySelector('.nav-dropdown-menu button[data-subaba="sub-cliente"]').click();
  doc.getElementById('clNome').value = 'Cliente Smoke Test';
  doc.querySelector('button[onclick="salvarCliente()"]').click();
  doc.querySelector('nav button[data-aba="versoes"]').click();
  doc.getElementById('nomeVersaoNova').value = 'Versão de teste';
  doc.querySelector('button[onclick="salvarVersaoAtual()"]').click();
  checar('versão salva aparece na lista', doc.querySelectorAll('#listaVersoes .talhao-item').length >= 1);

  // ---- 8. Limpar Tudo realmente zera (não só volta pro exemplo) ----
  doc.querySelector('.nav-dropdown-btn').click();
  doc.querySelector('.nav-dropdown-menu button[data-subaba="sub-cliente"]').click();
  doc.getElementById('btnLimparDados').click();
  doc.querySelector('#confirmacaoLimpar button.perigo').click();
  checar('Limpar Tudo zera de verdade (0 pastos, não 106)', doc.getElementById('totalGeral').textContent === '0');

  console.log('\n' + (errors.length ? errors.join('\n---\n') : 'Nenhum erro de JS capturado.'));
  console.log('\n' + (falhas === 0 ? `TUDO OK (${8} blocos verificados)` : `${falhas} verificação(ões) falharam`));
  process.exit(falhas === 0 && errors.length === 0 ? 0 : 1);
}

main().catch(e => { console.error('EXCEÇÃO NO TESTE:', e.stack); process.exit(1); });
