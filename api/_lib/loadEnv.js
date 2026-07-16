// Reads .env.local (or .env) and copies any values into process.env that
// aren't already set. This is a workaround for vercel dev not reliably
// auto-loading .env.local in this project. Safe to require multiple times.

const fs = require("fs");
const path = require("path");

function loadLocalEnv() {
  const localEnvPath = path.join(__dirname, "..", "..", ".env.local");
  const envPath = path.join(__dirname, "..", "..", ".env");
  const filePath = fs.existsSync(localEnvPath) ? localEnvPath : envPath;

  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

module.exports = {};