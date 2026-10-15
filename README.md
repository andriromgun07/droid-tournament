# Droid Turnamen

Aplikasi pengacak dan pencatat turnamen badminton (tunggal/ganda, 1–4 lapangan) untuk main bareng.

## Alur pemakaian
1. **Buat turnamen baru**: isi pemain (bisa tempel banyak nama dipisah koma, tandai L/P), pilih format, jumlah lapangan, dan cara mencatat hasil, lalu mulai ronde 1. Pemain dari turnamen terakhir otomatis terisi.
2. **Ronde**: tiap lapangan tampil sebagai lapangan mini. Ketuk sisi yang menang (atau isi skor). Kalau ada yang belum siap, ketuk *Ada yang belum siap?* untuk menggantinya dengan pemain cadangan.
3. **Siap-siap ronde berikutnya**: di bawah lapangan tampil susunan ronde berikutnya sejak ronde sekarang dimulai, supaya pemain bisa bersiap. Titik kuning = masih main di ronde ini. *Acak ulang* menyusun ulang rencana itu.
4. **Mulai ronde berikutnya** aktif setelah semua lapangan ada hasil, dan memakai persis susunan yang sudah ditampilkan. Klasemen bisa dibuka kapan saja.
5. **Menu**: kelola pemain (tambah, keluar, ganti L/P), acak ulang ronde, bagikan link, selesai.

## Aturan pengacakan
- Pemain yang ronde lalu istirahat selalu didahulukan, jadi giliran berpindah ke orang berikutnya.
- Pemain perempuan yang baru main diberi jeda satu ronde. Hanya dilanggar kalau jumlah pemain tidak cukup untuk mengisi lapangan.
- Pemain pria tidak main lebih dari 2 ronde berturut-turut bila ada yang menunggu.
- Lawan dan pasangan yang sama dihindari, dan komposisi L/P tiap tim diusahakan seimbang.
- Klasemen: menang 3, seri 1, kalah 0. Pemain yang keluar tetap tercatat.

## Struktur
| Path | Isi |
|---|---|
| `index.html`, `css/style.css` | Tampilan |
| `js/engine.js` | Engine rotasi & klasemen (tanpa DOM) |
| `js/app.js` | UI, simpan lokal, sinkron ke API |
| `netlify/functions/api.mjs` | REST API (`/api/tournaments`, `/api/players`) |
| `netlify/database/migrations/` | Skema Postgres, dijalankan otomatis oleh Netlify saat deploy |

Data selalu disimpan dulu di HP (localStorage), lalu disinkronkan ke Netlify Database. Kalau server tidak bisa dihubungi, aplikasi tetap jalan dan menyinkronkan lagi saat online.

## Deploy ke Netlify
1. Netlify → **Add new project → Import an existing project → GitHub** → pilih repo ini. Build command kosong, publish directory `.`.
2. Di project tersebut buka **Data & Storage → Database → Create a database** (atau `netlify database init` dari CLI).
3. Deploy ulang. Netlify memasang `@netlify/database`, menjalankan migrasi di `netlify/database/migrations`, lalu mempublikasikan situs.

## Pengembangan & tes
```bash
npm install
npm test                 # simulasi rotasi + tes API terhadap Postgres (PGlite)
npx netlify dev          # jalankan lokal dengan database lokal
```
