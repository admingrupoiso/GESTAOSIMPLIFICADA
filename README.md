# GO On AGRO — Biblioteca de Prompts v5

Catálogo navegável de **15 prompts executáveis** para construir o sistema GO On AGRO v5
(precificação inteligente para consultoria técnica no agro), do esqueleto ao módulo comercial.

Abra `index.html` no navegador. Não há build, dependência nem servidor.

---

## O que foi feito

**1. Prompts reescritos em forma executável.**
Cada prompt deixou de descrever o que o módulo *é* e passou a ordenar o que deve ser *feito*.
O padrão é sempre o mesmo:

| Seção | Papel |
|---|---|
| Verbo no imperativo no título | *Crie*, *Implemente*, *Gere*, *Calcule* — nunca "sobre o módulo X" |
| `CONTEXTO` | Por que o módulo existe, em 2 ou 3 linhas (só quando muda a decisão técnica) |
| `EXECUTE, NESTA ORDEM` | Entregáveis numerados, cada um uma ação verificável |
| `CRITÉRIOS DE ACEITE` | Testes objetivos, com números concretos, que decidem se o passo terminou |

Os números dos critérios de aceite foram **conferidos por cálculo**, não estimados. Exemplos:
custo 100 + frete 10 + imposto 6% a preço 150 → MC 31 e MC% 20,7%; salário 3.000 com encargos
padrão de 53,77% → custo total ≈ R$ 4.613 e R$ 20,97/hora; fixos 10.000 com MC 30% → ponto de
equilíbrio contábil de R$ 33.333,33. As funções direta e inversa do motor (prompt 08) fecham em
ida e volta.

**2. Layout organizado na identidade do GOA v5.**
Mesmos design tokens do sistema original (creme `#f5f3ee`, dourado `#b8902a`/`#e8c86a`, grafite
`#1a1810`, DM Serif Display + Mulish), mesma sidebar escura de navegação, mesmos cards e heroes —
estruturado como diretório de prompts: blocos numerados, abas de categoria, variáveis
reutilizáveis, dor do usuário em citação e contador de progresso.

**3. Os 15 prompts, em 5 blocos, na ordem de dependência real do sistema.**

| # | Bloco | Prompt |
|---|---|---|
| 01 | Fundação | Crie a estrutura base, a navegação e os design tokens |
| 02 | Fundação | Implemente a camada de dados, a persistência e o backup |
| 03 | Fundação | Gere a biblioteca de componentes de interface |
| 04 | Cadastros | Crie a tabela e o CRUD de Produtos para Revenda |
| 05 | Cadastros | Crie a tabela e o CRUD de Serviços e Produtos Próprios |
| 06 | Cadastros | Implemente a Folha de Pagamento com encargos CLT parametrizáveis |
| 07 | Cadastros | Crie os cadastros de Despesas Fixas e de Clientes |
| 08 | Motor | Implemente o motor de cálculo de margem de contribuição |
| 09 | Motor | Gere as tabelas de Pricing com linhas Bruto e Líquido |
| 10 | Motor | Implemente a Precificação Inteligente bidirecional com rateio por mix |
| 11 | Análises | Implemente a Simulação de Resultados com totalizadores |
| 12 | Análises | Crie a Análise Individual comparando preço praticado e sugerido |
| 13 | Análises | Calcule o Ponto de Equilíbrio com DRE e diagnóstico automático |
| 14 | Comercial | Gere o módulo de Propostas Comerciais com prévia e impressão |
| 15 | Comercial | Crie o Dashboard, as Configurações e o Guia de Uso guiado |

A ordem importa: o prompt 08 é a fonte única de cálculo e os prompts 09 a 13 o consomem em vez
de reimplementar fórmula, que é justamente o defeito que os prompts antigos produziam.

---

## Variáveis reutilizáveis

Dez marcadores preenchidos **uma única vez** e injetados nos 15 prompts no momento de copiar:

`{EMPRESA}` `{SEGMENTO}` `{STACK}` `{PERSIST}` `{REGIME}`
`{ALIQUOTA}` `{PALETA}` `{TIPOGRAFIA}` `{MOEDA}` `{META}`

Campo em branco continua como `{MARCADOR}` no texto copiado, para ser completado depois.
O botão **Preencher exemplo** carrega os valores do GO On AGRO real.

## Recursos da página

- Busca em texto integral, **insensível a acento** (`equilibrio` encontra `equilíbrio`)
- Filtro por bloco, na sidebar e em abas
- Copiar prompt individual (já com as variáveis substituídas), baixar em `.md`, ou exportar a
  biblioteca inteira em um único Markdown
- Marcar prompt como executado, com barra de progresso
- Variáveis, progresso e filtros persistidos em `localStorage` (chave `goa5_prompts`)
- Responsivo até 390px, sem rolagem horizontal

## Estrutura

```
index.html              biblioteca de prompts
referencia/goa_v5.html  sistema GOA v5 original, usado como fonte dos módulos e das fórmulas
```

## Verificação

Testado em Chromium via Playwright: renderização dos 15 cards, filtro por bloco, busca com e sem
acento, substituição de variáveis, cópia para a área de transferência, progresso, persistência
após recarregar e ausência de overflow horizontal em 1440px e 390px. Aritmética dos critérios de
aceite conferida numericamente.
