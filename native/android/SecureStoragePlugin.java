package com.geofield.fieldnotebook;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureStorage")
public class SecureStoragePlugin extends Plugin {
    private static final String KEY_ALIAS = "GeoField.RecordEncryption.v1";
    private static final String DATA_FILE = "geofield_records.enc";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH_BITS = 128;

    private AtomicFile getDataFile() {
        return new AtomicFile(new File(getContext().getFilesDir(), DATA_FILE));
    }

    private SecretKey getOrCreateEncryptionKey() throws GeneralSecurityException, IOException {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }

        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"
        );
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build();
        generator.init(spec);
        return generator.generateKey();
    }

    private SecretKey getExistingDecryptionKey() throws GeneralSecurityException, IOException {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            throw new GeneralSecurityException("The GeoField encryption key is missing. Stored data was not modified.");
        }
        return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
    }

    private byte[] encrypt(String plaintext) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateEncryptionKey());
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != GCM_IV_LENGTH) {
            throw new GeneralSecurityException("The encryption provider returned an invalid IV.");
        }
        ByteBuffer payload = ByteBuffer.allocate(iv.length + encrypted.length);
        payload.put(iv);
        payload.put(encrypted);
        return payload.array();
    }

    private String decrypt(byte[] payload) throws GeneralSecurityException, IOException {
        if (payload == null || payload.length <= GCM_IV_LENGTH + 16) {
            throw new GeneralSecurityException("Encrypted data is incomplete.");
        }
        ByteBuffer buffer = ByteBuffer.wrap(payload);
        byte[] iv = new byte[GCM_IV_LENGTH];
        buffer.get(iv);
        byte[] encrypted = new byte[buffer.remaining()];
        buffer.get(encrypted);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(
            Cipher.DECRYPT_MODE,
            getExistingDecryptionKey(),
            new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
        );
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    @PluginMethod
    public void load(PluginCall call) {
        AtomicFile file = getDataFile();
        if (!file.getBaseFile().exists()) {
            JSObject result = new JSObject();
            result.put("found", false);
            result.put("plaintext", "");
            call.resolve(result);
            return;
        }

        try (FileInputStream input = file.openRead();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);

            JSObject result = new JSObject();
            result.put("found", true);
            result.put("plaintext", decrypt(output.toByteArray()));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Secure data could not be decrypted. The encrypted file was left untouched.", error);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        String plaintext = call.getString("plaintext");
        if (plaintext == null) {
            call.reject("Plaintext is required.");
            return;
        }

        AtomicFile file = getDataFile();
        FileOutputStream output = null;
        try {
            // Refuse to replace an existing encrypted file unless its current
            // authentication tag can be verified with the existing Keystore key.
            File baseFile = file.getBaseFile();
            File backupFile = new File(baseFile.getPath() + ".bak");
            if (baseFile.exists() || backupFile.exists()) {
                try (FileInputStream previousInput = file.openRead();
                     ByteArrayOutputStream previousBytes = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = previousInput.read(buffer)) != -1) {
                        previousBytes.write(buffer, 0, count);
                    }
                    decrypt(previousBytes.toByteArray());
                }
            }

            byte[] encrypted = encrypt(plaintext);
            output = file.startWrite();
            output.write(encrypted);
            file.finishWrite(output);
            output = null;

            JSObject result = new JSObject();
            result.put("saved", true);
            call.resolve(result);
        } catch (Exception error) {
            if (output != null) file.failWrite(output);
            call.reject("Secure save failed. The previous encrypted data was preserved.", error);
        }
    }
}
