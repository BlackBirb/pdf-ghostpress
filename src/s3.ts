import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { request } from "node:http"
import { Readable } from "node:stream"

export const fetchStreamS3 = async (url: string): Promise<Readable | null> => {
  try {
    const res = await fetch(url, { method: 'GET' })
    if(!res.ok || !res.body) {
      return null
    }

    return Readable.fromWeb(res.body as any)
  } catch(err) {
    console.error(err)
    return null
  }
}

export const uploadToS3 = (destination: string, resultFile: string) => new Promise<void>(async (resolve, reject) => {
  const { size } = await stat(resultFile)
  const stream = createReadStream(resultFile)

  const req = request(destination, {
    method: 'PUT',
    headers: {
      "Content-length": size.toString(),
      "content-type": 'application/pdf'
    },
  })

  stream.pipe(req)

  stream.on('error', () => {
    req.destroy()
    reject('Webhook: File read error')
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

})
