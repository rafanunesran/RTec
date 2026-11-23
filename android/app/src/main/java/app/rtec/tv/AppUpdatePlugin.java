package app.rtec.tv;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Atualizacao automatica do app (ver src/lib/appupdate.ts): o site avisa a versao nova
 * (/download/rtec-tv.json), o app baixa o APK e instala por cima pelo PackageInstaller.
 * Android 12+: depois que o proprio app instalou uma vez (passa a ser o "instalador" dele mesmo),
 * as proximas atualizacoes entram sem perguntar nada. Na primeira vez o Android pede para permitir
 * "instalar apps desta fonte" e confirmar a atualizacao (isso nao da para pular por codigo).
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private File apkFile() {
        return new File(getContext().getCacheDir(), "rtec-update.apk");
    }

    @PluginMethod
    @SuppressWarnings("deprecation")
    public void info(PluginCall call) {
        Context ctx = getContext();
        PackageManager pm = ctx.getPackageManager();
        String pkg = ctx.getPackageName();
        JSObject ret = new JSObject();
        try {
            PackageInfo pi = pm.getPackageInfo(pkg, 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
            String installer = null;
            try {
                installer = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? pm.getInstallSourceInfo(pkg).getInstallingPackageName()
                    : pm.getInstallerPackageName(pkg);
            } catch (Exception ignored) {
                // sem informacao do instalador
            }
            ret.put("versionCode", code);
            ret.put("versionName", pi.versionName);
            ret.put("silent", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && pkg.equals(installer));
            ret.put("canInstall", Build.VERSION.SDK_INT < Build.VERSION_CODES.O || pm.canRequestPackageInstalls());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Nao foi possivel ler a versao do app", e);
        }
    }

    /** Baixa o APK novo para o cache do app. */
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Endereco invalido");
            return;
        }
        new Thread(() -> {
            File tmp = new File(getContext().getCacheDir(), "rtec-update.part");
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setConnectTimeout(15000);
                con.setReadTimeout(30000);
                if (con.getResponseCode() != 200) throw new RuntimeException("HTTP " + con.getResponseCode());
                try (InputStream in = con.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                if (tmp.length() < 500_000) throw new RuntimeException("Arquivo incompleto");
                File dest = apkFile();
                if (dest.exists() && !dest.delete()) throw new RuntimeException("Nao apagou o arquivo antigo");
                if (!tmp.renameTo(dest)) throw new RuntimeException("Nao salvou o arquivo");
                call.resolve();
            } catch (Exception e) {
                tmp.delete();
                call.reject("Falha ao baixar a atualizacao", e);
            } finally {
                if (con != null) con.disconnect();
            }
        }).start();
    }

    /** Instala o APK baixado por cima do app (o app fecha ao terminar). */
    @PluginMethod
    public void install(PluginCall call) {
        final File apk = apkFile();
        if (!apk.exists()) {
            call.reject("Nenhuma atualizacao baixada");
            return;
        }
        new Thread(() -> {
            Context ctx = getContext();
            PackageInstaller.Session session = null;
            try {
                PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(ctx.getPackageName());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                }
                int id = installer.createSession(params);
                session = installer.openSession(id);
                try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("rtec", 0, apk.length())) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    session.fsync(out);
                }
                Intent intent = new Intent(ctx, InstallResultReceiver.class);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
                PendingIntent pending = PendingIntent.getBroadcast(ctx, id, intent, flags);
                session.commit(pending.getIntentSender());
                call.resolve();
            } catch (Exception e) {
                if (session != null) session.abandon();
                call.reject("Falha ao instalar a atualizacao", e);
            } finally {
                if (session != null) session.close();
            }
        }).start();
    }
}
