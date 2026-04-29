export type BrokerTokenErrorCode =
  | 'expired'
  | 'invalid_signature'
  | 'invalid_audience'
  | 'invalid_issuer'
  | 'missing_kid'
  | 'unknown_kid'
  | 'malformed'

export class BrokerTokenError extends Error {
  readonly code: BrokerTokenErrorCode

  constructor(code: BrokerTokenErrorCode, message: string) {
    super(message)
    this.name = 'BrokerTokenError'
    this.code = code
  }
}
