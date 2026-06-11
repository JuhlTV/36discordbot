require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");
const fs = require("fs");
const path = require("path");

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;
const replaceExistingPrefix = (process.env.REPLACE_EXISTING_PREFIX ?? "true").toLowerCase() === "true";

if (!token || !guildId) {
  console.error("Fehlende Umgebungsvariablen: DISCORD_TOKEN und/oder GUILD_ID.");
  process.exit(1);
}

let rolePrefixes;
const configPath = path.join(__dirname, "..", "roles-config.json");

// Zuerst versuchen, aus roles-config.json zu laden
if (fs.existsSync(configPath)) {
  try {
    const configContent = fs.readFileSync(configPath, "utf-8");
    rolePrefixes = JSON.parse(configContent);
    if (!Array.isArray(rolePrefixes)) {
      throw new Error("roles-config.json muss ein JSON-Array sein.");
    }
    console.log(`Rollen-Konfiguration geladen aus roles-config.json (${rolePrefixes.length} Rollen)`);
  } catch (error) {
    console.error("Fehler beim Lesen von roles-config.json:", error.message);
    process.exit(1);
  }
} else {
  // Fallback auf .env ROLE_PREFIXES
  try {
    rolePrefixes = JSON.parse(process.env.ROLE_PREFIXES || "[]");
    if (!Array.isArray(rolePrefixes)) {
      throw new Error("ROLE_PREFIXES muss ein JSON-Array sein.");
    }
    if (rolePrefixes.length > 0) {
      console.log(`Rollen-Konfiguration geladen aus .env (${rolePrefixes.length} Rollen)`);
    }
  } catch (error) {
    console.error("ROLE_PREFIXES konnte nicht gelesen werden:", error.message);
    process.exit(1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // Privilegierter Intent – muss im Developer Portal aktiviert sein
  ],
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const knownPrefixesPattern = rolePrefixes
  .map((entry) => entry?.prefix)
  .filter((prefix) => typeof prefix === "string" && prefix.trim().length > 0)
  .map((prefix) => escapeRegExp(prefix.trim()))
  .join("|");

const existingPrefixRegex = knownPrefixesPattern
  ? new RegExp(`^(${knownPrefixesPattern})\\s*\\|\\s*`, "i")
  : null;

function getHighestMatchingRolePrefix(member) {
  const memberRoles = member.roles.cache;

  // Höchste Rolle zuerst, damit immer das passende Kürzel mit höchster Priorität verwendet wird.
  const sortedRoles = [...memberRoles.values()].sort((a, b) => b.position - a.position);

  for (const role of sortedRoles) {
    const match = rolePrefixes.find((entry) => {
      return (
        entry &&
        typeof entry.roleName === "string" &&
        entry.roleName.toLowerCase() === role.name.toLowerCase() &&
        typeof entry.prefix === "string" &&
        entry.prefix.trim().length > 0
      );
    });

    if (match) {
      return match.prefix.trim();
    }
  }

  return null;
}

function buildNewNickname(member, prefix) {
  const current = member.nickname ?? member.user.username;
  const withoutKnownPrefix = existingPrefixRegex ? current.replace(existingPrefixRegex, "") : current;

  if (!prefix) {
    return replaceExistingPrefix ? withoutKnownPrefix : current;
  }

  if (!replaceExistingPrefix && existingPrefixRegex?.test(current)) {
    return current;
  }

  return `${prefix} | ${withoutKnownPrefix}`;
}

async function syncMemberNickname(member) {
  if (!member || !member.manageable) {
    return;
  }

  const prefix = getHighestMatchingRolePrefix(member);
  const desiredNickname = buildNewNickname(member, prefix);
  const currentNickname = member.nickname ?? member.user.username;

  if (desiredNickname === currentNickname) {
    return;
  }

  try {
    await member.setNickname(desiredNickname);
    console.log(`Nickname aktualisiert: ${member.user.tag} -> ${desiredNickname}`);
  } catch (error) {
    console.error(`Konnte Nickname nicht setzen für ${member.user.tag}:`, error.message);
  }
}

async function syncAllMembers(guild) {
  await guild.members.fetch();
  const tasks = guild.members.cache.map((member) => syncMemberNickname(member));
  await Promise.all(tasks);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot ist online als ${readyClient.user.tag}`);

  const guild = readyClient.guilds.cache.get(guildId);
  if (!guild) {
    console.error("Server mit GUILD_ID nicht gefunden.");
    return;
  }

  console.log(`Starte Initial-Sync auf Server: ${guild.name}`);
  await syncAllMembers(guild);
  console.log("Initial-Sync abgeschlossen.");
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== guildId) {
    return;
  }
  await syncMemberNickname(member);
});

client.on(Events.GuildMemberUpdate, async (_oldMember, newMember) => {
  if (newMember.guild.id !== guildId) {
    return;
  }
  await syncMemberNickname(newMember);
});

client.login(token);
