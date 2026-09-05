import { execSync } from "child_process";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://agrigat_user:agrigat_secret_pwd@localhost:5432/agrigat_db";

async function reset() {
  console.log("⚠️ Resetting AgriGate Database...");
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    console.log("💥 Dropping public schema...");
    await client.query(`
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO agrigat_user;
      GRANT ALL ON SCHEMA public TO public;
    `);
    console.log("✨ Schema cleared.");
  } finally {
    client.release();
    await pool.end();
  }

  console.log("🚀 Executing Migrations Up...");
  execSync("npm run migrate:up", { stdio: "inherit" });

  console.log("🌱 Executing Seed Script...");
  execSync("npm run seed", { stdio: "inherit" });

  console.log("🎉 Database reset complete!");
}

reset().catch((err) => {
  console.error("❌ Reset failed:", err);
  process.exit(1);
});
