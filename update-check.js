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
      window.alertModal('Kamu sudah pakai versi terbaru Monopoli Dunia. 👍');
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
      <p>Ada versi baru Monopoli Dunia${data.terbaru?(' (v'+data.terbaru+')'):''}. Update dulu ya biar bisa main bareng teman.</p>
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
      status.textContent = 'Aktifkan dulu izin "Pasang aplikasi tidak dikenal" untuk Monopoli Dunia di layar Pengaturan yang terbuka, lalu kembali ke sini dan tekan tombolnya lagi.';
      await CapPlugins.ApkInstaller.requestInstallPermission();
      btn.textContent = '🔁 Sudah Diizinkan? Coba Lagi';
      btn.dataset.busy = '0';
      return;
    }

    // 2) Download dengan progress asli (bukan animasi palsu)
    btn.textContent = '⏳ Mengunduh...';
    document.getElementById('updProgressWrap').style.display = 'block';
    status.textContent = 'Mengunduh update, mohon tunggu...';

    const res = await fetch(data.link_apk);
    if(!res.ok) throw new Error('Gagal mengunduh (HTTP '+res.status+')');
    const total = parseInt(res.headers.get('Content-Length') || '0', 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    // Dipakai buat hitung kecepatan sesaat (byte yang nambah / waktu yang
    // lewat sejak titik ukur SEBELUMNYA) — bukan rata-rata dari awal,
    // supaya kalau jaringan sempat melambat/cepat, angkanya ikut berubah
    // secara real-time, bukan angka yang "adem-ayem" terus.
    let waktuUkurTerakhir = performance.now();
    let bytesUkurTerakhir = 0;
    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      chunks.push(value);
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
    }

    // 3) Simpan ke folder cache aplikasi — tidak perlu izin penyimpanan
    status.textContent = 'Menyimpan file update...';
    const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
    const base64 = await blobToBase64(blob);
    const writeResult = await CapPlugins.Filesystem.writeFile({
      path: 'monopoli-dunia-update.apk',
      data: base64,
      directory: 'CACHE'
    });

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

function blobToBase64(blob){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onloadend = ()=> resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ============================================================
   HOT UPDATE (konten) — beda dari update APK di atas!
   ============================================================
   Update APK di atas = ganti seluruh aplikasi, WAJIB lewat dialog
   "Install" Android, dipakai kalau ada perubahan native (plugin baru,
   izin baru, dst) — jarang terjadi.

   Hot update di sini = cuma ganti ISI (index.html, bgm, dsb), lewat
   plugin "@capgo/capacitor-updater" (mode self-hosted, TANPA akun/cloud
   pihak ketiga — bundle-nya di-hosting sendiri di GitHub Pages, sama
   seperti anumpoly.apk & versi.json). Ini yang berasa kayak update
   dalam-game MLBB/PUBG/FF: unduhan kecil, sekali tap, TANPA dialog
   Install Android sama sekali — karena APK aslinya tidak diganti,
   cuma isi di dalamnya yang ditimpa.

   Dipakai kalau developer cuma push perubahan index.html/asset (kayak
   sebagian besar perubahan sehari-hari) — jauh lebih sering dari update
   APK penuh di atas.
*/
const CapUpdater = CapPlugins.CapacitorUpdater;
const CONTENT_VERSION_KEY = 'anumpoly_content_version'; // dipertahankan sebagai fallback lama, TIDAK dipakai lagi sebagai sumber utama (lihat catatan di checkForContentUpdate)

// Dipanggil setiap sesi jalan (bukan cuma pas ada update) — ini wajib
// per dokumentasi plugin: menandai ke plugin bahwa versi yang sedang
// jalan sekarang terbukti tidak crash, supaya plugin tidak otomatis
// rollback ke versi sebelumnya.
if(isNativeApp && CapUpdater && CapUpdater.notifyAppReady){
  CapUpdater.notifyAppReady().catch(()=>{});
}

// Bersihkan bundle hot-update lama/gagal yang mungkin tertinggal di
// penyimpanan HP — jaring pengaman TAMBAHAN di atas autoDeleteFailed/
// autoDeletePrevious plugin (lihat capacitor_config.json), untuk kasus
// di mana banyak percobaan update yang gagal berulang-ulang (mis. dulu
// sebelum dist.zip diperbaiki) sempat menumpuk bundle yang tidak
// terpakai. Cuma menyisakan bundle yang SEDANG AKTIF — semua yang lain
// dihapus. Aman dijalankan tiap kali aplikasi dibuka; kalau memang
// sudah bersih, tidak akan menemukan apa-apa untuk dihapus.
async function bersihkanBundleLama(){
  if(!isNativeApp || !CapUpdater || !CapUpdater.list || !CapUpdater.current || !CapUpdater.delete) return;
  try{
    const { bundle: aktif } = await CapUpdater.current();
    const { bundles } = await CapUpdater.list();
    for(const b of bundles){
      if(b.id !== aktif.id){
        try{ await CapUpdater.delete({ id: b.id }); }catch(e){ /* satu gagal, lanjut ke berikutnya */ }
      }
    }
  }catch(e){ /* gagal cek/bersihkan — tidak fatal, coba lagi sesi berikutnya */ }
}
bersihkanBundleLama();

async function checkForContentUpdate(){
  if(!isNativeApp || !CapUpdater) return false; // fitur ini cuma ada di APK asli, bukan browser preview
  try{
    const res = await fetch(REMOTE_VERSI_URL, { cache: 'no-store' });
    const data = await res.json();
    // Dulu pakai "terbaruBuild" (nomor yang sama dipakai update APK juga —
    // ini sumber masalah update dobel). Sekarang pakai "contentBuild",
    // nomor terpisah yang naik tiap rilis apapun (isi konten selalu ikut
    // ter-update lewat sini), independen dari "nativeBuild" yang dipakai
    // checkForUpdate() di atas.
    if(!data || !data.contentBuild || !data.link_bundle) return false;
    const buildTerbaru = String(data.contentBuild);

    // PENTING — inilah perbaikan untuk bug "update maju-mundur / tidak
    // selesai-selesai walau APK terbaru sudah dipasang manual":
    // Sumber kebenaran "build konten yang sedang aktif SEKARANG" adalah
    // window.ANUMPOLY_BUILD (dibaca dari index.html yang BENAR-BENAR
    // sedang jalan saat ini — lihat penjelasan lengkap di index.html,
    // dekat baris window.ANUMPOLY_BUILD di-set). Ini SELALU sinkron,
    // baik untuk APK fresh install (index.html bawaan APK) maupun
    // setelah hot-update sebelumnya (index.html dari dist.zip) —
    // berbeda dari localStorage lama yang kosong lagi tiap fresh
        // install/uninstall walau kontennya sebenarnya sudah paling baru.
    const buildAktif = (window.ANUMPOLY_BUILD || '').replace(/[^0-9]/g, '');
    if(buildAktif && buildAktif === buildTerbaru){
      // Sinkronkan localStorage juga (fallback lama) biar konsisten,
      // walau sekarang bukan yang dipakai untuk keputusan utama.
      try{ localStorage.setItem(CONTENT_VERSION_KEY, buildTerbaru); }catch(e){}
      return false; // build konten yang aktif SUDAH sama dengan yang terbaru, tidak perlu apa-apa
    }

    if(sudahDiabaikan(buildTerbaru)) return false;

    showContentUpdateCard(data, buildTerbaru);
    return true;
  }catch(e){ return false; /* offline / gagal cek — biarkan pemain lanjut main seperti biasa */ }
}

function showContentUpdateCard(data, buildTerbaru){
  const overlay = document.createElement('div');
  overlay.id = 'updateOverlay';
  overlay.innerHTML = `
    <div class="upd-box" style="position:relative;">
      ${TOMBOL_ABAIKAN_HTML}
      <div class="upd-icon">✨</div>
      <h2>Update Kecil Tersedia</h2>
      <p>Ada pembaruan ringan Anumpoly${data.terbaru?(' (v'+data.terbaru+')'):''} — perbaikan/tampilan, unduhan kecil, TANPA install ulang.</p>
      <div id="contentProgressWrap" style="display:none;">
        <div class="upd-bar-track"><div id="contentProgressBar" class="upd-bar-fill"></div></div>
        <div class="upd-meta-row"><span id="contentSpeedLabel"></span><span id="contentSizeLabel"></span></div>
        <div id="contentProgressLabel" class="upd-progress-label">0%</div>
      </div>
      <button id="btnContentUpdateAction" class="upd-btn-main">⬇️ Perbarui Sekarang</button>
      <div id="contentUpdateStatus" class="upd-status"></div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('btnContentUpdateAction').onclick = ()=> startContentUpdate(data, buildTerbaru);
  pasangTombolAbaikan(overlay, buildTerbaru);
}

// Berapa kali coba ulang otomatis kalau unduhan gagal (mis. putus sesaat di
// jaringan lambat) SEBELUM benar-benar menampilkan pesan gagal ke pemain.
// Percobaan ulang otomatis ini yang tadinya tidak ada — dulu sekali gagal
// (mis. cuma putus sebentar) langsung tampil "Gagal memperbarui" walau
// jaringannya sebenarnya masih hidup.
const CONTENT_UPDATE_MAX_RETRY = 2;

async function startContentUpdate(data, buildTerbaru, percobaanKe = 1){
  const btn = document.getElementById('btnContentUpdateAction');
  const status = document.getElementById('contentUpdateStatus');
  const progressWrap = document.getElementById('contentProgressWrap');
  const progressBar = document.getElementById('contentProgressBar');
  const progressLabel = document.getElementById('contentProgressLabel');
  const speedLabel = document.getElementById('contentSpeedLabel');
  const sizeLabel = document.getElementById('contentSizeLabel');
  if(btn.dataset.busy==='1') return;
  btn.dataset.busy = '1';
  const btnDismissSaatDownload = document.getElementById('btnUpdateDismiss');
  if(btnDismissSaatDownload) btnDismissSaatDownload.style.display = 'none';
  btn.textContent = '⏳ Mengunduh...';
  progressWrap.style.display = 'block';
  progressBar.style.width = '0%';
  progressLabel.textContent = '0%';
  speedLabel.textContent = '';
  sizeLabel.textContent = '';
  status.textContent = 'Mengunduh pembaruan, mohon tunggu...';

  // PENTING — kenapa perlu HEAD request terpisah ke dist.zip:
  // Plugin @capgo/capacitor-updater cuma ngasih "percent" polos lewat
  // event 'download' (dan di banyak HP naiknya lompat per-blok, mis.
  // 0 -> 10 -> 20 -> ..., BUKAN pelan-pelan per 1% — ini keterbatasan
  // di sisi native plugin, bukan sesuatu yang bisa diatur dari sini).
  // Plugin ini juga TIDAK ngasih info ukuran file (byte terunduh/total)
  // ataupun kecepatan sama sekali. Makanya sebelum mulai download,
  // kita ambil dulu Content-Length dari dist.zip lewat HEAD request —
  // dari situ ukuran MB & kecepatan bisa DIHITUNG SENDIRI (estimasi
  // dari persen x total ukuran), bukan dibaca langsung dari plugin.
  let totalBundleBytes = null;
  try{
    const headRes = await fetch(data.link_bundle, { method: 'HEAD', cache: 'no-store' });
    const len = headRes.headers.get('Content-Length');
    if(len) totalBundleBytes = parseInt(len, 10);
  }catch(e){ /* HEAD gagal (jaringan/HP tertentu) -> ukuran & kecepatan disembunyikan, progres tetap jalan pakai persen */ }

  // ------------------------------------------------------------------
  // Animasi persen HALUS 1% demi 1% dari nilai yang sedang tampil menuju
  // target terbaru dari plugin — supaya progress bar tidak "meloncat"
  // 10% sekali lompat walau data mentah dari plugin memang lompat.
  // ------------------------------------------------------------------
  let persenTampil = 0;
  let animFrame = null;
  function animasikanKe(target){
    if(animFrame) cancelAnimationFrame(animFrame);
    const awal = persenTampil;
    const waktuMulai = performance.now();
    const durasi = 500; // ms — cukup untuk terasa "naik pelan", tapi tidak ketinggalan jauh dari data asli
    function langkah(now){
      const t = Math.min(1, (now - waktuMulai) / durasi);
      persenTampil = awal + (target - awal) * t;
      const tampil = Math.min(100, Math.round(persenTampil));
      progressBar.style.width = tampil + '%';
      progressLabel.textContent = tampil + '%';
      if(t < 1) animFrame = requestAnimationFrame(langkah);
    }
    animFrame = requestAnimationFrame(langkah);
  }

  // Dengerin event progress asli dari plugin CapacitorUpdater. Listener
  // WAJIB dilepas lagi di finally, supaya tidak numpuk kalau fungsi ini
  // dipanggil ulang (coba lagi / update berikutnya).
  let downloadListener = null;
  let waktuUkurTerakhir = performance.now();
  let bytesUkurTerakhir = 0;
  if(CapUpdater.addListener){
    downloadListener = await CapUpdater.addListener('download', (info)=>{
      const pctAsli = Math.min(100, Math.max(0, Math.round(info && info.percent || 0)));
      animasikanKe(pctAsli);

      if(totalBundleBytes){
        const bytesSekarang = Math.round(totalBundleBytes * pctAsli / 100);
        sizeLabel.textContent = formatBytes(bytesSekarang) + ' / ' + formatBytes(totalBundleBytes);

        const sekarang = performance.now();
        const selisihWaktu = (sekarang - waktuUkurTerakhir) / 1000;
        const selisihBytes = bytesSekarang - bytesUkurTerakhir;
        // Cuma hitung ulang kecepatan kalau memang ada progres baru sejak
        // titik ukur sebelumnya — kalau event ini "percent"-nya masih
        // sama (kadang plugin kirim event kosong), biarkan angka lama.
        if(selisihWaktu > 0 && selisihBytes > 0){
          speedLabel.textContent = formatSpeed(selisihBytes / selisihWaktu);
          waktuUkurTerakhir = sekarang;
          bytesUkurTerakhir = bytesSekarang;
        }
      }
    });
  }

  try{
    const bundle = await CapUpdater.download({ version: buildTerbaru, url: data.link_bundle });
    if(animFrame) cancelAnimationFrame(animFrame);
    progressBar.style.width = '100%';
    progressLabel.textContent = '100%';
    if(totalBundleBytes) sizeLabel.textContent = formatBytes(totalBundleBytes) + ' / ' + formatBytes(totalBundleBytes);
    speedLabel.textContent = '';
    status.textContent = 'Menerapkan pembaruan...';
    if(CapPlugins.SplashScreen) { try{ await CapPlugins.SplashScreen.show(); }catch(e){} }
    try{ localStorage.setItem(CONTENT_VERSION_KEY, buildTerbaru); }catch(e){}
    // CapUpdater.set() mengganti isi WebView ke bundle baru & reload di
    // tempat — baris setelah ini biasanya tidak sempat kejalan lagi.
    await CapUpdater.set(bundle);
  }catch(err){
    if(animFrame) cancelAnimationFrame(animFrame);
    if(downloadListener) { try{ await downloadListener.remove(); }catch(e){} }
    // Gagal (paling sering: timeout di jaringan lambat/putus sesaat) —
    // coba ulang otomatis dulu beberapa kali sebelum benar-benar
    // mengaku gagal ke pemain.
    if(percobaanKe < CONTENT_UPDATE_MAX_RETRY){
      status.textContent = 'Unduhan sempat gagal, mencoba lagi... ('+percobaanKe+'/'+CONTENT_UPDATE_MAX_RETRY+')';
      btn.dataset.busy = '0';
      setTimeout(()=> startContentUpdate(data, buildTerbaru, percobaanKe+1), 1500);
      return;
    }
    if(CapPlugins.SplashScreen) { try{ await CapPlugins.SplashScreen.hide(); }catch(e){} }
    status.textContent = '❌ Gagal memperbarui: '+(err && err.message ? err.message : err)+'. Coba lagi, atau main dulu — nanti ditawari lagi saat buka berikutnya.';
    btn.textContent = '🔁 Coba Lagi';
    btn.dataset.busy = '0';
    btn.onclick = ()=> startContentUpdate(data, buildTerbaru, 1);
    // Bersihkan bundle gagal SEKARANG JUGA, jangan tunggu app dibuka ulang —
    // ini yang tadinya bikin storage numpuk (71MB -> 112MB dalam hitungan
    // menit) kalau pemain gagal beberapa kali berturut-turut di sesi yang
    // sama sebelum sempat menutup aplikasi.
    bersihkanBundleLama();
    return;
  }
  if(downloadListener) { try{ await downloadListener.remove(); }catch(e){} }
}

// Hot update konten UNTUK SEMENTARA DIMATIKAN (permintaan developer) —
// semua rilis, sekecil apapun, sekarang ditawarkan sebagai update APK
// penuh saja (1x tap di dalam game: unduh + pasang, tanpa keluar dari
// aplikasi — lihat startUpdateFlow() di atas). Fungsi-fungsi hot-update
// di atas (checkForContentUpdate, showContentUpdateCard,
// startContentUpdate, bersihkanBundleLama) SENGAJA tidak dihapus, cuma
// tidak dipanggil lagi di sini — supaya gampang dinyalakan lagi nanti
// kalau perlu, tinggal un-comment baris yang di-comment di bawah, DAN
// kembalikan checkForUpdate() ke perbandingan "nativeBuild" (lihat
// catatan di fungsi checkForUpdate() di atas).
(async ()=>{
  // const contentUpdateShown = await checkForContentUpdate();
  // if(!contentUpdateShown) checkForUpdate();
  checkForUpdate();
})();
