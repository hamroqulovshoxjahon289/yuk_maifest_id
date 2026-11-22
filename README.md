# Yuk Manifest (login bilan)

Davomat (Face ID) va Ishlab chiqarish olib tashlangan. Faqat Yuk Manifest qoldi.

## Rollar
| Rol | Qanday kiradi | Nimani qila oladi |
|---|---|---|
| **Egasi** | Google orqali | Hamma narsa: zakazlar, Jamoa, xodimlar va zborshiklar va labo shafyorlariga login-parol berish |
| **Ishchi** | Egasi bergan login-parol | Zakazlarni ko'radi, holat/zborshik/labo almashtiradi. Qo'shish-tahrirlash, to'lov, o'chirish ruxsatlarini egasi har bir ishchiga alohida beradi |
| **Zborshik** | Egasi bergan login-parol | Faqat o'ziga biriktirilgan zakazlarni (astatka ham) ko'radi |
| **Labo (shafyor)** | Egasi bergan login-parol | Faqat o'ziga (o'z laboiga) biriktirilgan reyslarni ko'radi. Hech narsani o'zgartira olmaydi |

Har bir ega o'z jadvalini ko'radi, boshqa egalarning ma'lumotlari aralashmaydi.

## Railway sozlamalari (Variables)
| O'zgaruvchi | Qiymat |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud'dan olinadi (pastda) |
| `LEGACY_OWNER_EMAIL` | Sizning Gmail'ingiz. Hozirgi zakazlar shu akauntga biriktiriladi |
| `DATA_DIR` | Hozir ishlatayotgan Volume papkasi (oldingi qiymatni o'zgartirmang) |
| `SESSION_SECRET` | Ixtiyoriy (bo'sh bo'lsa server o'zi yaratadi) |

## Google Client ID olish
1. https://console.cloud.google.com ga kiring, loyiha yarating.
2. **APIs & Services → OAuth consent screen**: External, ilova nomi va emailingizni yozing, **Publish app** qiling (aks holda faqat test foydalanuvchilar kira oladi).
3. **Credentials → Create credentials → OAuth client ID → Web application**.
4. **Authorized JavaScript origins** ga saytingiz manzilini qo'shing: (masalan `https://sizning-saytingiz.up.railway.app`, brauzer manzil qatoridagi `https://...railway.app` qismini aynan o'zini yozing)
5. Chiqqan **Client ID** ni Railway'dagi `GOOGLE_CLIENT_ID` ga yozing.

## Eski zakazlar
Birinchi marta `LEGACY_OWNER_EMAIL` dagi Gmail bilan kirganingizda, `DATA_DIR/yuk-data/` dagi eski zakazlar, ranglar, zborshiklar, labolar va filiallar sizning akauntingizga **nusxalanadi** (eski fayllar zaxira sifatida joyida qoladi).

## Muhim
- Login butun tizimda yagona bo'lishi kerak (ikki egada bir xil login bo'lmaydi).
- Parollar hash qilib saqlanadi, egasi ham eski parolni ko'ra olmaydi, faqat yangisini qo'yadi.
- Xodimni o'chirsangiz yoki to'xtatsangiz, u darhol tizimdan chiqib ketadi.
- Eski kodlar (1111, 9999, 2222) va yuk PIN'lari endi ishlatilmaydi, ularning o'rniga ruxsatlar bor.

## Zakaz tartibi, kodlar va ruxsatlar

- **Tartib raqami**: har bir kunda zakazlar 1, 2, 3... deb raqamlanadi, kartochka tepasida ko'rinadi. Raqamni bossangiz (tartibni almashtirish ruxsati bo'lsa), yangi raqam kiritish oynasi ochiladi, qolgan zakazlar avtomatik siljiydi. Zakaz o'chirilsa, qolganlari qayta raqamlanadi. Kuniga maksimum 99 ta zakaz.
- **Kiritilgan vaqt**: zakazni ochganda o'ng chetda qachon kiritilgani (sana va vaqt, Toshkent vaqti) ko'rinadi.
- **Kodlar** (faqat egasi, ⚙️ Sozlamalar), hammasi 4 xonali, hash qilib saqlanadi, kiritayotganda ko'rinmaydi:
  - *Amal kodi*: yuk qo'shish va tahrirlash. Sozlamalarni ochish va kodlarni o'zgartirish uchun ham shu kod kerak.
  - *Pul qabul qilish kodi*: "Pul qabul qilindi" tugmasi, summa kiritilgandan keyin.
  - *O'chirish kodi*: yuk, zborshik, labo, filial, xodimni o'chirish.
  Kod qo'yilmasa, o'sha amal kodsiz ishlaydi.
- **Xodim ruxsatlari**: yuk qo'shish, tahrirlash, pul qabul qilish, o'chirish, tartibni almashtirish, jamoani boshqarish. Hech biri berilmasa, xodim faqat zakazlarni ko'ra oladi.

## Labo (shafyor) logini
- 👥 Jamoa → Labolar bo'limida: **➕ Yangi labo qo'shish** (raqam, shafyor ismi, telefon, ixtiyoriy login-parol) yoki mavjud labo yonidagi **🔑 Login berish** tugmasi.
- Shafyor oddiy kirish sahifasida (Login va parol bilan) kiradi va `/labo.html` sahifasida faqat o'z laboiga biriktirilgan zakazlarni ko'radi.
- Login-parolni faqat egasi beradi/o'zgartiradi/to'xtatadi. To'xtatilsa yoki labo o'chirilsa, shafyor darhol tizimdan chiqib ketadi.

## Sklad (matras / mebel / zapchast)
- **🏬 Sklad** tugmasi: 3 yo'nalish (Matras, Mebel, Zapchast). Har birida xohlagancha kategoriya, har kategoriyada xohlagancha model.
  - **＋ Kirim**: skladga mahsulot kelganda sonini yozasiz, qoldiq oshadi.
  - **✎ Sanoq**: sanab chiqib, aniq qoldiqni qo'yish.
  - **Oxirgi harakatlar**: kim, qachon, nechta kirim/chiqim qilgani.
  - Kategoriya/model qo'shish va kirim: egasi yoki **Jamoani boshqarish** ruxsati bor xodim. O'chirishda o'chirish kodi so'raladi.
- **Yuk qo'shish** oynasida «🏬 Sklad mahsulotlari»: yo'nalish → kategoriya → model → soni → **＋ Qo'shish**. Xohlagancha model qo'shish mumkin, nomini yozish shart emas (nom bo'sh qolsa, tanlangan modellardan olinadi).
- **Yuborildi** bosilganda (yoki yuk shu holatda saqlanganda) tanlangan mahsulotlar skladdan **avtomatik ayiriladi**.
  - Yuborildidan qaytarilsa yoki yuk o'chirilsa, mahsulot skladga qaytadi. Ikki marta ayirilmaydi.
  - Skladda yetmasa, tizim ogohlantiradi; tasdiqlansangiz baribir yuboradi va qoldiq minusga tushadi (kam ekanini ko'rsatadi).
- **📊 Hisobot** tepasida sklad hisoboti: har yo'nalish bo'yicha bugunga qancha kerak, qancha ketdi, qancha hali ketishi kerak, skladda nechta bor va yetmayotgani. Pastda oxirgi 7 kun + keyingi 2 kun uchun jadval.
- Eski zakazlar va eski «Matras o'lchami» belgisi o'zgarmagan; sklad hisobi faqat yangi tanlash orqali kiritilganlarni hisoblaydi.
- Ma'lumot `DATA_DIR/yuk-data/owners/<id>/sklad.json` da saqlanadi.

### Sklad: surat va hisobot (yangilanish)
- **Surat** faqat **Mebel** yo'nalishidagi modellarga, ixtiyoriy: Sklad → Mebel → model yonida «📷 Surat». Bitta model — bitta surat (almashtirish yoki olib tashlash mumkin). Surat avtomatik kichraytiriladi.
- Suratni kim ko'radi: egasi/xodimlar (faqat **Sklad** oynasida) va **shu modelli yuk biriktirilgan zborshik** («📷 Suratni ko'rish» tugmasi). Zakaz kartochkasida, yuk formasida, labo/shafyor sahifasida va boshqa zborshiklarda surat ko'rinmaydi.
- Suratlar `DATA_DIR/yuk-data/owners/<id>/sklad-img/` papkasida saqlanadi (Railway'da Volume ulangan bo'lishi kerak).
- **Hisobot**: matras uchun «✅ Bugun ketgan matraslar» (model va soni) va «📋 Bugunga kerak matraslar» (model, soni, skladda nechta). Skladda yetmasa, tepada qizil chiziqli «🔴 Bugunga kerak matraslar — skladda yetmaydi» chiqadi.
- «Yuborildi» bosilganda nima skladdan ayirilgani xabarda ko'rsatiladi. Mahsulot tanlanmagan eski yukda ogohlantirish chiqadi.

### Matras kategoriyasiz + xodimlarga bildirishnoma (yangilanish)
- **Matras** yo'nalishida kategoriya yo'q: Sklad → Matras → «➕ Yangi matras modeli». Yuk formasida ham Matras tanlansa, kategoriya so'ralmaydi, modelning o'zi tanlanadi. Mebel va Zapchastda kategoriya avvalgidek. Eski matras kategoriyalaridagi modellar saqlanib qoladi (ro'yxatda tekis ko'rinadi).
- **Bildirishnoma**: egasi (admin) yangi zakaz qo'shganda barcha faol **xodimlarga** xabar boradi (zborshik va shafyorlarga bormaydi). Xodimda 🔔 tugmasi bor: o'qilmaganlar soni ko'rinadi, bossa ro'yxat ochiladi, xabarni bossa shu zakaz ochiladi. Sahifa ochiq bo'lsa, har 20 soniyada tekshiriladi va ekranda xabar chiqadi (brauzer ruxsat bersa — tizim xabari ham). Xodim zakaz qo'shsa, xabar yuborilmaydi.
- Ma'lumot `DATA_DIR/yuk-data/owners/<id>/bildirishnomalar.json` da (oxirgi 200 ta).

## 🛏 1 oylik matras hisoboti (yangilanish)
- **📊 Hisobot** oynasida «🛏 Matras — 1 oylik hisobot»: tanlangan davrda (standart: oxirgi 30 kun) har bir matras modeli bo'yicha **nechta zakazga**, **jami nechta kerak bo'ldi**, **nechtasi ketdi** («Yuborildi»), **nechtasi hali ketmagan**, skladda nechta bor va nechtasi yetmayotgani.
- Pastida **«Qaysi zakazga qaysi matras»** jadvali: sana, zakaz, hudud, matras, soni, holat (✅ Ketdi / 📋 Kerak).
- **🖨️ Chop etish** tugmasi: shu hisobotni (umumiy jadval + zakazlar ro'yxati) qog'ozga chiqaradi.
- «Qaysi sanadan / gacha» maydonlari bilan istalgan davrni (masalan, keyingi kunlarni ham) ko'rish mumkin.
- Hisob faqat sklad modeli tanlab kiritilgan zakazlardan olinadi. Eski «Matras o'lchami» belgisi bo'yicha zakazlar soni alohida qator qilib ko'rsatiladi.

## 🛍 Sotuvchi (do'kon) roli va zalog (yangilanish)
| Rol | Qanday kiradi | Nimani qila oladi |
|---|---|---|
| **Sotuvchi** | Egasi bergan login-parol | `/sotuvchi.html`: zakaz kiritadi (xuddi egasi formasidek, **zalog** bilan) va egasiga yuboradi. O'zining zakazlarini va zalogini ko'radi |

**Egasi qanday sozlaydi:** 👥 Jamoa → «🛍 Sotuvchilar (do'kon)» → **➕ Yangi sotuvchi**: ism, login, parol. «Zakaz qo'shish» ruxsatini egasi beradi/oladi, kirishni to'xtatish ham mumkin.

**Zakaz yo'li:**
1. Sotuvchi zakazni to'ldirib **📤 Egasiga yuborish** bosadi. Zakaz hali jadvalga tushmaydi va skladga ta'sir qilmaydi.
2. Egasida yuqorida **📥 Zakazlar** tugmasi (o'qilmaganlar soni bilan) paydo bo'ladi, yangi zakaz kelsa ekranda xabar chiqadi (har 20 soniyada tekshiriladi).
3. Egasi zakazni ochib tekshiradi va:
   - **✔ Tasdiqlash**: zakaz jadvalga (sotuvchi ko'rsatgan sanaga, «Hali tayyor emas» holatida) qo'shiladi;
   - **✏️ Tahrirlab tasdiqlash**: forma ochiladi, kerakli joyini o'zgartirib (zborshik, labo, holat, zalog ham) tasdiqlaydi;
   - **✖ Rad etish**: sabab yozsa bo'ladi. Sotuvchi rad etilganini sababi bilan ko'radi, tuzatib qayta yuboradi yoki o'chiradi.
4. Tasdiqlashda amal kodi (o'rnatilgan bo'lsa) so'raladi, chunki bu yuk qo'shish amali. Tasdiqlangach xodimlarga odatdagidek bildirishnoma boradi.

**Zalog:**
- Zalog (so'm) alohida maydon: **astatka va to'lov hisobiga ta'sir qilmaydi**.
- **Faqat egasi va shu zakazni yuborgan sotuvchi ko'radi.** Xodim (ishchi), zborshik, shafyor, boshqa sotuvchilar ko'rmaydi; ularning ro'yxatlari, chop etishlari va Excel faylida zalog yo'q. Xodim zakazni tahrirlasa ham zalog o'zgarmaydi.
- Egasi zalogni o'zi qo'shgan/tahrirlagan zakazlarda ham kiritishi mumkin (forma va tahrirlashda «💵 Zalog» maydoni faqat egasiga ko'rinadi).
- **Egasining hisobotlarida yoziladi:** 📊 Hisobot → «💵 Zalog hisoboti»: sotuvchilar kesimida zakazlar soni va zalog yig'indisi, pastida har bir zalog yozuvi (sana, sotuvchi, zakaz, summa, izoh), davrni tanlash va chop etish. Excel faylda («⬇️ Excel») qo'shimcha **Zalog** varag'i va «Sotuvchi / Zalog» ustunlari bor (faqat egasi yuklasa).
- Zalog sotuvchi zakazni yuborgan kunga yoziladi. Faqat tasdiqlangan zakazlar hisoblanadi.
- Ma'lumot: kutilayotgan zakazlar `DATA_DIR/yuk-data/owners/<id>/kutilayotgan.json` da, zalog esa zakazning o'zida (`loads.json`) saqlanadi.

## 🕵️ Kuzatuv jurnali (yashirin, faqat admin) — yangilanish
Admin (ega) tizimda **hamma kim nima qilganini** ko'ra oladi. Xodim, zborshik, shafyor va sotuvchilar bu bo'limni ko'rmaydi va bilmaydi.

**Qanday ochiladi (yashirin):** yuqori chapdagi **◈ logotipni 5 marta ketma-ket bosing** (yoki kompyuterda `Ctrl+Alt+K`). Birinchi marta o'zingiz **kuzatuv kodi** (4–8 raqam) o'ylab topasiz, keyin har safar shu kod so'raladi. Kodni «🔐 Kod» tabida o'zgartirsa bo'ladi. Oyna yopilsa yoki 10 daqiqa harakatsiz qolsa, kod xotiradan o'chadi. 8 marta noto'g'ri kod kiritilsa 15 daqiqaga bloklanadi va bu ham jurnalga yoziladi.

**Nimalar yoziladi** (admin o'zi ham, ya'ni uning amallari ham):
- **Kirish va qurilma:** kim, qachon kirdi/chiqdi, qaysi qurilma bilan (telefon / planshet / kompyuter-noutbuk, telefon modeli, Android/iOS/Windows, brauzer, ekran o'lchami, IP). Noto'g'ri parol bilan urinishlar ham yoziladi.
- **Faollik:** zborshik/shafyor/xodim ishlayotgani (har ~10–15 daqiqada bitta yozuv), zborshik zakazlar ro'yxatini ochgani va **qaysi mahsulot suratini ko'rgani**.
- **Zakazlar:** qo'shdi, tahrirladi (**har bir o'zgargan maydon uchun «oldin → keyin»**: sana, astatka, telefon, manzil, mahsulotlar, zborshik, holat, zalog...), holat o'zgartirdi, **o'chirdi** (o'chirilgan zakazning to'liq nusxasi bilan), tartibini o'zgartirdi.
- **Pul:** kim, qancha pul oldi, qaysi zakazga; **pul yozuvlarini bekor qilish** (qancha va kim olgani bilan) alohida qizil belgi bilan.
- **Sotuvchi zakazlari:** yubordi, tahrirladi (oldin → keyin), bekor qildi; admin **tasdiqladi / tahrirlab tasdiqladi** (sotuvchi yozgani bilan admin o'zgartirgani farqi bilan) / rad etdi.
- **Sklad:** kirim, qoldiqni qo'lda to'g'rilash (kamaytirilsa qizil), model/kategoriya qo'shish-o'chirish, surat yuklash.
- **Jamoa:** xodim/sotuvchi/zborshik/labo/filial qo'shish, ruxsatlarini o'zgartirish, to'xtatish, o'chirish; kodlarni o'zgartirish; Excel yuklab olish; noto'g'ri kod bilan urinish.
- **Parollar va kodlar jurnalga umuman yozilmaydi** (faqat «o'zgartirildi» deb yoziladi).

**Ko'rinishi:** «👥 Odamlar» tabida har bir kishi: oxirgi kirish, oxirgi faollik, qaysi qurilmadan, bugun nechta amal, qaysi qurilmalardan kirgan, shubhali (xato parol, xavfli amal) soni. «🕒 Jurnal» tabida vaqt tartibida hammasi, filtr: kim / turi / sana / faqat xavfli / qidiruv.

**Xavfsizlik:** jurnal faqat qo'shiladi (uni tahrirlash yoki o'chirish yo'li yo'q). Ma'lumot `DATA_DIR/yuk-data/owners/<id>/kuzatuv.jsonl` da saqlanadi (oxirgi ~60 000 yozuv). Interfeys kodi alohida `owner-extra.js` faylida bo'lib, server uni faqat ega sessiyasiga beradi. Xodimning brauzeriga bu funksiya haqida hech narsa yuklanmaydi. Jurnal API'si (`/api/audit/*`) ham faqat ega + kod bilan ishlaydi.

**Eslatma:** qurilma ma'lumoti brauzer yuboradigan ma'lumotdan aniqlanadi (ba'zi telefonlar modelini yashiradi, kompyuterda «noutbuk yoki stol kompyuteri»ni ajratib bo'lmaydi). Shuning uchun IP manzil va ekran o'lchami bilan birga ko'rsatiladi.


## 🆕 Yangi yuk qo'shish oqimi: Kategoriya → Model → Matras (yangilanish)
**Yuk qo'shish** tugmasi avvalgidek ochiladi, ichida yangi tanlash paneli:
1. **Kategoriya** tanlanadi (Spalni, Shkaf, Divan...). Ro'yxat oxirida «🛏 Faqat matras» (faqat matras yuboriladigan zakazlar uchun).
2. **Model** tanlanadi (shu kategoriyadagi modellar chiqadi; matras ketadiganlari 🛏 belgisi bilan).
3. Model **matras ketadigan** bo'lsa: «🛏 Matras ketadi» belgisi + **qanday matras** (sklad matraslaridan) + matras soni chiqadi. Matras **ketmaydigan** bo'lsa, shunchaki zakazga qo'shiladi.
4. **＋ Zakazga qo'shish** tugmasi yoki **Enter** bosiladi. Yuk «Zakazdagi yuklar» ro'yxatiga tushadi, panel esa yana tayyor: yana biror narsa birga ketsa, shu yerning o'zidan yana qo'shasiz (soni ro'yxatning o'zida o'zgartiriladi, ✕ bilan olib tashlanadi).
5. Model nomidan boshqa qo'shimcha gap bo'lsa — **📝 Tavsif** maydoniga yoziladi (Enter bilan forma yuborilib ketmaydi, faqat «Saqlash» bosilganda saqlanadi).

- Zakaz nomi va jadval kategoriyasi tanlangan modellardan **avtomatik** olinadi (alohida «Nomi» / «Kategoriya» maydoni yo'q).
- Tanlangan, lekin «Zakazga qo'shish» bosilmagan model bo'lsa, «Saqlash» bosilganda o'zi qo'shiladi.
- Sotuvchi sahifasi (`/sotuvchi.html`) ham xuddi shu paneldan foydalanadi.

## 🏬 Sklad (yangilangan): faqat MATRAS hisoblanadi
- **Zapchast yo'nalishi olib tashlandi** (eski ma'lumot faylda qoladi, lekin ko'rinmaydi).
- **🛋 Mebel** bo'limi: kategoriya → model. Modellar **soni hisoblanmaydi**. Har bir modelga **🛏 Matras** tugmasi bilan belgilanadi: matras ketadimi, ketsa **qaysi matras(lar)** (bir nechtasini belgilash mumkin; hech biri belgilanmasa, zakazda istalgan matras tanlanadi). Yangi model qo'shilganda shu oyna darrov ochiladi. Mebel modeliga ixtiyoriy surat qo'yish avvalgidek.
- **🛏 Matras** bo'limi: matras modellari va **qoldig'i** (＋ Kirim, ✎ Sanoq, harakatlar tarixi).
- **«Yuborildi»** bosilganda faqat **matras** skladdan ayiriladi (qaytarilsa yoki yuk o'chirilsa — qaytadi, ikki marta ayirilmaydi). Skladda yetmasa ogohlantiradi.

## 📊 Hisobot: 1 haftalik matras hisoboti
- **📊 Hisobot** oynasida «🛏 Matras — 1 haftalik hisobot» (standart: oxirgi 7 kun; **1 hafta / 2 hafta / 1 oy** tugmalari va o'zingiz sana tanlash).
- Har bir matras bo'yicha: nechta zakazga, **jami kerak bo'ldi**, **ketdi**, **hali ketmagan**, **skladda qoldi**, yetmasa ⚠.
- **Kunlar bo'yicha** jadval: har bir matras har kuni nechta ketdi / kerak edi.
- «Qaysi zakazga qaysi matras» ro'yxati va 🖨️ chop etish.
- Tepada «Bugun» bloki: bugunga qancha matras kerak, qancha ketdi, skladda yetmaydiganlari qizil chiziqda.
- **Mebel modellari hisobga kirmaydi** — faqat matras.

## 🎨 Premium dizayn («Aurora glass»)
- `public/premium.css` (barcha sahifalarga oxirida ulanadi) va `public/fx.js` (yengil effektlar). Eski stillarga tegilmagan: premium.css'ni olib tashlasangiz, sayt avvalgi ko'rinishiga qaytadi.
- Harakatlanuvchi aurora fon va nozik to'r, shisha (glass) panel va oynalar, gradient yorug' chiziqlar.
- Yuk kartochkalari holatiga qarab nur sochadi (🔴🟡🟢), bugungi kun ustuni yonib turadi.
- Kursor ustida kartochkalarda nur ergashadi, tugmalarda to'lqin (ripple) va yaltirash, hisobot raqamlari sanab chiqiladi.
- Chiroyli kirish sahifasi (kursorga qarab egiladigan shisha karta), yangi tanlash paneli, o'tkazgichlar va animatsiyalar.
- Zborshik, labo va sotuvchi sahifalari ham yangilangan. Animatsiyalar «harakatni kamaytirish» yoqilgan qurilmalarda o'chadi.

## Eski ma'lumotlar haqida
Eski zakazlar o'zgarmaydi. Eski mebel/zapchast sklad qoldiqlari endi hisoblanmaydi, faqat matras. Eski yuklarda saqlangan «Matras o'lchami» belgisi ko'rinishda qoladi.


## 🎨 5 xil dizayn (mavzu) — har kim o'zi tanlaydi
Har bir sahifaning o'ng pastki burchagida **🎨** tugmasi bor. Bosib dizaynni tanlang, tanlov shu brauzer/telefonda eslab qolinadi (har bir xodim o'ziniki, bir-biriga ta'sir qilmaydi):
1. 🌅 **Quyosh** — qorong'u, to'q sariq (standart)
2. 🌊 **Okean** — qorong'u, moviy
3. 💜 **Neon** — qorong'u, pushti-binafsha
4. 🌿 **Tabiat** — qorong'u, yashil
5. ☀️ **Yorug'** — kunduzgi, oq fon

**Yana 10 ta qo'shildi (jami 15 ta):** 🔥 Olov, 🍇 Uzum, 🌹 Atirgul, 🌌 Kosmos, 🍋 Limon, 💎 Firuza, ⚫ Grafit (qorong'u) va 🌸 Shaftoli, 🩵 Osmon, 🍃 Yalpiz (kunduzgi, oq fon).

Fayllar: `public/theme.js` (tanlagich), `public/premium.css` (ranglar o'zgaruvchilari `html[data-theme="..."]`). Yangi dizayn qo'shish uchun premium.css oxiridagi bloklardan birini nusxalab ranglarni o'zgartirish yetarli.


## 💵 Zalog (yangilangan)
- Zalog **olingan (kiritilgan) kunga** yoziladi, zakazning jo'natish kuniga emas. Masalan, zalog 23-noyabrda olinib, zakaz 25-noyabrga yozilsa, hisobotda zalog **23-noyabr** ostida chiqadi.
- Admin zakaz formasida **«📅 Zalog qachon olindi»** sanasini ko'radi (standart: bugun) va o'zgartira oladi. Sana ko'rsatilmasa, avval yozilgani saqlanadi.
- Sotuvchi zakaz yuborsa, zalog sotuvchi yuborgan kun bilan yoziladi (admin tasdiqlashda sanani o'zgartirishi mumkin).
- **Zalog olinmagan** bo'lsa hech narsa yozilmaydi: kartada, hisobotda, Excel'da zalog qatori ham, 0 ham chiqmaydi.
- Zalogni faqat **admin** ko'radi (xodim, zborshik, labo ko'rmaydi). Sotuvchi faqat o'zi kiritgan zalogni o'z sahifasida ko'radi.
- Astatka hisoboti o'zgartirilmagan.

## 🕰️ Klassik dizayn
🎨 tanlagichda «Klassik» — saytning eski (dastlabki) ranglari. Jami 16 ta dizayn.
