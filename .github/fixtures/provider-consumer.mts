import { createProviderHttpTransport } from '@crowsi/provider-http-transport'
import { createLocalProviderControl, type LocalAccount, type LocalOperation, type LocalPlan,
  type CredentialSource } from '@crowsi/provider-http-transport/local-control'
const account: LocalAccount = { provider: 'fixture', account: 'synthetic', subject: 'owner' }
const credentials: CredentialSource = { acquire: async () => 'synthetic-credential-not-a-real-account' }
const operations: LocalOperation[] = [{ id: 'read', effect: 'read', requiredPermissions: [],
  build: () => ({ url: 'https://synthetic.test/state', method: 'GET' }) }]
const control = createLocalProviderControl({ account, credentials, operations, allowedOrigins: ['https://synthetic.test'] })
const plan: LocalPlan = control.prepare('read', {})
control.approve(plan, Date.now() + 1000)
createProviderHttpTransport({ allowedOrigins: ['https://synthetic.test'] })
// @ts-expect-error Effects must use the closed read/write declaration.
const invalid: LocalOperation = { id: 'invalid', effect: 'unbounded', requiredPermissions: [], build: operations[0].build }
void invalid
