package app.rtec.tv;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AudioBoostPlugin.class); // reforco de volume (src/lib/boost.ts)
        super.onCreate(savedInstanceState);
    }
}
