package studio.omnidoc.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import java.security.UnrecoverableKeyException;

import javax.crypto.AEADBadTagException;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;

@CapacitorPlugin(name = "SecureVault")
public class SecureVaultPlugin extends Plugin {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "omnidoc_mobile_vault_key_v1";
    private static final String PREFS_NAME = "omnidoc_secure_vault_prefs";

    private synchronized SecretKey getOrCreateSecretKey(boolean forceRecreate) throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);

        if (forceRecreate && keyStore.containsAlias(KEY_ALIAS)) {
            keyStore.deleteEntry(KEY_ALIAS);
        }

        if (keyStore.containsAlias(KEY_ALIAS)) {
            try {
                KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null);
                if (entry != null && entry.getSecretKey() != null) {
                    return entry.getSecretKey();
                }
            } catch (UnrecoverableKeyException e) {
                keyStore.deleteEntry(KEY_ALIAS);
                getPrefs().edit().clear().apply();
            }
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(SecureVaultCrypto.KEY_SIZE_BITS)
                .setRandomizedEncryptionRequired(true)
                .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    private String encrypt(String plaintext) throws Exception {
        try {
            return SecureVaultCrypto.encryptWithKey(plaintext, getOrCreateSecretKey(false));
        } catch (KeyPermanentlyInvalidatedException e) {
            getPrefs().edit().clear().apply();
            return SecureVaultCrypto.encryptWithKey(plaintext, getOrCreateSecretKey(true));
        }
    }

    private String decrypt(String encoded) throws Exception {
        return SecureVaultCrypto.decryptWithKey(encoded, getOrCreateSecretKey(false));
    }

    private SharedPreferences getPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private JSObject inspectKeySecurityInfo(SecretKey key) {
        JSObject info = new JSObject();
        info.put("storageBackend", "android_keystore");
        info.put("algorithm", SecureVaultCrypto.TRANSFORMATION);
        info.put("keySizeBits", SecureVaultCrypto.KEY_SIZE_BITS);

        boolean hardwareBacked = false;
        String securityLevel = "unknown";

        try {
            SecretKeyFactory factory = SecretKeyFactory.getInstance(key.getAlgorithm(), ANDROID_KEYSTORE);
            KeyInfo keyInfo = (KeyInfo) factory.getKeySpec(key, KeyInfo.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                int level = keyInfo.getSecurityLevel();
                if (level == KeyProperties.SECURITY_LEVEL_STRONGBOX) {
                    hardwareBacked = true;
                    securityLevel = "strongbox";
                } else if (level == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT) {
                    hardwareBacked = true;
                    securityLevel = "tee";
                } else if (level == KeyProperties.SECURITY_LEVEL_SOFTWARE) {
                    hardwareBacked = false;
                    securityLevel = "software";
                } else if (level == KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE) {
                    hardwareBacked = true;
                    securityLevel = "hardware_unknown";
                }
            } else {
                @SuppressWarnings("deprecation")
                boolean insideHw = keyInfo.isInsideSecureHardware();
                hardwareBacked = insideHw;
                securityLevel = insideHw ? "tee" : "software";
            }
        } catch (Exception e) {
            hardwareBacked = false;
            securityLevel = "unavailable";
        }

        info.put("hardwareBacked", hardwareBacked);
        info.put("securityLevel", securityLevel);
        return info;
    }

    @PluginMethod
    public void getSecurityInfo(PluginCall call) {
        try {
            SecretKey key = getOrCreateSecretKey(false);
            call.resolve(inspectKeySecurityInfo(key));
        } catch (Exception e) {
            JSObject fallback = new JSObject();
            fallback.put("storageBackend", "android_keystore");
            fallback.put("hardwareBacked", false);
            fallback.put("securityLevel", "unavailable");
            call.resolve(fallback);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || value == null) {
            call.reject("Both key and value are required");
            return;
        }
        try {
            String encrypted = encrypt(value);
            getPrefs().edit().putString(key, encrypted).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to encrypt value in Android Keystore: " + e.getMessage());
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("Key is required");
            return;
        }
        try {
            String encrypted = getPrefs().getString(key, null);
            JSObject ret = new JSObject();
            if (encrypted == null) {
                ret.put("value", null);
            } else {
                ret.put("value", decrypt(encrypted));
            }
            call.resolve(ret);
        } catch (AEADBadTagException | KeyPermanentlyInvalidatedException | IllegalArgumentException e) {
            // Tampered ciphertext or invalidated hardware key: fail closed & purge
            // corrupted entry
            getPrefs().edit().remove(key).apply();
            JSObject ret = new JSObject();
            ret.put("value", null);
            call.resolve(ret);
        } catch (Exception e) {
            getPrefs().edit().remove(key).apply();
            JSObject ret = new JSObject();
            ret.put("value", null);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (key != null) {
            getPrefs().edit().remove(key).apply();
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        getPrefs().edit().clear().apply();
        call.resolve();
    }
}
