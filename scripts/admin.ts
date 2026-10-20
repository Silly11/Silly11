import { db, transaction, closeDb } from "../src/lib/db";

const [command, email, requestedRole] = process.argv.slice(2);
const role = command === "revoke" ? "user" : requestedRole;
if (
  !["grant", "revoke"].includes(command) ||
  !email ||
  !["expert", "admin", "user"].includes(role ?? "")
) {
  console.error(
    "Usage: npm run admin -- grant <existing-email> <expert|admin>\n       npm run admin -- revoke <existing-email>",
  );
  process.exitCode = 1;
} else {
  try {
    transaction(() => {
      const user = db()
        .prepare("SELECT id,role FROM users WHERE email=?")
        .get(email.trim()) as { id: string; role: string } | undefined;
      if (!user) throw new Error("Account does not exist; register it first.");
      if (user.role === "admin" && role !== "admin") {
        const count = db()
          .prepare("SELECT COUNT(*) AS total FROM users WHERE role='admin'")
          .get() as { total: number };
        if (count.total <= 1)
          throw new Error("Cannot revoke the last administrator.");
      }
      db()
        .prepare("UPDATE users SET role=?,verified=? WHERE id=?")
        .run(role!, role === "expert" ? 1 : 0, user.id);
      if (role === "user") {
        db()
          .prepare(
            "UPDATE tickets SET assignedTo=NULL,status='waiting' WHERE assignedTo=? AND status!='closed'",
          )
          .run(user.id);
      }
    });
    console.log("Account permissions updated.");
  } catch (error) {
    console.error(
      error instanceof Error &&
        [
          "Account does not exist; register it first.",
          "Cannot revoke the last administrator.",
        ].includes(error.message)
        ? error.message
        : "Permission update failed.",
    );
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
