import { stat } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import type { FastifyInstance } from "fastify"
import { GS_QUALITIES, runCompression, type GSQuality } from "../gs.js"
import { cleanup, useSnowflake, workerPool } from "../utils/index.js"
import readSourceFile from "../utils/readSourceFile.js"

type QueryParams = {
  quality: GSQuality | null
}

const inlineSchema = {
  headers: {
    type: 'object',
    properties: {
      ['content-type']: {
        type: 'string',
        anyOf: [
          { const: 'application/pdf' },
          { pattern: '^multipart/form-data' }
        ]
      }
    },
    required: ['content-type']
  },
  querystring: {
    type: 'object',
    properties: {
      quality: {
        type: 'string',
        enum: GS_QUALITIES,
      }
    }
  }
}

export default (app: FastifyInstance) => {
  app.post<{ Querystring: QueryParams }>('/process/inline', { schema: inlineSchema }, async (request, reply) => {
    if(!workerPool.available()) {
      return reply.code(503).send({ error: 'Server is busy, please try again later' })
    }

    const quality = request.query.quality || null

    const trace = useSnowflake()

    const { sourceFile } = (await readSourceFile(trace, request)) || {}

    if(!sourceFile) {
      return reply.code(400).send({ error: 'No file provided' })
    }

    let resultFile: string | null = null
    try {

      if(!workerPool.acquire()) {
        cleanup(sourceFile)
        return reply.code(503).send({ error: 'Server is busy, please try again later' })
      }
      const { result } = await runCompression(sourceFile, quality)
      resultFile = result

      const stats = await stat(result)

      reply.header('Trace', trace)
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Size', stats.size.toString())

      const resultStream = createReadStream(result)

      await pipeline(resultStream, reply.raw)
    } catch(err) {
      console.log("err")
      reply.header('Trace', trace)
      return reply.code(500).send({ error: 'Compression failed' })
    }

    if(resultFile)
      cleanup(resultFile)

    cleanup(sourceFile)
    workerPool.release()
  })
}
