package com.anumpoly.apkinstaller;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.net.URI;

/**
 * Plugin kecil untuk fitur "Update dalam-game": setelah APK baru selesai
 * di-download lewat JS (fetch + @capacitor/filesystem) ke folder cache
 * aplikasi, plugin ini yang memicu pemasang paket bawaan Android untuk
 * menginstalnya, tanpa pemain perlu keluar ke browser/notifikasi.
 *
 * Catatan penting (batasan keamanan Android, bukan bug): Android TIDAK
 * pernah mengizinkan aplikasi biasa memasang APK 100% otomatis tanpa
 * sentuhan sama sekali — akan selalu muncul dialog konfirmasi "Install"
 * dari sistem sekali setiap update. Yang bisa kita hilangkan hanyalah
 * langkah manual "buka Notifikasi/Files lalu cari APK-nya" — di sini
 * pemasang langsung terbuka begitu pemain menekan tombol di dalam game.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod()
    public void checkInstallPermission(PluginCall call) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            granted = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod()
    public void requestInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod()
    public void installApk(PluginCall call) {
        String filePath = call.getString("filePath");
        if (filePath == null || filePath.isEmpty()) {
            call.reject("filePath wajib diisi");
            return;
        }
        try {
            File apkFile;
            if (filePath.startsWith("file://")) {
                apkFile = new File(URI.create(filePath));
            } else {
                apkFile = new File(filePath);
            }
            if (!apkFile.exists()) {
                call.reject("File APK tidak ditemukan di: " + filePath);
                return;
            }
            Uri apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".apkinstaller.fileprovider",
                    apkFile
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Gagal membuka pemasang APK: " + e.getMessage(), e);
        }
    }
}
