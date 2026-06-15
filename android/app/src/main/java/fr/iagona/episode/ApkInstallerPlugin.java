package fr.iagona.episode;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
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
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Sideload-update installer for the GitHub-distributed APK.
 *
 * The app isn't on Play, so the standard in-app-update flow (Play Core)
 * doesn't apply. Instead the web layer (see $lib/update + the home banner)
 * resolves the latest release's APK asset URL and calls installApk(); this
 * plugin downloads it into the app cache and hands it to the system package
 * installer via the FileProvider declared in AndroidManifest.xml.
 *
 * Permissions: REQUEST_INSTALL_PACKAGES (manifest). On Android 8+ the user
 * must also allow "install unknown apps" for Episode — when they haven't,
 * we open that settings screen and reject with UNKNOWN_SOURCES so the UI can
 * ask them to retry.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long code;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                code = info.getLongVersionCode();
            } else {
                code = info.versionCode;
            }
            JSObject ret = new JSObject();
            ret.put("versionName", info.versionName != null ? info.versionName : "");
            ret.put("versionCode", code);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), "INFO_FAILED", e);
        }
    }

    @PluginMethod
    public void installApk(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing APK url", "NO_URL");
            return;
        }
        final String fileName = call.getString("fileName", "episode-update.apk");

        // Android 8+: this app must be permitted to install packages.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            call.reject("Install from unknown sources is not allowed yet", "UNKNOWN_SOURCES");
            return;
        }

        // Download off the UI thread; resolve once the installer is launched.
        new Thread(() -> {
            try {
                File apk = download(url, fileName);
                launchInstaller(apk);
                JSObject ret = new JSObject();
                ret.put("launched", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage(), "DOWNLOAD_FAILED", e);
            }
        }).start();
    }

    private File download(String urlStr, String fileName) throws Exception {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new Exception("Cannot create cache dir");
        }
        File out = new File(dir, fileName);

        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(30000);
        conn.connect();
        int status = conn.getResponseCode();
        if (status != HttpURLConnection.HTTP_OK) {
            conn.disconnect();
            throw new Exception("HTTP " + status);
        }

        int total = conn.getContentLength();
        long downloaded = 0;
        long lastEmit = 0;
        InputStream in = conn.getInputStream();
        OutputStream os = new FileOutputStream(out);
        try {
            byte[] buf = new byte[8192];
            int read;
            while ((read = in.read(buf)) != -1) {
                os.write(buf, 0, read);
                downloaded += read;
                if (downloaded - lastEmit >= 65536) {
                    lastEmit = downloaded;
                    emitProgress(downloaded, total);
                }
            }
            os.flush();
        } finally {
            os.close();
            in.close();
            conn.disconnect();
        }
        emitProgress(total > 0 ? total : downloaded, total);
        return out;
    }

    private void emitProgress(long downloaded, int total) {
        JSObject ev = new JSObject();
        ev.put("progress", total > 0 ? (double) downloaded / (double) total : -1);
        notifyListeners("downloadProgress", ev);
    }

    private void launchInstaller(File apk) {
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
    }
}
