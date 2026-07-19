import "dotenv/config";

const developmentSecret = "hellobetty-local-development-secret-change-me";

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 4100),
  databasePath: process.env.DATABASE_PATH ?? "./data/hellobetty.db",
  uploadsPath: process.env.UPLOADS_PATH ?? "./data/uploads",
  jwtSecret: process.env.JWT_SECRET ?? developmentSecret,
  isDevelopmentSecret:
    (process.env.JWT_SECRET ?? developmentSecret) === developmentSecret,
};

if (process.env.NODE_ENV === "production" && config.isDevelopmentSecret) {
  throw new Error("JWT_SECRET is required in production");
}
