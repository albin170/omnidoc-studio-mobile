package studio.omnidoc.mobile;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.security.SecureRandom;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Instrumented tests executed inside the real Android runtime/emulator.
 */
@RunWith(AndroidJUnit4.class)
public class MainActivityInstrumentedTest {

    @Test
    public void targetAppPackageMatchesProductionId() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("studio.omnidoc.mobile", appContext.getPackageName());
    }

    @Test
    public void secureVaultCryptoRoundTripWorksOnAndroidRuntime() throws Exception {
        byte[] keyBytes = new byte[32];
        new SecureRandom().nextBytes(keyBytes);
        javax.crypto.SecretKey key = new javax.crypto.spec.SecretKeySpec(keyBytes, "AES");

        String secretPayload = "{\"session\":\"omnidoc-android-runtime-check\",\"version\":2}";
        String encrypted = SecureVaultCrypto.encryptWithKey(secretPayload, key);
        assertFalse(encrypted.contains("omnidoc-android-runtime-check"));

        String decrypted = SecureVaultCrypto.decryptWithKey(encrypted, key);
        assertEquals(secretPayload, decrypted);
    }
}
