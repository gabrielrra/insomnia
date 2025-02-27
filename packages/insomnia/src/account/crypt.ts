import HKDF from 'hkdf';
import forge from 'node-forge';
import srp from 'srp-js';

const DEFAULT_BYTE_LENGTH = 32;
const DEFAULT_PBKDF2_ITERATIONS = 1e5; // 100,000

/**
 * Generate hex signing key used for AES encryption
 *
 * @param pass
 * @param email
 * @param salt
 */
export async function deriveKey(pass, email, salt) {
  const combinedSalt = await _hkdfSalt(salt, email);
  return _pbkdf2Passphrase(pass, combinedSalt);
}

/**
 * Encrypt with RSA256 public key
 *
 * @param publicKeyJWK
 * @param plaintext
 * @return String
 */
export function encryptRSAWithJWK(publicKeyJWK, plaintext) {
  if (publicKeyJWK.alg !== 'RSA-OAEP-256') {
    throw new Error('Public key algorithm was not RSA-OAEP-256');
  } else if (publicKeyJWK.kty !== 'RSA') {
    throw new Error('Public key type was not RSA');
  } else if (!publicKeyJWK.key_ops.find(o => o === 'encrypt')) {
    throw new Error('Public key does not have "encrypt" op');
  }

  const encodedPlaintext = encodeURIComponent(plaintext);

  const n = _b64UrlToBigInt(publicKeyJWK.n);

  const e = _b64UrlToBigInt(publicKeyJWK.e);

  // @ts-expect-error -- TSCONVERSION appears not to be exported for some reason
  const publicKey = forge.rsa.setPublicKey(n, e);
  const encrypted = publicKey.encrypt(encodedPlaintext, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
  });
  return forge.util.bytesToHex(encrypted);
}

export function decryptRSAWithJWK(privateJWK, encryptedBlob) {
  const n = _b64UrlToBigInt(privateJWK.n);

  const e = _b64UrlToBigInt(privateJWK.e);

  const d = _b64UrlToBigInt(privateJWK.d);

  const p = _b64UrlToBigInt(privateJWK.p);

  const q = _b64UrlToBigInt(privateJWK.q);

  const dP = _b64UrlToBigInt(privateJWK.dp);

  const dQ = _b64UrlToBigInt(privateJWK.dq);

  const qInv = _b64UrlToBigInt(privateJWK.qi);

  // @ts-expect-error -- TSCONVERSION appears not to be exported for some reason
  const privateKey = forge.rsa.setPrivateKey(n, e, d, p, q, dP, dQ, qInv);
  const bytes = forge.util.hexToBytes(encryptedBlob);
  const decrypted = privateKey.decrypt(bytes, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
  });
  return decodeURIComponent(decrypted);
}

/**
 * Encrypt data using symmetric key
 *
 * @param jwkOrKey JWK or string representing symmetric key
 * @param buff data to encrypt
 * @param additionalData any additional public data to attach
 * @returns {{iv, t, d, ad}}
 */
export function encryptAESBuffer(jwkOrKey, buff, additionalData = '') {
  // TODO: Add assertion checks for JWK
  const rawKey = typeof jwkOrKey === 'string' ? jwkOrKey : _b64UrlToHex(jwkOrKey.k);
  const key = forge.util.hexToBytes(rawKey);
  const iv = forge.random.getBytesSync(12);
  const cipher = forge.cipher.createCipher('AES-GCM', key);
  cipher.start({
    additionalData,
    iv,
    tagLength: 128,
  });
  cipher.update(forge.util.createBuffer(buff));
  cipher.finish();
  return {
    iv: forge.util.bytesToHex(iv),
    // @ts-expect-error -- TSCONVERSION needs to be converted to string
    t: forge.util.bytesToHex(cipher.mode.tag),
    ad: forge.util.bytesToHex(additionalData),
    // @ts-expect-error -- TSCONVERSION needs to be converted to string
    d: forge.util.bytesToHex(cipher.output),
  };
}

/**
 * Encrypt data using symmetric key
 *
 * @param jwkOrKey JWK or string representing symmetric key
 * @param plaintext string of data to encrypt
 * @param additionalData any additional public data to attach
 * @returns {{iv, t, d, ad}}
 */
export function encryptAES(jwkOrKey, plaintext, additionalData = '') {
  // TODO: Add assertion checks for JWK
  const rawKey = typeof jwkOrKey === 'string' ? jwkOrKey : _b64UrlToHex(jwkOrKey.k);
  const key = forge.util.hexToBytes(rawKey);
  const iv = forge.random.getBytesSync(12);
  const cipher = forge.cipher.createCipher('AES-GCM', key);
  // Plaintext could contain weird unicode, so we have to encode that
  const encodedPlaintext = encodeURIComponent(plaintext);
  cipher.start({
    additionalData,
    iv,
    tagLength: 128,
  });
  cipher.update(forge.util.createBuffer(encodedPlaintext));
  cipher.finish();
  return {
    iv: forge.util.bytesToHex(iv),
    // @ts-expect-error -- TSCONVERSION needs to be converted to string
    t: forge.util.bytesToHex(cipher.mode.tag),
    ad: forge.util.bytesToHex(additionalData),
    // @ts-expect-error -- TSCONVERSION needs to be converted to string
    d: forge.util.bytesToHex(cipher.output),
  };
}

/**
 * Decrypt AES using a key
 *
 * @param jwkOrKey JWK or string representing symmetric key
 * @param encryptedResult encryption data
 * @returns String
 */
export function decryptAES(jwkOrKey, encryptedResult) {
  // TODO: Add assertion checks for JWK
  const rawKey = typeof jwkOrKey === 'string' ? jwkOrKey : _b64UrlToHex(jwkOrKey.k);
  const key = forge.util.hexToBytes(rawKey);
  // ~~~~~~~~~~~~~~~~~~~~ //
  // Decrypt with AES-GCM //
  // ~~~~~~~~~~~~~~~~~~~~ //
  const decipher = forge.cipher.createDecipher('AES-GCM', key);
  decipher.start({
    iv: forge.util.hexToBytes(encryptedResult.iv),
    tagLength: encryptedResult.t.length * 4,
    // @ts-expect-error -- TSCONVERSION needs to be converted to string
    tag: forge.util.hexToBytes(encryptedResult.t),
    additionalData: forge.util.hexToBytes(encryptedResult.ad),
  });
  decipher.update(forge.util.createBuffer(forge.util.hexToBytes(encryptedResult.d)));

  if (decipher.finish()) {
    return decodeURIComponent(decipher.output.toString());
  } else {
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Decrypts AES using a key to buffer
 * @param jwkOrKey
 * @param encryptedResult
 * @returns {string}
 */
export function decryptAESToBuffer(jwkOrKey, encryptedResult) {
  // TODO: Add assertion checks for JWK
  const rawKey = typeof jwkOrKey === 'string' ? jwkOrKey : _b64UrlToHex(jwkOrKey.k);
  const key = forge.util.hexToBytes(rawKey);
  // ~~~~~~~~~~~~~~~~~~~~ //
  // Decrypt with AES-GCM //
  // ~~~~~~~~~~~~~~~~~~~~ //
  const decipher = forge.cipher.createDecipher('AES-GCM', key);
  decipher.start({
    iv: forge.util.hexToBytes(encryptedResult.iv),
    tagLength: encryptedResult.t.length * 4,
    // @ts-expect-error -- TSCONVERSION needs to be converted to string
    tag: forge.util.hexToBytes(encryptedResult.t),
    additionalData: forge.util.hexToBytes(encryptedResult.ad),
  });
  decipher.update(forge.util.createBuffer(forge.util.hexToBytes(encryptedResult.d)));

  if (decipher.finish()) {
    // @ts-expect-error -- TSCONVERSION needs to be converted to string
    return Buffer.from(forge.util.bytesToHex(decipher.output), 'hex');
  } else {
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Generate a random key
 *
 * @returns {Promise}
 */
export function srpGenKey() {
  return new Promise((resolve, reject) => {
    srp.genKey((err, secret1Buffer) => {
      if (err) {
        reject(err);
      } else {
        resolve(secret1Buffer.toString('hex'));
      }
    });
  });
}

/**
 * Generate a random AES256 key for use with symmetric encryption
 */
export async function generateAES256Key() {
  const c = window.crypto;
  // @ts-expect-error -- TSCONVERSION: likely needs a module augmentation for webkit
  const subtle = c ? c.subtle || c.webkitSubtle : null;

  if (subtle) {
    console.log('[crypt] Using Native AES Key Generation');
    const key = await subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt'],
    );
    return subtle.exportKey('jwk', key);
  } else {
    console.log('[crypt] Using Fallback Forge AES Key Generation');
    const key = forge.util.bytesToHex(forge.random.getBytesSync(32));
    return {
      kty: 'oct',
      alg: 'A256GCM',
      ext: true,
      key_ops: ['encrypt', 'decrypt'],
      k: _hexToB64Url(key),
    };
  }
}

/**
 * Generate RSA keypair JWK with 2048 bits and exponent 0x10001
 *
 * @returns Object
 */
export async function generateKeyPairJWK() {
  // NOTE: Safari has crypto.webkitSubtle, but it does not support RSA-OAEP-SHA256
  const subtle = window.crypto && window.crypto.subtle;

  if (subtle) {
    console.log('[crypt] Using Native RSA Generation');
    const pair = await subtle.generateKey(
      {
        name: 'RSA-OAEP',
        publicExponent: new Uint8Array([1, 0, 1]),
        modulusLength: 2048,
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    );
    if (!pair.publicKey || !pair.privateKey) {
      throw new Error('Unexpected error generating a keypair.');
    }
    return {
      publicKey: await subtle.exportKey('jwk', pair.publicKey),
      privateKey: await subtle.exportKey('jwk', pair.privateKey),
    };
  } else {
    console.log('[crypt] Using Forge RSA Generation');
    const pair = forge.pki.rsa.generateKeyPair({
      bits: 2048,
      e: 0x10001,
    });
    const privateKey = {
      alg: 'RSA-OAEP-256',
      kty: 'RSA',
      key_ops: ['decrypt'],
      ext: true,
      d: _bigIntToB64Url(pair.privateKey.d),
      dp: _bigIntToB64Url(pair.privateKey.dP),
      dq: _bigIntToB64Url(pair.privateKey.dQ),
      e: _bigIntToB64Url(pair.privateKey.e),
      n: _bigIntToB64Url(pair.privateKey.n),
      p: _bigIntToB64Url(pair.privateKey.p),
      q: _bigIntToB64Url(pair.privateKey.q),
      qi: _bigIntToB64Url(pair.privateKey.qInv),
    };
    const publicKey = {
      alg: 'RSA-OAEP-256',
      kty: 'RSA',
      key_ops: ['encrypt'],
      e: _bigIntToB64Url(pair.publicKey.e),
      n: _bigIntToB64Url(pair.publicKey.n),
    };
    return {
      privateKey,
      publicKey,
    };
  }
}

// ~~~~~~~~~~~~~~~~ //
// Helper Functions //
// ~~~~~~~~~~~~~~~~ //

/**
 * Combine email and raw salt into usable salt
 *
 * @param rawSalt
 * @param rawEmail
 * @returns {Promise}
 */
async function _hkdfSalt(rawSalt, rawEmail) {
  return new Promise<string>(resolve => {
    const hkdf = new HKDF('sha256', rawSalt, rawEmail);
    hkdf.derive('', DEFAULT_BYTE_LENGTH, buffer => resolve(buffer.toString('hex')));
  });
}

/**
 * Convert a JSBN BigInteger to a URL-safe version of base64 encoding. This
 * should only be used for encoding JWKs
 *
 * @param n BigInteger
 * @returns {string}
 */
function _bigIntToB64Url(n) {
  return _hexToB64Url(n.toString(16));
}

function _hexToB64Url(h) {
  const bytes = forge.util.hexToBytes(h);
  return window.btoa(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function _b64UrlToBigInt(s: string) {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- see below
  // @ts-ignore -- unfortunately, we must ignore here instead of the usual expect-error because this mondule is being used by two different builds (`insomnia` and `insomnia-send-request`) and in one of them this line is an error (`insomnia-send-request`) and the other it is not ()`insomnia`).
  return new forge.jsbn.BigInteger(_b64UrlToHex(s), 16);
}

function _b64UrlToHex(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return forge.util.bytesToHex(window.atob(b64));
}

/**
 * Derive key from password
 *
 * @param passphrase
 * @param salt hex representation of salt
 */
async function _pbkdf2Passphrase(passphrase, salt) {
  if (window.crypto && window.crypto.subtle) {
    console.log('[crypt] Using native PBKDF2');
    const k = await window.crypto.subtle.importKey(
      'raw',
      Buffer.from(passphrase, 'utf8'),
      {
        name: 'PBKDF2',
      },
      false,
      ['deriveBits'],
    );
    const algo = {
      name: 'PBKDF2',
      salt: Buffer.from(salt, 'hex'),
      iterations: DEFAULT_PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    };
    const derivedKeyRaw = await window.crypto.subtle.deriveBits(algo, k, DEFAULT_BYTE_LENGTH * 8);
    return Buffer.from(derivedKeyRaw).toString('hex');
  } else {
    console.log('[crypt] Using Forge PBKDF2');
    const derivedKeyRaw = forge.pkcs5.pbkdf2(
      passphrase,
      forge.util.hexToBytes(salt),
      DEFAULT_PBKDF2_ITERATIONS,
      DEFAULT_BYTE_LENGTH,
      forge.md.sha256.create(),
    );
    return forge.util.bytesToHex(derivedKeyRaw);
  }
}
