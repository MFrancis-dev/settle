import { defineConfig } from "drizzle-kit";

// Empty DATABASE_URL → embedded PGlite (local + demo mode). Set it → Postgres (hosted).
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : { driver: "pglite", dbCredentials: { url: "./.pglite" } }),
});
