// Verifica se o Node.js instalado é novo o bastante. Usado pelos arquivos "Iniciar-Atlas".
const [major] = process.versions.node.split('.').map(Number);
if (major >= 24) process.exit(0);
console.log(`\n  O Node.js deste computador é antigo (versão ${process.versions.node}).`);
console.log('  O Atlas precisa da versão 24 ou mais nova (recomendado: 26 LTS).');
console.log('  Baixe a versão "LTS" em https://nodejs.org/ e instale por cima.\n');
process.exit(1);
