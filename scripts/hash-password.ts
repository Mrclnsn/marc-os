import { hashPassword } from "../src/lib/password";

const pw = process.argv[2];
if (!pw) {
  console.error('Gebruik: npm run hash-password -- "jouw-wachtwoord"');
  process.exit(1);
}
console.log(hashPassword(pw));
