/* Kategoriser økonomien din — 100% klientbasert. */
'use strict';
const NOK=n=>Math.round(n).toLocaleString('no-NO')+' kr';
const SEP='␟';
let FILES=[];        // {name, rows(raw objects), headers, map}
let TX=[];           // merged transactions
/* ---------- Supabase ---------- */
const SUPA_URL='https://ljorsudysagqmdsmsymg.supabase.co';
const SUPA_KEY='sb_publishable_1EfmBjgKRF10wAYpGkWgPw_njK9G0EC';
const sb=window.supabase.createClient(SUPA_URL,SUPA_KEY);
let user=null;
let ownAccts=new Set();
let acctNames={};    // {kontonr: visningsnavn, f.eks. "Lønnskonto"}
let overrides={};
let goals={};        // {kategori: månedlig grense i kr}
let networth={assets:[],liabilities:[]};  // eiendeler & gjeld (manuelt)
let PENDING=[];      // parsed-but-not-saved transactions from uploads
async function saveGoals(){ if(!user)return; await sb.from('category_goals').delete().eq('user_id',user.id);
 const rows=Object.entries(goals).map(([category,monthly_limit])=>({user_id:user.id,category,monthly_limit}));
 if(rows.length)await sb.from('category_goals').upsert(rows,{onConflict:'user_id,category'}); }
async function saveNetworth(){ if(!user)return; await sb.from('networth').upsert({user_id:user.id,data:networth,updated_at:new Date().toISOString()},{onConflict:'user_id'}); }
let isPremium=false;
const PRICE_NOK=59;
/* ---- annonselenker (affiliate). Bytt url til dine egne fra Adservice/Adtraction/Partner-ads. ----
   VIKTIG (Forbrukertilsynet): lånereklame må bruke annonsørens GODKJENTE tekst og oppgi
   effektiv rente + representativt eksempel. Ikke fremhev lav månedskostnad. Lenker merkes «Annonselenke». */
const AFFILIATE=[
 {tag:'Refinansiering',title:'Samle dyre smålån og kredittkort',desc:'Sammenlign refinansiering hos flere banker i én søknad.',cta:'Sammenlign',url:'https://example.com/refinansiering?ref=DITT_ID'},
 {tag:'Forbrukslån',title:'Sammenlign forbrukslån',desc:'Én søknad – svar fra flere banker. Se effektiv rente hos hver tilbyder.',cta:'Sammenlign',url:'https://example.com/forbrukslan?ref=DITT_ID'},
 {tag:'Forsikring',title:'Betaler du for mye på forsikring?',desc:'Sammenlign pris på bil, hus og innbo på to minutter.',cta:'Sammenlign',url:'https://example.com/forsikring?ref=DITT_ID'},
 {tag:'Strøm',title:'Bytt til billigere strøm',desc:'Sammenlign strømavtaler og spar potensielt tusenlapper i året.',cta:'Se avtaler',url:'https://example.com/strom?ref=DITT_ID'},
];
// Valgfri display-annonse (f.eks. Google AdSense-kode). La stå tom ('') for kun affiliate.
const AD_SLOT_HTML='';
const cookieConsent=()=>localStorage.getItem('cookieConsent'); // 'accepted' | 'rejected' | null
function updatePlanUI(){
 const b=document.getElementById('planBadge');const up=document.getElementById('upgradeTop');
 if(!b)return;b.style.display='inline-block';b.textContent=isPremium?'Premium':'Gratis';
 b.style.background=isPremium?'#1b3b2a':'#22344a';b.style.color=isPremium?'#7ee2a8':'#8ba0b6';
 up.style.display=isPremium?'none':'inline-block';
 document.getElementById('manageSub').style.display=isPremium?'inline-block':'none';
}
async function openPortal(){
 const {data:{session}}=await sb.auth.getSession();if(!session)return;
 try{const r=await fetch(SUPA_URL+'/functions/v1/customer-portal',{method:'POST',headers:{'Authorization':'Bearer '+session.access_token}});
  const j=await r.json();if(j.url)location.href=j.url;else alert('Kunne ikke åpne kundeportal: '+(j.error||'ukjent'));}
 catch(e){alert('Nettverksfeil: '+e);}
}
function renderAds(){
 const ba=document.getElementById('freeBanner'),ads=document.getElementById('adsArea');if(!ads)return;
 if(isPremium){ba.classList.add('hide');ads.innerHTML='';return;}
 document.getElementById('freeBannerTxt').textContent='Gratis viser kun siste måned. Oppgrader for full historikk, kategori-redigering og reklamefri opplevelse.';
 ba.classList.remove('hide');
 const cards=AFFILIATE.map(a=>`<div class="card" style="margin:0">
   <span class="pill">${esc(a.tag)}</span>
   <div style="font-weight:600;margin:6px 0 2px">${esc(a.title)}</div>
   <div class="sub" style="margin-bottom:8px">${esc(a.desc)}</div>
   <div style="font-size:10px;color:var(--mut);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">Annonselenke</div>
   <a class="btn aff" data-tag="${esc(a.tag)}" data-url="${esc(a.url)}" style="text-decoration:none;display:inline-block;padding:6px 14px" href="${esc(a.url)}" target="_blank" rel="sponsored noopener nofollow">${esc(a.cta)} ↗</a>
  </div>`).join('');
 const showAd=AD_SLOT_HTML&&cookieConsent()==='accepted';   // display-annonser krever samtykke
 ads.innerHTML=`<div class="card" style="background:none;border:none;padding:0;margin-top:4px">
   <h3>Annonselenker</h3>
   <div class="sub" style="margin:-4px 0 8px">Lenkene under er annonser. Trykker du og handler, kan vi få provisjon.</div>
   <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">${cards}</div>
   ${showAd?`<div style="margin-top:12px">${AD_SLOT_HTML}</div>`:''}</div>`;
}
async function saveOv(){ if(!user)return; await sb.from('category_overrides').delete().eq('user_id',user.id);
 const rows=Object.entries(overrides).map(([group_key,category])=>({user_id:user.id,group_key,category}));
 if(rows.length)await sb.from('category_overrides').upsert(rows,{onConflict:'user_id,group_key'}); }
async function saveOwn(){ if(!user)return; await sb.from('own_accounts').delete().eq('user_id',user.id);
 const rows=[...ownAccts].map(acct=>({user_id:user.id,acct,name:acctNames[acct]||null})); if(rows.length)await sb.from('own_accounts').insert(rows); }

/* ---------- number & date parsing ---------- */
function num(v){
 if(v==null||v==='')return null;
 if(typeof v==='number')return v;
 let s=(''+v).trim().replace(/\s| /g,'');
 // norwegian: 1.234,56  or  1234,56 ; also plain 1234.56
 if(/,\d{1,2}$/.test(s)){s=s.replace(/\./g,'').replace(',','.');}
 else{s=s.replace(/,/g,'');}
 s=s.replace(/[^0-9.\-]/g,'');
 const n=parseFloat(s);return isNaN(n)?null:n;
}
function toDate(v){
 if(v instanceof Date)return v;
 if(typeof v==='number'){ // excel serial
  const d=new Date(Math.round((v-25569)*86400*1000));return isNaN(d)?null:d;}
 const s=(''+v).trim();
 let m=s.match(/^(\d{4})[-\/.](\d{2})[-\/.](\d{2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);
 m=s.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);
 const d=new Date(s);return isNaN(d)?null:d;
}
const iso=d=>d?d.toISOString().slice(0,10):'';
const ym=d=>d?d.toISOString().slice(0,7):'';

/* ---------- column auto-detection ---------- */
function guessMap(headers,rows){
 const H=headers.map(h=>({h,l:(h||'').toLowerCase()}));
 const find=(re)=>{const x=H.find(o=>re.test(o.l));return x?x.h:'';};
 const findClean=(re,bad)=>{const x=H.find(o=>re.test(o.l)&&!bad.test(o.l));return x?x.h:'';};
 const map={
  date:find(/dato|date|bokf|posting/),
  desc:find(/beskriv|tekst|forklar|descrip|text|merchant|melding|narrative|detalj/),
  amount:find(/^(amount|bel(ø|o)p|beloep|sum|bel(ø|o)p ?\(kr\))$/)||findClean(/amount|bel(ø|o)p|beloep|sum/,/currency|valuta|rate|kurs|orig/),
  inn:find(/^inn$|kredit|credit|innbet|deposit/),
  ut:find(/^ut$|debet|debit|utbet|withdraw|uttak/),
  acctA:find(/til konto|to account|mottaker/),
  acctB:find(/fra konto|from account|avsender/),
  mcat:find(/merchant category|kategori|category/),
 };
 // fallbacks by scanning values
 if(!map.date){for(const h of headers){if(rows.slice(0,8).every(r=>toDate(r[h]))){map.date=h;break;}}}
 if(!map.amount&&!(map.inn&&map.ut)){
  let best='',score=-1;
  for(const h of headers){const vals=rows.slice(0,20).map(r=>num(r[h])).filter(v=>v!=null);
   if(vals.length>score&&vals.some(v=>v<0||v>0)){best=h;score=vals.length;}}
  map.amount=best;
 }
 if(!map.desc){ // longest text column
  let best='',len=-1;
  for(const h of headers){const avg=rows.slice(0,15).reduce((a,r)=>a+((''+(r[h]||'')).length),0);
   if(avg>len&&!/\d{4,}/.test(headers)){best=h;len=avg;}}
  map.desc=best;
 }
 return map;
}
function applyMap(f){
 const {rows,map}=f;const out=[];
 // banks often name the export file after the account number
 const fnAcct=((f.name||'').match(/\d{8,}/)||[])[0];if(fnAcct)ownAccts.add(fnAcct);
 // detect this file's own account = value present in (almost) every row across acctA/acctB
 const acctCount={};
 rows.forEach(r=>{[map.acctA,map.acctB].forEach(c=>{if(c){const v=(''+(r[c]||'')).replace(/\D/g,'');if(v.length>=6)acctCount[v]=(acctCount[v]||0)+1;}});});
 let fileAcct='';let mx=0;for(const a in acctCount){if(acctCount[a]>mx){mx=acctCount[a];fileAcct=a;}}
 if(fileAcct&&mx>=rows.length*0.5)ownAccts.add(fileAcct);
 rows.forEach(r=>{
  const d=toDate(r[map.date]);if(!d)return;
  let amt=null;
  if(map.amount&&r[map.amount]!=='')amt=num(r[map.amount]);
  if(amt==null&&(map.inn||map.ut)){const inn=num(r[map.inn]),ut=num(r[map.ut]);
   if(inn)amt=Math.abs(inn);else if(ut)amt=-Math.abs(ut);}
  if(amt==null)return;
  const desc=(''+(r[map.desc]||'')).trim();
  // counterpart account (the acct that is NOT this file's own)
  let cp='';[map.acctA,map.acctB].forEach(c=>{if(c){const v=(''+(r[c]||'')).replace(/\D/g,'');if(v.length>=6&&v!==fileAcct)cp=v;}});
  const amount=Math.round(amt*100)/100;
  const acctId=fileAcct||f.short;
  const fp=[iso(d),amount,desc,acctId].join('|');   // dedup-nøkkel
  out.push({date:iso(d),month:ym(d),account:f.short,description:desc,amount,counterpart:cp,mcat:map.mcat?(''+(r[map.mcat]||'')).trim():'',acctId,fingerprint:fp});
 });
 return out;
}

/* ---------- categorization ---------- */
const RULES=[
 ['Bompenger',[/bompeng|bompeng|autopass|ferde|nord-j(æ|ae)ren|bro\b/]],
 ['Strømmetjenester',[/spotify|netflix|viaplay|hbo|max\b|disney|skyshowtime|storytel|podme|tv ?2|nrk tv|amazon prime|youtube ?premium/]],
 ['Telefon',[/telenor|telia|\bice\b|onecall|talkmore|chilimobil|mycall|phonero|release mobil|fjordkraft mobil|mobil abonnement/]],
 ['Internett',[/altibox|homenet|global ?connect|get as|lyse.*(fiber|bredb)|bredb(å|a)nd|broadband/]],
 ['Strøm',[/lyse|lnett|tibber|fjordkraft|fortum|elvia|glitre|klepp energi|energi|str(ø|oe)m|elkraft|hafslund|agva|nettleie/]],
 ['Forsikring',[/forsikr|fremtind|gjensidige|\btryg\b|\bif\b|storebrand|coverme|digisure|codan|frende|eika forsikr/]],
 ['Lån & kreditt',[/santander|svea|\blån\b|renter|avdrag|kreditt|instabank|bank norwegian.*rente/]],
 ['Sparing/investering',[/nordnet|bank ?norwegian|sparekonto|aksjesparing|fond|investering|kron\b|firi|coinbase/]],
 ['Overføringer',[/^til[:\s]|^fra[:\s]|overf(ø|o)r|nettgiro|\bgiro\b/]],
 ['Dagligvarer',[/rema|kiwi|coop|obs\b|extra|meny|bunnpris|spar\b|joker|matkroken|europris|matsenter|grocery|supermarket|nærbutikk|helios/]],
 ['Restaurant & takeaway',[/restaurant|pizza|sushi|kebab|burger|mcdonald|max\b|egon|peppes|dolly|foodora|wolt|just eat|kantine|cafe|kaffe|bakeri|napoli|ming|lucky bowl|caterer|eating/]],
 ['Uteliv & alkohol',[/vinmonopol|pub\b|bar\b|utested|nattklubb|brewery|drinking|beer|wine|liqu/]],
 ['Transport',[/circle ?k|esso|shell|uno-?x|st1\b|drivstoff|bensin|diesel|\bvy\b|ruter|kolumbus|flytoget|nsb|parker|easypark|apcoa|ryde|voi\b|bolt|taxi|drosje|fuel|garage|car ?wash|bilvask/]],
 ['Reise & hotell',[/hotel|hotell|sas\b|norwegian air|widerø|wideroe|flyr|ryanair|klm|lufthansa|airbnb|booking\.com|expedia|fly\b|cruise|ferge|color line|fjordline|duty free/]],
 ['Abonnement & medier',[/tradingview|color club|adobe|microsoft|google \*|apple\.com\/bill|icloud|dropbox|domeneshop|patreon|substack|avis|newspaper/]],
 ['Helse & apotek',[/apotek|vitus|boots|farmasi|lege|tannlege|fysio|helse|pharmac|sykehus/]],
 ['Klær & sko',[/zalando|hm\b|h&m|zara|cubus|dressmann|bikbok|nike|adidas|xxl|sko\b|clothing|apparel|varner|boozt/]],
 ['Personlig pleie',[/frisør|barber|salong|beauty|cosmetic|normal\b|kicks|vita\b/]],
 ['Gaver & veldedighet',[/vipps\*?r(ø|oe)de kors|unicef|leger uten|donation|veldedig|gave|charit/]],
 ['Bygg & oppussing',[/byggmakker|maxbo|montér|monter|jula|biltema|clas ohlson|jernia|obs bygg|bygg|rørlegger|elektriker|maler|lumber|hardware/]],
 ['Hjem & møbler',[/ikea|jysk|skeidar|bohus|kid interi|furniture|home furnish|princess\b/]],
 ['Elektronikk',[/power\b|elkjøp|elkjop|komplett|proshop|dustin|electronic|computer|elektro/]],
 ['Offentlig & avgifter',[/kommune|skatteetaten|politi|kartverk|statens|miljøverk|fylkeskommune|nav\b|toll/]],
 ['Spill & lotteri',[/norsk tipping|tipping|casino|betsson|unibet|lotto/]],
];
const MCAT=[ // if a merchant-category column exists (e.g. card exports)
 [/grocery|supermarket|convenience|food stores|bakeries/,'Dagligvarer'],
 [/eating|restaurant|fast food|caterer/,'Restaurant & takeaway'],
 [/drinking|package stores|beer, wine/,'Uteliv & alkohol'],
 [/cable|pay television/,'Strømmetjenester'],
 [/software|digital goods|digital games|computer network|book stores/,'Abonnement & medier'],
 [/automotive|car wash|parking|service station|taxicab|railway|commuter|transportation/,'Transport'],
 [/lodging|hotel|cruise|airline|travel|duty free/,'Reise & hotell'],
 [/lumber|building materials|home supply|hardware/,'Bygg & oppussing'],
 [/furniture|home furnish/,'Hjem & møbler'],
 [/cosmetic|barber|beauty/,'Personlig pleie'],
 [/pharmac|drug stores/,'Helse & apotek'],
 [/clothing|apparel|shoe|department stores/,'Klær & sko'],
 [/electronic|computers/,'Elektronikk'],
 [/charitable|social service/,'Gaver & veldedighet'],
];
function categorize(t){
 // internal transfer?
 if(t.counterpart&&ownAccts.has(t.counterpart))return {cat:'Intern overføring',type:'Intern'};
 for(const a of ownAccts){if(a&&t.description.replace(/\D/g,'').includes(a))return {cat:'Intern overføring',type:'Intern'};}
 const d=t.description.toLowerCase();
 if(t.mcat){for(const [re,c] of MCAT)if(re.test(t.mcat.toLowerCase()))return {cat:c,type:t.amount<0?'Utgift':'Inntekt'};}
 for(const [cat,res] of RULES){for(const re of res){if(re.test(d))return {cat,type:t.amount<0?'Utgift':'Inntekt'};}}
 // person transfer (Vipps): capitalized name-ish, no company markers
 const comp=/\bas\b|\basa\b|\bab\b|\bsa\b|\.com|\.no|\.se|\*|\bnuf\b|as \d|butikk|store|shop|bank|norwegian|nordnet|sparebank|\bdnb\b|nordea|klarna|paypal|vipps|forsikr|kommune/.test(d);
 // person (Vipps): "Fornavn Etternavn" i Titlecase, ikke STORE BOKSTAVER-butikknavn
 if(!comp&&/^[A-ZÆØÅ][a-zæøå'’\-]+ [A-ZÆØÅ][a-zæøåé'’\-]+/.test(t.description.trim()))return {cat:'Vipps & personoverføringer',type:t.amount<0?'Utgift':'Inntekt'};
 if(t.amount>0)return {cat:'Andre innbetalinger',type:'Inntekt'};
 return {cat:'Diverse/annet',type:'Utgift'};
}
function recategorize(){TX.forEach(t=>{const c=categorize(t);t.baseCat=c.cat;t.type=c.type;});}

/* ---------- file loading ---------- */
function readFile(file){
 return new Promise(res=>{
  const ext=file.name.split('.').pop().toLowerCase();
  const short=file.name.replace(/\.(csv|xlsx|xls)$/i,'').slice(0,18);
  if(ext==='csv'){
   const r=new FileReader();
   r.onload=e=>{let txt=e.target.result;
    const dl=(txt.split('\n')[0].match(/;/g)||[]).length>=(txt.split('\n')[0].match(/,/g)||[]).length?';':',';
    const p=Papa.parse(txt.replace(/^﻿/,''),{header:true,skipEmptyLines:true,delimiter:dl});
    res({name:file.name,short,rows:p.data,headers:p.meta.fields||[]});};
   r.readAsText(file,'utf-8');
  }else{
   const r=new FileReader();
   r.onload=e=>{const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
    const ws=wb.Sheets[wb.SheetNames[0]];const json=XLSX.utils.sheet_to_json(ws,{defval:''});
    res({name:file.name,short,rows:json,headers:Object.keys(json[0]||{})});};
   r.readAsArrayBuffer(file);
  }
 });
}
async function handleFiles(list){
 for(const file of list){const f=await readFile(file);f.map=guessMap(f.headers,f.rows);FILES.push(f);}
 renderFileList();renderMapArea();document.getElementById('goWrap').classList.remove('hide');
}
function renderFileList(){
 document.getElementById('fileList').innerHTML=FILES.map((f,i)=>
  `<div class="frow"><span>📄 ${f.name} <span class="sub">(${f.rows.length} rader)</span></span><b style="cursor:pointer;color:#ff8a80" data-i="${i}">✕</b></div>`).join('');
 document.querySelectorAll('#fileList b').forEach(b=>b.onclick=()=>{FILES.splice(+b.dataset.i,1);renderFileList();renderMapArea();if(!FILES.length)document.getElementById('goWrap').classList.add('hide');});
}
function renderMapArea(){
 const el=document.getElementById('mapArea');if(!FILES.length){el.innerHTML='';return;}
 const opts=(headers,sel)=>'<option value="">—</option>'+headers.map(h=>`<option ${h===sel?'selected':''}>${h}</option>`).join('');
 el.innerHTML=FILES.map((f,i)=>`<div class="card" style="max-width:620px;margin:10px auto;text-align:left">
  <h3>${f.name} — kolonner</h3>
  <div class="map">
   <label>Dato</label><select data-i="${i}" data-f="date">${opts(f.headers,f.map.date)}</select>
   <label>Beskrivelse</label><select data-i="${i}" data-f="desc">${opts(f.headers,f.map.desc)}</select>
   <label>Beløp (ett felt)</label><select data-i="${i}" data-f="amount">${opts(f.headers,f.map.amount)}</select>
   <label>…eller Inn</label><select data-i="${i}" data-f="inn">${opts(f.headers,f.map.inn)}</select>
   <label>…og Ut</label><select data-i="${i}" data-f="ut">${opts(f.headers,f.map.ut)}</select>
   <label>Motkonto (valgfritt)</label><select data-i="${i}" data-f="acctA">${opts(f.headers,f.map.acctA)}</select>
   <label>Motkonto 2 (valgfritt)</label><select data-i="${i}" data-f="acctB">${opts(f.headers,f.map.acctB)}</select>
  </div></div>`).join('');
 el.querySelectorAll('select').forEach(s=>s.onchange=()=>{FILES[+s.dataset.i].map[s.dataset.f]=s.value;});
}

/* ---------- build & show app ---------- */
let curMonth='',curCat='',off=new Set(),sortK='amount',sortDir=1,pie,levSort='sum',levDir=1,monthChart=null,nwChart=null,nwYears=5;
let months=[],COLOR={},CATS=[];
function buildDerived(){
 recategorize();
 TX.sort((a,b)=>a.date.localeCompare(b.date));
 months=[...new Set(TX.map(t=>t.month))].sort();
 CATS=[...new Set(TX.filter(t=>t.type==='Utgift').map(t=>t.baseCat))].sort();
 const PAL=['#4f9cf9','#ff8a80','#7ee2a8','#ffd166','#c792ea','#f78c6b','#80cbc4','#f48fb1','#90caf9','#a5d6a7','#ffab91','#ce93d8','#ffe082','#80deea','#bcaaa4','#e6ee9c','#b39ddb','#81d4fa','#ef9a9a','#a1887f','#9fa8da','#c5e1a5','#ffcc80','#b0bec5','#f8bbd0'];
 [...new Set([...CATS,'Intern overføring','Andre innbetalinger'])].sort().forEach((c,i)=>COLOR[c]=PAL[i%PAL.length]);
}
const gid=t=>t.description+SEP+t.baseCat;
const eff=t=>overrides[gid(t)]||t.baseCat;

/* ---- cloud: parse uploads, save with dedup, load ---- */
function parsePending(){PENDING=[];FILES.forEach(f=>{PENDING=PENDING.concat(applyMap(f));});return PENDING;}
async function savePending(){
 parsePending();
 const msg=document.getElementById('saveMsg');
 if(!PENDING.length){msg.textContent='Fant ingen transaksjoner i filene.';return;}
 await saveOwn(); // persist any newly detected own accounts
 const rows=PENDING.map(t=>({user_id:user.id,tx_date:t.date,account:t.account,description:t.description,amount:t.amount,counterpart:t.counterpart,mcat:t.mcat,source_file:t.acctId,fingerprint:t.fingerprint}));
 // dedup: ignore rows whose (user_id,fingerprint) already exists
 const {data,error}=await sb.from('transactions').upsert(rows,{onConflict:'user_id,fingerprint',ignoreDuplicates:true}).select();
 if(error){msg.textContent='Feil ved lagring: '+error.message;return;}
 const added=data?data.length:0;const dup=rows.length-added;
 msg.textContent=`Lagret ${added} nye transaksjoner. ${dup} duplikat ble hoppet over.`;
 FILES=[];renderFileList();renderMapArea();document.getElementById('goWrap').classList.add('hide');
 await loadData();showApp();
}
async function loadData(){
 // own accounts
 const oa=await sb.from('own_accounts').select('acct,name');ownAccts=new Set((oa.data||[]).map(r=>r.acct));acctNames={};(oa.data||[]).forEach(r=>{if(r.name)acctNames[r.acct]=r.name;});
 // overrides
 const ov=await sb.from('category_overrides').select('group_key,category');overrides={};(ov.data||[]).forEach(r=>overrides[r.group_key]=r.category);
 const gl=await sb.from('category_goals').select('category,monthly_limit');goals={};(gl.data||[]).forEach(r=>goals[r.category]=Number(r.monthly_limit));
 const nw=await sb.from('networth').select('data').maybeSingle();const nd=nw.data&&nw.data.data;networth={assets:(nd&&nd.assets)||[],liabilities:(nd&&nd.liabilities)||[],dismissed:(nd&&nd.dismissed)||[]};
 // transactions (paged)
 TX=[];let from=0;const page=1000;
 while(true){const {data,error}=await sb.from('transactions').select('tx_date,account,description,amount,counterpart,mcat,fingerprint').order('tx_date').range(from,from+page-1);
  if(error){alert('Feil ved lasting: '+error.message);break;}
  (data||[]).forEach(r=>TX.push({date:r.tx_date,month:(r.tx_date||'').slice(0,7),account:r.account,description:r.description,amount:Number(r.amount),counterpart:r.counterpart||'',mcat:r.mcat||'',fingerprint:r.fingerprint}));
  if(!data||data.length<page)break;from+=page;}
 buildDerived();
 await loadSubscription();
}
async function loadSubscription(){
 const {data}=await sb.from('subscriptions').select('status,current_period_end').maybeSingle();
 const okStatus=data&&['active','trialing'].includes(data.status);
 const notExpired=!data||!data.current_period_end||new Date(data.current_period_end)>new Date();
 isPremium=!!(okStatus&&notExpired);
 updatePlanUI();
}
/* ---- premium gating ---- */
function requirePremium(){ if(isPremium)return true; showUpsell(); return false; }
function showUpsell(){document.getElementById('upMsg').textContent='';document.getElementById('upsell').classList.remove('hide');}
function hideUpsell(){document.getElementById('upsell').classList.add('hide');}
async function startCheckout(){
 const msg=document.getElementById('upMsg');msg.textContent='Åpner betaling…';
 const {data:{session}}=await sb.auth.getSession();
 if(!session){msg.textContent='Logg inn først.';return;}
 try{
  const r=await fetch(SUPA_URL+'/functions/v1/create-checkout',{method:'POST',headers:{'Authorization':'Bearer '+session.access_token,'Content-Type':'application/json'}});
  const j=await r.json();
  if(j.url){location.href=j.url;}else{msg.textContent='Kunne ikke starte betaling: '+(j.error||'ukjent feil');}
 }catch(e){msg.textContent='Nettverksfeil: '+e;}
}
function showApp(){
 document.getElementById('auth').classList.add('hide');
 document.getElementById('landing').classList.add('hide');
 document.getElementById('app').classList.remove('hide');
 document.getElementById('sub').textContent=`${TX.length?TX[0].date:''} – ${TX.length?TX[TX.length-1].date:''} · ${TX.length} transaksjoner`;
 const mb=document.getElementById('months');mb.innerHTML='';
 const latest=months[months.length-1];
 const locked=v=>!isPremium&&v!==latest;   // gratis kan bare se siste måned
 if(!isPremium)curMonth=latest||'';
 const mk=(l,v)=>{const b=document.createElement('button');b.className='mbtn';b.textContent=l+(locked(v)?' 🔒':'');
  b.onclick=()=>{if(locked(v)){showUpsell();return;}curMonth=v;render();};return b;};
 mb.appendChild(mk('Alle',''));months.forEach(m=>mb.appendChild(mk(m,m)));
 render();renderKonto();
}
function showUpload(){document.getElementById('auth').classList.add('hide');document.getElementById('app').classList.add('hide');document.getElementById('landing').classList.remove('hide');}
function base(){
 const latest=months[months.length-1];
 const mFilter=isPremium?curMonth:latest;   // gratis: kun siste måned
 return TX.filter(t=>t.type!=='Intern'&&(!mFilter||t.month===mFilter));
}
function esc(s){return (''+(s||'')).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function kpi(l,v,c){return `<div class="kpi"><div class="l">${l}</div><div class="v ${c}">${v}</div></div>`}

function renderMonthTrend(){
 const el=document.getElementById('monthChart');if(!el)return;
 const bm={};TX.filter(t=>t.type==='Utgift').forEach(t=>bm[t.month]=(bm[t.month]||0)+(-t.amount));
 const ms=Object.keys(bm).sort();
 if(monthChart)monthChart.destroy();
 monthChart=new Chart(el,{type:'bar',data:{labels:ms,datasets:[{data:ms.map(m=>Math.round(bm[m])),backgroundColor:ms.map(m=>m===curMonth?'#4f9cf9':'#33608f'),borderRadius:4}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>NOK(c.raw)}}},
   scales:{x:{ticks:{color:'#8ba0b6',font:{size:10}},grid:{display:false}},y:{ticks:{color:'#8ba0b6',callback:v=>Math.round(v/1000)+'k'},grid:{color:'#243447'}}},
   onClick:(e,a)=>{if(a.length){const m=ms[a[0].index];curMonth=(curMonth===m?'':m);render();}}}});
}
function renderMoM(){
 const el=document.getElementById('momCard');if(!el)return;
 const ms=[...new Set(TX.filter(t=>t.type==='Utgift').map(t=>t.month))].sort();
 const target=curMonth||ms[ms.length-1];const idx=ms.indexOf(target);const prev=idx>0?ms[idx-1]:null;
 if(!prev){el.innerHTML=`<h3>Endring fra forrige måned</h3><div class="sub">Trenger minst to måneder med data.</div>`;return;}
 const sum=m=>{const o={};TX.filter(t=>t.type==='Utgift'&&t.month===m).forEach(t=>{const c=eff(t);o[c]=(o[c]||0)+(-t.amount);});return o;};
 const a=sum(target),b=sum(prev);
 const cats=[...new Set([...Object.keys(a),...Object.keys(b)])];
 const rows=cats.map(c=>({c,then:b[c]||0,d:(a[c]||0)-(b[c]||0)})).filter(r=>Math.abs(r.d)>=100).sort((x,y)=>Math.abs(y.d)-Math.abs(x.d)).slice(0,6);
 const tot=Object.values(a).reduce((x,y)=>x+y,0)-Object.values(b).reduce((x,y)=>x+y,0);
 el.innerHTML=`<h3>Endring: ${esc(target)} vs ${esc(prev)}</h3>
  <div class="sub" style="margin:-4px 0 8px">Totalt <b style="color:${tot>0?'#ff8a80':'#7ee2a8'}">${tot>=0?'+':'−'}${NOK(Math.abs(tot))}</b> ${tot>0?'mer':'mindre'} enn forrige måned.</div>
  ${rows.length?rows.map(r=>{const up=r.d>0;const pct=r.then>0?Math.round(r.d/r.then*100):100;
    return `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--line)"><span>${esc(r.c)}</span><span class="sub"><b style="color:${up?'#ff8a80':'#7ee2a8'}">${up?'▲':'▼'} ${NOK(Math.abs(r.d))}</b> ${r.then>0?'('+(up?'+':'−')+Math.abs(pct)+'%)':'(ny)'}</span></div>`;}).join(''):'<div class="sub">Ingen store endringer.</div>'}`;
}
function detectSubs(){
 const norm=d=>d.toLowerCase().replace(/\s*\S*\d\S*$/,'').replace(/[^a-zæøå ]/g,'').trim();
 const allMonths=[...new Set(TX.map(t=>t.month))].sort();
 const g={};
 TX.filter(t=>t.type==='Utgift').forEach(t=>{const k=norm(t.description)||t.description.toLowerCase();
   (g[k]=g[k]||{name:t.description,months:new Set(),amts:[]});g[k].months.add(t.month);g[k].amts.push({a:-t.amount,d:t.date});});
 const subs=[];
 for(const k in g){const v=g[k];if(v.months.size>=3){
   v.amts.sort((x,y)=>x.d.localeCompare(y.d));
   const arr=v.amts.map(x=>x.a).slice().sort((a,b)=>a-b);const med=arr[Math.floor(arr.length/2)];
   if(med<30)continue;
   const firstMonth=[...v.months].sort()[0];
   subs.push({name:v.name,perMonth:med,n:v.months.size,last:v.amts[v.amts.length-1].a,
     startedRecently:allMonths.indexOf(firstMonth)>=allMonths.length-2,
     increased:v.amts[v.amts.length-1].a>v.amts[0].a*1.15});
 }}
 return subs.sort((a,b)=>b.perMonth-a.perMonth);
}
function render(){
 const mb=document.getElementById('months');
 [...mb.children].forEach((b,i)=>b.classList.toggle('on',(i===0&&!curMonth)||b.textContent===curMonth));
 const d=base();
 const exp=d.filter(t=>t.type==='Utgift'),inc=d.filter(t=>t.type==='Inntekt');
 const sE=exp.reduce((a,t)=>a+t.amount,0),sI=inc.reduce((a,t)=>a+t.amount,0);
 document.getElementById('kpis').innerHTML=kpi('Utgifter',NOK(sE),'neg')+kpi('Inntekter',NOK(sI),'pos')+kpi('Netto',NOK(sI+sE),(sI+sE)>=0?'pos':'neg')+kpi('Antall kjøp',exp.length,'');
 // sparemål-varsel
 const ga=document.getElementById('goalAlerts');
 if(ga){
  const nMg=Math.max(1,new Set(exp.map(t=>t.month)).size);
  const cmg={};exp.forEach(t=>{const c=eff(t);cmg[c]=(cmg[c]||0)+(-t.amount);});
  const breaches=Object.keys(goals).filter(c=>cmg[c]!=null&&cmg[c]/nMg>goals[c]).map(c=>({c,a:cmg[c]/nMg,l:goals[c]}));
  ga.innerHTML=breaches.length?`<div class="card" style="border-color:#7a3030;background:#25161a">
    <div style="font-weight:600;color:#ff8a80;margin-bottom:6px">⚠ Over sparemål i ${breaches.length} ${breaches.length===1?'kategori':'kategorier'}</div>
    ${breaches.map(b=>`<div class="sub" style="color:#f4c6c6">${esc(b.c)}: ${NOK(b.a)}/mnd av mål ${NOK(b.l)}/mnd <b style="color:#ff8a80">(+${NOK(b.a-b.l)}/mnd)</b></div>`).join('')}</div>`:'';
 }
 const cm={};exp.forEach(t=>{const c=eff(t);cm[c]=(cm[c]||0)+t.amount;});
 const ce=Object.entries(cm).sort((a,b)=>a[1]-b[1]);
 const shown=ce.filter(([c])=>!off.has(c));
 document.getElementById('cTot').textContent=NOK(shown.reduce((a,x)=>a-x[1],0));
 const labels=shown.map(x=>x[0]),vals=shown.map(x=>-x[1]),cols=labels.map(c=>COLOR[c]||'#888');
 if(pie)pie.destroy();
 pie=new Chart(document.getElementById('pie'),{type:'doughnut',data:{labels,datasets:[{data:vals,backgroundColor:cols,borderColor:'#182534',borderWidth:2,hoverOffset:8}]},
  options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${c.label}: ${NOK(c.raw)} (${(c.raw/vals.reduce((a,b)=>a+b,0)*100).toFixed(1)}%)`}}},
   onClick:(e,el)=>{if(el.length){const c=labels[el[0].index];curCat=(curCat===c?'':c);render();}}}});
 const tot=ce.reduce((a,x)=>a-x[1],0);
 document.getElementById('legend').innerHTML=ce.map(([c,v])=>`<div class="lg ${off.has(c)?'off':''}" data-c="${esc(c)}" style="${curCat===c?'background:#20344a':''}"><span class="dot" style="background:${COLOR[c]||'#888'}"></span><span class="nm">${esc(c)}</span><span class="amt">${NOK(-v)}</span><span class="pct">${tot?(-v/tot*100).toFixed(0):0}%</span></div>`).join('');
 document.querySelectorAll('#legend .lg').forEach(el=>el.onclick=ev=>{const c=el.dataset.c;if(ev.shiftKey){off.has(c)?off.delete(c):off.add(c);}else{curCat=(curCat===c?'':c);}render();});
 const q=document.getElementById('q').value.trim().toLowerCase();
 let rows=exp.slice();
 if(q)rows=rows.filter(t=>t.description.toLowerCase().includes(q));
 else if(curCat)rows=rows.filter(t=>eff(t)===curCat);
 rows.sort((a,b)=>{let x=sortK==='category'?eff(a):a[sortK],y=sortK==='category'?eff(b):b[sortK];return sortK==='amount'?(x-y)*sortDir:(''+x).localeCompare(''+y)*sortDir;});
 const rs=rows.reduce((a,t)=>a+t.amount,0);
 document.getElementById('tblTitle').textContent=q?`«${q}» — ${rows.length} kjøp · ${NOK(rs)}`:(curCat?`${curCat} — ${rows.length} kjøp · ${NOK(rs)}`:`Alle utgifter — ${rows.length} kjøp · ${NOK(rs)}`);
 document.querySelector('#tbl tbody').innerHTML=rows.map(t=>`<tr><td>${t.date}</td><td>${esc(acctNames[t.account]||t.account)}</td><td class="desc" data-name="${esc(t.description.split(/\s+/).slice(0,2).join(' '))}">${esc(t.description)}</td><td><span class="pill">${esc(eff(t))}</span></td><td class="num neg">${NOK(t.amount)} <span class="del" title="Slett transaksjon" data-fp="${esc(t.fingerprint||'')}">✕</span></td></tr>`).join('');
 if(!document.getElementById('viewLev').classList.contains('hide'))renderLev();
 if(!document.getElementById('viewRaad').classList.contains('hide'))renderTips();
 renderMonthTrend();renderMoM();
 renderAds();
}
async function deleteOne(fp){
 if(!fp||!user)return;
 await sb.from('transactions').delete().eq('user_id',user.id).eq('fingerprint',fp);
 TX=TX.filter(t=>t.fingerprint!==fp);buildDerived();render();renderKonto();
 document.getElementById('sub').textContent=`${TX.length?TX[0].date:''} – ${TX.length?TX[TX.length-1].date:''} · ${TX.length} transaksjoner`;
}
async function resetAccount(){
 if(!user)return;
 if(!confirm('Slette ALLE transaksjonene dine permanent? Dette kan ikke angres.'))return;
 await sb.from('transactions').delete().eq('user_id',user.id);
 TX=[];buildDerived();renderKonto();render();showUpload();
}
function renderLev(){
 const q=document.getElementById('qlev').value.trim().toLowerCase();
 const g={};TX.filter(t=>t.type==='Utgift').forEach(t=>{const k=gid(t);if(!g[k])g[k]={name:t.description,base:t.baseCat,cnt:0,sum:0};g[k].cnt++;g[k].sum+=t.amount;});
 let arr=Object.entries(g).map(([k,v])=>({k,...v,eff:overrides[k]||v.base}));
 if(q)arr=arr.filter(x=>x.name.toLowerCase().includes(q));
 arr.sort((a,b)=>{let x=a[levSort],y=b[levSort];return (levSort==='sum'||levSort==='cnt')?(x-y)*levDir:(''+x).localeCompare(''+y)*levDir;});
 const allCats=[...new Set([...RULES.map(r=>r[0]),'Vipps & personoverføringer','Andre innbetalinger','Diverse/annet',...CATS,...Object.values(overrides)])].sort();
 const opt=c=>allCats.map(o=>`<option ${o===c?'selected':''}>${esc(o)}</option>`).join('');
 document.querySelector('#levtbl tbody').innerHTML=arr.map(x=>`<tr><td>${esc(x.name)}</td><td class="num">${x.cnt}</td><td class="num neg">${NOK(x.sum)}</td><td><select class="catsel ${x.eff!==x.base?'changed':''}" data-k="${esc(x.k)}">${opt(x.eff)}</select></td></tr>`).join('');
 document.querySelectorAll('#levtbl select.catsel').forEach(s=>s.onchange=()=>{
   if(!isPremium){showUpsell();renderLev();return;}
   const k=s.dataset.k,base=k.split(SEP)[1];if(s.value===base)delete overrides[k];else overrides[k]=s.value;saveOv();render();});
}
function renderKonto(){
 const wrap=document.getElementById('ownChips');const accts=[...ownAccts];
 wrap.innerHTML=accts.length?accts.map(a=>`<div style="display:flex;gap:10px;align-items:center;margin-bottom:7px;flex-wrap:wrap">
    <input class="txt acctname" data-a="${esc(a)}" value="${esc(acctNames[a]||'')}" placeholder="Navn (f.eks. Lønnskonto)" style="min-width:200px">
    <span class="sub" style="font-variant-numeric:tabular-nums">${esc(a)}</span>
    <b data-del="${esc(a)}" title="Fjern konto" style="cursor:pointer;color:#ff8a80;margin-left:auto">✕</b>
   </div>`).join(''):'<span class="sub">Ingen kontoer registrert ennå.</span>';
 wrap.querySelectorAll('.acctname').forEach(inp=>inp.onchange=()=>{const a=inp.dataset.a,v=inp.value.trim();if(v)acctNames[a]=v;else delete acctNames[a];saveOwn();render();});
 wrap.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{const a=b.dataset.del;ownAccts.delete(a);delete acctNames[a];saveOwn();buildDerived();renderKonto();render();});
 const n=TX.filter(t=>t.type==='Intern').length;
 document.getElementById('internNote').textContent=`${n} transaksjoner er markert som interne overføringer og holdt utenfor.`;
}
/* ---- spareråd (regelbasert innsikt) ---- */
function renderTips(){
 const area=document.getElementById('tipsArea');
 if(!isPremium){
  area.innerHTML=`<div class="card" style="text-align:center;padding:22px">
    <div style="font-weight:700;font-size:17px;margin-bottom:6px">Spareråd er en Premium-funksjon</div>
    <div class="sub" style="max-width:470px;margin:0 auto 14px">Få personlige forslag basert på tallene dine – hvor du kan kutte, hvor mye du kan spare, og sett månedlige sparemål per kategori med fremdrift.</div>
    <button class="btn" id="tipsUp">Oppgrader for å låse opp</button></div>`;
  document.getElementById('tipsUp').onclick=showUpsell;
  return;
 }
 const exp=base().filter(t=>t.type==='Utgift');
 const inc=base().filter(t=>t.type==='Inntekt');
 const nM=Math.max(1,new Set(exp.map(t=>t.month)).size);
 const byCat={};exp.forEach(t=>{const c=eff(t);byCat[c]=(byCat[c]||0)+(-t.amount);});
 const totalExp=Object.values(byCat).reduce((a,b)=>a+b,0);
 const totalInc=inc.reduce((a,t)=>a+t.amount,0);
 const perM=v=>NOK(v/nM)+'/mnd';
 const tips=[];let potential=0;
 // bruker mer enn du tjener
 if(totalInc>0&&totalExp>totalInc){
  tips.push({t:'Du bruker mer enn du får inn',b:`I denne perioden gikk det ut ${NOK(totalExp-totalInc)} mer enn du fikk inn. De største kategoriene nedenfor er stedene å begynne.`});}
 // valgfrie utgifter (servering/uteliv/underholdning)
 const disc=['Restaurant & takeaway','Uteliv & alkohol','Fritid & underholdning'];
 const discSum=disc.reduce((a,c)=>a+(byCat[c]||0),0);
 if(discSum>500){const s=discSum*0.3;potential+=s;
  tips.push({t:'Servering, uteliv og underholdning',b:`Du brukte ${NOK(discSum)} (${perM(discSum)}) her. Kutter du dette med 30 % frigjør du rundt <b>${perM(s)}</b> – uten å endre faste utgifter.`});}
 // abonnementer
 const subCats=['Abonnement & medier','Strømmetjenester'];
 const subNames=new Set(exp.filter(t=>subCats.includes(eff(t))).map(t=>t.description.replace(/\s*\S*\d\S*$/,'').trim().toLowerCase()).filter(Boolean));
 const subSum=subCats.reduce((a,c)=>a+(byCat[c]||0),0);
 if(subSum>300){const s=subSum*0.25;potential+=s;
  tips.push({t:'Abonnementer',b:`Du har rundt ${subNames.size||'flere'} abonnementstjenester til sammen ${perM(subSum)}. Gå gjennom dem i «Leverandører» og si opp det du ikke bruker – ofte kan man kutte 1–2 stk og spare <b>${perM(s)}</b>.`});}
 // lån/kreditt -> refinansiering
 if((byCat['Lån & kreditt']||0)>0){
  tips.push({t:'Renter og kreditt',b:`Du betalte ${NOK(byCat['Lån & kreditt'])} på lån/kreditt i perioden. Har du flere smålån eller kredittkortgjeld, kan refinansiering til én lavere rente kutte rentekostnaden.`});}
 // dagligvarer stort
 if((byCat['Dagligvarer']||0)>0&&(byCat['Dagligvarer']/totalExp)>0.28){
  tips.push({t:'Dagligvarer',b:`Dagligvarer er ${(byCat['Dagligvarer']/totalExp*100).toFixed(0)} % av forbruket (${perM(byCat['Dagligvarer'])}). Handleliste, tilbud og litt mindre bruk av nærbutikk kan monne.`});}
 // største post
 const top=Object.entries(byCat).sort((a,b)=>b[1]-a[1])[0];
 if(top)tips.push({t:'Største utgiftspost',b:`${esc(top[0])} er din største kategori: ${NOK(top[1])} (${(top[1]/totalExp*100).toFixed(0)} % av utgiftene).`});
 const head=potential>0?`<div class="card" style="border-color:#2e6b4a;background:#12231b">
   <div class="sub">Anslått mulig innsparing</div>
   <div style="font-size:26px;font-weight:800;color:#7ee2a8;margin:2px 0">${perM(potential)}</div>
   <div class="sub">hvis du følger forslagene under. Kun et estimat basert på tallene dine.</div></div>`:'';
 const pm=v=>v/nM;
 const topCats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,8);
 const goalRows=topCats.map(([c,v])=>{
   const actual=pm(v);
   if(goals[c]!=null){
     const lim=goals[c];const over=actual>lim;const pct=Math.min(100,Math.round(actual/Math.max(1,lim)*100));
     const mx=Math.max(50,Math.ceil(actual*1.2/50)*50);
     const red=actual>0?Math.round((actual-lim)/actual*100):0;
     return `<div class="card goalcard" data-c="${esc(c)}" data-actual="${Math.round(actual)}" style="margin:0 0 8px">
       <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="font-weight:600">${esc(c)}</div>
        <div class="sub"><b class="gv" style="color:${over?'#ff8a80':'#7ee2a8'}">${NOK(actual)}/mnd</b> av mål <b class="gl">${NOK(lim)}</b>/mnd <b data-goal-del="${esc(c)}" title="Fjern mål" style="margin-left:8px;cursor:pointer;color:#ff8a80">✕</b></div>
       </div>
       <input type="range" class="gslider" min="0" max="${mx}" step="50" value="${lim}" style="margin:10px 0 2px">
       <div class="sub gmeta">Dra for å justere · ${red>=0?'−'+red+'% vs snitt':'over snitt'} · ${over?'over målet nå':'innenfor målet'}</div>
       <div style="height:8px;background:#0f1620;border-radius:6px;margin-top:6px;overflow:hidden"><div class="gbar" style="height:100%;width:${pct}%;background:${over?'#ff8a80':'#7ee2a8'}"></div></div>
     </div>`;
   }
   return `<div class="card" style="margin:0 0 8px;display:flex;justify-content:space-between;align-items:center;gap:8px">
     <div><div style="font-weight:600">${esc(c)}</div><div class="sub">${NOK(actual)}/mnd i snitt</div></div>
     <button class="clr goal-set" data-goal-cat="${esc(c)}" data-goal-val="${Math.round(actual*0.7/50)*50}">Sett mål</button></div>`;
 }).join('');
 const subs=detectSubs();
 const subsHtml=`<div class="card" style="background:none;border:none;padding:0;margin-top:2px"><h3>Abonnementer og faste trekk</h3><div class="sub" style="margin:-4px 0 8px">Leverandører som trekker deg jevnlig. Merket «ny» hvis nylig startet, «økt» hvis beløpet har steget.</div>`
   +(subs.length?subs.slice(0,12).map(s=>`<div class="card" style="margin:0 0 6px;display:flex;justify-content:space-between;align-items:center;gap:8px"><div><div style="font-weight:600">${esc(s.name)} ${s.startedRecently?'<span class="pill" style="background:#1b3b2a;color:#7ee2a8">ny</span>':''}${s.increased?' <span class="pill" style="background:#3b2a1b;color:#ffd166">økt</span>':''}</div><div class="sub">${s.n} måneder · sist ${NOK(s.last)}</div></div><div style="font-weight:700;white-space:nowrap">${NOK(s.perMonth)}/mnd</div></div>`).join(''):'<div class="sub">Fant ingen faste trekk ennå.</div>')+`</div>`;
 area.innerHTML=head
   +(tips.length?tips.map(x=>`<div class="card"><div style="font-weight:600;margin-bottom:4px">${esc(x.t)}</div><div style="font-size:13.5px;color:#dbe4ee;line-height:1.5">${x.b}</div></div>`).join(''):'')
   +subsHtml
   +`<div class="card" style="background:none;border:none;padding:0;margin-top:2px"><h3>Sett sparemål per kategori</h3><div class="sub" style="margin:-4px 0 8px">Sett en månedlig grense og dra i slideren for å justere. Følg fremdriften hver måned.</div>${goalRows}</div>`;
 area.querySelectorAll('.goal-set').forEach(b=>b.onclick=()=>{goals[b.dataset.goalCat]=Number(b.dataset.goalVal);saveGoals();renderTips();});
 area.querySelectorAll('[data-goal-del]').forEach(b=>b.onclick=(e)=>{e.stopPropagation();delete goals[b.dataset.goalDel];saveGoals();renderTips();});
 area.querySelectorAll('.goalcard').forEach(card=>{
   const c=card.dataset.c,actual=Number(card.dataset.actual),sl=card.querySelector('.gslider');
   sl.oninput=()=>{const val=Number(sl.value);goals[c]=val;const over=actual>val;
     card.querySelector('.gl').textContent=NOK(val);
     card.querySelector('.gv').style.color=over?'#ff8a80':'#7ee2a8';
     const p=Math.min(100,Math.round(actual/Math.max(1,val)*100));const bar=card.querySelector('.gbar');
     bar.style.width=p+'%';bar.style.background=over?'#ff8a80':'#7ee2a8';
     const r=actual>0?Math.round((actual-val)/actual*100):0;
     card.querySelector('.gmeta').textContent=`Dra for å justere · ${r>=0?'−'+r+'% vs snitt':'over snitt'} · ${over?'over målet nå':'innenfor målet'}`;};
   sl.onchange=()=>saveGoals();
 });
}
/* ---- formue / nettoformue ---- */
// Standard %/år = historiske snitt: bolig ~5,4 % (SSB, siden 2005), globalt indeksfond ~7 % netto (MSCI World), bil ~−15 %/år verditap.
const ASSET_CATS={'Bolig':5,'Hytte':3,'Bil':-15,'Kjøretøy':-12,'Båt':-8,'Aksjer/fond':7,'Sparekonto':3,'Kontanter':0,'Annet':0};
const LIAB_CATS=['Boliglån','Billån','Studielån','Forbrukslån','Kredittkort','Annet'];
function nwMonthlySavings(){const inc=TX.filter(t=>t.type==='Inntekt').reduce((s,t)=>s+t.amount,0);const exp=TX.filter(t=>t.type==='Utgift').reduce((s,t)=>s+t.amount,0);const nm=Math.max(1,new Set(TX.map(t=>t.month)).size);return (inc+exp)/nm;}
function nwProject(years){
 const ms=nwMonthlySavings();
 let A=(networth.assets||[]).map(x=>({v:+x.value||0,r:(+x.rate||0)/100}));
 let L=(networth.liabilities||[]).map(x=>({b:+x.balance||0,r:(+x.rate||0)/100,p:+x.monthly||0}));
 let cash=0;const pts=[A.reduce((s,x)=>s+x.v,0)-L.reduce((s,x)=>s+x.b,0)];
 for(let m=1;m<=years*12;m++){
   cash+=ms;
   A.forEach(x=>x.v*=(1+x.r/12));
   L.forEach(x=>{const it=x.b*x.r/12;const pr=Math.max(0,Math.min(x.b,x.p-it));x.b=Math.max(0,x.b-pr);});
   if(m%12===0)pts.push(cash+A.reduce((s,x)=>s+x.v,0)-L.reduce((s,x)=>s+x.b,0));
 }
 return pts;
}
const LIAB_RATE={'Boliglån':5.5,'Billån':7,'Studielån':4.5,'Forbrukslån':13,'Kredittkort':22,'Annet':6};
function nwDebtSuggestions(){
 const norm=d=>d.toLowerCase().replace(/\s*\S*\d\S*$/,'').replace(/[^a-zæøå ]/g,'').trim();
 const debtRe=/santander|svea|instabank|bank ?norwegian|l(å|a)nekassen|studiel(å|a)n|boligl(å|a)n|bill(å|a)n|kreditt|\bl(å|a)n\b/;
 const g={};
 TX.filter(t=>t.type==='Utgift'&&(t.baseCat==='Lån & kreditt'||debtRe.test(t.description.toLowerCase())||/^til:?\s*325083/.test(t.description.toLowerCase()))).forEach(t=>{
   const k=norm(t.description)||t.description.toLowerCase();
   (g[k]=g[k]||{name:t.description,months:new Set(),amts:[]});g[k].months.add(t.month);g[k].amts.push(-t.amount);});
 const out=[];
 for(const k in g){const v=g[k];if(v.months.size>=3){const arr=v.amts.slice().sort((a,b)=>a-b);const med=arr[Math.floor(arr.length/2)];if(med<200)continue;
   const d=v.name.toLowerCase();let cat='Forbrukslån';
   if(/l(å|a)nekassen|studiel(å|a)n/.test(d))cat='Studielån';else if(/santander|bil/.test(d))cat='Billån';else if(/^til:?\s*325083|boligl(å|a)n/.test(d)||med>10000)cat='Boliglån';
   out.push({name:v.name,monthly:Math.round(med),cat});}}
 const have=new Set((networth.liabilities||[]).map(x=>(x.name||'').toLowerCase()));
 const dis=new Set((networth.dismissed||[]).map(x=>(x||'').toLowerCase()));
 return out.filter(s=>!have.has(s.name.toLowerCase())&&!dis.has(s.name.toLowerCase())).sort((a,b)=>b.monthly-a.monthly);
}
function nwAssetSuggestions(){
 const norm=d=>d.toLowerCase().replace(/\s*\S*\d\S*$/,'').replace(/[^a-zæøå ]/g,'').trim();
 const invRe=/nordnet|pareto|aksjesparing|aksjekapital|\bfond\b|kron\b|firi|coinbase|bob invest|hyrbart|obligasjon/;
 const savRe=/sparekonto|sm(å|aa)sparing|spareavtale|bufferkonto/;
 const g={};
 TX.filter(t=>t.type==='Utgift'&&(t.baseCat==='Sparing/investering'||invRe.test(t.description.toLowerCase())||savRe.test(t.description.toLowerCase()))).forEach(t=>{
   const k=norm(t.description)||t.description.toLowerCase();
   (g[k]=g[k]||{name:t.description,months:new Set(),tot:0}); g[k].months.add(t.month); g[k].tot+=-t.amount;});
 const out=[];
 for(const k in g){const v=g[k];if((v.months.size>=3&&v.tot>=1000)||v.tot>=20000){const d=v.name.toLowerCase();
   const cat=savRe.test(d)?'Sparekonto':'Aksjer/fond';
   out.push({name:v.name,cat,tot:v.tot});}}
 const have=new Set((networth.assets||[]).map(x=>(x.name||'').toLowerCase()));
 const dis=new Set((networth.dismissed||[]).map(x=>(x||'').toLowerCase()));
 return out.filter(s=>!have.has(s.name.toLowerCase())&&!dis.has(s.name.toLowerCase())).sort((a,b)=>b.tot-a.tot).slice(0,6);
}
function renderNetworth(){
 const A=networth.assets||[],L=networth.liabilities||[];
 const sumA=A.reduce((s,x)=>s+(+x.value||0),0),sumL=L.reduce((s,x)=>s+(+x.balance||0),0),net=sumA-sumL,ms=nwMonthlySavings();
 document.getElementById('nwKpis').innerHTML=kpi('Eiendeler',NOK(sumA),'pos')+kpi('Gjeld',NOK(sumL),'neg')+kpi('Nettoformue',NOK(net),net>=0?'pos':'neg')+kpi('Sparing/mnd',NOK(ms),ms>=0?'pos':'neg');
 const aopts=c=>Object.keys(ASSET_CATS).map(o=>`<option ${o===c?'selected':''}>${o}</option>`).join('');
 document.getElementById('assetList').innerHTML='<div class="sub" style="margin:-2px 0 8px">%/år er forhåndsutfylt med historiske snitt (bolig ~5 %, aksjer/fond ~7 %, bil −15 %) – juster fritt.</div><div class="nwhead" style="grid-template-columns:1fr 110px 92px 66px 18px"><div>Navn</div><div>Kategori</div><div>Verdi (kr)</div><div>%/år</div><div></div></div>'+(A.length?A.map((x,i)=>`<div style="display:grid;grid-template-columns:1fr 110px 92px 66px 18px;gap:6px;align-items:center;margin-bottom:6px">
    <input class="txt nwf" data-l="assets" data-i="${i}" data-f="name" value="${esc(x.name||'')}" placeholder="Navn">
    <select class="nwf" data-l="assets" data-i="${i}" data-f="cat">${aopts(x.cat)}</select>
    <input class="txt nwf" data-l="assets" data-i="${i}" data-f="value" value="${esc(x.value??'')}" placeholder="Verdi" inputmode="numeric">
    <input class="txt nwf" data-l="assets" data-i="${i}" data-f="rate" value="${esc(x.rate??'')}" placeholder="%/år" inputmode="numeric" title="Årlig verdiendring i %">
    <b class="nwdel" data-l="assets" data-i="${i}" title="Fjern" style="cursor:pointer;color:#ff8a80">✕</b></div>`).join(''):'<div class="sub">Ingen eiendeler lagt inn ennå.</div>');
 const asugg=nwAssetSuggestions();
 if(asugg.length)document.getElementById('assetList').innerHTML+=`<div class="sub" style="margin:12px 0 4px">Foreslått fra bankdataene – trykk for å legge til (fyll inn verdi etterpå):</div>`
   +asugg.map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px"><div><b>${esc(s.name)}</b> <span class="pill">${s.cat}</span></div><div style="display:flex;gap:6px;align-items:center;flex:0 0 auto"><button class="clr nwadd" data-kind="assets" data-name="${esc(s.name)}" data-cat="${s.cat}">+ Legg til</button><b class="nwdismiss" data-name="${esc(s.name)}" title="Avvis forslag" style="cursor:pointer;color:#8ba0b6;padding:0 4px">✕</b></div></div>`).join('');
 const lopts=c=>LIAB_CATS.map(o=>`<option ${o===c?'selected':''}>${o}</option>`).join('');
 document.getElementById('liabList').innerHTML='<div class="nwhead" style="grid-template-columns:1fr 96px 92px 56px 66px 18px"><div>Navn</div><div>Kategori</div><div>Saldo (kr)</div><div>Rente %</div><div>Kr/mnd</div><div></div></div>'+(L.length?L.map((x,i)=>`<div style="display:grid;grid-template-columns:1fr 96px 92px 56px 66px 18px;gap:6px;align-items:center;margin-bottom:6px">
    <input class="txt nwf" data-l="liabilities" data-i="${i}" data-f="name" value="${esc(x.name||'')}" placeholder="Navn">
    <select class="nwf" data-l="liabilities" data-i="${i}" data-f="cat">${lopts(x.cat)}</select>
    <input class="txt nwf" data-l="liabilities" data-i="${i}" data-f="balance" value="${esc(x.balance??'')}" placeholder="Saldo" inputmode="numeric">
    <input class="txt nwf" data-l="liabilities" data-i="${i}" data-f="rate" value="${esc(x.rate??'')}" placeholder="rente%" inputmode="numeric">
    <input class="txt nwf" data-l="liabilities" data-i="${i}" data-f="monthly" value="${esc(x.monthly??'')}" placeholder="kr/mnd" inputmode="numeric" title="Månedlig nedbetaling">
    <b class="nwdel" data-l="liabilities" data-i="${i}" title="Fjern" style="cursor:pointer;color:#ff8a80">✕</b></div>`).join(''):'<div class="sub">Ingen gjeld lagt inn ennå.</div>');
 const sugg=nwDebtSuggestions();
 if(sugg.length)document.getElementById('liabList').innerHTML+=`<div class="sub" style="margin:12px 0 4px">Foreslått fra bankdataene – trykk for å legge til (fyll inn saldo/rente etterpå):</div>`
   +sugg.map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px"><div><b>${esc(s.name)}</b> <span class="pill">${s.cat}</span> <span class="sub">~${NOK(s.monthly)}/mnd</span></div><div style="display:flex;gap:6px;align-items:center;flex:0 0 auto"><button class="clr nwadd" data-kind="liabilities" data-name="${esc(s.name)}" data-cat="${s.cat}" data-monthly="${s.monthly}">+ Legg til</button><b class="nwdismiss" data-name="${esc(s.name)}" title="Avvis forslag" style="cursor:pointer;color:#8ba0b6;padding:0 4px">✕</b></div></div>`).join('');
 document.querySelectorAll('.nwadd').forEach(b=>b.onclick=()=>{
   if(b.dataset.kind==='assets')networth.assets.push({name:b.dataset.name,cat:b.dataset.cat,value:'',rate:ASSET_CATS[b.dataset.cat]??0});
   else networth.liabilities.push({name:b.dataset.name,cat:b.dataset.cat,balance:'',rate:LIAB_RATE[b.dataset.cat]||5,monthly:Number(b.dataset.monthly||0)});
   saveNetworth();renderNetworth();});
 document.querySelectorAll('.nwdismiss').forEach(b=>b.onclick=()=>{networth.dismissed=networth.dismissed||[];networth.dismissed.push((b.dataset.name||'').toLowerCase());saveNetworth();renderNetworth();});
 document.querySelectorAll('.nwf').forEach(el=>el.onchange=()=>{const lst=el.dataset.l,i=+el.dataset.i,f=el.dataset.f;let v=el.value;
   if(['value','rate','balance','monthly'].includes(f))v=v===''?'':parseFloat((''+v).replace(/[^0-9.,\-]/g,'').replace(',','.'));
   networth[lst][i][f]=v;saveNetworth();renderNetworth();});
 document.querySelectorAll('.nwdel').forEach(b=>b.onclick=()=>{networth[b.dataset.l].splice(+b.dataset.i,1);saveNetworth();renderNetworth();});
 const yb=document.getElementById('nwYears');yb.innerHTML=[1,3,5,10].map(y=>`<button class="mbtn ${y===nwYears?'on':''}" data-y="${y}">${y} år</button>`).join('');
 yb.querySelectorAll('button').forEach(b=>b.onclick=()=>{nwYears=+b.dataset.y;renderNetworth();});
 const pts=nwProject(nwYears),labels=pts.map((_,i)=>i===0?'Nå':'+'+i+' år');
 if(nwChart)nwChart.destroy();
 nwChart=new Chart(document.getElementById('nwChart'),{type:'line',data:{labels,datasets:[{data:pts.map(Math.round),borderColor:'#4f9cf9',backgroundColor:'rgba(79,156,249,.15)',fill:true,tension:.25,pointRadius:3}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>NOK(c.raw)}}},
   scales:{x:{ticks:{color:'#8ba0b6'},grid:{display:false}},y:{ticks:{color:'#8ba0b6',callback:v=>Math.round(v/1000)+'k'},grid:{color:'#243447'}}}}});
 const end=pts[pts.length-1],diff=end-pts[0];
 document.getElementById('nwProjNote').innerHTML=`Om ${nwYears} år: <b style="color:${end>=pts[0]?'#7ee2a8':'#ff8a80'}">${NOK(end)}</b> (${diff>=0?'+':'−'}${NOK(Math.abs(diff))} fra i dag, med ${NOK(ms)}/mnd i sparing).`;
}
/* export */
function exportCSV(){
 if(!requirePremium())return;
 const head=['Dato','Konto','Beskrivelse','Kategori','Type','Beløp'];
 const lines=[head.join(';')].concat(TX.map(t=>[t.date,t.account,'"'+t.description.replace(/"/g,'""')+'"',eff(t),t.type,(''+t.amount).replace('.',',')].join(';')));
 const blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='kategorisert.csv';a.click();
}

/* ---------- wire up ---------- */
const drop=document.getElementById('drop'),file=document.getElementById('file');
drop.onclick=()=>file.click();
drop.ondragover=e=>{e.preventDefault();drop.classList.add('hot');};
drop.ondragleave=()=>drop.classList.remove('hot');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('hot');handleFiles(e.dataTransfer.files);};
file.onchange=()=>handleFiles(file.files);
document.getElementById('save').onclick=savePending;
document.getElementById('toApp').onclick=()=>{if(TX.length)showApp();else document.getElementById('saveMsg').textContent='Ingen lagrede transaksjoner ennå – last opp og lagre først.';};
document.getElementById('addMore').onclick=showUpload;
document.getElementById('expBtn').onclick=exportCSV;
document.getElementById('q').oninput=e=>{document.getElementById('qd').value=e.target.value;render();};
document.getElementById('qd').oninput=e=>{document.getElementById('q').value=e.target.value;render();};
document.getElementById('qlev').oninput=renderLev;
document.getElementById('clr').onclick=()=>{curCat='';off.clear();document.getElementById('q').value='';document.getElementById('qd').value='';render();};
document.getElementById('resetOv').onclick=()=>{if(confirm('Tilbakestille alle kategoriendringer?')){overrides={};saveOv();render();}};
document.getElementById('ownAdd').onclick=()=>{const v=document.getElementById('ownInput').value.replace(/\D/g,'');if(v){ownAccts.add(v);saveOwn();document.getElementById('ownInput').value='';buildDerived();renderKonto();render();}};
function switchView(v){['Oversikt','Lev','Raad','Formue','Konto'].forEach(x=>{document.getElementById('view'+x).classList.toggle('hide',x!==v);document.getElementById('tab'+x).classList.toggle('on',x===v);});if(v==='Lev')renderLev();if(v==='Konto')renderKonto();if(v==='Raad')renderTips();if(v==='Formue')renderNetworth();}
document.getElementById('tabOversikt').onclick=()=>switchView('Oversikt');
document.getElementById('tabLev').onclick=()=>switchView('Lev');
document.getElementById('tabRaad').onclick=()=>switchView('Raad');
document.getElementById('tabFormue').onclick=()=>switchView('Formue');
document.getElementById('tabKonto').onclick=()=>switchView('Konto');
document.getElementById('addAsset').onclick=()=>{networth.assets.push({name:'',cat:'Bolig',value:'',rate:ASSET_CATS['Bolig']});saveNetworth();renderNetworth();};
document.getElementById('addLiab').onclick=()=>{networth.liabilities.push({name:'',cat:'Boliglån',balance:'',rate:5,monthly:''});saveNetworth();renderNetworth();};
document.querySelectorAll('#tbl thead tr:first-child th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(sortK===k)sortDir*=-1;else{sortK=k;sortDir=1;}render();});
document.querySelectorAll('#levtbl thead th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(!k)return;if(levSort===k)levDir*=-1;else{levSort=k;levDir=1;}renderLev();});
document.querySelector('#tbl tbody').addEventListener('click',e=>{
 const del=e.target.closest('.del');if(del){e.stopPropagation();deleteOne(del.dataset.fp);return;}
 const c=e.target.closest('td.desc');if(c){document.getElementById('q').value=c.dataset.name;document.getElementById('qd').value=c.dataset.name;render();}});
document.getElementById('resetAcct').onclick=resetAccount;

/* ---------- auth ---------- */
const $=id=>document.getElementById(id);
function authMsg(t){$('authMsg').textContent=t;}
async function afterLogin(u){
 user=u;$('whoami').textContent=u.email;$('topbar').classList.remove('hide');
 authMsg('Laster dataene dine…');
 await loadData();authMsg('');
 if(TX.length)showApp();else showUpload();
 const params=new URLSearchParams(location.search);
 if(params.get('checkout')==='success'){
  // Stripe-webhook kan bruke et par sekunder på å oppdatere status
  setTimeout(async()=>{await loadSubscription();history.replaceState({},'',location.pathname);},2500);
 }else if(params.get('checkout')==='cancel'){history.replaceState({},'',location.pathname);}
}
$('loginBtn').onclick=async()=>{
 const email=$('email').value.trim(),password=$('pw').value;
 if(!email||!password)return authMsg('Fyll inn e-post og passord.');
 authMsg('Logger inn…');
 const {data,error}=await sb.auth.signInWithPassword({email,password});
 if(error)return authMsg('Innlogging feilet: '+error.message);
 afterLogin(data.user);
};
$('signupBtn').onclick=async()=>{
 const email=$('email').value.trim(),password=$('pw').value;
 if(!email||password.length<6)return authMsg('Oppgi e-post og passord (min. 6 tegn).');
 authMsg('Oppretter konto…');
 const {data,error}=await sb.auth.signUp({email,password});
 if(error)return authMsg('Kunne ikke opprette: '+error.message);
 if(data.session){afterLogin(data.user);return;}
 // auto-bekreftelse er på → logg inn med en gang
 const si=await sb.auth.signInWithPassword({email,password});
 if(si.error)return authMsg('Konto opprettet. Logg inn med passordet ditt.');
 afterLogin(si.data.user);
};
$('logout').onclick=async()=>{await sb.auth.signOut();user=null;TX=[];ownAccts=new Set();acctNames={};overrides={};goals={};networth={assets:[],liabilities:[]};isPremium=false;
 $('topbar').classList.add('hide');$('app').classList.add('hide');$('landing').classList.add('hide');$('auth').classList.remove('hide');authMsg('');};
$('upgradeTop').onclick=showUpsell;
$('upBuy').onclick=startCheckout;
$('upClose').onclick=hideUpsell;
$('manageSub').onclick=openPortal;
$('bannerUp').onclick=showUpsell;
/* cookie consent */
function setConsent(v){localStorage.setItem('cookieConsent',v);$('consent').classList.add('hide');renderAds();}
$('cookieAccept').onclick=()=>setConsent('accepted');
$('cookieReject').onclick=()=>setConsent('rejected');
if(!cookieConsent())$('consent').classList.remove('hide');
/* affiliate klikk-sporing */
$('adsArea').addEventListener('click',e=>{const a=e.target.closest('a.aff');if(a&&user){
 sb.from('affiliate_clicks').insert({user_id:user.id,tag:a.dataset.tag,url:a.dataset.url});}});
/* restore session on load */
(async()=>{const {data}=await sb.auth.getSession();if(data.session)afterLogin(data.session.user);})();
