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

async function checkForUpdate(){
  try{
    const versiSaya = await getVersiTerpasang();
    const res = await fetch(REMOTE_VERSI_URL, { cache: 'no-store' });
    const data = await res.json();
    // PENTING: perbandingan "ada update APK atau tidak" pakai "nativeBuild"
    // — BUKAN "contentBuild" (dulu namanya "terbaruBuild"). Ini yang
    // memperbaiki masalah update dobel: nativeBuild HANYA naik kalau rilis
    // itu benar-benar mengubah sesuatu yang butuh APK baru (plugin/
    // dependency/config native — lihat step "Deteksi perubahan native" di
    // build-android.yml). Rilis konten biasa (index.html/asset) TIDAK
    // menaikkan nativeBuild, jadi kalau native shell yang kepasang di HP
    // sudah setara dengan nativeBuild terbaru, kartu update APK ini TIDAK
    // akan muncul lagi — cukup hot-update konten (checkForContentUpdate)
    // yang jalan. versiSaya sendiri (dari App.getInfo().build) adalah
    // versionCode APK yang kepasang, yang selalu naik tiap build apapun,
    // jadi perbandingan "versiSaya < data.nativeBuild" tetap valid.
    if(data && data.nativeBuild && versiSaya < data.nativeBuild){
      showUpdateCard(data);
    }
  }catch(e){ /* offline / gagal cek — biarkan pemain lanjut main seperti biasa */ }
}

function showUpdateCard(data){
  const overlay = document.createElement('div');
  overlay.id = 'updateOverlay';
  overlay.innerHTML = `
    <div class="upd-box">
      <div class="upd-icon">🔔</div>
      <h2>Update Tersedia</h2>
      <p>Ada versi baru Monopoli Dunia${data.terbaru?(' (v'+data.terbaru+')'):''}. Update dulu ya biar bisa main bareng teman.</p>
      <div id="updProgressWrap" style="display:none;">
        <div class="upd-bar-track"><div id="updProgressBar" class="upd-bar-fill"></div></div>
        <div id="updProgressLabel" class="upd-progress-label">0%</div>
      </div>
      <button id="btnUpdateAction" class="upd-btn-main">⬇️ Download Update</button>
      <div id="updateStatus" class="upd-status"></div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('btnUpdateAction').onclick = ()=> startUpdateFlow(data);
}

async function startUpdateFlow(data){
  const btn = document.getElementById('btnUpdateAction');
  const status = document.getElementById('updateStatus');
  if(btn.dataset.busy==='1') return;
  btn.dataset.busy = '1';

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
    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      chunks.push(value);
      received += value.length;
      if(total){
        const pct = Math.min(100, Math.round(received/total*100));
        document.getElementById('updProgressBar').style.width = pct+'%';
        document.getElementById('updProgressLabel').textContent = pct+'%';
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

    showContentUpdateCard(data, buildTerbaru);
    return true;
  }catch(e){ return false; /* offline / gagal cek — biarkan pemain lanjut main seperti biasa */ }
}

function showContentUpdateCard(data, buildTerbaru){
  const overlay = document.createElement('div');
  overlay.id = 'updateOverlay';
  overlay.innerHTML = `
    <div class="upd-box">
      <div class="upd-icon">✨</div>
      <h2>Update Kecil Tersedia</h2>
      <p>Ada pembaruan ringan Anumpoly${data.terbaru?(' (v'+data.terbaru+')'):''} — perbaikan/tampilan, unduhan kecil, TANPA install ulang.</p>
      <div id="contentProgressWrap" style="display:none;">
        <div class="upd-bar-track"><div id="contentProgressBar" class="upd-bar-fill"></div></div>
        <div id="contentProgressLabel" class="upd-progress-label">0%</div>
      </div>
      <button id="btnContentUpdateAction" class="upd-btn-main">⬇️ Perbarui Sekarang</button>
      <div id="contentUpdateStatus" class="upd-status"></div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('btnContentUpdateAction').onclick = ()=> startContentUpdate(data, buildTerbaru);
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
  if(btn.dataset.busy==='1') return;
  btn.dataset.busy = '1';
  btn.textContent = '⏳ Mengunduh...';
  progressWrap.style.display = 'block';
  progressBar.style.width = '0%';
  progressLabel.textContent = '0%';
  status.textContent = 'Mengunduh pembaruan, mohon tunggu...';

  // Dengerin event progress asli dari plugin CapacitorUpdater (bukan
  // animasi palsu) — inilah yang tadinya hilang, makanya progress bar
  // hot-update tidak pernah jalan padahal update APK di atas sudah punya.
  // Listener WAJIB dilepas lagi di finally, supaya tidak numpuk kalau
  // fungsi ini dipanggil ulang (coba lagi / update berikutnya).
  let downloadListener = null;
  if(CapUpdater.addListener){
    downloadListener = await CapUpdater.addListener('download', (info)=>{
      const pct = Math.min(100, Math.round(info && info.percent || 0));
      progressBar.style.width = pct+'%';
      progressLabel.textContent = pct+'%';
    });
  }

  try{
    const bundle = await CapUpdater.download({ version: buildTerbaru, url: data.link_bundle });
    progressBar.style.width = '100%';
    progressLabel.textContent = '100%';
    status.textContent = 'Menerapkan pembaruan...';
    if(CapPlugins.SplashScreen) { try{ await CapPlugins.SplashScreen.show(); }catch(e){} }
    try{ localStorage.setItem(CONTENT_VERSION_KEY, buildTerbaru); }catch(e){}
    // CapUpdater.set() mengganti isi WebView ke bundle baru & reload di
    // tempat — baris setelah ini biasanya tidak sempat kejalan lagi.
    await CapUpdater.set(bundle);
  }catch(err){
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
    return;
  }
  if(downloadListener) { try{ await downloadListener.remove(); }catch(e){} }
}

// Hot update konten dicek DULUAN (ringan, tidak ganggu) — kalau memang
// ada dan pemain memilih update, alur update APK penuh di bawahnya
// dilewati dulu sesi ini (nanti otomatis kecek lagi begitu bundle baru
// selesai diterapkan & aplikasi reload).
(async ()=>{
  const contentUpdateShown = await checkForContentUpdate();
  if(!contentUpdateShown) checkForUpdate();
})();
