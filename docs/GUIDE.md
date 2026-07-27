# VenderCRM — guidebok

Appen är på spanska (kunderna är paraguayanska). Den här guiden är på svenska
för dig.

Byt ut `crm.tudominio.com` mot din riktiga adress.

---

## Alla URL:er

### Superadmin — du som plattformsägare
Kräver ett superadmin-konto (skapas med script, se runbooken).

| URL | Vad |
|---|---|
| `/tenants` | Skapa och stäng av företag. Här börjar allt. |
| `/tenants/[id]` | Ett företags detaljer, prenumeration, registrera betalning, **"Ver como"** (logga in som dem) |
| `/plans` | Prisplaner (3/6/12 månader) |
| `/whatsapp-health` | Alla företags WhatsApp-nummer, misslyckade webhooks, döda jobb |

### Ditt CRM — daglig användning
| URL | Vad |
|---|---|
| `/login` | Inloggning |
| `/dashboard` | Startsida |
| `/contacts` | Kontakter, sök och filtrera |
| `/contacts/[id]` | En kontakt: taggar, anteckningar, hela historiken |
| `/pipeline` | Kanban — dra affärer mellan steg |
| `/inbox` | WhatsApp-konversationer (uppdateras var 5:e sekund) |
| `/quotes` | Offerter |
| `/products` | Produktkatalog för offerter |
| `/automations` | Flödesbyggaren |
| `/forms` | Formulär som CRM:et själv publicerar |
| `/sites` | **Koppla dina sajter**, API-nycklar, leads per sajt |
| `/team` | **Användare och access** — anställda och kunder |
| `/settings` | Logga, färg, öppettider, tidszon |

### Publika sidor — ingen inloggning
| URL | Vad |
|---|---|
| `/f/[företag]/[formulär]` | Hostat formulär, för sajter utan backend |
| `/q/[token]` | Offert som kunden ser |
| `/q/[token]/pdf` | Offerten som PDF |
| `/api/v1/leads` | Lead-API:t dina sajter postar till |
| `/vc-attribution.js` | Kampanjspårnings-snippeten |

---

## Komma igång — i ordning

**1. Skapa superadmin** (engångs, via SSH):
```bash
npm run create-superadmin -- du@mail.com "lösenord" "Ditt Namn"
```

**2. Skapa ditt företag** → `/tenants`. En pipeline ("Ventas") skapas automatiskt.

**3. Logga in i CRM:et.** Antingen via "Ver como" från `/tenants/[id]`, eller
bjud in dig själv som admin via `/team`.

**4. Koppla WhatsApp** → `/whatsapp`. Du behöver WABA ID, Phone Number ID och en
token från Meta Business Manager.

**5. Koppla en sajt** → `/sites`:
- Fyll i namn, domän, **etapp** och **WhatsApp-nummer**
- **Kopiera nyckeln nu** — den visas aldrig igen (bara en hash sparas)
- Lägg in koden från `docs/site-integration/` på sajten

**6. Bjud in folk** → `/team`.

---

## Roller

| Roll | Ser |
|---|---|
| **Admin** (du) | Allt. Inga sajtkryss = obegränsad. |
| **Empleado** | Bara sina ikryssade sajter, men full CRM-funktion i dem |
| **Cliente** | Bara sina sajters leads. Ingen inbox, inga offerter, inga automationer. |

En kund **utan** ikryssade sajter ser **ingenting** — inte allt. Det är med
avsikt: ett felkonfigurerat kundkonto ska inte råka bli full insyn.

Varje sajt pekar på sin egen etapp, så tandläkarleads och byggmaterialleads
hamnar aldrig i samma vy.

---

## Det du behöver veta om WhatsApp

**24-timmarsfönstret är Metas regel, inte vår.** Har kunden skrivit till dig
inom 24 timmar får du svara fritt. Annars får du bara skicka **godkända
mallar**.

Därför: ett lead från ett formulär har aldrig skrivit till dig — då måste
första kontakten vara en mall. Synka mallar på `/whatsapp`.

Skriver någon **BAJA** eller **STOP** taggas de `optout` automatiskt och
hoppas över av alla automatiska utskick.

---

## Automationer

`/automations` → skapa flöde → välj trigger → dra in noder → **Publicera**.

Ett flöde är bara aktivt när det är publicerat. Publicering vägrar om grafen
är trasig (ingen trigger, lösa noder, cyklar).

Klassikern:
```
Formulär inskickat → Vänta på svar (2 dagar)
    ├─ inget svar → Skicka uppföljningsmall
    └─ svar      → Flytta till "Contactado"
```

Redigerar du ett publicerat flöde skapas ett nytt utkast. Körningar som redan
är igång fortsätter på sin gamla version.

---

## Offerter

`/products` (valfritt, du kan skriva fritext) → `/quotes` → bygg → **Enviar por
WhatsApp**.

Numret (`COT-000001`) är löpande per företag. PDF:en använder din logga och
färg från `/settings`.

Är 24h-fönstret stängt går PDF:en inte via WhatsApp — men offerten skapas ändå
och den **publika länken är leveransen**. Skicka den hur du vill.

Accepterad/avvisad sätter du för hand. Kunden kan inte klicka "acceptera" än.

---

## Vanliga problem

**Leads kommer inte in** → kolla `/sites` att sajten är aktiv; testa med curl
från runbookens smoke-test; kolla sajtens loggar (koden i
`docs/site-integration/` loggar fel men visar ändå tacksidan för besökaren).

**WhatsApp-meddelanden kommer inte** → `/whatsapp-health` visar misslyckade
webhooks och döda jobb. Vanligast är utgången token — kontot visas då som
"Error".

**"La ventana de 24 horas está cerrada"** → inte ett fel. Skicka en mall.

**Automation kördes inte** → är flödet publicerat *och* aktivt? Öppna flödet,
runs-listan visar varje körning med steg-för-steg-historik och felmeddelande.

---

## Vad som inte finns (medvetet)

E-postutskick, SMS, bokning/kalender och missed-call textback. Se `PLAN.md` §11
för vad var och en skulle kräva. Fakturering (SIFEN) är Phase 2.
