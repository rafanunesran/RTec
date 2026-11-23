package app.rtec.tv;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AudioBoostPlugin.class); // reforco de volume (src/lib/boost.ts)
        registerPlugin(AppUpdatePlugin.class); // atualizacao automatica (src/lib/appupdate.ts)
        registerPlugin(SystemBarsPlugin.class); // barras do sistema no player (src/lib/systembars.ts)
        super.onCreate(savedInstanceState);
    }
}
