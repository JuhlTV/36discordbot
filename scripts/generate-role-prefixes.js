require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;
const fallbackStrategy = (process.env.PREFIX_FALLBACK_STRATEGY || "initials").toLowerCase();
const includeManagedRoles = (process.env.INCLUDE_MANAGED_ROLES || "false").toLowerCase() === "true";

if (!token || !guildId) {
  console.error("Bitte DISCORD_TOKEN und GUILD_ID in .env setzen.");
  process.exit(1);
}

const knownRankPrefixes = {
  private: "PVT",
  "private first class": "PFC",
  specialist: "SPC",
  corporal: "CPL",
  sergeant: "SGT",
  "staff sergeant": "SSG",
  "sergeant first class": "SFC",
  "master sergeant": "MSG",
  "first sergeant": "1SG",
  "sergeant major": "SGM",
  "command sergeant major": "CSM",
  "second lieutenant": "2LT",
  "first lieutenant": "1LT",
  captain: "CPT",
  major: "MAJ",
  "lieutenant colonel": "LTC",
  colonel: "COL",
  brigadier: "BG",
  "brigadier general": "BG",
  "major general": "MG",
  "lieutenant general": "LTG",
  general: "GEN",
};

function normalizeRoleName(roleName) {
  return roleName.toLowerCase().replace(/\s+/g, " ").trim();
}

function prefixFromInitials(roleName) {
  const words = roleName
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();

  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

function prefixFromFirst3(roleName) {
  const clean = roleName.replace(/[^a-zA-Z0-9]/g, "");
  return clean.slice(0, 3).toUpperCase();
}

function buildPrefix(roleName) {
  const normalized = normalizeRoleName(roleName);

  if (knownRankPrefixes[normalized]) {
    return knownRankPrefixes[normalized];
  }

  if (fallbackStrategy === "first3") {
    return prefixFromFirst3(roleName);
  }

  return prefixFromInitials(roleName);
}

async function main() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once("ready", async () => {
    try {
      const guild = await client.guilds.fetch(guildId);
      const roles = await guild.roles.fetch();

      const rolePrefixes = [...roles.values()]
        .filter((role) => role && role.name !== "@everyone")
        .filter((role) => (includeManagedRoles ? true : !role.managed))
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
          roleName: role.name,
          roleId: role.id,
          prefix: buildPrefix(role.name),
        }))
        .filter((entry) => entry.prefix.length > 0);

      // Datei speichern
      const configPath = path.join(__dirname, "..", "roles-config.json");
      fs.writeFileSync(configPath, JSON.stringify(rolePrefixes, null, 2));
      console.log(`✓ ${rolePrefixes.length} Rollen in roles-config.json gespeichert:`);
      console.log(JSON.stringify(rolePrefixes, null, 2));
    } catch (error) {
      console.error("Fehler beim Generieren der ROLE_PREFIXES:", error.message);
      process.exitCode = 1;
    } finally {
      client.destroy();
    }
  });

  await client.login(token);
}

main().catch((error) => {
  console.error("Unerwarteter Fehler:", error.message);
  process.exit(1);
});
