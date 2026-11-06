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
