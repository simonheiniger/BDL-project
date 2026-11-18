# Vercel-Setup für BDL Pets (Handy-App + Relay)

Für den Besitzer des Vercel-Projekts. Aufwand: ca. 10 Minuten, nur Dashboard und ein Redeploy.
Die Handy-App (Android) und die Kopplung PC↔Handy brauchen eine neue Serverless-Function (`/api/relay`) mit einem kleinen Redis-Speicher. Es ändert sich nichts an bestehenden Funktionen (`/api/rpc`, `/api/checkin`).

## Voraussetzungen

- Das Vercel-Projekt zeigt auf das GitHub-Repo, Root Directory ist `app` (dort liegt `vercel.json`).
- Der aktuelle `main`-Stand ist gemerged. Er enthält `app/api/relay.ts`, `app/public/.well-known/assetlinks.json` und die neu deployten Contract-Adressen in `app/src/contracts/deployments.json`.

## 1. Redis-Speicher anlegen (Pflicht)

Der Relay speichert kurzlebige Anfragen (Sekunden bis wenige Minuten). Auf Vercel braucht das einen externen Speicher, sonst verlieren sich Anfragen zwischen Function-Instanzen.

1. Vercel-Dashboard → das Projekt → **Storage** (oder **Marketplace**) → **Upstash** → **Redis** wählen.
2. Gratis-Plan genügt. Region möglichst nah an der Function-Region (z. B. Frankfurt).
3. Mit dem Projekt verbinden. Dabei dürfen die Environments **Production** und **Preview** angehakt bleiben.
4. Vercel legt die Umgebungsvariablen selbst an: `KV_REST_API_URL` und `KV_REST_API_TOKEN` (oder `UPSTASH_REDIS_REST_URL` und `UPSTASH_REDIS_REST_TOKEN`). Beide Varianten werden vom Code erkannt. Nichts von Hand eintragen, die Token nicht weitergeben.

## 2. Neu deployen

Nach dem Anlegen der Variablen ist ein **Redeploy** nötig (Deployments → letzter Deploy → ⋯ → Redeploy), sonst kennt die Function sie nicht.

## 3. Prüfen

Im Browser öffnen: `https://<deine-domain>/api/relay`
Erwartet: `{"store":"redis"}`.
Steht dort `"memory"`, fehlt die Redis-Verbindung (Schritt 1/2). Dann funktioniert die Kopplung nur zufällig.

Zweiter Test (liefert JSON mit `"online":false`):
```
curl -s -X POST https://<deine-domain>/api/relay \
  -H 'content-type: application/json' \
  -d '{"a":"status","pair":"00000000000000000000000000000000"}'
```

Dritter Test: `https://<deine-domain>/.well-known/assetlinks.json` muss das JSON mit dem Paket `ch.zhaw.bdl.pets` zeigen. Das macht, dass ein NFC-Chip-Scan die Handy-App ohne Auswahldialog öffnet.

## 4. Domain mitteilen

Schick dem App-Bauer die **genaue Produktions-Domain** (z. B. `https://bdl-pets-xyz.vercel.app`). Sie steht in den NFC-Chip-URLs und in der Handy-App. Wird die Domain später geändert, müssen Chips und APK neu gemacht werden.

## Hinweise

- Bestehende Variablen (`CHECKIN_PRIVATE_KEY`, `BDL_RPC_URL`) bleiben unverändert. Es gibt keine neuen Secrets für dich.
- Last: Eine offene gekoppelte Browser-Seite fragt den Relay alle 1,5–4 s ab (je Anfrage ca. 1 Redis-Befehl). Das Gratis-Kontingent reicht für ein Kursprojekt; bei Dauerbetrieb kann man im Upstash-Dashboard den Verbrauch sehen.
- Der Relay speichert nur Anfragen und Signaturen (ca. 5 Minuten, dann automatisch gelöscht), nie Chip-Schlüssel und keine Wallet-Schlüssel.
- Der Standard-CORS erlaubt nur die Handy-App (`https://localhost`).

## 5. APK-Download auf der Seite

Öffnet jemand die Seite auf einem Android-Handy (ohne Wallet-Browser), zeigt sie statt der Web-App einen Download-Button für `/bdl-pets.apk`. Die Datei liegt im Repo unter `app/public/bdl-pets.apk` und wird mit deployt. Prüfen: `https://<deine-domain>/bdl-pets.apk` lädt eine ca. 4 MB große Datei herunter (keine Webseite).
Wichtig: Die APK muss mit der echten Domain gebaut sein (`APP_URL=https://<domain> npm run native:build && npm run native:apk`, kopiert die APK automatisch nach `app/public/`), sonst spricht die App mit der falschen Adresse.
