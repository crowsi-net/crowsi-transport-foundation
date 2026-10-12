export interface LocalAccount {
  readonly provider: string
  readonly subject: string
  readonly account: string
}
export interface BoundRequest {
  readonly url: string
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  readonly body?: string
}
export interface LocalOperation {
  readonly id: string
  readonly effect: 'read' | 'write'
  readonly requiredPermissions: readonly string[]
  build(input: unknown, account: LocalAccount): BoundRequest
}
export interface LocalPlan {
  readonly schema: 'crowsi://provider-operation-plan/v1'
  readonly account: LocalAccount
  readonly operation: string
  readonly effect: 'read' | 'write'
  readonly requiredPermissions: readonly string[]
  readonly request: BoundRequest
  readonly digest: string
}
export interface CredentialSource {
  // Trusted host-owned implementation; never pass this function to generated code.
  acquire(account: LocalAccount): Promise<string>
}
export interface LocalControlOptions {
  account: LocalAccount
  operations: readonly LocalOperation[]
  allowedOrigins: readonly string[]
  credentials: CredentialSource
  fetchImplementation?: typeof fetch
  clock?: () => number
}
