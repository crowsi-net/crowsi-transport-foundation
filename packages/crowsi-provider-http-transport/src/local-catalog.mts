import type { LocalOperation } from './local-contracts.mjs'

/** Snapshot owner registrations; declarations are information, never proof of cloud IAM. */
export function checkedOperations(input: readonly LocalOperation[]): readonly LocalOperation[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 128) {
    throw new Error('provider/operations/invalid')
  }
  const ids = new Set<string>()
  return Object.freeze(
    input.map((operation) => {
      if (
        !operation ||
        typeof operation.build !== 'function' ||
        typeof operation.id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(operation.id) ||
        !['read', 'write'].includes(operation.effect) ||
        !Array.isArray(operation.requiredPermissions) ||
        operation.requiredPermissions.length > 64
      ) {
        throw new Error('provider/operation/invalid')
      }
      if (ids.has(operation.id)) throw new Error('provider/operation/duplicate')
      ids.add(operation.id)
      const permissions = [...operation.requiredPermissions]
      if (
        permissions.some(
          (p) =>
            typeof p !== 'string' || !p || p.length > 256 || [...p].some((character) => character.charCodeAt(0) < 32),
        ) ||
        new Set(permissions).size !== permissions.length
      )
        throw new Error('provider/permissions/invalid')
      return Object.freeze({
        id: operation.id,
        effect: operation.effect,
        requiredPermissions: Object.freeze(permissions),
        build: operation.build,
      })
    }),
  )
}
