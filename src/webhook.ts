import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { request, type OutgoingHttpHeaders } from "node:http"
import Stream from "node:stream"

export const mediaWebhookRequest = async (filename: string, url: string, headers: OutgoingHttpHeaders) => {
  const stats = await stat(filename)
  const readStream = createReadStream(filename)

  return webhookRequest(readStream, stats.size, url, headers)
}

export const stringWebhookRequest = async (body: string, url: string, headers: OutgoingHttpHeaders) => {
  const size = Buffer.byteLength(body, 'utf8')
  const stream = Stream.Readable.from(body)

  return webhookRequest(stream, size, url, headers)
}

// Annoyingly coplex
// Need to watch if server just hangs the connection forever
// and in that case destry it and release the worker
const webhookRequest = async (stream: Stream, size: number, url: string, headers: OutgoingHttpHeaders) => {
  const { promise, resolve, reject } = Promise.withResolvers<void>()

  const req = request(url, {
    method: 'POST',
    headers: {
      "Content-length": size.toString(),
      "content-type": 'application/pdf',
      ...headers
    },
  })

  let lastRead = Date.now()
  const interval = setInterval(() => {
    const diff = Date.now() - lastRead
    
    if(diff < 10_000)
      return

    req.destroy()
    reject("Webhook: Socket timeout")
  }, 3334)

  stream.pipe(req)

  stream.on('error', () => {
    req.destroy()
    reject('Webhook: File read error')
  })
  stream.on('data', () => {
    lastRead = Date.now()
  })

  req.on('response', res => {
    req.destroy()
    resolve()
  })
  req.on('close', () => {
    resolve()
  })
  req.on('error', reqError => {
    reject("Webhook: Request error: " + reqError.name)
  })

  promise
    .then(() => clearInterval(interval))
    .catch(() => clearInterval(interval))
}