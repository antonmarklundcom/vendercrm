import "dotenv/config";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const db = drizzle(connection);

  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migrations applied successfully");

  await connection.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
