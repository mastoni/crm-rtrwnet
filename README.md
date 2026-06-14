# ISP NetOps & CRM (SKMNet)

Sistem CRM (Customer Relationship Management) dan Network Operations komprehensif yang dirancang khusus untuk operasional ISP (Internet Service Provider) skala menengah dan RT/RW Net.

## 🚀 Fitur Utama

### 📊 Network Operations & Monitoring
- **Dashboard Analytics**: Statistik jaringan real-time, aktivitas PPPoE, tren bandwidth, dan pertumbuhan pelanggan.
- **Monitoring Perangkat**: Pemantauan status ONT (Online/Offline) dan metrik OLT secara terpusat.
- **Firewall & Security**: Pengaturan dan pemantauan firewall jaringan.

### 💳 Billing & Keuangan
- **Manajemen Tagihan (Invoices)**: Pembuatan tagihan otomatis dan pemantauan pembayaran (Lunas, Belum Lunas, Jatuh Tempo).
- **Statistik Pendapatan**: Laporan proyeksi pendapatan dan total piutang yang beredar.

### 🎁 Reward Points System
- **Loyalty Program**: Perhitungan poin otomatis untuk pelanggan (contoh: bonus bayar tepat waktu, poin ekstra untuk pembayaran awal, dan penalti keterlambatan).
- **Katalog Reward**: Pelanggan dapat menukarkan poin mereka dengan berbagai macam item (voucher, merchandise, dll).
- **Manajemen Admin**: Penyesuaian poin manual dan persetujuan penukaran item.

### 🏢 Customer Portal (Subdomain)
- Akses khusus pelanggan melalui subdomain (contoh: `portal.domainanda.com`).
- **Dashboard Pelanggan**: Melihat layanan aktif dan tagihan berjalan.
- **Support Tickets**: Sistem pelaporan gangguan dan pembuatan tiket bantuan.
- **Tukar Poin**: Halaman interaktif untuk menukarkan Reward Points.

## 🛠️ Teknologi yang Digunakan

- **Backend**: Node.js dengan framework [Express.js](https://expressjs.com/)
- **Database**: MySQL
- **Templating Engine**: EJS (Embedded JavaScript templates)
- **Frontend**: Vanilla JavaScript & CSS (Modern UI/UX)
- **Visualisasi Data**: Chart.js

## 📦 Instalasi & Menjalankan Aplikasi

1. **Clone Repository**
   ```bash
   git clone https://github.com/username-anda/crm-rtrwnet.git
   cd crm-rtrwnet
   ```

2. **Install Dependensi**
   ```bash
   npm install
   ```

3. **Konfigurasi Database**
   - Buat database MySQL baru.
   - Import skema database (termasuk tabel `customers`, `invoices`, `reward_items`, `reward_history`, dll).
   - Sesuaikan konfigurasi koneksi database di file `db.js` atau file `.env` (jika menggunakan variabel lingkungan).

4. **Menjalankan Server**
   ```bash
   # Menjalankan di mode produksi
   node server.js
   
   # ATAU menjalankan dengan nodemon (untuk pengembangan)
   npm run dev
   ```

5. **Akses Aplikasi**
   - Admin Panel: `http://localhost:3000`
   - Customer Portal: `http://portal.localhost:3000`

## 🗂️ Struktur Direktori Utama

- `/routes`: Kumpulan endpoint API dan logika routing (seperti `billing`, `customer-portal`, `rewards`, `olt`).
- `/views`: Template halaman EJS untuk sisi Admin dan Customer Portal.
- `/public`: Aset statis yang dapat diakses publik (`/css`, `/js`, `/img`).
- `/server.js`: Titik masuk utama aplikasi (Main Entry Point) dan inisialisasi Express.

## 🤝 Kontribusi

Pull requests dipersilakan. Untuk perubahan besar, harap buka _issue_ terlebih dahulu untuk mendiskusikan apa yang ingin Anda ubah.

## 📄 Lisensi

[MIT](https://choosealicense.com/licenses/mit/)
