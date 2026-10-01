import { config } from "../../config";
import { countActiveAdmins, findUserRowByUsername } from "../users/user.repo";
import { registerUser } from "../users/user.service";

/**
 * Make sure someone can log in on a fresh install: if there is no active
 * admin yet, create one from ADMIN_USERNAME / ADMIN_PASSWORD.
 *
 * Once any active admin exists this does nothing, so changing the env vars
 * later never overwrites a password someone has since changed in the app.
 */
export async function ensureAdmin(): Promise<void> {
  if ((await countActiveAdmins()) > 0) return;

  const { adminUsername, adminPassword, adminFullName } = config;
  if (!adminUsername || !adminPassword) {
    console.warn(
      "auth: no active admin account exists. Set ADMIN_USERNAME and " +
        "ADMIN_PASSWORD in .env and restart to create one.",
    );
    return;
  }
  if (adminPassword.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  }
  if (await findUserRowByUsername(adminUsername)) {
    console.warn(
      `auth: no active admin, and username "${adminUsername}" is already ` +
        "taken by a non-admin/inactive account — not creating one.",
    );
    return;
  }

  await registerUser({
    username: adminUsername,
    fullName: adminFullName,
    password: adminPassword,
    role: "admin",
  });
  console.log(`auth: created initial admin account "${adminUsername}"`);
}
