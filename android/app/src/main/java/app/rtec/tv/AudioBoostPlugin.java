package app.rtec.tv;

import android.media.audiofx.LoudnessEnhancer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reforco de volume do app: aumenta o som de saida do aparelho (LoudnessEnhancer, com limitador proprio).
 * Funciona em qualquer video, sem depender do fornecedor liberar o audio para o site (ver src/lib/boost.ts).
 */
@CapacitorPlugin(name = "AudioBoost")
public class AudioBoostPlugin extends Plugin {

    private LoudnessEnhancer enhancer;

    @PluginMethod
    public void set(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        Integer gain = call.getInt("gainMb", 900);
        try {
            if (on) {
                // Sessao 0 = som misturado do aparelho (o WebView nao informa a sessao do video).
                if (enhancer == null) enhancer = new LoudnessEnhancer(0);
                enhancer.setTargetGain(gain == null ? 900 : gain);
                enhancer.setEnabled(true);
            } else {
                release();
            }
            JSObject ret = new JSObject();
            ret.put("on", on);
            call.resolve(ret);
        } catch (RuntimeException e) {
            release();
            call.reject("Este aparelho nao permite o reforco de volume", e);
        }
    }

    private void release() {
        if (enhancer == null) return;
        try {
            enhancer.setEnabled(false);
            enhancer.release();
        } catch (RuntimeException ignored) {
            // ja liberado pelo sistema
        }
        enhancer = null;
    }

    @Override
    protected void handleOnDestroy() {
        release();
    }
}
