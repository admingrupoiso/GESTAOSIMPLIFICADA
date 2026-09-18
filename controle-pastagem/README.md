# Controle de Pastagem — Go On Agro

Ferramenta HTML de gestão de pastagem: cadastro de pastos/piquetes, mapa (KMZ/KML) com
identificação de talhões, catálogo de produtos e cálculo de compra consolidada, taxa de
lotação (UA/ha), relatórios e versionamento de cenários. Nasceu como uma recriação fiel da
planilha `Controle de Pastagem — Fazenda Vista Alegre`, e evoluiu pra uma ferramenta de uso
geral (qualquer fazenda, qualquer KMZ).

Faz parte da suíte **Go On Agro**, do projeto **Consultor Agro 360°** (Renata Erler).

## Como abrir

`dist/controle-pastagem.html` é um arquivo único, autocontido — dá duplo-clique e abre em
qualquer navegador. Sem servidor, sem instalação. É esse arquivo (ou uma cópia renomeada
por versão, ex. `Controle_Pastagem_v13_2026-09-20.html`) que vai pro cliente.

## Por que dividido em `src/` se o produto final é um arquivo só?

Só por conveniência de edição. Nada aqui roda direto — sempre precisa `./build.sh` (ou
`npm run build`) pra virar o `dist/controle-pastagem.html` que é o que realmente abre no
navegador.

```
src/01-head.html   → <!DOCTYPE>, <head>, CSS (variáveis de tema, todos os componentes)
src/02-body.html   → <body>, header, nav, as 6 <section> (abas) com todo o HTML
src/03-data.js     → dado embutido: os 106 pastos originais da Vista Alegre (RAW_ROWS),
                     + as listas de referência da planilha (módulos, capins, classificação...)
src/04-app.js      → toda a lógica (o "app" em si)
```

`build.sh` só concatena os 4 nessa ordem, dentro de um `<script>`, fechando as tags no
fim. Nada mais sofisticado que isso — é: `cat 01 02 <script> 03 04 </script></body></html>`.

## Rodando localmente

```bash
npm install        # jsdom + jszip + togeojson + xlsx (só pra teste, nada disso vai pro produto final)
npm run build       # gera dist/controle-pastagem.html
npm test            # builda + roda tests/smoke-test.js
npm run test:visual # builda + abre num Chromium de verdade (precisa de playwright e de rede)
```

## Arquitetura de dados (o que precisa saber antes de mexer)

Tudo vive em `let`/`const` no topo de `04-app.js`, persistido como um JSON só em
`localStorage` (chave `controle_pastagem_vista_alegre_v1`). Os conceitos principais:

- **`baseRows`** — os 106 pastos originais da Vista Alegre (de `RAW_ROWS`, imutável).
- **`ocultarBase`** (bool) — se `true`, `baseRows` fica escondido de `todos()`. Instalação
  nova começa com isso `true` (ferramenta abre vazia). "Carregar Dados de Exemplo" desliga;
  "Limpar Tudo" liga de novo — é o que faz o botão zerar de verdade, não só reverter pro
  exemplo.
- **`edicoes`** — `{nomeDoPasto: objetoEditado}`, sobrescreve um pasto da base quando editado.
- **`extras`** — pastos novos (não fazem parte da base).
- **`todos()`** — a função que junta tudo isso: `(ocultarBase ? [] : baseRows com edicoes por cima) + extras`. É por onde TUDO passa — filtro, tabela, relatório, prova real (removida, ver Changelog), tudo lê daqui.
- **`catalogoProdutos`** / **`modulosRegistrados`** — cadastros próprios (produto e módulo
  não são mais só texto livre dentro do pasto).
- **`mapaProp`** — `{arquivoNome, kmlTexto, talhoes:[{nomeOriginal, nomeModulo, areaHa}], vista, mostrarRotulos}`.
  O KML cru fica salvo (não só o resultado do parse), pra poder re-renderizar o mapa sem
  precisar o usuário subir o arquivo de novo. `vista` é `{lat,lng,zoom}` — onde a pessoa
  parou de olhar; é o que faz o mapa voltar no mesmo enquadramento em vez de reenquadrar a
  fazenda inteira a cada marcação (ver v13 no Changelog). `mostrarRotulos` liga/desliga o
  rótulo fixo desenhado sobre cada talhão.
- **`filtros`** — os 6 filtros do Painel/Pastos (módulo, manejo, classificação, capim,
  aguada, cocho). Persistido junto — é o que faz "a visão do Painel valer no Relatório e
  nas Versões Salvas".
- **`versoesSalvas`** — array de `{nome, data, snapshot: <tudo acima>}`. Fica numa chave de
  `localStorage` separada (`controle_pastagem_versoes_v1`), pra não inflar o objeto principal.

## Identidade visual (não inventar de novo)

Variáveis CSS em `:root` (tema escuro, padrão) e `:root[data-tema="claro"]` (tema claro).
Fontes: Bebas Neue (títulos/números grandes), Inter (corpo). Dourado `#D4A820` como cor de
marca; semáforo de classificação (`CLASSIF_CORES` no JS) vai de vermelho (Degradação 3) a
verde escuro (Produtivo 4) — não é decoração, é convenção usada em vários lugares (tabela,
mapa, legenda do Painel).

## Bibliotecas externas (carregadas via CDN, não npm)

O produto final referencia isso via `<script src="https://cdn.jsdelivr.net/...">` dentro de
`01-head.html`, com fallback automático pra outro CDN se o principal falhar (ver
`carregarBibliotecaFallback` no topo do `<head>`), e espera educada (`aguardarBibliotecas`)
se o usuário abrir a aba Mapa antes delas terminarem de carregar:

- **Leaflet** 1.9.4 — mapa
- **JSZip** 3.10.2 — descompacta o KMZ (é um .zip)
- **@mapbox/togeojson** 0.16.2 — KML → GeoJSON
- **SheetJS (xlsx)** 0.18.5 — importação de planilha com mapeamento de coluna

Essas mesmas 4 (exceto Leaflet) são dependência real do `package.json` — usadas de
verdade nos testes (não mockadas), pra pegar bug de parsing de verdade.

## Testes

`tests/mock_leaflet.js` — um Leaflet falso o suficiente pra rodar a lógica do mapa fora de
um navegador real (jsdom não calcula layout, então não dá pra usar o Leaflet de verdade).
Expõe `L.__debug.{maps,tileLayers,geoJSONLayers}` pra inspecionar o que foi criado.

`tests/smoke-test.js` — sobe `dist/controle-pastagem.html` inteiro num DOM simulado e passa
pelos fluxos principais com **clique real** (não chamada de função direto). Duas pegadinhas
de jsdom que vale a pena ler no topo do arquivo antes de escrever um teste novo — resumo:
`runScripts:'outside-only'` não executa `onclick=""`, só `runScripts:'dangerously'` executa
de verdade (e aí precisa remover as `<script src>` externas antes, senão trava tentando
baixar).

`tests/visual-check.js` — checagem em **navegador de verdade** (Chromium via Playwright),
fora do `npm test` porque precisa de rede (os CDNs) e do Chromium instalado:
`npm install -D playwright && npx playwright install chromium && npm run test:visual`
(num ambiente que já tenha Chromium: `CHROMIUM_PATH=/caminho/do/chrome`). Ele mede o que o
jsdom não consegue medir — tamanho real do container e zoom depois de marcar pasto por
pasto — e salva três PNGs em `tests/saida-visual/` pra conferência a olho.

Esse smoke test cobre o caminho feliz das partes mais importantes, mas não é exaustivo —
ao longo do desenvolvimento foram escritos bem mais testes pontuais (import de planilha
com mapeamento de coluna incompleto, renomear módulo em cascata, tema persistindo,
fallback de CDN simulando falha de rede, etc.). Vale escrever um teste narrow sempre que
mexer numa função — o padrão acima (JSDOM + libs reais + Leaflet mockado + clique real)
seguiu se mostrando confiável o tempo todo.

## Changelog (resumo — contexto pra quem chegar agora)

- **v1–v3**: réplica fiel da planilha original (106 pastos, fórmulas de área útil por
  classificação), painel + relatório + cadastro + import de planilha com mapeamento manual
  de coluna.
- **v4–v6**: catálogo de produtos (Adubo/Calcário/Herbicida/Outros) substituindo os campos
  fixos de Calcário/MAP; UA e Taxa de Lotação (base 450 kg); aba Mapa (upload KMZ, renomear
  talhão, destaque cruzado tabela↔mapa); cores de manejo recriadas da formatação condicional
  oculta da planilha original; cadastro de Módulos como entidade própria (renomear em
  cascata); tema claro/escuro; Versões Salvas (snapshot nomeado + biblioteca exportável).
- **v7–v9**: correções de robustez — `confirm()`/`prompt()` nativos trocados por confirmação
  própria (alguns navegadores embutidos bloqueiam esses diálogos silenciosamente); malha de
  segurança CSS pro Leaflet (não desmontar se o `leaflet.css` externo falhar); fallback
  automático de tile de mapa (satélite → OpenStreetMap se der 6 falhas seguidas);
  `scrollIntoView` protegido (não existe em todo navegador); KMZ passou a aceitar
  `LineString` (cerca caminhada com GPS não é sempre um polígono fechado), descartando só
  pelo nome (`Medida da linha`) em vez de por tipo de geometria.
- **v10**: ferramenta deixou de vir com a Vista Alegre pré-carregada — abre vazia por
  padrão, com "Carregar Dados de Exemplo" opcional. "Limpar Tudo" passou a zerar de
  verdade (antes só descartava edições, a base nunca saía).
- **v11**: linha de cerca fechada (começa/termina quase no mesmo ponto) passou a ser
  pintada como área preenchida, não só contorno; legenda dos 4 gráficos de rosca do Painel
  virou HTML de verdade (clicável, filtra a tabela), substituindo o texto desenhado no
  canvas.
- **v12**: Painel voltou a ser a aba padrão; menu "Cadastros" suspenso agrupando
  Pastos/Módulos/Produtos/Cliente & Fazenda; filtro do Painel passou a persistir (localStorage
  + Versões Salvas + backup JSON); aba "Prova Real" removida; **clicar num talhão do mapa
  com área calculável já leva pro Cadastro** (edita o pasto existente daquele módulo, ou
  monta um rascunho novo com Módulo e Área — calculada por fórmula geodésica a partir do
  polígono — já preenchidos).

- **v13**: **o mapa parou de "ir diminuindo" enquanto a pessoa marca os pastos.** Antes,
  toda volta pra aba Mapa (e todo salvamento de pasto) recriava a camada de talhões e
  chamava `fitBounds` de novo — o zoom de trabalho ia embora a cada marcação, e quando o
  Leaflet ainda estava com a medida velha do container (aba que acabou de sair do
  `display:none`, janela redimensionada, teclado do celular fechando) o reenquadramento
  saía menor que o anterior, encolhendo o desenho de ida e volta em ida e volta. Agora:
  o enquadramento é preservado (guardado em `mapaProp.vista`), a camada só é recriada
  quando o arquivo muda de verdade (`assinaturaMapaDesenhado`), o tamanho é remedido em
  três momentos (agora, no próximo quadro e 120 ms depois) e um `ResizeObserver` avisa o
  Leaflet sempre que o container muda de altura; o container ganhou altura elástica com
  piso (`clamp` + `min-height`) e pode ser arrastado pra baixo pra aumentar. Reenquadrar
  virou ação explícita: botão **"Enquadrar tudo"**. Além disso, cada talhão passou a
  mostrar um **rótulo fixo em tamanho de legenda** com o nome do módulo, a **quantidade de
  animais** daquele lote e o **% de aproveitamento do pasto** (área útil ÷ área total —
  "a classificar" quando ainda não há classificação, em vez de um "0,00%" que faria o
  pasto parecer perdido); o detalhe completo, que antes era o tooltip do mouse, virou um
  quadro no canto do mapa (o Leaflet só aceita um tooltip por camada).

- **v14**: correções do que quebrava na mão do usuário. **O menu "Cadastros" não abria** —
  em nenhuma largura de tela: a `<nav>` tem `overflow-x:auto` (pra rolar no celular) e
  `overflow` recorta filho posicionado, então o menu, que era `position:absolute` dentro
  dela, era cortado inteiro. Virou `position:fixed`, encaixado embaixo do botão por
  `posicionarMenuCadastros()`, que também o segura dentro da tela no celular. Os testes de
  jsdom não pegavam isso porque olhavam classe CSS, não pixel — daí `tests/visual-check.js`
  ter ganhado uma checagem que pergunta ao navegador quem está desenhado naquele ponto.
  No mapa: `<MultiGeometry>` (Placemark com mais de uma parte) virava `GeometryCollection`
  e era descartado em silêncio — agora cada parte vira um talhão; KMZ com mais de um `.kml`
  dentro passou a ser lido por inteiro (antes só o primeiro encontrado); `NetworkLink` (o
  arquivo que só aponta pros desenhos, sem trazê-los) agora é explicado em vez de virar
  "nenhum talhão encontrado"; e abaixo do mapa entrou um resumo dizendo quantos desenhos
  viraram talhão e **quais ficaram de fora e por quê** — sumiço silencioso era a pior
  parte do problema. Os rótulos da v13 passaram a se esconder quando não cabem dentro do
  talhão na tela (com 50+ piquetes viravam uma parede de texto por cima do desenho) e
  linha/ponto solto só é rotulado quando tem animal lançado.

## Pendências conhecidas (não implementadas ainda)

- **Multi-fazenda / multi-cliente**: hoje é uma conta = uma fazenda por vez (via
  localStorage do navegador). Se a Renata for atender vários clientes, cada um precisa do
  próprio arquivo ou um "trocar de fazenda" dentro da mesma ferramenta — ainda não existe.
  Provavelmente é aqui que entra o backend (`agrodata.js`/MySQL) já usado nas outras
  ferramentas do Go On Agro.
- **Produtividade por capim** (Mombaça > Masai impactando lotação) — decidido explicitamente
  que fica de fora por enquanto (ver histórico de conversa).
- **Legenda clicável nos gráficos de barra** (Módulo, Capim) e na versão impressa do
  Relatório — só os 4 de rosca no Painel ficaram clicáveis; os de barra não têm uma
  "legenda" separada (cada barra já é o próprio rótulo), e a versão do Relatório ficou
  intencionalmente sem interação (é a versão "limpa" pra imprimir).
- Teste em navegador real cobre só o mapa (`tests/visual-check.js`, v13) e roda à parte. O
  resto da ferramenta continua verificado só por jsdom — bom pra bug de lógica, cego pra
  bug puramente visual/CSS fora do mapa.
