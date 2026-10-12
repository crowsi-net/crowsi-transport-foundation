import { execFile } from 'node:child_process'
import type { CredentialSource, LocalAccount } from './local-contracts.mjs'

/** Owner-only local credential adapter. Command, arguments and parser are fixed by the trusted host. */
export function localCommandCredential(
  file: string,
  args: readonly string[],
  parse: (text: string) => string,
  expected: LocalAccount,
): CredentialSource {
  if (!file || file.includes('/') || args.some((value) => typeof value !== 'string')) {
    throw new Error('provider/credential/source-invalid')
  }
  const captured = { ...expected }
  const argumentsCopy = [...args]
  return Object.freeze({
    async acquire(account: LocalAccount): Promise<string> {
      if (JSON.stringify(account) !== JSON.stringify(captured)) throw new Error('provider/credential/account-mismatch')
      return new Promise((resolve, reject) => {
        execFile(
          file,
          argumentsCopy,
          { encoding: 'utf8', timeout: 10000, maxBuffer: 65536, windowsHide: true },
          (error, stdout) => {
            if (error) {
              reject(new Error('provider/credential/command-failed'))
              return
            }
            try {
              resolve(parse(stdout))
            } catch {
              reject(new Error('provider/credential/invalid-output'))
            }
          },
        )
      })
    },
  })
}

/** Reference-only lookup; provisioning is performed directly in the owner's terminal. */
export function localKeyringCredential(account: LocalAccount): CredentialSource {
  return localCommandCredential(
    'secret-tool',
    [
      'lookup',
      'service',
      'zixcel-provider',
      'provider',
      account.provider,
      'account',
      account.account,
      'subject',
      account.subject,
    ],
    (text) => text.trim(),
    account,
  )
}
