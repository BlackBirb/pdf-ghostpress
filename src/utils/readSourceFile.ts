import type { FastifyRequest } from "fastify"
import { getSourceFileName } from "../config.js"
import { createWriteStream } from "node:fs"
import { cleanup } from "./index.js"
import { pipeline } from "node:stream/promises"
import type { Readable } from "node:stream"

export const cacheUpload = async (trace: string, sourceStream: Readable) => {
  const sourceFile = getSourceFileName(trace)
  const tmpStream = createWriteStream(sourceFile)

  sourceStream.on('aborted', () => {
    if(!tmpStream.closed)
      tmpStream.close()
    cleanup(sourceFile)
  })

  try {
    await pipeline(sourceStream, tmpStream)

    return {
      sourceFile
    }
  } catch(err) {
    cleanup(sourceFile)

    return null
  }
}

export default async (trace: string, request: FastifyRequest) => {
  const contentType = request.headers['content-type']

  let sourceStream = null
  if(contentType === 'application/pdf') {
    sourceStream = request.raw
  } else {
    sourceStream = (await request.file())?.file
  }

  if(!sourceStream) {
    return null
  }

  return cacheUpload(trace, sourceStream)
}
