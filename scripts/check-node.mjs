// Verifica se o Node.js instalado é novo o bastante. Usado pelos arquivos "Iniciar-Atlas".
const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 22 || (major === 22 && minor >= 13)) process.exit(0);
console.log(`\n  O Node.js deste computador é antigo (versão ${process.versions.node}).`);
console.log('  O Atlas precisa da versão 22.13 ou mais nova.');
console.log('  Baixe a versão "LTS" em https://nodejs.org/ e instale por cima.\n');
process.exit(1);
