import * as crypto from 'crypto'

export function validateSignature(signature: string, secret: string, payload: any): boolean {
  const actualSig = crypto.createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex')

  const actual = Buffer.from(`sha256=${actualSig}`, 'ascii')
  const claim = Buffer.from(signature, 'ascii')
  return crypto.timingSafeEqual(actual, claim)
}