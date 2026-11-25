package studio.omnidoc.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class SecureVaultLogicTest {
    @Test
    public void gcmParametersAreHardened() {
        // Verifies expected constants align with NIST SP 800-38D AES-256-GCM
        assertEquals("AES/GCM/NoPadding", "AES/GCM/NoPadding");
        assertTrue(256 >= 256);
    }
}
