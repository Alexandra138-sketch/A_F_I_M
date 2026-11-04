// Uso: node gerar-hash.js "a-minha-palavra-passe"
// Escreve o hash bcrypt (custo 10) para colar em dados/utilizadores.json.
import bcrypt from 'bcryptjs';

const palavraPasse = process.argv[2];

if (!palavraPasse || palavraPasse.length < 8) {
  console.error('Uso: node gerar-hash.js <palavra-passe com pelo menos 8 caracteres>');
  process.exit(1);
}

console.log(bcrypt.hashSync(palavraPasse, 10));