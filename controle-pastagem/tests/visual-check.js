// Checagem em NAVEGADOR DE VERDADE (Chromium via Playwright) — o que o jsdom não pega:
// tamanho real do container, tiles do satélite, rótulo desenhado na tela.
//
// Não entra no `npm test` (precisa de rede pros CDNs e do Chromium instalado).
// Rodar:
//   npm install -D playwright && npx playwright install chromium
//   node tests/visual-check.js
// (num ambiente que já tenha Chromium: CHROMIUM_PATH=/caminho/do/chrome node tests/visual-check.js)
// Gera três PNGs em tests/saida-visual/ e imprime o resumo no terminal.
//
// O que ele prova, e que é o motivo de existir: depois de "ir marcando" pasto por
// pasto (ir pro Cadastro, salvar, voltar pro Mapa, N vezes), o mapa tem que
// continuar com o MESMO tamanho e o MESMO zoom que o usuário deixou.

const path = require('path');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('Playwright não está instalado. Rode:\n  npm install -D playwright && npx playwright install chromium');
  process.exit(1);
}

const JSZip = require('jszip');
const DIST = path.join(__dirname, '..', 'dist', 'controle-pastagem.html');
const SAIDA = path.join(__dirname, 'saida-visual');
const RODADAS_DE_MARCACAO = 4;

// Dois piquetes vizinhos, pra ver dois rótulos ao mesmo tempo.
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Fundo Fazenda</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
-47.100,-15.100,0 -47.088,-15.100,0 -47.088,-15.090,0 -47.100,-15.090,0 -47.100,-15.100,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Meio</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
-47.087,-15.100,0 -47.075,-15.100,0 -47.075,-15.090,0 -47.087,-15.090,0 -47.087,-15.100,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;

(async () => {
  if (!fs.existsSync(DIST)) { console.error('Rode ./build.sh antes.'); process.exit(1); }
  fs.mkdirSync(SAIDA, { recursive: true });

  const zip = new JSZip(); zip.file('doc.kml', KML);
  const kmzPath = path.join(SAIDA, 'fazenda-teste.kmz');
  fs.writeFileSync(kmzPath, await zip.generateAsync({ type: 'nodebuffer' }));

  // CHROMIUM_PATH serve pra ambientes que já têm um Chromium instalado fora do
  // Playwright (container de CI, por exemplo) — sem ele, usa o que o Playwright baixou.
  const opcoes = {};
  if (process.env.CHROMIUM_PATH) opcoes.executablePath = process.env.CHROMIUM_PATH;
  if (process.env.HTTPS_PROXY) { opcoes.proxy = { server: process.env.HTTPS_PROXY }; opcoes.args = ['--ignore-certificate-errors']; }
  const browser = await chromium.launch(opcoes);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });

  await page.goto('file://' + DIST);
  await page.waitForTimeout(4000); // CDNs (Leaflet/JSZip/togeojson)

  await page.click('.nav-dropdown-btn');
  await page.click('.nav-dropdown-menu button[data-subaba="sub-cliente"]');
  await page.click('button[onclick="carregarDadosExemplo()"]');

  // Animais e classificação nos módulos que o KML usa, pra o rótulo ter número.
  await page.evaluate(() => {
    todos().filter(r => r.modulo === 'Fundo Fazenda').slice(0, 2).forEach((r, i) => {
      r.qtdAnimais = 120; r.pesoMedio = 430; r.classificacao = i ? 'Produtivo 3' : 'Produtivo 2';
      recalc(r); edicoes[r.pasto] = r;
    });
    todos().filter(r => r.modulo === 'Meio').slice(0, 2).forEach(r => {
      r.qtdAnimais = 34; r.pesoMedio = 390; r.classificacao = 'Degradação 2';
      recalc(r); edicoes[r.pasto] = r;
    });
    persistir(); atualizarTudo();
  });

  await page.click('nav button[data-aba="mapa"]');
  await page.setInputFiles('#inputMapa', kmzPath);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(SAIDA, '1-mapa-carregado.png') });

  // O usuário dá um zoom onde vai trabalhar…
  await page.evaluate(() => leafletMap.setZoom(leafletMap.getZoom() + 2));
  await page.waitForTimeout(600);
  const antes = await page.evaluate(() => ({ zoom: leafletMap.getZoom(), tam: [leafletMap.getSize().x, leafletMap.getSize().y] }));
  const alturaAntes = await page.$eval('#mapaLeaflet', el => el.getBoundingClientRect().height);

  // …e sai marcando pasto por pasto.
  for (let i = 0; i < RODADAS_DE_MARCACAO; i++) {
    await page.click('nav button[data-aba="pastos"]');
    await page.waitForTimeout(150);
    await page.click('#corpo tr td.acao');
    await page.fill('#fQtdAnimais', String(100 + i));
    await page.click('button[onclick="salvarPasto()"]');
    await page.click('nav button[data-aba="mapa"]');
    await page.waitForTimeout(400);
  }

  const depois = await page.evaluate(() => ({ zoom: leafletMap.getZoom(), tam: [leafletMap.getSize().x, leafletMap.getSize().y] }));
  const alturaDepois = await page.$eval('#mapaLeaflet', el => el.getBoundingClientRect().height);
  await page.screenshot({ path: path.join(SAIDA, '2-depois-de-marcar.png') });
  await page.locator('#mapaLeaflet').screenshot({ path: path.join(SAIDA, '3-rotulos.png') });

  const rotulos = await page.$$eval('.leaflet-tooltip.rotulo-talhao', els => els.map(e => e.innerText.replace(/\n/g, ' · ')));

  // ---- O menu Cadastros aparece DE VERDADE, em toda largura de tela? ----------------
  // Teste de classe CSS não pega isto: o menu tinha a classe "aberto" e mesmo assim não
  // era desenhado, porque a <nav> tem overflow-x:auto e recortava o menu inteiro.
  const menu = [];
  for (const largura of [1280, 900, 600, 390]) {
    const p2 = await browser.newPage({ viewport: { width: largura, height: 800 } });
    await p2.goto('file://' + DIST);
    await p2.waitForTimeout(1500);
    await p2.click('.nav-dropdown-btn');
    await p2.waitForTimeout(200);
    const r = await p2.$eval('.nav-dropdown-menu', el => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    // O ponto onde o primeiro item do menu está desenhado devolve mesmo esse item?
    const alvo = await p2.evaluate(() => {
      const item = document.querySelector('.nav-dropdown-menu button[data-subaba="sub-pastos"]');
      const b = item.getBoundingClientRect();
      const emCima = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return emCima === item || item.contains(emCima);
    });
    const dentro = r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 &&
                   r.x + r.w <= largura && r.y + r.h <= 800;
    menu.push({ largura, dentroDaTela: dentro, itemClicavel: alvo });
    await p2.close();
  }

  await browser.close();

  const falhas = [];
  if (alturaAntes !== alturaDepois) falhas.push(`altura do container mudou: ${alturaAntes} -> ${alturaDepois}`);
  if (antes.zoom !== depois.zoom) falhas.push(`zoom mudou sozinho: ${antes.zoom} -> ${depois.zoom}`);
  if (antes.tam.join('x') !== depois.tam.join('x')) falhas.push(`área de desenho mudou: ${antes.tam.join('x')} -> ${depois.tam.join('x')}`);
  if (!rotulos.length) falhas.push('nenhum rótulo desenhado no mapa');
  if (rotulos.length && !rotulos.every(r => /animais/.test(r) && /(%|classificar)/.test(r)))
    falhas.push('rótulo sem animais e/ou aproveitamento: ' + JSON.stringify(rotulos));
  menu.forEach(m => {
    if (!m.dentroDaTela) falhas.push(`menu Cadastros fora da tela ou não desenhado em ${m.largura}px`);
    if (!m.itemClicavel) falhas.push(`item do menu Cadastros coberto/recortado em ${m.largura}px`);
  });
  if (erros.length) falhas.push('erros de JS: ' + erros.join(' | '));

  console.log(`container: ${alturaAntes}px -> ${alturaDepois}px`);
  console.log(`área de desenho: ${antes.tam.join('x')} -> ${depois.tam.join('x')}`);
  console.log(`zoom: ${antes.zoom} -> ${depois.zoom} (após ${RODADAS_DE_MARCACAO} marcações)`);
  console.log('rótulos: ' + JSON.stringify(rotulos, null, 1));
  console.log('menu Cadastros: ' + menu.map(m => `${m.largura}px ${m.dentroDaTela && m.itemClicavel ? 'ok' : 'FALHA'}`).join(' · '));
  console.log('imagens em ' + SAIDA);
  console.log(falhas.length ? '\nFALHOU:\n- ' + falhas.join('\n- ') : '\nTUDO OK — mapa não encolheu e os rótulos estão na tela.');
  process.exit(falhas.length ? 1 : 0);
})();
