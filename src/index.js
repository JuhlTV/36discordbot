require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  PermissionsBitField,
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");
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
const absencesPath = path.join(__dirname, "..", "abmeldungen.json");
let absences = {};
const absenceCategories = ["urlaub", "krank", "ooc", "sonstiges"];

function loadAbsences() {
  if (!fs.existsSync(absencesPath)) {
    absences = {};
    return;
  }

  try {
    const content = fs.readFileSync(absencesPath, "utf-8");
    const parsed = JSON.parse(content || "{}");
    absences = parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Fehler beim Lesen von abmeldungen.json:", error.message);
    absences = {};
  }
}

function saveAbsences() {
  try {
    fs.writeFileSync(absencesPath, JSON.stringify(absences, null, 2), "utf-8");
  } catch (error) {
    console.error("Fehler beim Speichern von abmeldungen.json:", error.message);
  }
}

function parseGermanDate(rawDate) {
  if (!rawDate) {
    return null;
  }

  const match = String(rawDate).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2020 || year > 2100) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatGermanDate(isoDate) {
  if (!isoDate) {
    return "offen";
  }

  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "offen";
  }

  return parsed.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function isAbsenceExpired(entry) {
  if (!entry?.until) {
    return false;
  }

  const untilDate = new Date(entry.until);
  if (Number.isNaN(untilDate.getTime())) {
    return false;
  }

  return Date.now() > untilDate.getTime();
}

function pruneExpiredAbsences() {
  const removed = [];

  for (const [userId, entry] of Object.entries(absences)) {
    if (isAbsenceExpired(entry)) {
      removed.push(userId);
      delete absences[userId];
    }
  }

  if (removed.length > 0) {
    saveAbsences();
  }

  return removed;
}

function hasConfiguredRpRole(member) {
  if (!member?.roles?.cache) {
    return false;
  }

  return rolePrefixes.some((entry) => {
    if (!entry) {
      return false;
    }

    if (entry.roleId && member.roles.cache.has(entry.roleId)) {
      return true;
    }

    if (typeof entry.roleName === "string") {
      return member.roles.cache.some(
        (role) => role.name.toLowerCase() === entry.roleName.toLowerCase()
      );
    }

    return false;
  });
}

function formatUserList(values) {
  if (values.length === 0) {
    return "-";
  }

  const lines = values.slice(0, 50).map((value) => `• ${value}`);
  if (values.length > 50) {
    lines.push(`• ... und ${values.length - 50} weitere`);
  }

  return lines.join("\n");
}

function shortenForDiscord(value, maxLength = 950) {
  const text = String(value || "-");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 17)}\n... gekuerzt ...`;
}

function getMemberDisplay(member) {
  return member?.nickname ? `${member.nickname} (${member.user.tag})` : member.user.tag;
}

function buildOverviewEmbed({ guild, rpCandidates, activeMembers, absentMembers }) {
  const activeLines = activeMembers.map((member) => `• ${getMemberDisplay(member)}`);

  const absentLines = absentMembers.map(({ member, entry }) => {
    const reason = entry.reason?.trim() ? ` | ${entry.reason.trim()}` : "";
    const category = entry.category ? ` [${entry.category}]` : "";
    const until = entry.until ? ` bis ${formatGermanDate(entry.until)}` : "";
    return `• ${getMemberDisplay(member)}${category}${until}${reason}`;
  });

  return new EmbedBuilder()
    .setColor(0x2b8a3e)
    .setTitle("RP Verfuegbarkeits-HQ")
    .setDescription(
      `Gesamt RP-Rollen: **${rpCandidates.length}** | Verfuegbar: **${activeMembers.length}** | Abgemeldet: **${absentMembers.length}**`
    )
    .addFields(
      {
        name: `Kann ins RP (${activeMembers.length})`,
        value: shortenForDiscord(formatUserList(activeLines)),
        inline: false,
      },
      {
        name: `Abgemeldet (${absentMembers.length})`,
        value: shortenForDiscord(formatUserList(absentLines)),
        inline: false,
      }
    )
    .setFooter({ text: `Server: ${guild.name}` })
    .setTimestamp(new Date());
}

async function registerSlashCommands(clientUserGuild) {
  const commands = [
    new SlashCommandBuilder()
      .setName("abmelden")
      .setDescription("Markiert einen Spieler als abgemeldet (Standard: du selbst).")
      .addUserOption((option) =>
        option
          .setName("spieler")
          .setDescription("Spieler, der abgemeldet werden soll")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("grund")
          .setDescription("Optionaler Grund für die Abmeldung")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("kategorie")
          .setDescription("Art der Abmeldung")
          .setRequired(false)
          .addChoices(
            ...absenceCategories.map((category) => ({
              name: category,
              value: category,
            }))
          )
      )
      .addStringOption((option) =>
        option
          .setName("bis")
          .setDescription("Bis-Datum im Format TT.MM.JJJJ (optional)")
          .setRequired(false)
      )
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName("anmelden")
      .setDescription("Hebt die Abmeldung auf (Standard: du selbst).")
      .addUserOption((option) =>
        option
          .setName("spieler")
          .setDescription("Spieler, der wieder angemeldet werden soll")
          .setRequired(false)
      )
      .setDMPermission(false),
    new SlashCommandBuilder()
      .setName("abmeldungen")
      .setDescription("Zeigt nur die aktuelle Abmeldeliste.")
      .setDMPermission(false)
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
    new SlashCommandBuilder()
      .setName("rp-uebersicht")
      .setDescription("Zeigt, wer ins RP kann und wer abgemeldet ist.")
      .addBooleanOption((option) =>
        option
          .setName("oeffentlich")
          .setDescription("Wenn true, wird die Uebersicht fuer alle sichtbar gesendet")
          .setRequired(false)
      )
      .setDMPermission(false)
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
  ];

  await clientUserGuild.commands.set(commands.map((command) => command.toJSON()));
  console.log("Slash-Commands registriert: /abmelden, /anmelden, /abmeldungen, /rp-uebersicht");
}

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
  loadAbsences();
  const prunedAtStartup = pruneExpiredAbsences();
  if (prunedAtStartup.length > 0) {
    console.log(`Abgelaufene Abmeldungen entfernt: ${prunedAtStartup.length}`);
  }

  try {
    await registerSlashCommands(guild);
  } catch (error) {
    console.error("Fehler beim Registrieren der Slash-Commands:", error.message);
  }

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

  setInterval(() => {
    const removed = pruneExpiredAbsences();
    if (removed.length > 0) {
      console.log(`Auto-Cleanup: ${removed.length} abgelaufene Abmeldungen entfernt.`);
    }
  }, 30 * 60 * 1000);
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

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.guildId !== guildId) {
    await interaction.reply({
      content: "Dieser Command ist nur auf dem konfigurierten Server nutzbar.",
      ephemeral: true,
    });
    return;
  }

  const commandName = interaction.commandName;

  if (!["abmelden", "anmelden", "abmeldungen", "rp-uebersicht"].includes(commandName)) {
    return;
  }

  pruneExpiredAbsences();

  const readOnlyAdminCommand = ["abmeldungen", "rp-uebersicht"].includes(commandName);
  if (
    readOnlyAdminCommand &&
    !interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)
  ) {
    await interaction.reply({
      content: "Dafuer brauchst du die Berechtigung 'Server verwalten'.",
      ephemeral: true,
    });
    return;
  }

  if (commandName === "abmeldungen") {
    const entries = Object.entries(absences)
      .map(([userId, entry]) => ({ userId, entry }))
      .sort((a, b) => {
        const aTime = a.entry.until ? new Date(a.entry.until).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.entry.until ? new Date(b.entry.until).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      });

    if (entries.length === 0) {
      await interaction.reply({
        content: "Aktuell ist niemand abgemeldet.",
        ephemeral: true,
      });
      return;
    }

    const lines = entries.map(({ userId, entry }) => {
      const userTag = `<@${userId}>`;
      const category = entry.category ? ` [${entry.category}]` : "";
      const until = entry.until ? ` bis ${formatGermanDate(entry.until)}` : "";
      const reason = entry.reason?.trim() ? ` - ${entry.reason.trim()}` : "";
      return `• ${userTag}${category}${until}${reason}`;
    });

    await interaction.reply({
      content: `Aktive Abmeldungen (${entries.length}):\n${shortenForDiscord(lines.join("\n"), 1800)}`,
      ephemeral: true,
    });
    return;
  }

  if (commandName === "rp-uebersicht") {
    try {
      const visibleForAll = interaction.options.getBoolean("oeffentlich") === true;
      await interaction.deferReply({ ephemeral: !visibleForAll });
      await interaction.guild.members.fetch();

      const rpCandidates = interaction.guild.members.cache.filter(
        (member) => !member.user.bot && hasConfiguredRpRole(member)
      );

      const abgemeldet = [];
      const aktiv = [];

      for (const member of rpCandidates.values()) {
        const absenceEntry = absences[member.id];
        if (absenceEntry) {
          abgemeldet.push({ member, entry: absenceEntry });
        } else {
          aktiv.push(member);
        }
      }

      const embed = buildOverviewEmbed({
        guild: interaction.guild,
        rpCandidates: [...rpCandidates.values()],
        activeMembers: aktiv,
        absentMembers: abgemeldet,
      });

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      console.error("Fehler bei /rp-uebersicht:", error.message);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("Fehler beim Erstellen der RP-Übersicht.");
      } else {
        await interaction.reply({
          content: "Fehler beim Erstellen der RP-Übersicht.",
          ephemeral: true,
        });
      }
    }
    return;
  }

  const targetUser = interaction.options.getUser("spieler") ?? interaction.user;
  const actingOnSelf = targetUser.id === interaction.user.id;

  if (
    !actingOnSelf &&
    !interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)
  ) {
    await interaction.reply({
      content: "Du darfst andere Spieler nur mit der Berechtigung 'Server verwalten' verwalten.",
      ephemeral: true,
    });
    return;
  }

  if (commandName === "abmelden") {
    const reason = interaction.options.getString("grund")?.trim() ?? "";
    const category = interaction.options.getString("kategorie") ?? "sonstiges";
    const untilInput = interaction.options.getString("bis")?.trim();
    const untilDate = parseGermanDate(untilInput);

    if (untilInput && !untilDate) {
      await interaction.reply({
        content: "Ungueltiges Datum. Bitte nutze TT.MM.JJJJ, z. B. 28.06.2026.",
        ephemeral: true,
      });
      return;
    }

    if (untilDate && untilDate.getTime() < Date.now()) {
      await interaction.reply({
        content: "Das Bis-Datum liegt in der Vergangenheit.",
        ephemeral: true,
      });
      return;
    }

    absences[targetUser.id] = {
      reason,
      category,
      until: untilDate ? untilDate.toISOString() : null,
      by: interaction.user.id,
      at: new Date().toISOString(),
    };
    saveAbsences();

    const reasonText = reason ? `\nGrund: ${reason}` : "";
    const categoryText = `\nKategorie: ${category}`;
    const untilText = untilDate ? `\nBis: ${formatGermanDate(untilDate.toISOString())}` : "";
    await interaction.reply({
      content: `${targetUser} ist jetzt als abgemeldet markiert.${categoryText}${untilText}${reasonText}`,
      ephemeral: true,
    });
    return;
  }

  if (commandName === "anmelden") {
    if (!absences[targetUser.id]) {
      await interaction.reply({
        content: `${targetUser} ist aktuell nicht als abgemeldet markiert.`,
        ephemeral: true,
      });
      return;
    }

    delete absences[targetUser.id];
    saveAbsences();

    await interaction.reply({
      content: `${targetUser} ist wieder angemeldet und kann ins RP.`,
      ephemeral: true,
    });
  }
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
