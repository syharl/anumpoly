/* ============================================================
   UPDATE DALAM-GAME (download + pasang tanpa keluar aplikasi)
   ============================================================
   PENTING — kenapa file ini TERPISAH dari index.html:
   File ini SENGAJA tidak ikut dibundel ke dalam APK. index.html cuma
   memuatnya lewat <script src="...update-check.js?v=..."> pakai URL
   ABSOLUT ke GitHub Pages (lihat ujung index.html) — bukan ditulis
   inline. Efeknya: setiap kali aplikasi dibuka, kode yang jalan di sini
   selalu versi TERBARU yang ada di server, walau APK yang terpasang di
   HP pemain sudah lama dan tidak pernah di-update.

   Ini jawaban langsung atas masalah yang pernah kejadian: dulu logic
   pengecekan versi ada inline di index.html, kebetulan ada bug (fetch
   pakai path relatif), dan begitu APK dengan bug itu tersebar ke
   banyak HP, bug-nya IKUT BEKU permanen di tiap HP — tidak ada cara
   remote untuk menambalnya lagi tanpa minta semua orang install ulang
   manual satu-satu.

   Dengan pola ini, KHUSUS untuk logic di file ini, kejadian itu tidak
   akan terulang: kalau suatu saat ternyata ada bug lain di sini, cukup
   edit & publish file ini lagi ke GitHub Pages — SEMUA APK yang sudah
   terpasang (termasuk yang sangat lama) otomatis ikut kepakai versi
   yang sudah diperbaiki di kunjungan berikutnya, tanpa perlu APK baru
   sama sekali. Ini tidak berlaku untuk kode LAIN yang tetap inline di
   index.html (UI game, dsb) — itu tetap ikut beku di dalam APK seperti
   biasa, karena index.html sendiri masih dibundel saat build.

   Kenapa berbeda dari sebelumnya:
   - Dulu pengecekan versi ini SENGAJA dimatikan untuk aplikasi native
     (if(!isNativeApp)) karena fetch('versi.json') memakai path relatif,
     yang di dalam APK berarti membaca salinan versi.json yang ikut
     dibundel ke APK itu sendiri — jadi tidak akan pernah mendeteksi versi
     baru (selalu membandingkan app dengan dirinya sendiri).
   - Sekarang: versi TERPASANG diambil dari @capacitor/app (App.getInfo(),
     berisi versionCode asli yang di-set otomatis oleh CI dari angka
     "terbaru" di versi.json saat build — lihat build-android.yml), lalu
     dibandingkan dengan versi.json TERBARU yang di-fetch langsung dari
     internet (GitHub Pages), bukan salinan lokal.
   - Kalau ada versi baru: APK diunduh lewat fetch() dengan progress asli,
     disimpan ke folder cache aplikasi lewat @capacitor/filesystem, lalu
     pemasang APK Android dipicu langsung lewat plugin lokal "ApkInstaller"
     (lihat /plugins/capacitor-apk-installer) — semua tanpa membuka
     notifikasi/browser. Satu-satunya langkah yang TETAP butuh sentuhan
     manual adalah konfirmasi "Install" dari sistem Android sendiri —
     ini batas keamanan Android, bukan sesuatu yang bisa dilewati aplikasi
     biasa (bahkan Play Store pun tidak bisa memasang tanpa dialog itu).
*/
const REMOTE_VERSI_URL = 'https://syharl.github.io/anumpoly/versi.json'; // sesuaikan kalau alamat GitHub Pages-mu berbeda

// ------------------------------------------------------------------
// Helper format angka ukuran file & kecepatan unduhan, dipakai bareng
// oleh update APK penuh maupun hot-update konten di bawah.
// ------------------------------------------------------------------
function formatBytes(bytes){
  if(!bytes || bytes <= 0) return '0 KB';
  if(bytes < 1024*1024) return Math.round(bytes/1024)+' KB';
  return (bytes/1024/1024).toFixed(1)+' MB';
}
function formatSpeed(bytesPerSecond){
  if(!bytesPerSecond || bytesPerSecond <= 0) return '';
  if(bytesPerSecond < 1024*1024) return Math.round(bytesPerSecond/1024)+' KB/d';
  return (bytesPerSecond/1024/1024).toFixed(2)+' MB/d';
}
const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const CapPlugins = (window.Capacitor && window.Capacitor.Plugins) || {};

async function getVersiTerpasang(){
  if(isNativeApp && CapPlugins.App){
    try{
      const info = await CapPlugins.App.getInfo();
      const kode = parseInt(info.build, 10);
      if(!isNaN(kode)) return kode;
    }catch(e){}
  }
  return parseInt(new URLSearchParams(location.search).get('v') || '1', 10);
}

// ------------------------------------------------------------------
// TOMBOL "X" ABAIKAN — dipakai di pojok kanan atas kartu update.
// Kalau pemain menekannya, nomor build yang SEDANG ditawarkan disimpan
// ke localStorage. Selama build itu masih yang terbaru (belum ada
// rilis baru lagi), kartu tidak akan muncul lagi di kunjungan
// berikutnya. Begitu ada build LEBIH BARU dari yang tersimpan, kartu
// otomatis tampil lagi — jadi "abaikan" ini cuma menunda untuk update
// yang sedang ditawarkan sekarang, bukan mematikan pengecekan selamanya.
// ------------------------------------------------------------------
const UPDATE_DISMISSED_KEY = 'anumpoly_update_dismissed_build';
function sudahDiabaikan(buildDitawarkan){
  try{ return localStorage.getItem(UPDATE_DISMISSED_KEY) === String(buildDitawarkan); }
  catch(e){ return false; }
}
function tandaiAbaikan(buildDitawarkan){
  try{ localStorage.setItem(UPDATE_DISMISSED_KEY, String(buildDitawarkan)); }catch(e){}
}
// Markup tombol X, dipakai bareng oleh kartu update APK & kartu
// hot-update konten. Style ditulis INLINE (bukan lewat class CSS di
// index.html) supaya tetap tampil benar walau APK lama yang belum
// punya class CSS terbaru sekalipun — file ini sendiri kan selalu
// versi terbaru dari GitHub Pages, tapi index.html-nya belum tentu.
const TOMBOL_ABAIKAN_HTML = `<button id="btnUpdateDismiss" aria-label="Abaikan update ini" title="Abaikan"
  style="position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;border:none;
  background:rgba(18,52,86,0.08);color:var(--paper-dim,#4B6B8A);font-size:16px;line-height:1;
  cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">✕</button>`;
// Dipasang ke tombol X di kedua jenis kartu — cukup hapus overlay dari
// layar & catat sudah diabaikan, tanpa mengubah apa pun yang sedang
// berjalan di game di baliknya.
function pasangTombolAbaikan(overlay, buildDitawarkan){
  const btnClose = overlay.querySelector('#btnUpdateDismiss');
  if(!btnClose) return;
  btnClose.onclick = ()=>{
    tandaiAbaikan(buildDitawarkan);
    overlay.remove();
  };
}

async function checkForUpdate(){
  try{
    const versiSaya = await getVersiTerpasang();
    const res = await fetch(REMOTE_VERSI_URL, { cache: 'no-store' });
    const data = await res.json();
    // DIUBAH — SEMENTARA hot-update konten dimatikan (lihat blok di bawah,
    // dekat "Hot update konten dicek DULUAN"), jadi kartu update APK ini
    // sekarang jadi SATU-SATUNYA jalur update yang jalan. Makanya
    // perbandingannya diganti pakai "contentBuild" (naik tiap rilis
    // apapun, sekecil apapun), BUKAN "nativeBuild" lagi (yang cuma naik
    // kalau ada perubahan native — kalau tetap dipakai sendirian tanpa
    // hot-update, rilis konten biasa tidak akan pernah ditawarkan ke
    // pemain sama sekali, karena nativeBuild-nya diam terus).
    // versiSaya sendiri (dari App.getInfo().build) adalah versionCode
    // APK yang kepasang, angkanya sama skemanya dengan contentBuild
    // (keduanya dari github.run_number saat build), jadi perbandingan
    // "versiSaya < data.contentBuild" valid buat semua jenis rilis.
    //
    // KALAU NANTI HOT-UPDATE DIAKTIFKAN LAGI: baris di bawah ini WAJIB
    // dikembalikan ke "data.nativeBuild" (bukan contentBuild), supaya
    // kartu update APK ini tidak lagi muncul tiap rilis kecil — cukup
    // hot-update konten (checkForContentUpdate) yang menangani itu.
    if(data && data.contentBuild && versiSaya < data.contentBuild && !sudahDiabaikan(data.contentBuild)){
      showUpdateCard(data);
    }
  }catch(e){ /* offline / gagal cek — biarkan pemain lanjut main seperti biasa */ }
}

// ------------------------------------------------------------------
// CEK UPDATE MANUAL — dipanggil dari tombol "Cek Update" di layar
// Pengaturan (lihat onClickCekUpdateManual() di index.html).
// Beda dari checkForUpdate() otomatis di atas: fungsi ini SENGAJA
// TIDAK mengecek sudahDiabaikan() sama sekali — jadi kalau pemain
// sebelumnya sudah menekan X untuk update yang sama, tombol ini tetap
// bisa memanggil kartu update itu lagi. Kalau memang belum ada versi
// baru, kasih tahu pemain lewat alertModal() (fungsi umum yang sudah
// ada di index.html) supaya tombolnya terasa jelas kegunaannya,
// bukan cuma diam saja kalau ditekan.
// ------------------------------------------------------------------
window.cekUpdateManual = async function(){
  try{
    const versiSaya = await getVersiTerpasang();
    const res = await fetch(REMOTE_VERSI_URL, { cache: 'no-store' });
    const data = await res.json();
    if(data && data.contentBuild && versiSaya < data.contentBuild){
      // Kalau kartu update kebetulan sudah tampil (mis. dari pengecekan
      // otomatis tadi belum sempat ditutup), jangan tumpuk overlay baru.
      const overlayLama = document.getElementById('updateOverlay');
      if(overlayLama) overlayLama.remove();
      showUpdateCard(data);
    } else if(typeof window.alertModal === 'function'){
      window.alertModal('Kamu sudah pakai versi terbaru Anumpoly. 👍');
    }
  }catch(e){
    if(typeof window.alertModal === 'function'){
      window.alertModal('Gagal mengecek update. Pastikan HP terhubung ke internet, lalu coba lagi.');
    }
  }
};

function showUpdateCard(data){
  const overlay = document.createElement('div');
  overlay.id = 'updateOverlay';
  overlay.innerHTML = `
    <div class="upd-box" style="position:relative;">
      ${TOMBOL_ABAIKAN_HTML}
      <div class="upd-icon">🔔</div>
      <h2>Update Tersedia</h2>
      <p>Ada versi baru Anumpoly${data.terbaru?(' (v'+data.terbaru+')'):''}. Update dulu ya biar bisa main bareng teman.</p>
      <div id="updProgressWrap" style="display:none;">
        <div class="upd-bar-track"><div id="updProgressBar" class="upd-bar-fill"></div></div>
        <div class="upd-meta-row"><span id="updSpeedLabel"></span><span id="updSizeLabel"></span></div>
        <div id="updProgressLabel" class="upd-progress-label">0%</div>
      </div>
      <button id="btnUpdateAction" class="upd-btn-main">⬇️ Download Update</button>
      <div id="updateStatus" class="upd-status"></div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('btnUpdateAction').onclick = ()=> startUpdateFlow(data);
  pasangTombolAbaikan(overlay, data.contentBuild);
}

async function startUpdateFlow(data){
  const btn = document.getElementById('btnUpdateAction');
  const status = document.getElementById('updateStatus');
  if(btn.dataset.busy==='1') return;
  btn.dataset.busy = '1';
  // Sembunyikan tombol X begitu unduhan mulai — supaya pemain tidak
  // menutup kartu di tengah proses (unduhannya tetap lanjut di
  // belakang layar tanpa UI, yang cuma bikin bingung).
  const btnDismissSaatDownload = document.getElementById('btnUpdateDismiss');
  if(btnDismissSaatDownload) btnDismissSaatDownload.style.display = 'none';

  // Di browser biasa (bukan APK) atau kalau plugin belum ikut ter-build,
  // tetap sediakan jalan keluar: buka link APK apa adanya.
  if(!isNativeApp || !CapPlugins.Filesystem || !CapPlugins.ApkInstaller){
    window.open(data.link_apk, '_blank');
    status.textContent = 'Unduhan dibuka di luar aplikasi. Pasang APK-nya secara manual setelah selesai.';
    btn.dataset.busy = '0';
    return;
  }

  try{
    // 1) Pastikan izin "Pasang aplikasi tidak dikenal" sudah aktif (Android 8+)
    const permCheck = await CapPlugins.ApkInstaller.checkInstallPermission();
    if(!permCheck.granted){
      status.textContent = 'Aktifkan dulu izin "Pasang aplikasi tidak dikenal" untuk Anumpoly di layar Pengaturan yang terbuka, lalu kembali ke sini dan tekan tombolnya lagi.';
      await CapPlugins.ApkInstaller.requestInstallPermission();
      btn.textContent = '🔁 Sudah Diizinkan? Coba Lagi';
      btn.dataset.busy = '0';
      return;
    }

    // 2) Download dengan progress asli (bukan animasi palsu)
    btn.textContent = '⏳ Mengunduh...';
    document.getElementById('updProgressWrap').style.display = 'block';
    status.textContent = 'Mengunduh update, mohon tunggu...';

    // PENTING — kenapa ditulis ke disk BERTAHAP (streaming), bukan
    // dikumpulkan dulu semua baru ditulis sekali di akhir seperti
    // sebelumnya:
    // Cara lama menumpuk SELURUH file APK di memori 3x lipat secara
    // bersamaan — array "chunks" (~55MB), lalu disalin lagi jadi satu
    // Blob (~55MB lagi), lalu dikonversi lagi jadi satu string base64
    // (~74MB, base64 selalu ~33% lebih besar dari aslinya) — total bisa
    // >180MB menumpuk di memori PAS SEBELUM ditulis ke file. Ini yang
    // bikin crash "Failed to allocate ... until OOM" di HP dengan RAM
    // pas-pasan atau heap kecil: begitu APK makin besar, titik ini
    // makin gampang kelewat batas.
    // Sekarang: tiap potongan (chunk) dari jaringan langsung digabung
    // jadi buffer kecil (maks ~2MB), dikonversi ke base64 HANYA untuk
    // buffer sekecil itu, langsung ditulis/ditempel ke file di disk
    // lewat writeFile (potongan pertama) lalu appendFile (potongan
    // berikutnya), lalu buffer itu dibuang dari memori sebelum lanjut
    // ke potongan berikutnya. Jadi berapa pun besar APK-nya, yang
    // menumpuk di memori pada satu waktu cuma beberapa MB saja, bukan
    // seluruh ukuran file.
    const CACHE_APK_PATH = 'anumpoly-update.apk';
    const FLUSH_THRESHOLD_BYTES = 2 * 1024 * 1024; // tulis ke disk tiap ~2MB terkumpul

    // Hapus sisa file dari percobaan sebelumnya (kalau ada) SEBELUM mulai
    // menulis — supaya appendFile tidak "menyambung" ke sisa unduhan lama
    // yang gagal/terpotong, yang bisa menghasilkan APK korup.
    try{ await CapPlugins.Filesystem.deleteFile({ path: CACHE_APK_PATH, directory: 'CACHE' }); }catch(e){ /* memang belum ada file lama — aman diabaikan */ }

    function uint8KeBase64(bytes){
      let biner = '';
      const langkah = 0x8000; // dipotong per 32KB saat konversi karena String.fromCharCode tidak aman dipanggil dengan array yang sangat besar sekaligus
      for(let i=0;i<bytes.length;i+=langkah){
        biner += String.fromCharCode.apply(null, bytes.subarray(i, i+langkah));
      }
      return btoa(biner);
    }

    const res = await fetch(data.link_apk);
    if(!res.ok) throw new Error('Gagal mengunduh (HTTP '+res.status+')');
    const total = parseInt(res.headers.get('Content-Length') || '0', 10);
    const reader = res.body.getReader();
    let received = 0;
    let bufferPotongan = [];
    let bufferBytes = 0;
    let fileSudahDibuat = false;
    // Dipakai buat hitung kecepatan sesaat (byte yang nambah / waktu yang
    // lewat sejak titik ukur SEBELUMNYA) — bukan rata-rata dari awal,
    // supaya kalau jaringan sempat melambat/cepat, angkanya ikut berubah
    // secara real-time, bukan angka yang "adem-ayem" terus.
    let waktuUkurTerakhir = performance.now();
    let bytesUkurTerakhir = 0;

    async function tulisBuffer(){
      if(bufferBytes === 0) return;
      const gabungan = new Uint8Array(bufferBytes);
      let offset = 0;
      for(const potong of bufferPotongan){ gabungan.set(potong, offset); offset += potong.length; }
      const base64Potongan = uint8KeBase64(gabungan);
      if(!fileSudahDibuat){
        await CapPlugins.Filesystem.writeFile({ path: CACHE_APK_PATH, data: base64Potongan, directory: 'CACHE' });
        fileSudahDibuat = true;
      } else {
        await CapPlugins.Filesystem.appendFile({ path: CACHE_APK_PATH, data: base64Potongan, directory: 'CACHE' });
      }
      bufferPotongan = [];
      bufferBytes = 0;
    }

    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      bufferPotongan.push(value);
      bufferBytes += value.length;
      received += value.length;
      const sekarang = performance.now();
      if(total){
        const pct = Math.min(100, Math.round(received/total*100));
        document.getElementById('updProgressBar').style.width = pct+'%';
        document.getElementById('updProgressLabel').textContent = pct+'%';
        document.getElementById('updSizeLabel').textContent = formatBytes(received)+' / '+formatBytes(total);
      } else {
        document.getElementById('updSizeLabel').textContent = formatBytes(received);
      }
      const selisihWaktu = (sekarang - waktuUkurTerakhir) / 1000;
      if(selisihWaktu >= 0.4){ // update label kecepatan tiap ~0.4 detik, biar tidak "kedip" tiap chunk kecil
        const kecepatan = (received - bytesUkurTerakhir) / selisihWaktu;
        document.getElementById('updSpeedLabel').textContent = formatSpeed(kecepatan);
        waktuUkurTerakhir = sekarang;
        bytesUkurTerakhir = received;
      }
      if(bufferBytes >= FLUSH_THRESHOLD_BYTES){
        status.textContent = 'Mengunduh & menyimpan update, mohon tunggu...';
        await tulisBuffer();
      }
    }
    // Tulis sisa buffer terakhir yang belum genap 2MB
    status.textContent = 'Menyimpan sisa file update...';
    await tulisBuffer();

    // 3) Ambil URI file yang barusan ditulis, buat dipasang installer
    const writeResult = await CapPlugins.Filesystem.getUri({ path: CACHE_APK_PATH, directory: 'CACHE' });

    // 4) Siap dipasang — tinggal satu tap, tanpa keluar dari game
    document.getElementById('updProgressBar').style.width = '100%';
    document.getElementById('updProgressLabel').textContent = '100%';
    btn.textContent = '📦 Pasang Sekarang';
    status.innerHTML = '✅ Update siap! Tekan tombol di atas, konfirmasi "Install" yang muncul dari Android, lalu buka lagi aplikasinya.';
    btn.onclick = async ()=>{
      try{ await CapPlugins.ApkInstaller.installApk({ filePath: writeResult.uri }); }
      catch(e){ status.textContent = 'Gagal membuka pemasang: '+(e && e.message ? e.message : e); }
    };
    btn.dataset.busy = '0';
  }catch(err){
    status.textContent = '❌ Gagal update: '+(err && err.message ? err.message : err)+'. Coba lagi.';
    btn.textContent = '🔁 Coba Lagi';
    btn.onclick = ()=> startUpdateFlow(data);
    btn.dataset.busy = '0';
  }
}

/* ============================================================
   HOT UPDATE (konten) — DIHAPUS.
   ============================================================
   Fitur ini pernah ada di sini (lewat plugin @capgo/capacitor-updater,
   ganti isi WebView pakai dist.zip tanpa dialog Install Android), tapi
   dihapus total karena jadi sumber bug ukuran APK bengkak terus-menerus
   (dist.zip yang dibundel CI ikut nyasar ke build berikutnya, jadi
   "membungkus dirinya sendiri" tiap rilis). Belum ada rencana pakai
   hot-update lagi untuk saat ini — kalau nanti dipakai lagi, bangun
   ulang dari awal dengan hati-hati, JANGAN cuma un-comment kode lama.

   Update APK di atas (checkForUpdate/startUpdateFlow) TETAP jalan
   seperti biasa: setiap rilis, sekecil apapun, ditawarkan sebagai
   update APK penuh (1x tap: unduh + pasang, tanpa keluar aplikasi).

*/
(async ()=>{
  checkForUpdate();
})();
