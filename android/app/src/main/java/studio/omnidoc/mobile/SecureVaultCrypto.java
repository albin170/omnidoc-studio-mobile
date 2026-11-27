package studio.omnidoc.mobile;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.Key;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Pure Java AES-256-GCM cryptographic primitive used by SecureVaultPlugin and JVM unit tests.
 * Uses pure Java Base64 helpers for Android API 23+ and pure JVM JUnit compatibility.
 */
public final class SecureVaultCrypto {
    public static final String TRANSFORMATION = "AES/GCM/NoPadding";
    public static final int KEY_SIZE_BITS = 256;
    public static final int GCM_IV_LENGTH = 12;
    public static final int GCM_TAG_LENGTH_BITS = 128;
    public static final int GCM_TAG_LENGTH_BYTES = GCM_TAG_LENGTH_BITS / 8;

    private static final char[] B64_ALPHABET =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();

    private SecureVaultCrypto() {
    }

    static String encodeBase64(byte[] data) {
        StringBuilder sb = new StringBuilder(((data.length + 2) / 3) * 4);
        int i = 0;
        while (i < data.length) {
            int b0 = data[i++] & 0xFF;
            int hasB1 = i < data.length ? 1 : 0;
            int b1 = hasB1 == 1 ? (data[i++] & 0xFF) : 0;
            int hasB2 = i < data.length ? 1 : 0;
            int b2 = hasB2 == 1 ? (data[i++] & 0xFF) : 0;

            int triple = (b0 << 16) | (b1 << 8) | b2;
            sb.append(B64_ALPHABET[(triple >> 18) & 0x3F]);
            sb.append(B64_ALPHABET[(triple >> 12) & 0x3F]);
            sb.append(hasB1 == 1 ? B64_ALPHABET[(triple >> 6) & 0x3F] : '=');
            sb.append(hasB2 == 1 ? B64_ALPHABET[triple & 0x3F] : '=');
        }
        return sb.toString();
    }

    static byte[] decodeBase64(String encoded) {
        String clean = encoded.replaceAll("\\s+", "");
        if (clean.length() % 4 != 0) {
            throw new IllegalArgumentException("Invalid Base64 length");
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream((clean.length() * 3) / 4);
        for (int i = 0; i < clean.length(); i += 4) {
            int c0 = decodeChar(clean.charAt(i));
            int c1 = decodeChar(clean.charAt(i + 1));
            char ch2 = clean.charAt(i + 2);
            char ch3 = clean.charAt(i + 3);
            int c2 = ch2 == '=' ? -1 : decodeChar(ch2);
            int c3 = ch3 == '=' ? -1 : decodeChar(ch3);

            out.write((c0 << 2) | (c1 >> 4));
            if (c2 >= 0) {
                out.write(((c1 & 0x0F) << 4) | (c2 >> 2));
            }
            if (c3 >= 0) {
                out.write(((c2 & 0x03) << 6) | c3);
            }
        }
        return out.toByteArray();
    }

    private static int decodeChar(char ch) {
        if (ch >= 'A' && ch <= 'Z') return ch - 'A';
        if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
        if (ch >= '0' && ch <= '9') return ch - '0' + 52;
        if (ch == '+') return 62;
        if (ch == '/') return 63;
        throw new IllegalArgumentException("Invalid Base64 character");
    }

    public static String encryptWithKey(String plaintext, Key key) throws Exception {
        if (plaintext == null) {
            throw new IllegalArgumentException("Plaintext cannot be null");
        }
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != GCM_IV_LENGTH) {
            throw new IllegalStateException("Unexpected GCM IV length");
        }
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        ByteBuffer buffer = ByteBuffer.allocate(iv.length + ciphertext.length);
        buffer.put(iv);
        buffer.put(ciphertext);
        return encodeBase64(buffer.array());
    }

    public static String decryptWithKey(String encoded, Key key) throws Exception {
        if (encoded == null || encoded.isEmpty()) {
            throw new IllegalArgumentException("Ciphertext payload is empty");
        }
        byte[] raw = decodeBase64(encoded);
        if (raw.length <= GCM_IV_LENGTH + GCM_TAG_LENGTH_BYTES) {
            throw new IllegalArgumentException("Corrupted or truncated encrypted vault entry");
        }
        ByteBuffer buffer = ByteBuffer.wrap(raw);
        byte[] iv = new byte[GCM_IV_LENGTH];
        buffer.get(iv);
        byte[] ciphertext = new byte[buffer.remaining()];
        buffer.get(ciphertext);

        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv);
        cipher.init(Cipher.DECRYPT_MODE, key, spec);
        byte[] plaintext = cipher.doFinal(ciphertext);
        return new String(plaintext, StandardCharsets.UTF_8);
    }
}
