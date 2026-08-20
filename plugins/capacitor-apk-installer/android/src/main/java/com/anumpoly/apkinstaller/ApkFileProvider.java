package com.anumpoly.apkinstaller;

import androidx.core.content.FileProvider;

/**
 * Sekadar subclass kosong dari FileProvider bawaan androidx.
 *
 * Kenapa perlu: kalau plugin lain di aplikasi ini (misalnya plugin login)
 * JUGA mendaftarkan <provider android:name="androidx.core.content.FileProvider">
 * dengan authorities berbeda, Android Gradle Plugin menganggap keduanya
 * "provider yang sama" (kunci penggabungan manifest memakai android:name)
 * lalu menolak build karena authorities-nya beda (manifest merger conflict).
 *
 * Dengan subclass ini, provider milik plugin update-dalam-game punya
 * android:name sendiri yang unik (com.anumpoly.apkinstaller.ApkFileProvider),
 * jadi tidak akan pernah dianggap sama dengan FileProvider plugin lain,
 * berapa pun banyaknya plugin lain yang juga pakai FileProvider.
 */
public class ApkFileProvider extends FileProvider {
}
