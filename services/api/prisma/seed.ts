import "dotenv/config";
import { config } from "../src/config.js";
import { normalizePhone, USER_ROLES } from "../src/domain/user.js";
import { AccountStore } from "../src/lib/account-store.js";
import { hashPassword } from "../src/security/password.js";

const store = new AccountStore(config.databasePath);
const phone = normalizePhone(process.env.ADMIN_PHONE ?? "13800000000");
const password = process.env.ADMIN_PASSWORD ?? "HelloBetty2026!";
const displayName = process.env.ADMIN_NAME ?? "Hello Betty 管理员";

try {
  store.upsertAdmin({
    phone,
    displayName,
    passwordHash: await hashPassword(password),
    role: USER_ROLES.ADMIN,
    status: "ACTIVE",
  });
  console.log(`Admin account ready: ${phone}`);
} finally {
  store.close();
}
