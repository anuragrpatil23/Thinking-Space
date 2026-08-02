/**
 * A uuid for a record that is about to exist.
 *
 * Record identity is minted once and frozen (DERIVATION.md, first rule), so
 * this is called exactly at creation and never again — if you find yourself
 * regenerating one for an existing record, the bug is upstream.
 *
 * The fallback matters more than it looks: `crypto.randomUUID` is unavailable
 * on insecure origins, which is every LAN-served dev build, so a naive call
 * throws at exactly the moment a record is being created and loses the write.
 * A time-plus-random id is not a real uuid, but it is unique enough for a
 * single-writer vault and it fails soft instead of losing data.
 *
 * `projectBlock.ts` carries its own copy for project uuids; it predates this
 * and is left alone deliberately, since changing the shape of ids a registry
 * has already minted is a migration, not a refactor.
 */
export function newUuidBlock(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through — an insecure origin, not a reason to lose the record */
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
