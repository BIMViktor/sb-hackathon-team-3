# StreamBIM Hackathon — kom igång

**Team:** 3  
**Repo:** https://github.com/BIMViktor/sb-hackathon-team-3  
**Widget-URL (redan kopplad i StreamBIM):** https://sb-hackathon-team-3.vercel.app  

Öppna sandbox-projektet och panelen med ert teamnamn. Byt inte widgetens URL.

Ni har två sätt att jobba. Båda använder samma repo och samma URL i StreamBIM.

## Spår A — pusha till Git (standard)

Det här är vägen som syns i 3D-modellen.

1. Klona repot och öppna mappen i en lokal agent, till exempel Codex, Cursor eller Claude. Lovable fungerar också.
2. Ändra `src/main.js` och `src/style.css`.
3. Spara, committa och pusha till `main`:

```powershell
git add -A
git commit -m "Beskriv vad ni gjorde"
git push
```

4. Vänta ungefär en minut. Ladda sedan om StreamBIM-vyn (inte bara widgetpanelen om den ser gammal ut).

Ett rött bygge tar inte bort förra versionen. Laga felet och pusha igen.

`npm install` behövs inte för att publicera. Vercel bygger åt er. Kör det bara om ni vill testa lokalt.

## Spår B — lokal server (snabb feedback)

Använd det här medan ni bygger gränssnitt och logik. Hot reload fungerar på localhost. Localhost-widgeten i StreamBIM laddar http://localhost:3000/ på er egen dator.

```powershell
npm install
npm run dev -- --port 3000
```

Öppna http://127.0.0.1:3000, eller Localhost-widgeten i StreamBIM. Banner **Mock-läge** betyder att ni ser en fejkad modell. Under **Simulera StreamBIM** är varje objektnamn ett klick i modellen. **Byt våning** och **Flytta kamera** skickar de andra två händelserna.

När ni vill se funktionen på riktiga modellen: pusha som i spår A. Tunnel (ngrok eller Cloudflare) fungerar bara om arrangören redan har vitlistat just den domänen. En gratis-tunnel byter adress och ger en tom panel. Fråga en handledare innan ni tunnlar.

## Prompt till agenten

Klistra in det här och byt ut sista stycket.

```
Du bygger en StreamBIM-widget i det här repot (Vite, vanlig JavaScript, ingen React).

Ändra bara src/main.js och src/style.css om du inte måste annat.
Kopplingen finns i src/streambim.js. Använd variabeln client. Skriv ingen egen koppling.

Widgeten sitter i en smal sidopanel, max cirka 420 px, inuti en iframe.
På localhost är mock-läge aktivt. Nya funktioner ska fungera både i mock och live.

Använd bara dessa anrop:
- client.getProjectId()
- client.getUserEmail()
- client.getFloors()
- client.getObjectInfo(guid)
- client.findObjects({ key, value, limit })
- client.highlightObject(guid)
- client.deHighlightAllObjects()
- client.gotoObject(guid)
- client.gotoFloor(floorId)
- client.colorCodeObjects({ [guid]: "RRGGBB" })
Färger är hex utan #. client.api finns bara live och bara för metoder som redan nämns i src/streambim.js.

Händelser som redan kopplas: onPickedObject, onFloorChanged, onSpacesChanged.
Hämta inte data i onCameraChanged. Den anropas ofta.

Gör inte detta:
- Ingen backend, databas, inloggning eller nya npm-paket
- Ingen fetch mot StreamBIM. Det stoppas av CORS. All StreamBIM-data går via client
- Ingen API-nyckel eller token i koden
- Ingen loop med makeApiRequest, findObjects eller getObjectInfo över hela modellen
- Byt inte ut Vite

Uppgift:
<beskriv funktionen på en mening>

Visa resultatet i panelen. Logga fel med log(). Behåll mock-läget.
```

## Om något fastnar

- Push som ber om lösenord: använd webbläsarinloggningen eller GitHub Desktop. Be en handledare. Committa aldrig en token.
- `git commit` säger att namn saknas: `git config user.name "Team 1"` och `git config user.email "team1@hackathon.local"` i repomappen.
- Bygget failar: kör `npm run build` lokalt, eller läs felloggen hos handledaren. Återställ senaste bra commit och pusha den.
- Tom widget efter push: vänta ut bygget och ladda om vyn. URL:en ska vara https och oförändrad.
- Committa inte `node_modules` eller `dist`.

## Filer

| Fil | Roll |
| --- | --- |
| `src/main.js` | Er app. Börja här. |
| `src/style.css` | Utseende för den smala panelen. |
| `src/streambim.js` | Live-koppling, mock och postMessage. |
| `src/mock-data.js` | Fejkade våningar och objekt. |
| `public/streambim-widget-api.min.js` | Officiellt widget-API. Ändra den inte. |

## Demo-check

- Panelen laddar på er fasta URL i sandbox-projektet.
- En knapp markerar, färglägger eller flyttar kameran.
- Ett klick i modellen syns i händelseloggen.
- Mock-läget på localhost gör samma sak mot fejkdatan.
