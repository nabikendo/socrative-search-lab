// Matrizes tradicionais do SAEB (referenciais fornecidos pelo Inep).
// A mesma sigla Dn pode representar habilidades diferentes por disciplina/etapa.
// Fontes: os dois PDFs oficiais em MATRIZ_SOURCES. Não equivale à matriz BNCC.
export const MATRIZ_SOURCES = {
  LP: 'https://download.inep.gov.br/educacao_basica/prova_brasil_saeb/menu_do_professor/o_que_cai_nas_provas/Matriz_de_Referencia_de_Lingua_Portuguesa.pdf',
  MAT: 'https://download.inep.gov.br/educacao_basica/prova_brasil_saeb/menu_do_professor/o_que_cai_nas_provas/Matriz_de_Referencia_de_Matematica.pdf',
};
const topicsLP5 = [
  ['Procedimentos de leitura', `D1|Localizar informações explícitas em um texto.
D3|Inferir o sentido de uma palavra ou expressão.
D4|Inferir uma informação implícita em um texto.
D6|Identificar o tema de um texto.
D11|Distinguir um fato da opinião relativa a esse fato.`],
  ['Implicações do suporte, do gênero e/ou do enunciador na compreensão do texto', `D5|Interpretar texto com auxílio de material gráfico diverso (propagandas, quadrinhos, foto etc.).
D9|Identificar a finalidade de textos de diferentes gêneros.`],
  ['Relação entre textos', `D15|Reconhecer diferentes formas de tratar uma informação na comparação de textos que tratam do mesmo tema, em função das condições em que ele foi produzido e daquelas em que será recebido.`],
  ['Coerência e coesão no processamento do texto', `D2|Estabelecer relações entre partes de um texto, identificando repetições ou substituições que contribuem para a continuidade de um texto.
D7|Identificar o conflito gerador do enredo e os elementos que constroem a narrativa.
D8|Estabelecer relação causa/consequência entre partes e elementos do texto.
D12|Estabelecer relações lógico-discursivas presentes no texto, marcadas por conjunções, advérbios etc.`],
  ['Relações entre recursos expressivos e efeitos de sentido', `D13|Identificar efeitos de ironia ou humor em textos variados.
D14|Identificar o efeito de sentido decorrente do uso da pontuação e de outras notações.`],
  ['Variação linguística', `D10|Identificar as marcas linguísticas que evidenciam o locutor e o interlocutor de um texto.`],
];
const topicsLP9 = [
  ['Procedimentos de leitura', `D1|Localizar informações explícitas em um texto.
D3|Inferir o sentido de uma palavra ou expressão.
D4|Inferir uma informação implícita em um texto.
D6|Identificar o tema de um texto.
D14|Distinguir um fato da opinião relativa a esse fato.`],
  ['Implicações do suporte, do gênero e/ou do enunciador na compreensão do texto', `D5|Interpretar texto com auxílio de material gráfico diverso (propagandas, quadrinhos, foto etc.).
D12|Identificar a finalidade de textos de diferentes gêneros.`],
  ['Relação entre textos', `D20|Reconhecer diferentes formas de tratar uma informação na comparação de textos que tratam do mesmo tema, em função das condições em que ele foi produzido e daquelas em que será recebido.
D21|Reconhecer posições distintas entre duas ou mais opiniões relativas ao mesmo fato ou ao mesmo tema.`],
  ['Coerência e coesão no processamento do texto', `D2|Estabelecer relações entre partes de um texto, identificando repetições ou substituições que contribuem para a continuidade de um texto.
D7|Identificar a tese de um texto.
D8|Estabelecer relação entre a tese e os argumentos oferecidos para sustentá-la.
D9|Diferenciar as partes principais das secundárias em um texto.
D10|Identificar o conflito gerador do enredo e os elementos que constroem a narrativa.
D11|Estabelecer relação causa/consequência entre partes e elementos do texto.
D15|Estabelecer relações lógico-discursivas presentes no texto, marcadas por conjunções, advérbios etc.`],
  ['Relações entre recursos expressivos e efeitos de sentido', `D16|Identificar efeitos de ironia ou humor em textos variados.
D17|Reconhecer o efeito de sentido decorrente do uso da pontuação e de outras notações.
D18|Reconhecer o efeito de sentido decorrente da escolha de uma determinada palavra ou expressão.
D19|Reconhecer o efeito de sentido decorrente da exploração de recursos ortográficos e/ou morfossintáticos.`],
  ['Variação linguística', `D13|Identificar as marcas linguísticas que evidenciam o locutor e o interlocutor de um texto.`],
];
const topicsMAT5 = [
  ['Espaço e forma', `D1|Identificar a localização/movimentação de objeto em mapas, croquis e outras representações gráficas.
D2|Identificar propriedades comuns e diferenças entre poliedros e corpos redondos, relacionando figuras tridimensionais com suas planificações.
D3|Identificar propriedades comuns e diferenças entre figuras bidimensionais pelo número de lados, pelos tipos de ângulos.
D4|Identificar quadriláteros observando as posições relativas entre seus lados (paralelos, concorrentes, perpendiculares).
D5|Reconhecer a conservação ou modificação de medidas dos lados, do perímetro, da área em ampliação e/ou redução de figuras poligonais usando malhas quadriculadas.`],
  ['Grandezas e medidas', `D6|Estimar a medida de grandezas utilizando unidades de medida convencionais ou não.
D7|Resolver problemas significativos utilizando unidades de medida padronizadas como km/m/cm/mm, kg/g/mg, l/ml.
D8|Estabelecer relações entre unidades de medida de tempo.
D9|Estabelecer relações entre o horário de início e término e/ou o intervalo da duração de um evento ou acontecimento.
D10|Num problema, estabelecer trocas entre cédulas e moedas do sistema monetário brasileiro, em função de seus valores.
D11|Resolver problema envolvendo o cálculo do perímetro de figuras planas, desenhadas em malhas quadriculadas.
D12|Resolver problema envolvendo o cálculo ou estimativa de áreas de figuras planas, desenhadas em malhas quadriculadas.`],
  ['Números e operações/álgebra e funções', `D13|Reconhecer e utilizar características do sistema de numeração decimal, tais como agrupamentos e trocas na base 10 e princípio do valor posicional.
D14|Identificar a localização de números naturais na reta numérica.
D15|Reconhecer a decomposição de números naturais nas suas diversas ordens.
D16|Reconhecer a composição e a decomposição de números naturais em sua forma polinomial.
D17|Calcular o resultado de uma adição ou subtração de números naturais.
D18|Calcular o resultado de uma multiplicação ou divisão de números naturais.
D19|Resolver problema com números naturais, envolvendo diferentes significados da adição ou subtração: juntar, alteração de um estado inicial (positiva ou negativa), comparação e mais de uma transformação (positiva ou negativa).
D20|Resolver problema com números naturais, envolvendo diferentes significados da multiplicação ou divisão: multiplicação comparativa, ideia de proporcionalidade, configuração retangular e combinatória.
D21|Identificar diferentes representações de um mesmo número racional.
D22|Identificar a localização de números racionais representados na forma decimal na reta numérica.
D23|Resolver problema utilizando a escrita decimal de cédulas e moedas do sistema monetário brasileiro.
D24|Identificar fração como representação que pode estar associada a diferentes significados.
D25|Resolver problema com números racionais expressos na forma decimal envolvendo diferentes significados da adição ou subtração.
D26|Resolver problema envolvendo noções de porcentagem (25%, 50%, 100%).`],
  ['Tratamento da informação', `D27|Ler informações e dados apresentados em tabelas.
D28|Ler informações e dados apresentados em gráficos (particularmente em gráficos de colunas).`],
];
const topicsMAT9 = [
  ['Espaço e forma', `D1|Identificar a localização/movimentação de objeto em mapas, croquis e outras representações gráficas.
D2|Identificar propriedades comuns e diferenças entre figuras bidimensionais e tridimensionais, relacionando-as com as suas planificações.
D3|Identificar propriedades de triângulos pela comparação de medidas de lados e ângulos.
D4|Identificar relação entre quadriláteros por meio de suas propriedades.
D5|Reconhecer a conservação ou modificação de medidas dos lados, do perímetro, da área em ampliação e/ou redução de figuras poligonais usando malhas quadriculadas.
D6|Reconhecer ângulos como mudança de direção ou giros, identificando ângulos retos e não-retos.
D7|Reconhecer que as imagens de uma figura construída por uma transformação homotética são semelhantes, identificando propriedades e/ou medidas que se modificam ou não se alteram.
D8|Resolver problema utilizando propriedades dos polígonos (soma de seus ângulos internos, número de diagonais, cálculo da medida de cada ângulo interno nos polígonos regulares).
D9|Interpretar informações apresentadas por meio de coordenadas cartesianas.
D10|Utilizar relações métricas do triângulo retângulo para resolver problemas significativos.
D11|Reconhecer círculo/circunferência, seus elementos e algumas de suas relações.`],
  ['Grandezas e medidas', `D12|Resolver problema envolvendo o cálculo de perímetro de figuras planas.
D13|Resolver problema envolvendo o cálculo de área de figuras planas.
D14|Resolver problema envolvendo noções de volume.
D15|Resolver problema utilizando relações entre diferentes unidades de medida.`],
  ['Números e operações/álgebra e funções', `D16|Identificar a localização de números inteiros na reta numérica.
D17|Identificar a localização de números racionais na reta numérica.
D18|Efetuar cálculos com números inteiros, envolvendo as operações (adição, subtração, multiplicação, divisão, potenciação).
D19|Resolver problema com números naturais, envolvendo diferentes significados das operações (adição, subtração, multiplicação, divisão, potenciação).
D20|Resolver problema com números inteiros envolvendo as operações (adição, subtração, multiplicação, divisão, potenciação).
D21|Reconhecer as diferentes representações de um número racional.
D22|Identificar fração como representação que pode estar associada a diferentes significados.
D23|Identificar frações equivalentes.
D24|Reconhecer as representações decimais dos números racionais como uma extensão do sistema de numeração decimal, identificando a existência de “ordens” como décimos, centésimos e milésimos.
D25|Efetuar cálculos que envolvam operações com números racionais (adição, subtração, multiplicação, divisão, potenciação).
D26|Resolver problema com números racionais envolvendo as operações (adição, subtração, multiplicação, divisão, potenciação).
D27|Efetuar cálculos simples com valores aproximados de radicais.
D28|Resolver problema que envolva porcentagem.
D29|Resolver problema que envolva variação proporcional, direta ou inversa, entre grandezas.
D30|Calcular o valor numérico de uma expressão algébrica.
D31|Resolver problema que envolva equação do 2º grau.
D32|Identificar a expressão algébrica que expressa uma regularidade observada em sequências de números ou figuras (padrões).
D33|Identificar uma equação ou inequação do 1º grau que expressa um problema.
D34|Identificar um sistema de equações do 1º grau que expressa um problema.
D35|Identificar a relação entre as representações algébrica e geométrica de um sistema de equações do 1º grau.`],
  ['Tratamento da informação', `D36|Resolver problema envolvendo informações apresentadas em tabelas e/ou gráficos.
D37|Associar informações apresentadas em listas e/ou tabelas simples aos gráficos que as representam e vice-versa.`],
];
const topicsMAT3 = [
  ['Espaço e forma', `D1|Identificar figuras semelhantes mediante o reconhecimento de relações de proporcionalidade.
D2|Reconhecer aplicações das relações métricas do triângulo retângulo em um problema que envolva figuras planas ou espaciais.
D3|Relacionar diferentes poliedros ou corpos redondos com suas planificações ou vistas.
D4|Identificar a relação entre o número de vértices, faces e/ou arestas de poliedros expressa em um problema.
D5|Resolver problema que envolva razões trigonométricas no triângulo retângulo (seno, cosseno, tangente).
D6|Identificar a localização de pontos no plano cartesiano.
D7|Interpretar geometricamente os coeficientes da equação de uma reta.
D8|Identificar a equação de uma reta apresentada a partir de dois pontos dados ou de um ponto e sua inclinação.
D9|Relacionar a determinação do ponto de interseção de duas ou mais retas com a resolução de um sistema de equações com duas incógnitas.
D10|Reconhecer, dentre as equações do 2º grau com duas incógnitas, as que representam circunferências.`],
  ['Grandezas e medidas', `D11|Resolver problema envolvendo o cálculo de perímetro de figuras planas.
D12|Resolver problema envolvendo o cálculo de área de figuras planas.
D13|Resolver problema envolvendo a área total e/ou volume de um sólido (prisma, pirâmide, cilindro, cone, esfera).`],
  ['Números e operações/álgebra e funções', `D14|Identificar a localização de números reais na reta numérica.
D15|Resolver problema que envolva variação proporcional, direta ou inversa, entre grandezas.
D16|Resolver problema que envolva porcentagem.
D17|Resolver problema envolvendo equação do 2º grau.
D18|Reconhecer expressão algébrica que representa uma função a partir de uma tabela.
D19|Resolver problema envolvendo uma função do 1º grau.
D20|Analisar crescimento/decrescimento, zeros de funções reais apresentadas em gráficos.
D21|Identificar o gráfico que representa uma situação descrita em um texto.
D22|Resolver problema envolvendo P.A./P.G. dada a fórmula do termo geral.
D23|Reconhecer o gráfico de uma função polinomial de 1º grau por meio de seus coeficientes.
D24|Reconhecer a representação algébrica de uma função do 1º grau dado o seu gráfico.
D25|Resolver problemas que envolvam os pontos de máximo ou de mínimo no gráfico de uma função polinomial do 2º grau.
D26|Relacionar as raízes de um polinômio com sua decomposição em fatores do 1º grau.
D27|Identificar a representação algébrica e/ou gráfica de uma função exponencial.
D28|Identificar a representação algébrica e/ou gráfica de uma função logarítmica, reconhecendo-a como inversa da função exponencial.
D29|Resolver problema que envolva função exponencial.
D30|Identificar gráficos de funções trigonométricas (seno, cosseno, tangente) reconhecendo suas propriedades.
D31|Determinar a solução de um sistema linear associando-o a uma matriz.
D32|Resolver problema de contagem utilizando o princípio multiplicativo ou noções de permutação simples, arranjo simples e/ou combinação simples.
D33|Calcular a probabilidade de um evento.`],
  ['Tratamento da informação', `D34|Resolver problema envolvendo informações apresentadas em tabelas e/ou gráficos.
D35|Associar informações apresentadas em listas e/ou tabelas simples aos gráficos que as representam e vice-versa.`],
];
const stageRows = [
  ['SAEB5', 'Matemática', 'MAT', '5º ano do Ensino Fundamental', topicsMAT5],
  ['SAEB9', 'Matemática', 'MAT', '9º ano do Ensino Fundamental', topicsMAT9],
  ['SAEB3', 'Matemática', 'MAT', '3ª série do Ensino Médio', topicsMAT3],
  ['SAEBLP5', 'Língua Portuguesa', 'LP', '5º ano do Ensino Fundamental', topicsLP5],
  ['SAEBLP9', 'Língua Portuguesa', 'LP', '9º ano do Ensino Fundamental', topicsLP9],
  ['SAEBLP3', 'Língua Portuguesa', 'LP', '3ª série do Ensino Médio', topicsLP9],
];
export const SAEB_LEVELS = stageRows.map(([id, subject, source, label, topics]) => ({
  id, subject, source, label: `${subject} · ${label}`, stage: label, max: topics.reduce((n, [, rows]) => n + rows.trim().split('\n').length, 0),
}));
export const SAEB_SKILLS = stageRows.flatMap(([level, subject, source, stage, topics]) =>
  topics.flatMap(([topic, rows]) => rows.trim().split('\n').map((line) => {
    const split = line.indexOf('|');
    const code = line.slice(0, split);
    const description = line.slice(split + 1).trim();
    return { id: `${level}-${code}`, code, level, subject, stage, topic,
      description, label: `${code} · ${description}`, source: MATRIZ_SOURCES[source] };
  })));
const skillById = new Map(SAEB_SKILLS.map((item) => [item.id, item]));
export const findSkill = (id) => skillById.get(String(id || '').toUpperCase()) || null;
export function skillLabel(id) {
  const known = findSkill(id);
  if (known) return `${known.subject} · ${known.stage} · ${known.code}: ${known.description}`;
  return /^D\d{1,2}$/i.test(String(id || ''))
    ? `${String(id).toUpperCase()} · descritor legado sem disciplina/etapa definida` : '';
}
