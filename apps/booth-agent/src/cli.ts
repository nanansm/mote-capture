// CLI booth-agent.
//   booth-agent set-pin 1234     -> simpan hash argon2 PIN staf ke agent.db
import { openDb, closeDb, kvSet } from "./db.js";
import { BoothAgent } from "./agent.js";

const [cmd, arg] = process.argv.slice(2);
const dataDir = process.env.DATA_DIR ?? "/var/lib/booth-agent";

if (cmd === "set-pin") {
  if (!arg || !/^\d{4}$/.test(arg)) {
    console.error("pakai: booth-agent set-pin <4 digit>");
    process.exit(2);
  }
  const db = openDb(dataDir);
  kvSet(db, "staffPinHash", await BoothAgent.hashPin(arg));
  for (const k of ["pinWrong", "pinLockLevel", "pinLockedUntil"]) kvSet(db, k, null);
  closeDb(db);
  console.log("PIN staf tersimpan. Restart booth-agent tidak perlu.");
} else {
  console.error("perintah: set-pin <4 digit>");
  process.exit(2);
}
