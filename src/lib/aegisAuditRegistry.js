import nacl from 'tweetnacl';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { AEGIS_AUDIT_REGISTRY_PROGRAM_ID } from '../config.js';

const PROGRAM_ID = new PublicKey(AEGIS_AUDIT_REGISTRY_PROGRAM_ID);

const CONFIG_SEED = Buffer.from('config');
const AUDITOR_PROFILE_SEED = Buffer.from('auditor_profile');
const AUDITOR_VAULT_SEED = Buffer.from('auditor_vault');
const VIEWING_GRANT_SEED = Buffer.from('viewing_grant');

const AUDITOR_STATUS = ['pending', 'approved', 'suspended', 'slashed'];
const GRANT_SCOPE = ['daily', 'transaction', 'custom'];

function asPublicKey(value) {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function readPubkey(data, offset) {
  return {
    value: new PublicKey(data.subarray(offset, offset + 32)),
    offset: offset + 32,
  };
}

function readFixedBytes(data, offset, length) {
  return {
    value: Uint8Array.from(data.subarray(offset, offset + length)),
    offset: offset + length,
  };
}

function readU64(data, offset) {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return {
    value: view.getBigUint64(0, true),
    offset: offset + 8,
  };
}

function readI64(data, offset) {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return {
    value: view.getBigInt64(0, true),
    offset: offset + 8,
  };
}

function readOptionI64(data, offset) {
  const tag = data[offset];
  if (tag === 0) {
    return { value: null, offset: offset + 1 };
  }

  const parsed = readI64(data, offset + 1);
  return { value: parsed.value, offset: parsed.offset };
}

function readEnum(data, offset, variants) {
  const index = data[offset];
  return {
    value: variants[index] ?? 'unknown',
    offset: offset + 1,
  };
}

function bigIntToNumber(value) {
  return Number(value);
}

function toHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex) {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return bytes;
}

function encodeI64(value) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigInt64(0, BigInt(value), true);
  return bytes;
}

function encodeU64(value) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(value), true);
  return bytes;
}

async function getInstructionDiscriminator(name) {
  const payload = new TextEncoder().encode(`global:${name}`);
  const hash = await crypto.subtle.digest('SHA-256', payload);
  return Uint8Array.from(new Uint8Array(hash).slice(0, 8));
}

async function hashUtf8(value) {
  const payload = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', payload);
  return Uint8Array.from(new Uint8Array(hash));
}

function normalizeDate(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function normalizeIsoDateTime(value) {
  return new Date(value).toISOString();
}

function toBase64Url(text) {
  return btoa(text)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding);
  return atob(padded);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return toBase64Url(binary);
}

function base64UrlToBytes(value) {
  return Uint8Array.from(fromBase64Url(value), (char) => char.charCodeAt(0));
}

async function deriveDeliveryKey(passphrase, saltBytes) {
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 150_000,
      hash: 'SHA-256',
    },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function decodeProtocolConfig(data) {
  let offset = 8;
  const admin = readPubkey(data, offset);
  offset = admin.offset;
  const slashDestination = readPubkey(data, offset);
  offset = slashDestination.offset;
  const minStake = readU64(data, offset);
  offset = minStake.offset;

  return {
    admin: admin.value,
    slashDestination: slashDestination.value,
    minAuditorStakeLamports: bigIntToNumber(minStake.value),
    bump: data[offset],
  };
}

function decodeAuditorProfile(data) {
  let offset = 8;
  const authority = readPubkey(data, offset);
  offset = authority.offset;
  const metadataHash = readFixedBytes(data, offset, 32);
  offset = metadataHash.offset;
  const stake = readU64(data, offset);
  offset = stake.offset;
  const status = readEnum(data, offset, AUDITOR_STATUS);
  offset = status.offset;
  const registeredAt = readI64(data, offset);
  offset = registeredAt.offset;
  const approvedAt = readOptionI64(data, offset);
  offset = approvedAt.offset;

  return {
    authority: authority.value,
    metadataHash: toHex(metadataHash.value),
    stakeLockedLamports: bigIntToNumber(stake.value),
    status: status.value,
    registeredAt: bigIntToNumber(registeredAt.value),
    approvedAt: approvedAt.value === null ? null : bigIntToNumber(approvedAt.value),
    bump: data[offset],
    vaultBump: data[offset + 1],
  };
}

function decodeViewingGrant(data) {
  let offset = 8;
  const grantor = readPubkey(data, offset);
  offset = grantor.offset;
  const auditor = readPubkey(data, offset);
  offset = auditor.offset;
  const scope = readEnum(data, offset, GRANT_SCOPE);
  offset = scope.offset;
  const scopeRef = readFixedBytes(data, offset, 32);
  offset = scopeRef.offset;
  const encryptedTvkRef = readFixedBytes(data, offset, 32);
  offset = encryptedTvkRef.offset;
  const createdAt = readI64(data, offset);
  offset = createdAt.offset;
  const expiresAt = readI64(data, offset);
  offset = expiresAt.offset;
  const revokedAt = readOptionI64(data, offset);
  offset = revokedAt.offset;

  return {
    grantor: grantor.value,
    auditor: auditor.value,
    scope: scope.value,
    scopeRef: toHex(scopeRef.value),
    encryptedTvkRef: toHex(encryptedTvkRef.value),
    createdAt: bigIntToNumber(createdAt.value),
    expiresAt: bigIntToNumber(expiresAt.value),
    revokedAt: revokedAt.value === null ? null : bigIntToNumber(revokedAt.value),
    bump: data[offset],
  };
}

async function fetchDecodedAccount(connection, address, decoder) {
  const accountInfo = await connection.getAccountInfo(address);
  if (!accountInfo?.data) {
    return null;
  }

  return decoder(accountInfo.data);
}

export function getRegistryProgramId() {
  return PROGRAM_ID;
}

export function getConfigPda() {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)[0];
}

export function getAuditorProfilePda(auditorAuthority) {
  const authority = asPublicKey(auditorAuthority);
  return PublicKey.findProgramAddressSync(
    [AUDITOR_PROFILE_SEED, authority.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function getAuditorVaultPda(auditorAuthority) {
  const authority = asPublicKey(auditorAuthority);
  return PublicKey.findProgramAddressSync(
    [AUDITOR_VAULT_SEED, authority.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function getViewingGrantPda(grantorAuthority, auditorAuthority, scopeRefBytes) {
  const grantor = asPublicKey(grantorAuthority);
  const auditor = asPublicKey(auditorAuthority);

  return PublicKey.findProgramAddressSync(
    [VIEWING_GRANT_SEED, grantor.toBuffer(), auditor.toBuffer(), Buffer.from(scopeRefBytes)],
    PROGRAM_ID,
  )[0];
}

export async function deriveDailyScopeRef(date) {
  const normalizedDate = normalizeDate(date);
  const payload = new TextEncoder().encode(`daily:${normalizedDate}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', payload);
  return Uint8Array.from(new Uint8Array(hashBuffer));
}

export async function deriveEncryptedReferenceHash(reference) {
  return hashUtf8(String(reference));
}

export function buildViewingCredentialEnvelope({
  contentType = 'application/octet-stream',
  deliveryMethod = 'secure-copy',
  recipientPublicKey,
  senderPublicKey,
  salt,
  nonce,
  ciphertext,
  note = '',
}) {
  return {
    version: 'aegis.delivery-envelope.v1',
    contentType: String(contentType),
    deliveryMethod: String(deliveryMethod),
    encoding: 'base64url',
    recipientPublicKey: String(recipientPublicKey ?? ''),
    senderPublicKey: String(senderPublicKey ?? ''),
    salt: String(salt ?? ''),
    nonce: String(nonce ?? ''),
    ciphertext: String(ciphertext ?? ''),
    note: String(note ?? ''),
  };
}

export function validateViewingCredentialEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Viewing credential envelope is missing');
  }

  if (envelope.version !== 'aegis.delivery-envelope.v1') {
    throw new Error('Unsupported viewing credential envelope version');
  }

  if (!String(envelope.contentType || '').trim()) {
    throw new Error('Viewing credential envelope content type is required');
  }

  if (!String(envelope.deliveryMethod || '').trim()) {
    throw new Error('Viewing credential envelope delivery method is required');
  }

  if (envelope.encoding !== 'base64url') {
    throw new Error('Viewing credential envelope encoding must be base64url');
  }

  if (envelope.deliveryMethod === 'recipient-box') {
    if (!String(envelope.recipientPublicKey || '').trim()) {
      throw new Error('Recipient-bound envelope recipient public key is required');
    }

    if (!String(envelope.senderPublicKey || '').trim()) {
      throw new Error('Recipient-bound envelope sender public key is required');
    }
  } else {
    if (!String(envelope.salt || '').trim()) {
      throw new Error('Viewing credential envelope salt is required');
    }
  }

  if (!String(envelope.nonce || '').trim()) {
    throw new Error('Viewing credential envelope nonce is required');
  }

  if (!String(envelope.ciphertext || '').trim()) {
    throw new Error('Viewing credential envelope ciphertext is required');
  }

  return envelope;
}

export function generateDeliveryKeypair() {
  const keypair = nacl.box.keyPair();

  return {
    publicKey: bytesToBase64Url(keypair.publicKey),
    secretKey: bytesToBase64Url(keypair.secretKey),
  };
}

export async function encryptViewingCredentialEnvelope({
  plaintext,
  passphrase,
  contentType = 'application/octet-stream',
  deliveryMethod = 'shared-secret-aes-gcm',
  note = '',
}) {
  if (!String(plaintext || '').trim()) {
    throw new Error('Envelope plaintext is required');
  }

  if (!String(passphrase || '').trim()) {
    throw new Error('Envelope passphrase is required');
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveDeliveryKey(String(passphrase), saltBytes);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    new TextEncoder().encode(String(plaintext)),
  );

  return buildViewingCredentialEnvelope({
    contentType,
    deliveryMethod,
    salt: bytesToBase64Url(saltBytes),
    nonce: bytesToBase64Url(ivBytes),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertextBuffer)),
    note,
  });
}

export function encryptViewingCredentialEnvelopeForRecipient({
  plaintext,
  recipientPublicKey,
  contentType = 'application/octet-stream',
  note = '',
}) {
  if (!String(plaintext || '').trim()) {
    throw new Error('Envelope plaintext is required');
  }

  if (!String(recipientPublicKey || '').trim()) {
    throw new Error('Recipient delivery public key is required');
  }

  const recipientPublicKeyBytes = base64UrlToBytes(recipientPublicKey);
  if (recipientPublicKeyBytes.length !== nacl.box.publicKeyLength) {
    throw new Error('Recipient delivery public key must be a base64url-encoded NaCl box public key');
  }

  const senderKeypair = nacl.box.keyPair();
  const nonceBytes = nacl.randomBytes(nacl.box.nonceLength);
  const plaintextBytes = new TextEncoder().encode(String(plaintext));
  const ciphertextBytes = nacl.box(plaintextBytes, nonceBytes, recipientPublicKeyBytes, senderKeypair.secretKey);

  return buildViewingCredentialEnvelope({
    contentType,
    deliveryMethod: 'recipient-box',
    recipientPublicKey,
    senderPublicKey: bytesToBase64Url(senderKeypair.publicKey),
    nonce: bytesToBase64Url(nonceBytes),
    ciphertext: bytesToBase64Url(ciphertextBytes),
    note,
  });
}

export async function decryptViewingCredentialEnvelope(envelope, passphrase) {
  const validatedEnvelope = validateViewingCredentialEnvelope(envelope);

  if (validatedEnvelope.deliveryMethod === 'recipient-box') {
    const recipientSecretKeyBytes = base64UrlToBytes(String(passphrase || ''));
    if (recipientSecretKeyBytes.length !== nacl.box.secretKeyLength) {
      throw new Error('Recipient-bound envelope decryption requires the base64url delivery secret key');
    }

    const senderPublicKeyBytes = base64UrlToBytes(validatedEnvelope.senderPublicKey);
    const nonceBytes = base64UrlToBytes(validatedEnvelope.nonce);
    const ciphertextBytes = base64UrlToBytes(validatedEnvelope.ciphertext);
    const plaintextBytes = nacl.box.open(ciphertextBytes, nonceBytes, senderPublicKeyBytes, recipientSecretKeyBytes);

    if (!plaintextBytes) {
      throw new Error('Recipient-bound envelope decryption failed');
    }

    return new TextDecoder().decode(plaintextBytes);
  }

  if (!String(passphrase || '').trim()) {
    throw new Error('Envelope passphrase is required');
  }

  const saltBytes = base64UrlToBytes(validatedEnvelope.salt);
  const ivBytes = base64UrlToBytes(validatedEnvelope.nonce);
  const ciphertextBytes = base64UrlToBytes(validatedEnvelope.ciphertext);
  const key = await deriveDeliveryKey(String(passphrase), saltBytes);
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    ciphertextBytes,
  );

  return new TextDecoder().decode(plaintextBuffer);
}

export function buildViewingGrantPackage({
  grantorAuthority,
  auditorAuthority,
  scope = 'daily',
  scopeDate,
  expiresAt,
  scopeRefBytes,
  credentialEnvelope,
}) {
  const grantor = asPublicKey(grantorAuthority).toBase58();
  const auditor = asPublicKey(auditorAuthority).toBase58();
  const validatedEnvelope = validateViewingCredentialEnvelope(credentialEnvelope);

  return {
    version: 'aegis.viewing-grant.v1',
    scope: {
      type: scope,
      date: normalizeDate(scopeDate),
      scopeRef: toHex(scopeRefBytes),
    },
    parties: {
      grantor,
      auditor,
    },
    registry: {
      programId: PROGRAM_ID.toBase58(),
      viewingGrantPda: getViewingGrantPda(grantor, auditor, scopeRefBytes).toBase58(),
    },
    delivery: {
      kind: 'structured-envelope',
      envelope: validatedEnvelope,
    },
    timestamps: {
      createdAt: new Date().toISOString(),
      expiresAt: normalizeIsoDateTime(expiresAt),
    },
  };
}

export function buildAuditorDeliveryMetadata({
  auditorAuthority,
  deliveryPublicKey,
  note = '',
}) {
  return {
    version: 'aegis.auditor-delivery.v1',
    auditor: asPublicKey(auditorAuthority).toBase58(),
    delivery: {
      scheme: 'nacl-box',
      publicKey: String(deliveryPublicKey ?? ''),
    },
    note: String(note ?? ''),
  };
}

export function serializeAuditorDeliveryMetadata(metadata) {
  return JSON.stringify(metadata, null, 2);
}

export function encodeAuditorDeliveryMetadata(metadata) {
  return toBase64Url(serializeAuditorDeliveryMetadata(metadata));
}

export function parseAuditorDeliveryMetadata(serializedMetadata) {
  const parsed = JSON.parse(serializedMetadata);

  if (parsed?.version !== 'aegis.auditor-delivery.v1') {
    throw new Error('Unsupported auditor delivery metadata version');
  }

  if (!String(parsed?.auditor || '').trim()) {
    throw new Error('Auditor delivery metadata auditor is required');
  }

  if (parsed?.delivery?.scheme !== 'nacl-box') {
    throw new Error('Unsupported auditor delivery metadata scheme');
  }

  const publicKeyBytes = base64UrlToBytes(String(parsed?.delivery?.publicKey || ''));
  if (publicKeyBytes.length !== nacl.box.publicKeyLength) {
    throw new Error('Auditor delivery metadata public key must be a base64url-encoded NaCl box public key');
  }

  return parsed;
}

export function decodeAuditorDeliveryMetadata(encodedMetadata) {
  return parseAuditorDeliveryMetadata(fromBase64Url(encodedMetadata));
}

export async function deriveAuditorDeliveryMetadataHash(metadataOrSerialized) {
  const serialized = typeof metadataOrSerialized === 'string'
    ? metadataOrSerialized
    : serializeAuditorDeliveryMetadata(metadataOrSerialized);

  return toHex(await hashUtf8(serialized));
}

export async function verifyAuditorDeliveryMetadata({
  encodedMetadata,
  auditorAuthority,
  profile,
}) {
  const decodedMetadata = decodeAuditorDeliveryMetadata(encodedMetadata.trim());
  const serializedMetadata = serializeAuditorDeliveryMetadata(decodedMetadata);
  const metadataHash = await deriveAuditorDeliveryMetadataHash(serializedMetadata);
  const expectedAuditor = auditorAuthority ? asPublicKey(auditorAuthority).toBase58() : null;

  if (expectedAuditor && decodedMetadata.auditor !== expectedAuditor) {
    throw new Error('Auditor delivery metadata does not target the selected auditor');
  }

  if (profile) {
    if (decodedMetadata.auditor !== profile.authority?.toBase58?.()) {
      throw new Error('Auditor delivery metadata does not match the on-chain auditor profile');
    }

    if (metadataHash !== profile.metadataHash) {
      throw new Error('Auditor delivery metadata hash does not match the on-chain auditor profile');
    }
  }

  return {
    decodedMetadata,
    serializedMetadata,
    metadataHash,
  };
}

export function serializeViewingGrantPackage(viewingGrantPackage) {
  return JSON.stringify(viewingGrantPackage, null, 2);
}

export function encodeViewingGrantPackage(viewingGrantPackage) {
  return toBase64Url(serializeViewingGrantPackage(viewingGrantPackage));
}

export function parseViewingGrantPackage(serializedPackage) {
  const parsed = JSON.parse(serializedPackage);

  if (parsed?.version !== 'aegis.viewing-grant.v1') {
    throw new Error('Unsupported viewing grant package version');
  }

  if (parsed?.delivery?.kind !== 'structured-envelope') {
    throw new Error('Unsupported viewing grant package delivery kind');
  }

  validateViewingCredentialEnvelope(parsed.delivery.envelope);

  return parsed;
}

export function decodeViewingGrantPackage(encodedPackage) {
  return parseViewingGrantPackage(fromBase64Url(encodedPackage));
}

export async function deriveViewingGrantPackageHash(viewingGrantPackageOrSerialized) {
  const serialized = typeof viewingGrantPackageOrSerialized === 'string'
    ? viewingGrantPackageOrSerialized
    : serializeViewingGrantPackage(viewingGrantPackageOrSerialized);

  return toHex(await hashUtf8(serialized));
}

export async function verifyViewingGrantPackage({
  encodedPackage,
  connectedAuditor,
  registrySnapshot,
}) {
  const decodedPackage = decodeViewingGrantPackage(encodedPackage.trim());
  const serializedPackage = serializeViewingGrantPackage(decodedPackage);
  const packageHash = await deriveViewingGrantPackageHash(serializedPackage);
  const connectedAuditorBase58 = connectedAuditor ? asPublicKey(connectedAuditor).toBase58() : null;

  if (decodedPackage.registry.programId !== PROGRAM_ID.toBase58()) {
    throw new Error('Grant package targets a different registry program');
  }

  if (connectedAuditorBase58 && decodedPackage.parties.auditor !== connectedAuditorBase58) {
    throw new Error('Connected wallet does not match the auditor encoded in the grant package');
  }

  if (registrySnapshot) {
    if (decodedPackage.parties.grantor !== registrySnapshot.grant?.grantor?.toBase58?.()) {
      throw new Error('Grant package grantor does not match the on-chain viewing grant');
    }

    if (decodedPackage.parties.auditor !== registrySnapshot.grant?.auditor?.toBase58?.()) {
      throw new Error('Grant package auditor does not match the on-chain viewing grant');
    }

    if (decodedPackage.scope.date !== registrySnapshot.scopeDate) {
      throw new Error('Grant package date does not match the selected on-chain scope');
    }

    if (decodedPackage.scope.scopeRef !== registrySnapshot.scopeRef) {
      throw new Error('Grant package scope reference does not match the on-chain scope');
    }

    if (decodedPackage.registry.viewingGrantPda !== getViewingGrantPda(
      registrySnapshot.grant.grantor,
      registrySnapshot.grant.auditor,
      hexToBytes(registrySnapshot.scopeRef),
    ).toBase58()) {
      throw new Error('Grant package PDA does not match the on-chain viewing grant PDA');
    }

    if (packageHash !== registrySnapshot.grant?.encryptedTvkRef) {
      throw new Error('Grant package hash does not match the on-chain viewing grant reference');
    }
  }

  return {
    decodedPackage,
    serializedPackage,
    packageHash,
  };
}

export async function fetchProtocolConfig(connection) {
  return fetchDecodedAccount(connection, getConfigPda(), decodeProtocolConfig);
}

export async function fetchAuditorProfile(connection, auditorAuthority) {
  return fetchDecodedAccount(
    connection,
    getAuditorProfilePda(auditorAuthority),
    decodeAuditorProfile,
  );
}

export async function fetchViewingGrant(connection, grantorAuthority, auditorAuthority, scopeRefBytes) {
  return fetchDecodedAccount(
    connection,
    getViewingGrantPda(grantorAuthority, auditorAuthority, scopeRefBytes),
    decodeViewingGrant,
  );
}

export function isViewingGrantActive(grant, now = Math.floor(Date.now() / 1000)) {
  if (!grant) {
    return false;
  }

  return grant.revokedAt === null && grant.expiresAt > now;
}

export async function getAuditorGrantSnapshot(connection, { auditorAuthority, grantorAuthority, date }) {
  const [config, profile, scopeRefBytes] = await Promise.all([
    fetchProtocolConfig(connection),
    fetchAuditorProfile(connection, auditorAuthority),
    deriveDailyScopeRef(date),
  ]);

  const grant = grantorAuthority
    ? await fetchViewingGrant(connection, grantorAuthority, auditorAuthority, scopeRefBytes)
    : null;

  const minStakeLamports = config?.minAuditorStakeLamports ?? 0;
  const scopeRef = toHex(scopeRefBytes);
  const isApprovedAuditor =
    profile?.status === 'approved' && profile.stakeLockedLamports >= minStakeLamports;

  return {
    config,
    profile,
    grant,
    scopeRef,
    scopeDate: normalizeDate(date),
    isApprovedAuditor,
    hasActiveGrant: isViewingGrantActive(grant),
  };
}

export async function createViewingGrantTransaction({
  grantorAuthority,
  auditorAuthority,
  scope = 'daily',
  scopeRefBytes,
  encryptedReferenceHash,
  expiresAt,
}) {
  const grantor = asPublicKey(grantorAuthority);
  const auditor = asPublicKey(auditorAuthority);
  const configPda = getConfigPda();
  const auditorProfilePda = getAuditorProfilePda(auditor);
  const viewingGrantPda = getViewingGrantPda(grantor, auditor, scopeRefBytes);
  const discriminator = await getInstructionDiscriminator('create_viewing_grant');
  const scopeIndex = GRANT_SCOPE.indexOf(scope);

  if (scopeIndex === -1) {
    throw new Error(`Unsupported grant scope: ${scope}`);
  }

  const data = new Uint8Array(8 + 1 + 32 + 32 + 8);
  data.set(discriminator, 0);
  data[8] = scopeIndex;
  data.set(scopeRefBytes, 9);
  data.set(encryptedReferenceHash, 41);
  data.set(encodeI64(expiresAt), 73);

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: grantor, isSigner: true, isWritable: true },
      { pubkey: auditor, isSigner: false, isWritable: false },
      { pubkey: auditorProfilePda, isSigner: false, isWritable: false },
      { pubkey: viewingGrantPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return {
    transaction: new Transaction().add(instruction),
    viewingGrantPda,
  };
}

export async function registerAuditorTransaction({
  auditorAuthority,
  metadataHash,
  stakeLamports,
}) {
  const auditor = asPublicKey(auditorAuthority);
  const configPda = getConfigPda();
  const auditorProfilePda = getAuditorProfilePda(auditor);
  const auditorVaultPda = getAuditorVaultPda(auditor);
  const discriminator = await getInstructionDiscriminator('register_auditor');
  const metadataHashBytes = typeof metadataHash === 'string' ? fromHex(metadataHash) : Uint8Array.from(metadataHash);

  if (metadataHashBytes.length !== 32) {
    throw new Error('Auditor metadata hash must be 32 bytes');
  }

  if (BigInt(stakeLamports) <= 0n) {
    throw new Error('Auditor stake must be greater than zero');
  }

  const data = new Uint8Array(8 + 32 + 8);
  data.set(discriminator, 0);
  data.set(metadataHashBytes, 8);
  data.set(encodeU64(stakeLamports), 40);

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: auditorProfilePda, isSigner: false, isWritable: true },
      { pubkey: auditorVaultPda, isSigner: false, isWritable: true },
      { pubkey: auditor, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return {
    transaction: new Transaction().add(instruction),
    auditorProfilePda,
    auditorVaultPda,
  };
}

export async function topUpAuditorStakeTransaction({
  auditorAuthority,
  amountLamports,
}) {
  const auditor = asPublicKey(auditorAuthority);
  const configPda = getConfigPda();
  const auditorProfilePda = getAuditorProfilePda(auditor);
  const auditorVaultPda = getAuditorVaultPda(auditor);
  const discriminator = await getInstructionDiscriminator('top_up_auditor_stake');

  if (BigInt(amountLamports) <= 0n) {
    throw new Error('Top-up amount must be greater than zero');
  }

  const data = new Uint8Array(8 + 8);
  data.set(discriminator, 0);
  data.set(encodeU64(amountLamports), 8);

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: auditorProfilePda, isSigner: false, isWritable: true },
      { pubkey: auditorVaultPda, isSigner: false, isWritable: true },
      { pubkey: auditor, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return {
    transaction: new Transaction().add(instruction),
    auditorProfilePda,
    auditorVaultPda,
  };
}

export async function withdrawAuditorStakeTransaction({
  auditorAuthority,
  amountLamports,
}) {
  const auditor = asPublicKey(auditorAuthority);
  const configPda = getConfigPda();
  const auditorProfilePda = getAuditorProfilePda(auditor);
  const auditorVaultPda = getAuditorVaultPda(auditor);
  const discriminator = await getInstructionDiscriminator('withdraw_auditor_stake');

  if (BigInt(amountLamports) <= 0n) {
    throw new Error('Withdrawal amount must be greater than zero');
  }

  const data = new Uint8Array(8 + 8);
  data.set(discriminator, 0);
  data.set(encodeU64(amountLamports), 8);

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: auditorProfilePda, isSigner: false, isWritable: true },
      { pubkey: auditorVaultPda, isSigner: false, isWritable: true },
      { pubkey: auditor, isSigner: true, isWritable: true },
    ],
    data,
  });

  return {
    transaction: new Transaction().add(instruction),
    auditorProfilePda,
    auditorVaultPda,
  };
}

export async function revokeViewingGrantTransaction({ grantorAuthority, auditorAuthority, scopeRefBytes }) {
  const grantor = asPublicKey(grantorAuthority);
  const auditor = asPublicKey(auditorAuthority);
  const viewingGrantPda = getViewingGrantPda(grantor, auditor, scopeRefBytes);
  const discriminator = await getInstructionDiscriminator('revoke_viewing_grant');

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: grantor, isSigner: true, isWritable: true },
      { pubkey: viewingGrantPda, isSigner: false, isWritable: true },
    ],
    data: discriminator,
  });

  return {
    transaction: new Transaction().add(instruction),
    viewingGrantPda,
  };
}

export async function closeViewingGrantTransaction({ grantorAuthority, auditorAuthority, scopeRefBytes }) {
  const grantor = asPublicKey(grantorAuthority);
  const auditor = asPublicKey(auditorAuthority);
  const viewingGrantPda = getViewingGrantPda(grantor, auditor, scopeRefBytes);
  const discriminator = await getInstructionDiscriminator('close_viewing_grant');

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: grantor, isSigner: true, isWritable: true },
      { pubkey: viewingGrantPda, isSigner: false, isWritable: true },
    ],
    data: discriminator,
  });

  return {
    transaction: new Transaction().add(instruction),
    viewingGrantPda,
  };
}

export async function sendRegistryTransaction(connection, signTransaction, feePayer, transaction) {
  if (!signTransaction) {
    throw new Error('Connected wallet cannot sign transactions');
  }

  const latestBlockhash = await connection.getLatestBlockhash();
  transaction.feePayer = asPublicKey(feePayer);
  transaction.recentBlockhash = latestBlockhash.blockhash;

  const signedTransaction = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  await connection.confirmTransaction({ signature, ...latestBlockhash }, 'confirmed');
  return signature;
}

export function hexToBytes(hex) {
  return fromHex(hex);
}