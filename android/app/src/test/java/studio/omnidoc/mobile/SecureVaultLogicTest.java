package studio.omnidoc.mobile;

import org.junit.Test;

import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.AEADBadTagException;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import static org.junit.Assert.*;

public class SecureVaultLogicTest {
    private SecretKey generateAes256Key() {
        byte[] keyBytes = new byte[32];
        new SecureRandom().nextBytes(keyBytes);
        return new SecretKeySpec(keyBytes, "AES");
    }

    @Test
    public void aes256GcmEncryptDecryptRoundtripUsesDistinctRandomIvs() throws Exception {
        SecretKey key = generateAes256Key();
        String secretJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsImV4cCI6OTk5OTk5OTk5OX0.sig";

        String encrypted1 = SecureVaultCrypto.encryptWithKey(secretJwt, key);
        String encrypted2 = SecureVaultCrypto.encryptWithKey(secretJwt, key);

        assertNotNull(encrypted1);
        assertFalse(encrypted1.contains(secretJwt));
        // Random IV guarantees semantically secure distinct ciphertexts for identical plaintexts
        assertNotEquals(encrypted1, encrypted2);

        byte[] raw1 = SecureVaultCrypto.decodeBase64(encrypted1);
        byte[] raw2 = SecureVaultCrypto.decodeBase64(encrypted2);
        byte[] iv1 = Arrays.copyOfRange(raw1, 0, SecureVaultCrypto.GCM_IV_LENGTH);
        byte[] iv2 = Arrays.copyOfRange(raw2, 0, SecureVaultCrypto.GCM_IV_LENGTH);
        assertFalse(Arrays.equals(iv1, iv2));

        assertEquals(secretJwt, SecureVaultCrypto.decryptWithKey(encrypted1, key));
        assertEquals(secretJwt, SecureVaultCrypto.decryptWithKey(encrypted2, key));
    }

    @Test
    public void tamperedCiphertextOrIvFailsAuthenticationTagValidation() throws Exception {
        SecretKey key = generateAes256Key();
        String encrypted = SecureVaultCrypto.encryptWithKey("sensitive-session-meta", key);
        byte[] raw = SecureVaultCrypto.decodeBase64(encrypted);

        // Tamper ciphertext byte
        byte[] tamperedCt = Arrays.copyOf(raw, raw.length);
        tamperedCt[raw.length - 1] ^= 0x55;
        String tamperedCtB64 = SecureVaultCrypto.encodeBase64(tamperedCt);
        assertThrows(AEADBadTagException.class, () -> SecureVaultCrypto.decryptWithKey(tamperedCtB64, key));

        // Tamper IV byte
        byte[] tamperedIv = Arrays.copyOf(raw, raw.length);
        tamperedIv[0] ^= 0x01;
        String tamperedIvB64 = SecureVaultCrypto.encodeBase64(tamperedIv);
        assertThrows(AEADBadTagException.class, () -> SecureVaultCrypto.decryptWithKey(tamperedIvB64, key));

        // Wrong key must also fail GCM tag validation
        SecretKey wrongKey = generateAes256Key();
        assertThrows(AEADBadTagException.class, () -> SecureVaultCrypto.decryptWithKey(encrypted, wrongKey));
    }

    @Test
    public void truncatedOrMalformedPayloadIsRejected() {
        SecretKey key = generateAes256Key();
        String tooShort = SecureVaultCrypto.encodeBase64(new byte[16]);
        assertThrows(IllegalArgumentException.class, () -> SecureVaultCrypto.decryptWithKey(tooShort, key));
        assertThrows(IllegalArgumentException.class, () -> SecureVaultCrypto.decryptWithKey("", key));
    }
}
