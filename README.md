# Kategoriser økonomien din — med innlogging (Supabase)

Sky-versjon der hver bruker logger inn, laster opp kontoutskrifter over tid, og får dem
lagret på sin egen konto. Duplikater ignoreres automatisk, så overlappende utskrifter gir
ikke doble oppføringer.

## Filer
- `index.html` – grensesnitt (innlogging + opplasting + dashbord)
- `app.js` – parsing, kategorisering, Supabase-innlogging og lagring

Bibliotekene (Supabase-js, PapaParse, SheetJS, Chart.js) lastes fra CDN. Ingen bygg-steg.

## Backend (allerede satt opp)
- Supabase-prosjekt: **okonomi-kategorisering**
- URL: `https://ljorsudysagqmdsmsymg.supabase.co`
- Publishable key ligger allerede i `app.js` (trygt å eksponere — beskyttet av Row Level Security)

Databasen har tre tabeller, alle med Row Level Security slik at **hver bruker kun ser sine egne data**:
- `transactions` – én rad per transaksjon, med unik `(user_id, fingerprint)` som hindrer duplikater
- `category_overrides` – dine egne kategori-endringer per leverandør
- `own_accounts` – kontonumre som skal regnes som «dine» (interne overføringer holdes utenfor)

**Duplikat-nøkkel (fingerprint):** `dato | beløp | beskrivelse | konto`. Laster du opp en ny
utskrift som overlapper en gammel, settes bare de nye radene inn – resten hoppes over.

## Slik virker det for brukeren
1. Opprett konto / logg inn (e-post + passord)
2. Last opp CSV/Excel – kolonner gjenkjennes automatisk, kan justeres
3. «Lagre til min konto» – nye transaksjoner lagres, duplikater ignoreres (antallet vises)
4. Oversikt, kakediagram, søk, «Leverandører» (endre kategori) og «Kontoer» (interne overføringer)
5. Neste måned: last opp ny utskrift – alt bygges videre på det som allerede ligger der

## Viktig: e-postbekreftelse
Nye Supabase-prosjekt krever som standard at brukeren bekrefter e-posten før første innlogging.
Vil du at folk skal komme rett inn uten bekreftelse:
- Supabase → **Authentication → Providers → Email** → skru av **Confirm email**.
Da kan de logge inn umiddelbart etter «Opprett konto».

## Premium / betaling (Stripe)

Gratis versjon gir opplasting, dashbord og kakediagram. **Premium (kr 59/mnd)** låser opp
kategori-redigering per leverandør og CSV-eksport. Alt er allerede satt opp bortsett fra dine
egne Stripe-nøkler:

Allerede på plass i prosjektet:
- Tabell `subscriptions` (RLS: bruker leser kun egen status; kun webhook skriver)
- Edge-funksjon `create-checkout` – lager Stripe Checkout-økt for innlogget bruker
- Edge-funksjon `stripe-webhook` – oppdaterer abonnementsstatus (verify_jwt av)

Det du må gjøre (én gang):

1. **Opprett Stripe-konto.** I Stripe → Products: lag produkt «Premium» med en gjentakende
   pris (kr 59 / måned, NOK). Kopier **Price ID** (`price_...`).

2. **Legg inn hemmeligheter** i Supabase → Project Settings → Edge Functions → Secrets
   (eller `supabase secrets set NAVN=verdi`):
   - `STRIPE_SECRET_KEY` = `sk_live_...` (bruk `sk_test_...` mens du tester)
   - `STRIPE_PRICE_ID` = `price_...`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_...` (fra steg 3)
   - `SITE_URL` = `https://ditt-domene` (brukes som fallback for redirect)

   `SUPABASE_URL`, `SUPABASE_ANON_KEY` og `SUPABASE_SERVICE_ROLE_KEY` settes automatisk.

3. **Webhook** i Stripe → Developers → Webhooks → Add endpoint:
   - URL: `https://ljorsudysagqmdsmsymg.supabase.co/functions/v1/stripe-webhook`
   - Hendelser: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Kopier «Signing secret» (`whsec_...`) → sett som `STRIPE_WEBHOOK_SECRET`.

4. **Test** i Stripe testmodus med kort `4242 4242 4242 4242`. Etter betaling sendes brukeren
   tilbake til `/?checkout=success`, webhooken setter status til `active`, og appen låser opp
   premium (merket «Premium» i toppen).

Så snart nøklene er på plass virker «Oppgrader»-knappen og betalingen ende-til-ende.

### Gratis vs. Premium (kan justeres i `app.js`)
- **Gratis:** opplasting, dashbord og kakediagram — men kun **siste måned**, og med annonser/tilbud.
- **Premium:** full historikk (alle måneder), kategori-redigering per leverandør, CSV-eksport, og **reklamefritt**.

### Administrer abonnement (kundeportal)
Knappen «Administrer abonnement» (vises for premium-brukere) åpner Stripes kundeportal der de kan
bytte kort, se kvitteringer eller si opp. Aktiver den én gang i Stripe:
**Settings → Billing → Customer portal → Activate**. Edge-funksjonen `customer-portal` er allerede deployet.

## Annonser & affiliate

Gratisbrukere ser en «Annonser & tilbud»-seksjon; premium er reklamefritt (vanlig og populær modell).

- **Affiliate:** rediger `AFFILIATE`-listen øverst i `app.js` — sett inn dine egne sporingslenker
  (strøm, forsikring, sparing, lån osv.). Lenkene bruker `rel="sponsored nofollow"` og setter
  ingen informasjonskapsler selv.
- **Display-annonser:** vil du kjøre f.eks. Google AdSense, lim inn annonsekoden i `AD_SLOT_HTML`
  (også øverst i `app.js`). Den vises kun for gratisbrukere.

### Klikk-sporing (allerede innebygd)
Hvert affiliate-klikk lagres i tabellen `affiliate_clicks` (dato, tag, url, bruker). Se hva som
konverterer med f.eks.:
```sql
select tag, count(*) as klikk from affiliate_clicks group by tag order by klikk desc;
```

### Cookie-samtykke (allerede innebygd)
Et samtykkebanner vises på første besøk (Godta / Avslå). Affiliate-lenkene setter ingen
informasjonskapsler og vises uansett. Display-annonser i `AD_SLOT_HTML` lastes **kun** hvis
brukeren har trykket «Godta».

**Viktig (personvern/regler):**
- Bruk **aldri** brukernes transaksjons-/finansdata til å målrette annonser.
- Legger du til sporingsannonser (AdSense o.l.), trenger du et **samtykke-/cookie-banner** (GDPR).
- Affiliate for finansprodukter (lån, forsikring) kan utløse markedsføringsregler — merk innhold
  tydelig som «sponset» (allerede gjort) og sjekk vilkårene til partnerprogrammet.

## Publisere på Vercel
> Merk: automatisk deploy via integrasjonen feilet med «You don't have permission to create a
> project» — Vercel-tokenet som er koblet til mangler rettighet til å opprette nye prosjekter.
> Bruk CLI-metoden under (da bruker du din egen innlogging), eller gi integrasjonen utvidede
> rettigheter i Vercel → Settings → Tokens/Integrations.

**CLI (anbefalt – bruker din egen konto):**
```bash
npm i -g vercel
cd okonomi-cloud
vercel          # logg inn, godta standardvalg
vercel --prod   # publiser live
```
Appen er ren statisk HTML/JS (index.html + app.js), så ingen build trengs.
**GitHub + Vercel:** importer repoet på https://vercel.com/new, framework **Other**,
build command tom, output directory `.`.

> Etter deploy: legg til domenet (f.eks. `https://ditt-prosjekt.vercel.app`) under
> Supabase → **Authentication → URL Configuration → Site URL / Redirect URLs**, så
> e-postlenker og økter peker riktig.
