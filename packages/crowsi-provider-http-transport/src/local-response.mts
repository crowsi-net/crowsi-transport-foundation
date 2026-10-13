import type { ProviderHttpResponse } from './contracts.mjs'

export class ResponseRejected extends Error {
  constructor(readonly code: 'not-utf8' | 'not-json' | 'credential-rejected' | 'no-content-body') {
    super(`provider/response/${code}`)
  }
}

export function jsonReceiptData(response: ProviderHttpResponse, credential: string): unknown {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(response.body)
  } catch {
    throw new ResponseRejected('not-utf8')
  }
  if (text.includes(credential)) throw new ResponseRejected('credential-rejected')
  let data: unknown = null
  if (![204, 205].includes(response.status)) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new ResponseRejected('not-json')
    }
  } else if (response.body.length) throw new ResponseRejected('no-content-body')
  if (JSON.stringify(data).includes(credential)) throw new ResponseRejected('credential-rejected')
  return data
}
