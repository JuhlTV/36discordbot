# Discord Role Nickname Bot

Dieser Bot setzt automatisch ein Rollen-Kürzel vor den Nickname, z. B.:

- Rolle `Private` => `PVT | Juhl`

## Voraussetzungen

- Node.js 18+
- Ein Discord Bot mit den folgenden aktivierten Privileged Gateway Intents im Developer Portal:
  - `SERVER MEMBERS INTENT`
- Bot-Berechtigungen auf deinem Server:
  - `Manage Nicknames`
  - `View Channels`

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

## ROLE_PREFIXES automatisch generieren

Wenn du viele Rollen hast, kannst du die `ROLE_PREFIXES` per Script erzeugen:

```bash
npm run generate:role-prefixes
```

Das Script:
- Liest alle Rollen aus deinem `GUILD_ID`
- Nimmt bekannte Militär-Ränge mit typischen Kürzeln (z. B. `Private` -> `PVT`, `Corporal` -> `CPL`)
- Nutzt für unbekannte Rollen einen Fallback (`initials` oder `first3`)

Danach kopierst du die ausgegebene JSON direkt als Railway-Variable `ROLE_PREFIXES`.

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
