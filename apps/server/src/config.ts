import path from "node:path";

const isProduction = process.env.NODE_ENV === "production";

export const config = {
  appName: "Hitster Local",
  isProduction,
  port: Number(process.env.PORT ?? 3001),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databasePath: process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "data/app.db"),
  webDistPath: path.resolve(process.cwd(), "apps/web/dist"),
};
