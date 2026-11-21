// Matriz de Referência do ENEM (Inep/MEC, publicada on-line em abril de 2026).
// "É permitida a reprodução total ou parcial desta publicação, desde que citada a fonte." Fonte: Inep/MEC.
// Dados extraídos do PDF oficial (58 páginas) por script e conferidos: 5 eixos cognitivos, 4 áreas,
// 30 competências de área, 120 habilidades (H1–H30 por área), 5 competências da redação e os
// objetos de conhecimento do anexo. Não altere o texto: ele reproduz o documento oficial.
export const ENEM_SOURCE = { title: 'Matrizes de Referência do ENEM', publisher: 'Inep/MEC', year: 2026, pdf: '/matrizes/enem-matriz-de-referencia-2026.pdf' };

export const ENEM_AXES = [
 {
  "id": "DL",
  "name": "Dominar linguagens",
  "text": "dominar a norma culta da língua portuguesa e fazer uso das linguagens matemática, artística e científica e das línguas espanhola e inglesa."
 },
 {
  "id": "CF",
  "name": "Compreender fenômenos",
  "text": "construir e aplicar conceitos das várias áreas do conhecimento para a compreensão de fenômenos naturais, de processos histórico-geográficos, da produção tecnológica e das manifestações artísticas."
 },
 {
  "id": "SP",
  "name": "Enfrentar situações-problema",
  "text": "selecionar, organizar, relacionar, interpretar dados e informações, representados de diferentes formas, para tomar decisões e enfrentar situações-problema."
 },
 {
  "id": "CA",
  "name": "Construir argumentação",
  "text": "relacionar informações, representadas em diferentes formas, e conhecimentos disponíveis em situações concretas, para construir argumentação consistente."
 },
 {
  "id": "EP",
  "name": "Elaborar propostas",
  "text": "recorrer aos conhecimentos desenvolvidos na escola para elaboração de propostas de intervenção solidária na realidade, respeitando os valores humanos e considerando a diversidade sociocultural."
 }
];

export const ENEM_AREAS = [
 {
  "id": "LC",
  "name": "Linguagens, Códigos e suas Tecnologias",
  "competencias": [
   {
    "n": 1,
    "text": "Aplicar as tecnologias da comunicação e da informação na escola, no trabalho e em outros contextos relevantes para sua vida.",
    "skills": [
     [
      "H1",
      "Identificar as diferentes linguagens e seus recursos expressivos como elementos de caracterização dos sistemas de comunicação."
     ],
     [
      "H2",
      "Recorrer aos conhecimentos sobre as linguagens dos sistemas de comunicação e informação para resolver problemas sociais."
     ],
     [
      "H3",
      "Relacionar informações geradas nos sistemas de comunicação e informação, considerando a função social desses sistemas."
     ],
     [
      "H4",
      "Reconhecer posições críticas aos usos sociais que são feitos das linguagens e dos sistemas de comunicação e informação."
     ]
    ]
   },
   {
    "n": 2,
    "text": "Conhecer e usar língua(s) estrangeira(s) moderna(s) como instrumento de acesso a informações e a outras culturas e grupos sociais.",
    "skills": [
     [
      "H5",
      "Associar vocábulos e expressões de um texto em LEM ao seu tema."
     ],
     [
      "H6",
      "Utilizar os conhecimentos da LEM e de seus mecanismos como meio de ampliar as possibilidades de acesso a informações, tecnologias e culturas."
     ],
     [
      "H7",
      "Relacionar um texto em LEM, as estruturas linguísticas, sua função e seu uso social."
     ],
     [
      "H8",
      "Reconhecer a importância da produção cultural em LEM como representação da diversidade cultural e linguística."
     ]
    ]
   },
   {
    "n": 3,
    "text": "Compreender e usar a linguagem corporal como relevante para a própria vida, integradora social e formadora da identidade.",
    "skills": [
     [
      "H9",
      "Reconhecer as manifestações corporais de movimento como originárias de necessidades cotidianas de um grupo social."
     ],
     [
      "H10",
      "Reconhecer a necessidade de transformação de hábitos corporais em função das necessidades cinestésicas."
     ],
     [
      "H11",
      "Reconhecer a linguagem corporal como meio de interação social, considerando os limites de desempenho e as alternativas de adaptação para diferentes indivíduos."
     ]
    ]
   },
   {
    "n": 4,
    "text": "Compreender a arte como saber cultural e estético gerador de significação e integrador da organização do mundo e da própria identidade.",
    "skills": [
     [
      "H12",
      "Reconhecer diferentes funções da arte, do trabalho da produção dos artistas em seus meios culturais."
     ],
     [
      "H13",
      "Analisar as diversas produções artísticas como meio de explicar diferentes culturas, padrões de beleza e preconceitos."
     ],
     [
      "H14",
      "Reconhecer o valor da diversidade artística e das inter-relações de elementos que se apresentam nas manifestações de vários grupos sociais e étnicos."
     ]
    ]
   },
   {
    "n": 5,
    "text": "Analisar, interpretar e aplicar recursos expressivos das linguagens, relacionando textos com seus contextos, mediante a natureza, função, organização, estrutura das manifestações, de acordo com as condições de produção e recepção.",
    "skills": [
     [
      "H15",
      "Estabelecer relações entre o texto literário e o momento de sua produção, situando aspectos do contexto histórico, social e político."
     ],
     [
      "H16",
      "Relacionar informações sobre concepções artísticas e procedimentos de construção do texto literário."
     ],
     [
      "H17",
      "Reconhecer a presença de valores sociais e humanos atualizáveis e permanentes no patrimônio literário nacional."
     ]
    ]
   },
   {
    "n": 6,
    "text": "Compreender e usar os sistemas simbólicos das diferentes linguagens como meios de organização cognitiva da realidade pela constituição de significados, expressão, comunicação e informação.",
    "skills": [
     [
      "H18",
      "Identificar os elementos que concorrem para a progressão temática e para a organização e estruturação de textos de diferentes gêneros e tipos."
     ],
     [
      "H19",
      "Analisar a função da linguagem predominante nos textos em situações específicas de interlocução."
     ],
     [
      "H20",
      "Reconhecer a importância do patrimônio linguístico para a preservação da memória e da identidade nacional."
     ]
    ]
   },
   {
    "n": 7,
    "text": "Confrontar opiniões e pontos de vista sobre as diferentes linguagens e suas manifestações específicas.",
    "skills": [
     [
      "H21",
      "Reconhecer, em textos de diferentes gêneros, recursos verbais e não verbais utilizados com a finalidade de criar e mudar comportamentos e hábitos."
     ],
     [
      "H22",
      "Relacionar, em diferentes textos, opiniões, temas, assuntos e recursos linguísticos."
     ],
     [
      "H23",
      "Inferir em um texto quais são os objetivos de seu produtor e quem é seu público-alvo, pela análise dos procedimentos argumentativos utilizados."
     ],
     [
      "H24",
      "Reconhecer no texto estratégias argumentativas empregadas para o convencimento do público, tais como a intimidação, sedução, comoção, chantagem, entre outras."
     ]
    ]
   },
   {
    "n": 8,
    "text": "Compreender e usar a língua portuguesa como língua materna, geradora de significação e integradora da organização do mundo e da própria identidade.",
    "skills": [
     [
      "H25",
      "Identificar, em textos de diferentes gêneros, as marcas linguísticas que singularizam as variedades linguísticas sociais, regionais e de registro."
     ],
     [
      "H26",
      "Relacionar as variedades linguísticas a situações específicas de uso social."
     ],
     [
      "H27",
      "Reconhecer os usos da norma-padrão da língua portuguesa nas diferentes situações de comunicação."
     ]
    ]
   },
   {
    "n": 9,
    "text": "Entender os princípios, a natureza, a função e o impacto das tecnologias da comunicação e da informação na sua vida pessoal e social, no desenvolvimento do conhecimento, associando-os aos conhecimentos científicos, às linguagens que lhes dão suporte, às demais tecnologias, aos processos de produção e aos problemas que se propõem solucionar.",
    "skills": [
     [
      "H28",
      "Reconhecer a função e o impacto social das diferentes tecnologias da comunicação e informação."
     ],
     [
      "H29",
      "Identificar, pela análise de suas linguagens, as tecnologias da comunicação e informação."
     ],
     [
      "H30",
      "Relacionar as tecnologias de comunicação e informação ao desenvolvimento das sociedades e ao conhecimento que elas produzem."
     ]
    ]
   }
  ],
  "objetos": [
   {
    "disciplina": null,
    "tema": "Estudo do texto: as sequências discursivas e os gêneros textuais no sistema de comunicação e informação",
    "itens": [
     "Modos de organização da composição textual",
     "Atividades de produção escrita e de leitura de textos gerados nas diferentes esferas sociais — públicas e privadas"
    ]
   },
   {
    "disciplina": null,
    "tema": "Estudo das práticas corporais: a linguagem corporal como integradora social e formadora de identidade",
    "itens": [
     "Performance corporal e identidades juvenis",
     "Possibilidades de vivência crítica e emancipada do lazer",
     "Mitos e verdades sobre os corpos masculino e feminino na sociedade atual",
     "Exercício físico e saúde",
     "Corpo e expressão artística e cultural",
     "O corpo no mundo dos símbolos e como produção da cultura",
     "Práticas corporais e autonomia",
     "Condicionamentos e esforços físicos",
     "O esporte",
     "A dança",
     "As lutas",
     "Os jogos",
     "As brincadeiras"
    ]
   },
   {
    "disciplina": null,
    "tema": "Produção e recepção de textos artísticos: interpretação e representação do mundo para o fortalecimento dos processos de identidade e cidadania",
    "itens": [
     "Artes Visuais: estrutura morfológica, sintática, o contexto da obra artística, o contexto da comunidade",
     "Teatro: estrutura morfológica, sintática, o contexto da obra artística, o contexto da comunidade, as fontes de criação",
     "Música: estrutura morfológica, sintática, o contexto da obra artística, o contexto da comunidade, as fontes de criação",
     "Dança: estrutura morfológica, sintática, o contexto da obra artística, o contexto da comunidade, as fontes de criação",
     "Conteúdos estruturantes das linguagens artísticas (Artes Visuais, Dança, Música, Teatro), elaborados a partir de suas estruturas morfológicas e sintáticas",
     "Inclusão, diversidade e multiculturalidade: a valorização da pluralidade expressada nas produções estéticas e artísticas das minorias sociais e das pessoas com deficiência"
    ]
   },
   {
    "disciplina": null,
    "tema": "Estudo do texto literário: relações entre produção literária e processo social, concepções artísticas, procedimentos de construção e recepção de textos",
    "itens": [
     "Produção literária e processo social",
     "Processos de formação literária e de formação nacional",
     "Produção de textos literários, sua recepção e a constituição do patrimônio literário nacional",
     "Relações entre a dialética cosmopolitismo/localismo e a produção literária nacional",
     "Elementos de continuidade e ruptura entre os diversos momentos da literatura brasileira",
     "Associações entre concepções artísticas e procedimentos de construção do texto literário em seus gêneros (épico/narrativo, lírico e dramático) e formas diversas",
     "Articulações entre os recursos expressivos e estruturais do texto literário e o processo social relacionado ao momento de sua produção",
     "Representação literária: natureza, função, organização e estrutura do texto literário",
     "Relações entre literatura, outras artes e outros saberes"
    ]
   },
   {
    "disciplina": null,
    "tema": "Estudo dos aspectos linguísticos em diferentes textos: recursos expressivos da língua, procedimentos de construção e recepção de textos",
    "itens": [
     "Organização da macroestrutura semântica e a articulação entre ideias e proposições (relações lógico-semânticas)"
    ]
   },
   {
    "disciplina": null,
    "tema": "Estudo do texto argumentativo, seus gêneros e recursos linguísticos: argumentação — tipo, gêneros e usos em Língua Portuguesa",
    "itens": [
     "Formas de apresentação de diferentes pontos de vista",
     "Organização e progressão textual",
     "Papéis sociais e comunicativos dos interlocutores, relação entre usos e propósitos comunicativos, função sociocomunicativa do gênero, aspectos da dimensão espaçotemporal em que se produz o texto"
    ]
   },
   {
    "disciplina": null,
    "tema": "Estudo dos aspectos linguísticos da Língua Portuguesa: usos da língua — norma culta e variação linguística",
    "itens": [
     "Uso dos recursos linguísticos em relação ao contexto em que o texto é constituído: elementos de referência pessoal, temporal, espacial, registro linguístico, grau de formalidade, seleção lexical, tempos e modos verbais",
     "Uso dos recursos linguísticos em processo de coesão textual: elementos de articulação das sequências dos textos ou à construção da microestrutura do texto"
    ]
   },
   {
    "disciplina": null,
    "tema": "Estudo dos gêneros digitais: tecnologia da comunicação e informação — impacto e função social",
    "itens": [
     "Texto literário típico da cultura de massa: o suporte textual em gêneros digitais",
     "Caracterização dos interlocutores na comunicação tecnológica",
     "Recursos linguísticos e os gêneros digitais",
     "Função social das novas tecnologias"
    ]
   }
  ]
 },
 {
  "id": "MT",
  "name": "Matemática e suas Tecnologias",
  "competencias": [
   {
    "n": 1,
    "text": "Construir significados para os números naturais, inteiros, racionais e reais.",
    "skills": [
     [
      "H1",
      "Reconhecer, no contexto social, diferentes significados e representações dos números e operações — naturais, inteiros, racionais ou reais."
     ],
     [
      "H2",
      "Identificar padrões numéricos ou princípios de contagem."
     ],
     [
      "H3",
      "Resolver situação-problema envolvendo conhecimentos numéricos."
     ],
     [
      "H4",
      "Avaliar a razoabilidade de um resultado numérico na construção de argumentos sobre afirmações quantitativas."
     ],
     [
      "H5",
      "Avaliar propostas de intervenção na realidade utilizando conhecimentos numéricos."
     ]
    ]
   },
   {
    "n": 2,
    "text": "Utilizar o conhecimento geométrico para realizar a leitura e a representação da realidade e agir sobre ela.",
    "skills": [
     [
      "H6",
      "Interpretar a localização e a movimentação de pessoas/objetos no espaço tridimensional e sua representação no espaço bidimensional."
     ],
     [
      "H7",
      "Identificar características de figuras planas ou espaciais."
     ],
     [
      "H8",
      "Resolver situação-problema que envolva conhecimentos geométricos de espaço e forma."
     ],
     [
      "H9",
      "Utilizar conhecimentos geométricos de espaço e forma na seleção de argumentos propostos como solução de problemas do cotidiano."
     ]
    ]
   },
   {
    "n": 3,
    "text": "Construir noções de grandezas e medidas para a compreensão da realidade e a solução de problemas do cotidiano.",
    "skills": [
     [
      "H10",
      "Identificar relações entre grandezas e unidades de medida."
     ],
     [
      "H11",
      "Utilizar a noção de escalas na leitura de representação de situação do cotidiano."
     ],
     [
      "H12",
      "Resolver situação-problema que envolva medidas de grandezas."
     ],
     [
      "H13",
      "Avaliar o resultado de uma medição na construção de um argumento consistente."
     ],
     [
      "H14",
      "Avaliar proposta de intervenção na realidade utilizando conhecimentos geométricos relacionados a grandezas e medidas."
     ]
    ]
   },
   {
    "n": 4,
    "text": "Construir noções de variação de grandezas para a compreensão da realidade e a solução de problemas do cotidiano.",
    "skills": [
     [
      "H15",
      "Identificar a relação de dependência entre grandezas."
     ],
     [
      "H16",
      "Resolver situação-problema envolvendo a variação de grandezas, direta ou inversamente proporcionais."
     ],
     [
      "H17",
      "Analisar informações envolvendo a variação de grandezas como recurso para a construção de argumentação."
     ],
     [
      "H18",
      "Avaliar propostas de intervenção na realidade envolvendo variação de grandezas."
     ]
    ]
   },
   {
    "n": 5,
    "text": "Modelar e resolver problemas que envolvem variáveis socioeconômicas ou técnico-científicas, usando representações algébricas.",
    "skills": [
     [
      "H19",
      "Identificar representações algébricas que expressem a relação entre grandezas."
     ],
     [
      "H20",
      "Interpretar gráfico cartesiano que represente relações entre grandezas."
     ],
     [
      "H21",
      "Resolver situação-problema cuja modelagem envolva conhecimentos algébricos."
     ],
     [
      "H22",
      "Utilizar conhecimentos algébricos/geométricos como recurso para a construção de argumentação."
     ],
     [
      "H23",
      "Avaliar propostas de intervenção na realidade utilizando conhecimentos algébricos."
     ]
    ]
   },
   {
    "n": 6,
    "text": "Interpretar informações de natureza científica e social obtidas da leitura de gráficos e tabelas, realizando previsão de tendência, extrapolação, interpolação e interpretação.",
    "skills": [
     [
      "H24",
      "Utilizar informações expressas em gráficos ou tabelas para fazer inferências."
     ],
     [
      "H25",
      "Resolver problema com dados apresentados em tabelas ou gráficos."
     ],
     [
      "H26",
      "Analisar informações expressas em gráficos ou tabelas como recurso para a construção de argumentos."
     ]
    ]
   },
   {
    "n": 7,
    "text": "Compreender o caráter aleatório e não determinístico dos fenômenos naturais e sociais, e utilizar instrumentos adequados para medidas, determinação de amostras e cálculos de probabilidade para interpretar informações de variáveis apresentadas em uma distribuição estatística.",
    "skills": [
     [
      "H27",
      "Calcular medidas de tendência central ou de dispersão de um conjunto de dados expressos em uma tabela de frequências de dados agrupados (não em classes) ou em gráficos."
     ],
     [
      "H28",
      "Resolver situação-problema que envolva conhecimentos de estatística e probabilidade."
     ],
     [
      "H29",
      "Utilizar conhecimentos de estatística e probabilidade como recurso para a construção de argumentação."
     ],
     [
      "H30",
      "Avaliar propostas de intervenção na realidade utilizando conhecimentos de estatística e probabilidade."
     ]
    ]
   }
  ],
  "objetos": [
   {
    "disciplina": null,
    "tema": "Conhecimentos numéricos",
    "itens": [
     "Operações em conjuntos numéricos (naturais, inteiros, racionais e reais)",
     "Desigualdades, divisibilidade, fatoração, razões e proporções, porcentagem e juros",
     "Relações de dependência entre grandezas, sequências e progressões, princípios de contagem"
    ]
   },
   {
    "disciplina": null,
    "tema": "Conhecimentos geométricos",
    "itens": [
     "Características das figuras geométricas planas e espaciais",
     "Grandezas, unidades de medida e escalas",
     "Comprimentos, áreas e volumes",
     "Ângulos",
     "Posições de retas",
     "Simetrias de figuras planas ou espaciais",
     "Congruência e semelhança de triângulos",
     "Teorema de Tales",
     "Relações métricas nos triângulos",
     "Circunferências",
     "Trigonometria do ângulo agudo"
    ]
   },
   {
    "disciplina": null,
    "tema": "Conhecimentos de estatística e probabilidade",
    "itens": [
     "Representação e análise de dados",
     "Medidas de tendência central (médias, moda e mediana)",
     "Desvios e variância",
     "Noções de probabilidade"
    ]
   },
   {
    "disciplina": null,
    "tema": "Conhecimentos algébricos",
    "itens": [
     "Gráficos e funções",
     "Funções algébricas do 1º e do 2º graus, polinomiais, racionais, exponenciais e logarítmicas",
     "Equações e inequações",
     "Relações no ciclo trigonométrico e funções trigonométricas"
    ]
   },
   {
    "disciplina": null,
    "tema": "Conhecimentos algébricos/geométricos",
    "itens": [
     "Plano cartesiano",
     "Retas",
     "Circunferências",
     "Paralelismo e perpendicularidade, sistemas de equações"
    ]
   }
  ]
 },
 {
  "id": "CN",
  "name": "Ciências da Natureza e suas Tecnologias",
  "competencias": [
   {
    "n": 1,
    "text": "Compreender as ciências naturais e as tecnologias a elas associadas como construções humanas, percebendo seus papéis nos processos de produção e no desenvolvimento econômico e social da humanidade.",
    "skills": [
     [
      "H1",
      "Reconhecer características ou propriedades de fenômenos ondulatórios ou oscilatórios, relacionando-os a seus usos em diferentes contextos."
     ],
     [
      "H2",
      "Associar a solução de problemas de comunicação, transporte, saúde ou outro, com o correspondente desenvolvimento científico e tecnológico."
     ],
     [
      "H3",
      "Confrontar interpretações científicas com interpretações baseadas no senso comum, ao longo do tempo ou em diferentes culturas."
     ],
     [
      "H4",
      "Avaliar propostas de intervenção no ambiente, considerando a qualidade da vida humana ou as medidas de conservação, recuperação ou utilização sustentável da biodiversidade."
     ]
    ]
   },
   {
    "n": 2,
    "text": "Identificar a presença e aplicar as tecnologias associadas às ciências naturais em diferentes contextos.",
    "skills": [
     [
      "H5",
      "Dimensionar circuitos ou dispositivos elétricos de uso cotidiano."
     ],
     [
      "H6",
      "Relacionar informações para compreender manuais de instalação ou utilização de aparelhos ou sistemas tecnológicos de uso comum."
     ],
     [
      "H7",
      "Selecionar testes de controle, parâmetros ou critérios para a comparação de materiais e produtos, tendo em vista a defesa do consumidor, a saúde do trabalhador ou a qualidade de vida."
     ]
    ]
   },
   {
    "n": 3,
    "text": "Associar intervenções que resultam em degradação ou conservação ambiental a processos produtivos e sociais e a instrumentos ou ações científico-tecnológicos.",
    "skills": [
     [
      "H8",
      "Identificar etapas em processos de obtenção, transformação, utilização ou reciclagem de recursos naturais, energéticos ou matérias-primas, considerando processos biológicos, químicos ou físicos neles envolvidos."
     ],
     [
      "H9",
      "Compreender a importância dos ciclos biogeoquímicos ou do fluxo de energia para a vida ou da ação de agentes ou fenômenos que possam causar alterações nesses processos."
     ],
     [
      "H10",
      "Analisar perturbações ambientais, identificando fontes, transporte e(ou) destino dos poluentes ou prevendo efeitos em sistemas naturais, produtivos ou sociais."
     ],
     [
      "H11",
      "Reconhecer benefícios, limitações e aspectos éticos da biotecnologia, considerando estruturas e processos biológicos envolvidos em produtos biotecnológicos."
     ],
     [
      "H12",
      "Avaliar impactos em ambientes naturais decorrentes de atividades sociais ou econômicas, considerando interesses contraditórios."
     ]
    ]
   },
   {
    "n": 4,
    "text": "Compreender interações entre organismos e ambiente, em particular aquelas relacionadas à saúde humana, relacionando conhecimentos científicos, aspectos culturais e características individuais.",
    "skills": [
     [
      "H13",
      "Reconhecer mecanismos de transmissão da vida, prevendo ou explicando a manifestação de características dos seres vivos."
     ],
     [
      "H14",
      "Identificar padrões em fenômenos e processos vitais dos organismos, como manutenção do equilíbrio interno, defesa, relações com o ambiente, sexualidade, entre outros."
     ],
     [
      "H15",
      "Interpretar modelos e experimentos para explicar fenômenos ou processos biológicos em qualquer nível de organização dos sistemas biológicos."
     ],
     [
      "H16",
      "Compreender o papel da evolução na produção de padrões, processos biológicos ou na organização taxonômica dos seres vivos."
     ]
    ]
   },
   {
    "n": 5,
    "text": "Entender métodos e procedimentos próprios das ciências naturais e aplicá-los em diferentes contextos.",
    "skills": [
     [
      "H17",
      "Relacionar informações apresentadas em diferentes formas de linguagem e representação usadas nas ciências físicas, químicas ou biológicas, como texto discursivo, gráficos, tabelas, relações matemáticas ou linguagem simbólica."
     ],
     [
      "H18",
      "Relacionar propriedades físicas, químicas ou biológicas de produtos, sistemas ou procedimentos tecnológicos às finalidades a que se destinam."
     ],
     [
      "H19",
      "Avaliar métodos, processos ou procedimentos das ciências naturais que contribuam para diagnosticar ou solucionar problemas de ordem social, econômica ou ambiental."
     ]
    ]
   },
   {
    "n": 6,
    "text": "Apropriar-se de conhecimentos da física para, em situações-problema, interpretar, avaliar ou planejar intervenções científico-tecnológicas.",
    "skills": [
     [
      "H20",
      "Caracterizar causas ou efeitos dos movimentos de partículas, substâncias, objetos ou corpos celestes."
     ],
     [
      "H21",
      "Utilizar leis físicas e(ou) químicas para interpretar processos naturais ou tecnológicos inseridos no contexto da termodinâmica e(ou) do eletromagnetismo."
     ],
     [
      "H22",
      "Compreender fenômenos decorrentes da interação entre a radiação e a matéria em suas manifestações em processos naturais ou tecnológicos, ou em suas implicações biológicas, sociais, econômicas ou ambientais."
     ],
     [
      "H23",
      "Avaliar possibilidades de geração, uso ou transformação de energia em ambientes específicos, considerando implicações éticas, ambientais, sociais e(ou) econômicas."
     ]
    ]
   },
   {
    "n": 7,
    "text": "Apropriar-se de conhecimentos da química para, em situações-problema, interpretar, avaliar ou planejar intervenções científico-tecnológicas.",
    "skills": [
     [
      "H24",
      "Utilizar códigos e nomenclatura da química para caracterizar materiais, substâncias ou transformações químicas."
     ],
     [
      "H25",
      "Caracterizar materiais ou substâncias, identificando etapas, rendimentos ou implicações biológicas, sociais, econômicas ou ambientais de sua obtenção ou produção."
     ],
     [
      "H26",
      "Avaliar implicações sociais, ambientais e(ou) econômicas na produção ou no consumo de recursos energéticos ou minerais, identificando transformações químicas ou de energia envolvidas nesses processos."
     ],
     [
      "H27",
      "Avaliar propostas de intervenção no meio ambiente aplicando conhecimentos químicos, observando riscos ou benefícios."
     ]
    ]
   },
   {
    "n": 8,
    "text": "Apropriar-se de conhecimentos da biologia para, em situações-problema, interpretar, avaliar ou planejar intervenções científico-tecnológicas.",
    "skills": [
     [
      "H28",
      "Associar características adaptativas dos organismos com seu modo de vida ou com seus limites de distribuição em diferentes ambientes, em especial em ambientes brasileiros."
     ],
     [
      "H29",
      "Interpretar experimentos ou técnicas que utilizam seres vivos, analisando implicações para o ambiente, a saúde, a produção de alimentos, as matérias-primas ou os produtos industriais."
     ],
     [
      "H30",
      "Avaliar propostas de alcance individual ou coletivo, identificando aquelas que visam à preservação e à implementação da saúde individual, coletiva ou do ambiente."
     ]
    ]
   }
  ],
  "objetos": [
   {
    "disciplina": "Física",
    "tema": "Conhecimentos básicos e fundamentais",
    "itens": [
     "Noções de ordem de grandeza",
     "Notação Científica",
     "Sistema Internacional de Unidades",
     "Metodologia de investigação: a procura de regularidades e de sinais na interpretação física do mundo",
     "Observações e mensurações: representação de grandezas físicas como grandezas mensuráveis",
     "Ferramentas básicas: gráficos e vetores",
     "Conceituação de grandezas vetoriais e escalares",
     "Operações básicas com vetores"
    ]
   },
   {
    "disciplina": "Física",
    "tema": "O movimento, o equilíbrio e a descoberta de leis físicas",
    "itens": [
     "Grandezas fundamentais da mecânica: tempo, espaço, velocidade e aceleração",
     "Relação histórica entre força e movimento",
     "Descrições do movimento e sua interpretação: quantificação do movimento e sua descrição matemática e gráfica",
     "Casos especiais de movimentos e suas regularidades observáveis",
     "Conceito de inércia",
     "Noção de sistemas de referência inerciais e não inerciais",
     "Noção dinâmica de massa e quantidade de movimento (momento linear)",
     "Força e variação da quantidade de movimento",
     "Leis de Newton",
     "Centro de massa e a ideia de ponto material",
     "Conceito de forças externas e internas",
     "Lei da conservação da quantidade de movimento (momento linear) e teorema do impulso",
     "Momento de uma força (torque)",
     "Condições de equilíbrio estático de ponto material e de corpos rígidos",
     "Força de atrito, força peso, força normal de contato e tração",
     "Diagramas de forças",
     "Identificação das forças que atuam nos movimentos circulares",
     "Noção de força centrípeta e sua quantificação",
     "A hidrostática: aspectos históricos e variáveis relevantes",
     "Empuxo",
     "Princípios de Pascal, Arquimedes e Stevin: condições de flutuação, relação entre diferença de nível e pressão hidrostática"
    ]
   },
   {
    "disciplina": "Física",
    "tema": "Energia, trabalho e potência",
    "itens": [
     "Conceituação de trabalho, energia e potência",
     "Conceito de energia potencial e de energia cinética",
     "Conservação de energia mecânica e dissipação de energia",
     "Trabalho da força gravitacional e energia potencial gravitacional",
     "Forças conservativas e dissipativas"
    ]
   },
   {
    "disciplina": "Física",
    "tema": "A Mecânica e o funcionamento do Universo",
    "itens": [
     "Força peso",
     "Aceleração gravitacional",
     "Lei da Gravitação Universal",
     "Leis de Kepler",
     "Movimentos de corpos celestes",
     "Influência na Terra: marés e variações climáticas",
     "Concepções históricas sobre a origem do universo e sua evolução"
    ]
   },
   {
    "disciplina": "Física",
    "tema": "Fenômenos Elétricos e Magnéticos",
    "itens": [
     "Carga elétrica e corrente elétrica",
     "Lei de Coulomb",
     "Campo elétrico e potencial elétrico",
     "Linhas de campo",
     "Superfícies equipotenciais",
     "Poder das pontas",
     "Blindagem",
     "Capacitores",
     "Efeito Joule",
     "Lei de Ohm",
     "Resistência elétrica e resistividade",
     "Relações entre grandezas elétricas: tensão, corrente, potência e energia",
     "Circuitos elétricos simples",
     "Correntes contínua e alternada",
     "Medidores elétricos",
     "Representação gráfica de circuitos",
     "Símbolos convencionais",
     "Potência e consumo de energia em dispositivos elétricos",
     "Campo magnético",
     "Imãs permanentes",
     "Linhas de campo magnético",
     "Campo magnético terrestre"
    ]
   },
   {
    "disciplina": "Física",
    "tema": "Oscilações, ondas, óptica e radiação",
    "itens": [
     "Feixes e frentes de ondas",
     "Reflexão e refração",
     "Óptica geométrica: lentes e espelhos",
     "Formação de imagens",
     "Instrumentos ópticos simples",
     "Fenômenos ondulatórios",
     "Pulsos e ondas",
     "Período, frequência, ciclo",
     "Propagação: relação entre velocidade, frequência e comprimento de onda",
     "Ondas em diferentes meios de propagação"
    ]
   },
   {
    "disciplina": "Física",
    "tema": "O calor e os fenômenos térmicos",
    "itens": [
     "Conceitos de calor e de temperatura",
     "Escalas termométricas",
     "Transferência de calor e equilíbrio térmico",
     "Capacidade calorífica e calor específico",
     "Condução do calor",
     "Dilatação térmica",
     "Mudanças de estado físico e calor latente de transformação",
     "Comportamento de gases ideais",
     "Máquinas térmicas",
     "Ciclo de Carnot",
     "Leis da Termodinâmica",
     "Aplicações e fenômenos térmicos de uso cotidiano",
     "Compreensão de fenômenos climáticos relacionados ao ciclo da água"
    ]
   },
   {
    "disciplina": "Química",
    "tema": "Transformações químicas",
    "itens": [
     "Evidências de transformações químicas",
     "Interpretando transformações químicas",
     "Sistemas Gasosos: Lei dos gases",
     "Equação geral dos gases ideais, Princípio de Avogadro, conceito de molécula",
     "Massa molar, volume molar dos gases",
     "Teoria cinética dos gases",
     "Misturas gasosas",
     "Modelo corpuscular da matéria",
     "Modelo atômico de Dalton",
     "Natureza elétrica da matéria: Modelo Atômico de Thomson, Rutherford, Rutherford-Bohr",
     "Átomos e sua estrutura",
     "Número atômico, número de massa, isótopos, massa atômica",
     "Elementos químicos e Tabela Periódica",
     "Reações químicas"
    ]
   },
   {
    "disciplina": "Química",
    "tema": "Representação das transformações químicas",
    "itens": [
     "Fórmulas químicas",
     "Balanceamento de equações químicas",
     "Aspectos quantitativos das transformações químicas",
     "Leis ponderais das reações químicas",
     "Determinação de fórmulas químicas",
     "Grandezas Químicas: massa, volume, mol, massa molar, constante de Avogadro",
     "Cálculos estequiométricos"
    ]
   },
   {
    "disciplina": "Química",
    "tema": "Materiais, suas propriedades e usos",
    "itens": [
     "Propriedades de materiais",
     "Estados físicos de materiais",
     "Mudanças de estado",
     "Misturas: tipos e métodos de separação",
     "Substâncias químicas: classificação e características gerais",
     "Metais e Ligas metálicas",
     "Ferro, cobre e alumínio",
     "Ligações metálicas",
     "Substâncias iônicas: características e propriedades",
     "Substâncias iônicas do grupo: cloreto, carbonato, nitrato e sulfato",
     "Ligação iônica",
     "Substâncias moleculares: características e propriedades",
     "Substâncias moleculares: H2, O2, N2, Cl2, NH3, H2O, HCl, CH4",
     "Ligação Covalente",
     "Polaridade de moléculas",
     "Forças intermoleculares",
     "Relação entre estruturas, propriedade e aplicação das substâncias"
    ]
   },
   {
    "disciplina": "Química",
    "tema": "Água",
    "itens": [
     "Ocorrência e importância na vida animal e vegetal",
     "Ligação, estrutura e propriedades",
     "Sistemas em Solução Aquosa: soluções verdadeiras, soluções coloidais e suspensões",
     "Solubilidade",
     "Concentração das soluções",
     "Aspectos qualitativos das propriedades coligativas das soluções",
     "Ácidos, bases, sais e óxidos: definição, classificação, propriedades, formulação e nomenclatura",
     "Conceitos de ácidos e base",
     "Principais propriedades dos ácidos e bases: indicadores, condutibilidade elétrica, reação com metais, reação de neutralização"
    ]
   },
   {
    "disciplina": "Química",
    "tema": "Transformações químicas e energia",
    "itens": [
     "Transformações químicas e energia calorífica",
     "Calor de reação",
     "Entalpia",
     "Equações termoquímicas",
     "Lei de Hess",
     "Transformações químicas e energia elétrica",
     "Reação de oxirredução",
     "Potenciais padrão de redução",
     "Pilha",
     "Eletrólise",
     "Leis de Faraday",
     "Transformações nucleares",
     "Conceitos fundamentais da radioatividade",
     "Reações de fissão e fusão nuclear",
     "Desintegração radioativa e radioisótopos"
    ]
   },
   {
    "disciplina": "Química",
    "tema": "Dinâmica das transformações químicas",
    "itens": [
     "Transformações químicas e velocidade",
     "Velocidade de reação",
     "Energia de ativação",
     "Fatores que alteram a velocidade de reação: concentração, pressão, temperatura e catalisador"
    ]
   },
   {
    "disciplina": "Química",
    "tema": "Transformação Química e Equilíbrio",
    "itens": [
     "Caracterização do sistema em equilíbrio",
     "Constante de equilíbrio",
     "Produto iônico da água, equilíbrio ácido-base e pH",
     "Solubilidade dos sais e hidrólise",
     "Fatores que alteram o sistema em equilíbrio",
     "Aplicação da velocidade e do equilíbrio químico no cotidiano"
    ]
   },
   {
    "disciplina": "Química",
    "tema": "Compostos de Carbono",
    "itens": [
     "Características gerais dos compostos orgânicos",
     "Principais funções orgânicas",
     "Estrutura e propriedades de Hidrocarbonetos",
     "Estrutura e propriedades de compostos orgânicos oxigenados",
     "Fermentação",
     "Estrutura e propriedades de compostos orgânicos nitrogenados",
     "Macromoléculas naturais e sintéticas",
     "Noções básicas sobre polímeros",
     "Amido, glicogênio e celulose",
     "Borracha natural e sintética",
     "Polietileno, poliestireno, PVC, Teflon, náilon",
     "Óleos e gorduras, sabões e detergentes sintéticos",
     "Proteínas e enzimas"
    ]
   },
   {
    "disciplina": "Química",
    "tema": "Relações da Química com as tecnologias, a sociedade e o meio ambiente",
    "itens": [
     "Química no cotidiano",
     "Química na agricultura e na saúde",
     "Química nos alimentos",
     "Química e ambiente",
     "Aspectos científico-tecnológicos, socioeconômicos e ambientais associados à obtenção ou produção de substâncias químicas",
     "Indústria química: obtenção e utilização do cloro, hidróxido de sódio, ácido sulfúrico, amônia e ácido nítrico",
     "Mineração e metalurgia",
     "Poluição e tratamento de água",
     "Poluição atmosférica",
     "Contaminação e proteção do ambiente"
    ]
   },
   {
    "disciplina": "Química",
    "tema": "Energias químicas no cotidiano",
    "itens": [
     "Petróleo, gás natural e carvão",
     "Madeira e hulha",
     "Biomassa",
     "Biocombustíveis",
     "Impactos ambientais de combustíveis fósseis",
     "Energia nuclear",
     "Lixo atômico",
     "Vantagens e desvantagens do uso de energia nuclear"
    ]
   },
   {
    "disciplina": "Biologia",
    "tema": "Moléculas, células e tecidos",
    "itens": [
     "Estrutura e fisiologia celular: membrana, citoplasma e núcleo",
     "Divisão celular",
     "Aspectos bioquímicos das estruturas celulares",
     "Aspectos gerais do metabolismo celular",
     "Metabolismo energético: fotossíntese e respiração",
     "Codificação da informação genética",
     "Síntese proteica",
     "Diferenciação celular",
     "Principais tecidos animais e vegetais",
     "Origem e evolução das células",
     "Noções sobre células-tronco, clonagem e tecnologia do DNA recombinante",
     "Aplicações de biotecnologia na produção de alimentos, fármacos e componentes biológicos",
     "Aplicações de tecnologias relacionadas ao DNA a investigações científicas, determinação da paternidade, investigação criminal e identificação de indivíduos",
     "Aspectos éticos relacionados ao desenvolvimento biotecnológico",
     "Biotecnologia e sustentabilidade"
    ]
   },
   {
    "disciplina": "Biologia",
    "tema": "Hereditariedade e diversidade da vida",
    "itens": [
     "Princípios básicos que regem a transmissão de características hereditárias",
     "Concepções pré-mendelianas sobre a hereditariedade",
     "Aspectos genéticos do funcionamento do corpo humano",
     "Antígenos e anticorpos",
     "Grupos sanguíneos, transplantes e doenças autoimunes",
     "Neoplasias e a influência de fatores ambientais",
     "Mutações gênicas e cromossômicas",
     "Aconselhamento genético",
     "Fundamentos genéticos da evolução",
     "Aspectos genéticos da formação e manutenção da diversidade biológica"
    ]
   },
   {
    "disciplina": "Biologia",
    "tema": "Identidade dos seres vivos",
    "itens": [
     "Níveis de organização dos seres vivos",
     "Vírus, procariontes e eucariontes",
     "Autótrofos e heterótrofos",
     "Seres unicelulares e pluricelulares",
     "Sistemática e as grandes linhas da evolução dos seres vivos",
     "Tipos de ciclo de vida",
     "Evolução e padrões anatômicos e fisiológicos observados nos seres vivos",
     "Funções vitais dos seres vivos e sua relação com a adaptação desses organismos a diferentes ambientes",
     "Embriologia, anatomia e fisiologia humana",
     "Evolução humana",
     "Biotecnologia e sistemática"
    ]
   },
   {
    "disciplina": "Biologia",
    "tema": "Ecologia e ciências ambientais",
    "itens": [
     "Ecossistemas",
     "Fatores bióticos e abióticos",
     "Habitat e nicho ecológico",
     "Comunidade biológica: teia alimentar, sucessão e comunidade clímax",
     "Dinâmica de populações",
     "Interações entre os seres vivos",
     "Ciclos biogeoquímicos",
     "Fluxo de energia no ecossistema",
     "Biogeografia",
     "Biomas brasileiros",
     "Exploração e uso de recursos naturais",
     "Problemas ambientais: mudanças climáticas, efeito estufa, desmatamento, erosão, poluição da água, do solo e do ar",
     "Conservação e recuperação de ecossistemas",
     "Conservação da biodiversidade",
     "Tecnologias ambientais",
     "Noções de saneamento básico",
     "Noções de legislação ambiental: água, florestas, unidades de conservação, biodiversidade"
    ]
   },
   {
    "disciplina": "Biologia",
    "tema": "Origem e evolução da vida",
    "itens": [
     "Biologia como ciência: história, métodos, técnicas e experimentação",
     "Hipóteses sobre a origem do Universo, da Terra e dos seres vivos",
     "Teorias de evolução",
     "Explicações pré-darwinistas para a modificação das espécies",
     "Teoria evolutiva de Charles Darwin",
     "Teoria sintética da evolução",
     "Seleção artificial e seu impacto sobre ambientes naturais e sobre populações humanas"
    ]
   },
   {
    "disciplina": "Biologia",
    "tema": "Qualidade de vida das populações humanas",
    "itens": [
     "Aspectos biológicos da pobreza e do desenvolvimento humano",
     "Indicadores sociais, ambientais e econômicos. Índice de desenvolvimento humano",
     "Principais doenças que afetam a população brasileira: caracterização, prevenção e profilaxia",
     "Noções de primeiros socorros",
     "Infecções Sexualmente Transmissíveis",
     "Aspectos sociais da biologia: uso indevido de drogas, gravidez na adolescência, obesidade",
     "Violência e segurança pública",
     "Exercícios físicos e vida saudável",
     "Aspectos biológicos do desenvolvimento sustentável",
     "Legislação e cidadania"
    ]
   }
  ]
 },
 {
  "id": "CH",
  "name": "Ciências Humanas e suas Tecnologias",
  "competencias": [
   {
    "n": 1,
    "text": "Compreender os elementos culturais que constituem as identidades.",
    "skills": [
     [
      "H1",
      "Interpretar historicamente e(ou) geograficamente fontes documentais acerca de aspectos da cultura."
     ],
     [
      "H2",
      "Analisar a produção da memória pelas sociedades humanas."
     ],
     [
      "H3",
      "Associar as manifestações culturais do presente aos seus processos históricos."
     ],
     [
      "H4",
      "Comparar pontos de vista expressos em diferentes fontes sobre determinado aspecto da cultura."
     ],
     [
      "H5",
      "Identificar as manifestações ou representações da diversidade do patrimônio cultural e artístico em diferentes sociedades."
     ]
    ]
   },
   {
    "n": 2,
    "text": "Compreender as transformações dos espaços geográficos como produto das relações socioeconômicas e culturais de poder.",
    "skills": [
     [
      "H6",
      "Interpretar diferentes representações gráficas e cartográficas dos espaços geográficos."
     ],
     [
      "H7",
      "Identificar os significados histórico-geográficos das relações de poder entre as nações."
     ],
     [
      "H8",
      "Analisar a ação dos Estados nacionais no que se refere à dinâmica dos fluxos populacionais e no enfrentamento de problemas de ordem econômico-social."
     ],
     [
      "H9",
      "Comparar o significado histórico-geográfico das organizações políticas e socioeconômicas em escala local, regional ou mundial."
     ],
     [
      "H10",
      "Reconhecer a dinâmica da organização dos movimentos sociais e a importância da participação da coletividade na transformação da realidade histórico-geográfica."
     ]
    ]
   },
   {
    "n": 3,
    "text": "Compreender a produção e o papel histórico das instituições sociais, políticas e econômicas, associando-as aos diferentes grupos, conflitos e movimentos sociais.",
    "skills": [
     [
      "H11",
      "Identificar registros de práticas de grupos sociais no tempo e no espaço."
     ],
     [
      "H12",
      "Analisar o papel da justiça como instituição na organização das sociedades."
     ],
     [
      "H13",
      "Analisar a atuação dos movimentos sociais que contribuíram para mudanças ou rupturas em processos de disputa pelo poder."
     ],
     [
      "H14",
      "Comparar diferentes pontos de vista, presentes em textos analíticos e interpretativos, sobre situação ou fatos de natureza histórico-geográfica acerca das instituições sociais, políticas e econômicas."
     ],
     [
      "H15",
      "Avaliar criticamente conflitos culturais, sociais, políticos, econômicos ou ambientais ao longo da história."
     ]
    ]
   },
   {
    "n": 4,
    "text": "Entender as transformações técnicas e tecnológicas e seu impacto nos processos de produção, no desenvolvimento do conhecimento e na vida social.",
    "skills": [
     [
      "H16",
      "Identificar registros sobre o papel das técnicas e tecnologias na organização do trabalho e(ou) da vida social."
     ],
     [
      "H17",
      "Analisar fatores que explicam o impacto das novas tecnologias no processo de territorialização da produção."
     ],
     [
      "H18",
      "Analisar diferentes processos de produção ou circulação de riquezas e suas implicações sócio-espaciais."
     ],
     [
      "H19",
      "Reconhecer as transformações técnicas e tecnológicas que determinam as várias formas de uso e apropriação dos espaços rural e urbano."
     ],
     [
      "H20",
      "Selecionar argumentos favoráveis ou contrários às modificações impostas pelas novas tecnologias à vida social e ao mundo do trabalho."
     ]
    ]
   },
   {
    "n": 5,
    "text": "Utilizar os conhecimentos históricos para compreender e valorizar os fundamentos da cidadania e da democracia, favorecendo uma atuação consciente do indivíduo na sociedade.",
    "skills": [
     [
      "H21",
      "Identificar o papel dos meios de comunicação na construção da vida social."
     ],
     [
      "H22",
      "Analisar as lutas sociais e conquistas obtidas no que se refere às mudanças nas legislações ou nas políticas públicas."
     ],
     [
      "H23",
      "Analisar a importância dos valores éticos na estruturação política das sociedades."
     ],
     [
      "H24",
      "Relacionar cidadania e democracia na organização das sociedades."
     ],
     [
      "H25",
      "Identificar estratégias que promovam formas de inclusão social."
     ]
    ]
   },
   {
    "n": 6,
    "text": "Compreender a sociedade e a natureza, reconhecendo suas interações no espaço em diferentes contextos históricos e geográficos.",
    "skills": [
     [
      "H26",
      "Identificar em fontes diversas o processo de ocupação dos meios físicos e as relações da vida humana com a paisagem."
     ],
     [
      "H27",
      "Analisar de maneira crítica as interações da sociedade com o meio físico, levando em consideração aspectos históricos e(ou) geográficos."
     ],
     [
      "H28",
      "Relacionar o uso das tecnologias com os impactos sócio-ambientais em diferentes contextos histórico-geográficos."
     ],
     [
      "H29",
      "Reconhecer a função dos recursos naturais na produção do espaço geográfico, relacionando-os com as mudanças provocadas pelas ações humanas."
     ],
     [
      "H30",
      "Avaliar as relações entre preservação e degradação da vida no planeta nas diferentes escalas."
     ]
    ]
   }
  ],
  "objetos": [
   {
    "disciplina": null,
    "tema": "Diversidade cultural, conflitos e vida em sociedade",
    "itens": [
     "Cultura material e imaterial: patrimônio e diversidade cultural no Brasil",
     "A Conquista da América: conflitos entre europeus e indígenas na América colonial",
     "A escravidão e as formas de resistência indígena e africana na América",
     "História cultural dos povos africanos: a luta dos negros no Brasil e o negro na formação da sociedade brasileira",
     "História dos povos indígenas e a formação sócio-cultural brasileira",
     "Movimentos culturais no mundo ocidental e seus impactos na vida política e social"
    ]
   },
   {
    "disciplina": null,
    "tema": "Formas de organização social, movimentos sociais, pensamento político e ação do Estado",
    "itens": [
     "Cidadania e democracia na Antiguidade",
     "Estado e direitos do cidadão a partir da Idade Moderna",
     "Democracia direta, indireta e representativa",
     "Revoluções sociais e políticas na Europa Moderna",
     "Formação territorial brasileira",
     "Regiões brasileiras",
     "Políticas de reordenamento territorial",
     "Lutas pela conquista da independência política das colônias da América",
     "Grupos sociais em conflito no Brasil imperial e a construção da nação",
     "Desenvolvimento do pensamento liberal na sociedade capitalista e seus críticos nos séculos XIX e XX",
     "Políticas de colonização, migração, imigração e emigração no Brasil nos séculos XIX e XX",
     "Atuação dos grupos sociais e os grandes processos revolucionários do século XX: Revolução Bolchevique, Revolução Chinesa, Revolução Cubana",
     "Geopolítica e conflitos entre os séculos XIX e XX: Imperialismo, a ocupação da Ásia e da África, as Guerras Mundiais e a Guerra Fria",
     "Sistemas totalitários na Europa do século XX: nazifascista, franquismo, salazarismo e stalinismo",
     "Ditaduras políticas na América Latina: Estado Novo no Brasil e ditaduras na América",
     "Conflitos político-culturais pós-Guerra Fria, reorganização política internacional e os organismos multilaterais nos séculos XX e XXI",
     "Luta pela conquista de direitos pelos cidadãos: direitos civis, humanos, políticos e sociais",
     "Direitos sociais nas constituições brasileiras",
     "Políticas afirmativas.",
     "Vida urbana: redes e hierarquia nas cidades, pobreza e segregação espacial"
    ]
   },
   {
    "disciplina": null,
    "tema": "Características e transformações das estruturas produtivas",
    "itens": [
     "Diferentes formas de organização da produção: escravismo antigo, feudalismo, capitalismo, socialismo e suas diferentes experiências",
     "Economia agroexportadora brasileira: complexo açucareiro, mineração no período colonial, economia cafeeira e borracha na Amazônia",
     "Revolução Industrial: criação do sistema de fábrica na Europa e transformações no processo de produção",
     "Formação do espaço urbano-industrial",
     "Transformações na estrutura produtiva no século XX: fordismo, toyotismo, novas técnicas de produção e seus impactos",
     "Industrialização brasileira, urbanização e transformações sociais e trabalhistas",
     "Globalização e novas tecnologias de telecomunicação e suas consequências econômicas, políticas e sociais",
     "Produção e transformação dos espaços agrários",
     "Modernização da agricultura e estruturas agrárias tradicionais",
     "Agronegócio, agricultura familiar, assalariados do campo e lutas sociais no campo",
     "Relação campo-cidade"
    ]
   },
   {
    "disciplina": null,
    "tema": "Os domínios naturais e a relação do ser humano com o ambiente",
    "itens": [
     "Relação homem-natureza e a apropriação dos recursos naturais pelas sociedades ao longo do tempo",
     "Impacto ambiental das atividades econômicas no Brasil",
     "Recursos minerais e energéticos: exploração e impactos",
     "Recursos hídricos",
     "Bacias hidrográficas e seus aproveitamentos",
     "Questões ambientais contemporâneas: mudança climática, ilhas de calor, efeito estufa, chuva ácida, destruição da camada de ozônio",
     "Nova ordem ambiental internacional",
     "Políticas territoriais ambientais",
     "Uso e conservação dos recursos naturais, unidades de conservação, corredores ecológicos, zoneamento ecológico e econômico",
     "Origem e evolução do conceito de sustentabilidade",
     "Estrutura interna da terra",
     "Estruturas do solo e do relevo",
     "Agentes internos e externos modeladores do relevo",
     "Situação geral da atmosfera e classificação climática",
     "Características climáticas do território brasileiro",
     "Grandes domínios da vegetação no Brasil e no mundo"
    ]
   },
   {
    "disciplina": null,
    "tema": "Representação espacial",
    "itens": [
     "Projeções cartográficas; leitura de mapas temáticos, físicos e políticos; tecnologias modernas aplicadas à cartografia"
    ]
   }
  ]
 }
];

export const ENEM_ESSAY = [
 {
  "id": "I",
  "text": "Demonstrar domínio da modalidade escrita formal da língua portuguesa.",
  "levels": [
   {
    "score": 200,
    "description": "Demonstra excelente domínio da modalidade escrita formal da língua portuguesa e de escolha de registro. Desvios gramaticais ou de convenções da escrita serão aceitos somente como excepcionalidade e quando não caracterizarem reincidência."
   },
   {
    "score": 160,
    "description": "Demonstra bom domínio da modalidade escrita formal da língua portuguesa e de escolha de registro, com poucos desvios gramaticais e de convenções da escrita."
   },
   {
    "score": 120,
    "description": "Demonstra domínio mediano da modalidade escrita formal da língua portuguesa e de escolha de registro, com alguns desvios gramaticais e de convenções da escrita."
   },
   {
    "score": 80,
    "description": "Demonstra domínio insuficiente da modalidade escrita formal da língua portuguesa, com muitos desvios gramaticais, de escolha de registro e de convenções da escrita."
   },
   {
    "score": 40,
    "description": "Demonstra domínio precário da modalidade escrita formal da língua portuguesa, de forma sistemática, com diversificados e frequentes desvios gramaticais, de escolha de registro e de convenções da escrita."
   },
   {
    "score": 0,
    "description": "Demonstra desconhecimento da modalidade escrita formal da língua portuguesa."
   }
  ]
 },
 {
  "id": "II",
  "text": "Compreender a proposta de redação e aplicar conceitos das várias áreas de conhecimento para desenvolver o tema dentro dos limites estruturais do texto dissertativo-argumentativo em prosa.",
  "levels": [
   {
    "score": 200,
    "description": "Desenvolve o tema por meio de argumentação consistente, a partir de um repertório sociocultural produtivo, e apresenta excelente domínio do texto dissertativo-argumentativo."
   },
   {
    "score": 160,
    "description": "Desenvolve o tema por meio de argumentação consistente e apresenta bom domínio do texto dissertativo-argumentativo, com proposição, argumentação e conclusão."
   },
   {
    "score": 120,
    "description": "Desenvolve o tema por meio de argumentação previsível e apresenta domínio mediano do texto dissertativo-argumentativo, com proposição, argumentação e conclusão."
   },
   {
    "score": 80,
    "description": "Desenvolve o tema recorrendo à cópia de trechos dos textos motivadores ou apresenta domínio insuficiente do texto dissertativo-argumentativo, não atendendo à estrutura com proposição, argumentação e conclusão."
   },
   {
    "score": 40,
    "description": "Apresenta o assunto, tangenciando o tema, ou demonstra domínio precário do texto dissertativo-argumentativo, com traços constantes de outros tipos textuais."
   },
   {
    "score": 0,
    "description": "Fuga ao tema/não atendimento à estrutura dissertativo-argumentativa. Nestes casos a redação recebe nota 0 (zero) e é anulada."
   }
  ]
 },
 {
  "id": "III",
  "text": "Selecionar, relacionar, organizar e interpretar informações, fatos, opiniões e argumentos em defesa de um ponto de vista.",
  "levels": [
   {
    "score": 200,
    "description": "Apresenta informações, fatos e opiniões relacionados ao tema proposto, de forma consistente e organizada, configurando autoria, em defesa de um ponto de vista."
   },
   {
    "score": 160,
    "description": "Apresenta informações, fatos e opiniões relacionados ao tema, de forma organizada, com indícios de autoria, em defesa de um ponto de vista."
   },
   {
    "score": 120,
    "description": "Apresenta informações, fatos e opiniões relacionados ao tema, limitados aos argumentos dos textos motivadores e pouco organizados, em defesa de um ponto de vista."
   },
   {
    "score": 80,
    "description": "Apresenta informações, fatos e opiniões relacionados ao tema, mas desorganizados ou contraditórios e limitados aos argumentos dos textos motivadores, em defesa de um ponto de vista."
   },
   {
    "score": 40,
    "description": "Apresenta informações, fatos e opiniões pouco relacionados ao tema ou incoerentes e sem defesa de um ponto de vista."
   },
   {
    "score": 0,
    "description": "Apresenta informações, fatos e opiniões não relacionados ao tema e sem defesa de um ponto de vista."
   }
  ]
 },
 {
  "id": "IV",
  "text": "Demonstrar conhecimento dos mecanismos linguísticos necessários para a construção da argumentação.",
  "levels": [
   {
    "score": 200,
    "description": "Articula bem as partes do texto e apresenta repertório diversificado de recursos coesivos."
   },
   {
    "score": 160,
    "description": "Articula as partes do texto, com poucas inadequações, e apresenta repertório diversificado de recursos coesivos."
   },
   {
    "score": 120,
    "description": "Articula as partes do texto, de forma mediana, com inadequações, e apresenta repertório pouco diversificado de recursos coesivos."
   },
   {
    "score": 80,
    "description": "Articula as partes do texto, de forma insuficiente, com muitas inadequações, e apresenta repertório limitado de recursos coesivos."
   },
   {
    "score": 40,
    "description": "Articula as partes do texto de forma precária."
   },
   {
    "score": 0,
    "description": "Não articula as informações."
   }
  ]
 },
 {
  "id": "V",
  "text": "Elaborar proposta de intervenção para o problema abordado, respeitando os direitos humanos.",
  "levels": [
   {
    "score": 200,
    "description": "Elabora muito bem proposta de intervenção, detalhada, relacionada ao tema e articulada à discussão desenvolvida no texto."
   },
   {
    "score": 160,
    "description": "Elabora bem proposta de intervenção relacionada ao tema e articulada à discussão desenvolvida no texto."
   },
   {
    "score": 120,
    "description": "Elabora, de forma mediana, proposta de intervenção relacionada ao tema e articulada à discussão desenvolvida no texto."
   },
   {
    "score": 80,
    "description": "Elabora, de forma insuficiente, proposta de intervenção relacionada ao tema, ou não articulada com a discussão desenvolvida no texto."
   },
   {
    "score": 40,
    "description": "Apresenta proposta de intervenção vaga, precária ou relacionada apenas ao assunto."
   },
   {
    "score": 0,
    "description": "Não apresenta proposta de intervenção ou apresenta proposta não relacionada ao tema ou ao assunto."
   }
  ]
 }
];

// Critérios de correção da redação no formato das questões abertas do Atlas (um por competência).
export const essayCriteria = () => ENEM_ESSAY.map((c) => ({ id: c.id, label: `Competência ${c.id} — ${c.text}`.slice(0, 260), levels: c.levels.map((level) => ({ ...level })) }));
export const ESSAY_PROMPT = 'A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija um texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema "…", apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista.';
