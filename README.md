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
