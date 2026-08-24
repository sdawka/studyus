/**
 * Converts this application's legacy Web Crypto PBKDF2 storage format to the
 * digest shape Clerk expects for `password_hasher: 'pbkdf2_sha256'`.
 *
 * This is deliberately pure: the production migration operator owns the
 * export and Clerk API call, while the application never handles a plaintext
 * password during the cutover.
 */
export function toClerkPbkdf2Sha256Digest(legacyHash: string): string {
  const [algorithm, iterations, saltHex, hashHex] = legacyHash.split('$');
  if (
    algorithm !== 'pbkdf2' ||
    !/^\d+$/.test(iterations ?? '') ||
    !isEvenHex(saltHex) ||
    !isEvenHex(hashHex)
  ) {
    throw new Error('Expected legacy password hash format pbkdf2$<iterations>$<salt-hex>$<hash-hex>.');
  }

  return `pbkdf2_sha256$${iterations}$${hexToBase64(saltHex)}$${hexToBase64(hashHex)}`;
}

function isEvenHex(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

function hexToBase64(hex: string): string {
  let binary = '';
  for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary);
}
