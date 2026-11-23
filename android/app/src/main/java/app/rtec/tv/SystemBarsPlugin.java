package app.rtec.tv;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Barras do sistema (hora/notificacoes em cima, gestos embaixo) no reprodutor do app (ver src/lib/systembars.ts).
 * Com o player aberto, o video vai de ponta a ponta (inclusive na area do recorte da camera) e as barras somem
 * (modo imersivo); aparecem por cima do video quando o cliente toca para ver os controles ou puxa a borda.
 * Ao fechar o player, tudo volta como era.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    private boolean inPlayer = false;
    private int savedStatusColor;
    private int savedNavColor;
    private boolean savedLightIcons;

    @PluginMethod
    public void set(PluginCall call) {
        final boolean player = Boolean.TRUE.equals(call.getBoolean("player", false));
        final boolean bars = !Boolean.FALSE.equals(call.getBoolean("bars", true));
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                apply(activity.getWindow(), player, bars);
            } catch (RuntimeException ignored) {
                // aparelho sem suporte: segue com as barras como estao
            }
            call.resolve();
        });
    }

    @SuppressWarnings("deprecation")
    private void apply(Window w, boolean player, boolean bars) {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
        if (player != inPlayer) {
            inPlayer = player;
            WindowCompat.setDecorFitsSystemWindows(w, !player);
            if (player) {
                savedStatusColor = w.getStatusBarColor();
                savedNavColor = w.getNavigationBarColor();
                savedLightIcons = c.isAppearanceLightStatusBars();
                c.setAppearanceLightStatusBars(false); // icones claros sobre o video
                w.setStatusBarColor(Color.TRANSPARENT);
                w.setNavigationBarColor(Color.TRANSPARENT);
            } else {
                c.setAppearanceLightStatusBars(savedLightIcons);
                w.setStatusBarColor(savedStatusColor);
                w.setNavigationBarColor(savedNavColor);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams lp = w.getAttributes();
                lp.layoutInDisplayCutoutMode = player
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
                w.setAttributes(lp);
            }
        }
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (player && !bars) c.hide(WindowInsetsCompat.Type.systemBars());
        else c.show(WindowInsetsCompat.Type.systemBars());
    }
}
