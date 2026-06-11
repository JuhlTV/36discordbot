# Discord Role Nickname Bot

Dieser Bot setzt automatisch ein Rollen-Kürzel vor den Nickname, z. B.:

- Rolle `Private` => `PVT | Juhl`

## Voraussetzungen

- Node.js 18+
- Ein Discord Bot mit den folgenden aktivierten Privileged Gateway Intents im Developer Portal:
  - ✓ `SERVER MEMBERS INTENT` (wichtig!)
  - ✓ `GUILDS`
- Bot-Berechtigungen auf deinem Server:
  - `Manage Nicknames`
  - `View Channels`

**Wie man die Intents aktiviert:**
1. Gehe zu https://discord.com/developers/applications
2. Wähle deine Anwendung
3. Klick auf **Bot** (links)
4. Scrolle zu **GATEWAY INTENTS** (rechts)
5. Aktiviere `SERVER MEMBERS INTENT` und `GUILDS`
6. Speichern

## Installation

1. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
2. `.env.example` nach `.env` kopieren und Werte eintragen.
3. Bot starten:
   ```bash
   npm start
   ```

## .env konfigurieren

Beispiel:

```env
DISCORD_TOKEN=dein_bot_token_hier
GUILD_ID=deine_server_id_hier
ROLE_PREFIXES=[{"roleName":"Private","prefix":"PVT"},{"roleName":"Corporal","prefix":"CPL"},{"roleName":"Sergeant","prefix":"SGT"}]
REPLACE_EXISTING_PREFIX=true
PREFIX_FALLBACK_STRATEGY=initials
INCLUDE_MANAGED_ROLES=false
```

## Rollen konfigurieren

Es gibt zwei Möglichkeiten, die Rollen-zu-Prefix-Mappings einzustellen:

### Option 1: Direkt in `roles-config.json` (empfohlen)

Einfach die Datei [roles-config.json](roles-config.json) bearbeiten und deine Rollen mit Namen, IDs und Kürzeln eintragen:

```json
[
  {
    "roleName": "Private",
    "roleId": "1234567890",
    "prefix": "PVT"
  },
  {
    "roleName": "Sergeant",
    "roleId": "0987654321",
    "prefix": "SGT"
  }
]
```

### Option 2: Auto-Generierung mit Script

Wenn du viele Rollen hast und sie automatisch generieren willst:

1. `.env` mit `DISCORD_TOKEN` und `GUILD_ID` setzen.
2. Ausführen:
```bash
npm run generate:role-prefixes
```
3. Das Script erzeugt automatisch die `roles-config.json` mit allen Rollen und intelligenten Kürzeln.

Die Anwendungspriorität:
1. Wenn `roles-config.json` existiert → wird geladen
2. Sonst → fallback auf `ROLE_PREFIXES` aus .env


## Hinweise

- Der Bot verwendet immer die höchste passende Rolle (nach Rollenposition).
- Wenn `REPLACE_EXISTING_PREFIX=true`, ersetzt der Bot alte bekannte Präfixe.
- Wenn `REPLACE_EXISTING_PREFIX=false`, setzt der Bot kein neues Präfix, falls bereits eines vorhanden ist.
- Der Bot kann Nicknames nur ändern, wenn seine eigene Rolle über der Zielrolle liegt.

## Railway Deployment

1. Repository auf GitHub pushen.
2. Auf Railway ein neues Projekt erstellen mit `Deploy from GitHub repo`.
3. Dieses Repository auswählen.
4. Unter Railway die Variablen aus `.env.example` als Environment Variables setzen:
  - `DISCORD_TOKEN`
  - `GUILD_ID`
  - `ROLE_PREFIXES`
  - `REPLACE_EXISTING_PREFIX`
5. Railway startet den Bot automatisch mit `npm start`.

## GitHub Push (dein Repo)

```bash
git init
git add .
git commit -m "Initial Discord role nickname bot"
git branch -M main
git remote add origin https://github.com/JuhlTV/36discordbot.git
git push -u origin main
```
