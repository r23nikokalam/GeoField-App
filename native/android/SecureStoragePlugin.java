package com.geofield.fieldnotebook;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH_BITS = 128;

    private SecretKey getOrCreateKey() throws GeneralSecurityException {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        try {
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
        } catch (java.io.IOException error) {
            throw new GeneralSecurityException("Unable to access Android Keystore.", error);
        }
    }

    @PluginMethod
    public void encrypt(PluginCall call) {
        String plaintext = call.getString("plaintext");
        if (plaintext == null) {
            call.reject("Plaintext is required.");
            return;
        }

        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] iv = cipher.getIV();
            if (iv == null || iv.length != GCM_IV_LENGTH) {
                call.reject("The encryption provider returned an invalid IV.");
                return;
            }

            ByteBuffer payload = ByteBuffer.allocate(iv.length + encrypted.length);
            payload.put(iv);
            payload.put(encrypted);

            JSObject result = new JSObject();
            result.put("ciphertext", Base64.encodeToString(payload.array(), Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Encryption failed. Existing data was not changed.", error);
        }
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        String encoded = call.getString("ciphertext");
        if (encoded == null || encoded.isEmpty()) {
            call.reject("Ciphertext is required.");
            return;
        }

        try {
            byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
            if (payload.length <= GCM_IV_LENGTH + 16) {
                call.reject("Encrypted data is incomplete.");
                return;
            }

            ByteBuffer buffer = ByteBuffer.wrap(payload);
            byte[] iv = new byte[GCM_IV_LENGTH];
            buffer.get(iv);
            byte[] encrypted = new byte[buffer.remaining()];
            buffer.get(encrypted);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)
            );
            byte[] plaintext = cipher.doFinal(encrypted);

            JSObject result = new JSObject();
            result.put("plaintext", new String(plaintext, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Decryption failed. Stored data was left untouched.", error);
        }
    }
}
