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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
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
    // Zuerst nach roleId suchen (exakt)
    let match = rolePrefixes.find((entry) => {
      return (
        entry &&
        entry.roleId &&
        entry.roleId === role.id &&
        typeof entry.prefix === "string" &&
        entry.prefix.trim().length > 0
      );
    });

    if (match) {
      console.log(
        `[DEBUG] Rolle ${role.name} (${role.id}) -> Präfix: ${match.prefix} (nach ID gefunden)`
      );
      return match.prefix.trim();
    }

    // Fallback: Nach roleName suchen (weniger genau)
    match = rolePrefixes.find((entry) => {
      return (
        entry &&
        typeof entry.roleName === "string" &&
        entry.roleName.toLowerCase() === role.name.toLowerCase() &&
        typeof entry.prefix === "string" &&
        entry.prefix.trim().length > 0
      );
    });

    if (match) {
      console.log(
        `[DEBUG] Rolle ${role.name} (${role.id}) -> Präfix: ${match.prefix} (nach Name gefunden)`
      );
      return match.prefix.trim();
    }
  }

  console.log(
    `[DEBUG] Keine Rolle gefunden für Member ${member.user.tag}. Rollen: ${[...memberRoles.values()]
      .map((r) => `${r.name}(${r.id})`)
      .join(", ")}`
  );
  return null;
}

function buildNewNickname(member, prefix) {
  const current = member.nickname ?? member.user.username;
  const withoutKnownPrefix = existingPrefixRegex ? current.replace(existingPrefixRegex, "") : current;

  if (!prefix) {
    // Keine passende Rolle: Namen unverändert lassen.
    return current;
  }

  if (!replaceExistingPrefix && existingPrefixRegex?.test(current)) {
    return current;
  }

  return `${prefix} | ${withoutKnownPrefix}`;
}

async function syncMemberNickname(member) {
  if (!member) {
    return;
  }

  if (!member.manageable) {
    console.log(
      `Übersprungen (nicht verwaltbar): ${member.user.tag} - meist Server-Owner oder Rolle über Bot.`
    );
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
  const tasks = guild.members.cache.map((member) => syncMemberNickname(member));
  await Promise.all(tasks);
}

function getRetryDelayMsFromError(error) {
  const message = String(error?.message || "");
  const match = message.match(/Retry after\s+([0-9.]+)\s+seconds?/i);

  if (!match) {
    return 30000;
  }

  const seconds = Number(match[1]);
  if (Number.isNaN(seconds) || seconds <= 0) {
    return 30000;
  }

  // Small buffer to avoid immediately hitting the same limit again.
  return Math.ceil((seconds + 1) * 1000);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot ist online als ${readyClient.user.tag}`);

  const guild = readyClient.guilds.cache.get(guildId);
  if (!guild) {
    console.error("Server mit GUILD_ID nicht gefunden.");
    return;
  }

  console.log(`Verbunden mit Server: ${guild.name}`);

  // Versuche alle Rollen zu synchen, wenn GuildMembers Intent aktiviert ist
  try {
    await guild.members.fetch();
    console.log(`Initial-Sync: ${guild.members.cache.size} Member geladen.`);
    await syncAllMembers(guild);
    console.log("Initial-Sync abgeschlossen.");
  } catch (error) {
    // Wenn kein GuildMembers Intent, wird hier ein Fehler geworfen
    // Das ist ok – der Bot reagiert trotzdem auf Live-Events
    if (error.message.includes("Used disallowed intents")) {
      console.warn(
        "⚠ GuildMembers Intent nicht aktiviert. Bot reagiert nur auf Live-Events (neue Member, Rollenwechsel)."
      );
      console.warn(
        "ℹ Optional: Aktiviere im Developer Portal Bot → GATEWAY INTENTS → SERVER MEMBERS INTENT für Initial-Sync."
      );
    } else if (String(error.message).toLowerCase().includes("rate limited")) {
      const delayMs = getRetryDelayMsFromError(error);
      console.warn(
        `Initial-Sync rate-limited. Neuer Versuch in ${Math.ceil(delayMs / 1000)} Sekunden.`
      );

      setTimeout(async () => {
        try {
          await guild.members.fetch();
          console.log(`Retry-Sync: ${guild.members.cache.size} Member geladen.`);
          await syncAllMembers(guild);
          console.log("Retry-Sync abgeschlossen.");
        } catch (retryError) {
          console.error("Retry-Sync fehlgeschlagen:", retryError.message);
        }
      }, delayMs);
    } else {
      console.error("Fehler beim Initial-Sync:", error.message);
    }
  }
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

client.login(token).catch((error) => {
  if (error?.message?.includes("disallowed intents") || error?.message?.includes("Used disallowed intents")) {
    console.error(
      "GuildMembers Intent ist im Discord Developer Portal nicht aktiviert. Aktiviere: Bot -> Gateway Intents -> SERVER MEMBERS INTENT"
    );
    process.exit(1);
  }

  console.error("Login-Fehler:", error.message);
  process.exit(1);
});
