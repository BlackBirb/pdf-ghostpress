import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { GS_QUALITIES, runCompression, type GSError, type GSQuality } from "../gs.js"
import { headers } from "../config.js"
import { cleanup, useSnowflake, workerPool } from "../utils/index.js"
import { Readable } from "node:stream"
import { cacheUpload } from "../utils/readSourceFile.js"
import { stringWebhookRequest } from "../webhook.js"
import { fetchStreamS3, uploadToS3 } from "../s3.js"


type QueryParams = {
  quality: GSQuality | null
}

type WebhookHeaders = {
  [headers.replyTo]: string
  [headers.reportTo]: string
  [headers.trace]?: string
  ['content-type']: string
}

const s3Schema = {
  headers: {
    type: 'object',
    properties: {
      [headers.replyTo]: { type: 'string' },
      [headers.reportTo]: { type: 'string' },
      [headers.trace]: { type: 'string' },
      ['content-type']: {
        type: 'string',
        pattern: '^multipart/form-data'
      }
    },
    required: [headers.replyTo, headers.reportTo, 'content-type']
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
  app.post<{ Querystring: QueryParams, Headers: WebhookHeaders }>('/process/s3', { schema: s3Schema }, async (request, reply) => {
    if(!workerPool.available()) {
      return reply.code(503).send({ error: 'Server is busy, please try again later' })
    }

    const quality = request.query.quality || null
    const callbackSuccess = request.headers[headers.replyTo]
    const callbackError = request.headers[headers.reportTo]

    const trace = request.headers[headers.trace] || useSnowflake()

    const parts = await request.parts()

    const fields: Record<string, string | null> = {}

    let sourceStream = null

    for await (const part of parts) {
      if(part.type === 'file')
        sourceStream = part.file
      else
        fields[part.fieldname] = part.value as string || null
    }
    if(!fields.destination)
      return reply.code(400).send({ error: 'Missing destination' })

    if(!workerPool.acquire()) {
      return reply.code(503).send({ error: 'Server is busy, please try again later' })
    }

    let sourceFile: string;
    if(!sourceStream) {
      if(!fields.source)
        return reply.code(400).send({ error: 'Missing source or file' })

      reply.code(202).header('Trace', trace).send({ trace })

      sourceStream = await fetchStreamS3(fields.source!)

      if(!sourceStream)
        return stringWebhookRequest('Failed to fetch file', callbackError, { [headers.trace]: trace })

      const { sourceFile: srcFile } = (await cacheUpload(trace, sourceStream)) || {}
      if(!srcFile)
        return stringWebhookRequest('Internal server error', callbackError, { [headers.trace]: trace })

      sourceFile = srcFile
    } else {
      const { sourceFile: srcFile } = (await cacheUpload(trace, sourceStream)) || {}

      if(!srcFile)
        return reply.code(400).send({ error: 'No file provided' })

      sourceFile = srcFile
      reply.code(202).header('Trace', trace).send({ trace })
    }

    newTask({
      sourceFile,
      quality,
      callbackSuccess,
      destination: fields.destination,
      callbackError,
      trace
    }, app.log)
  })
}

type TaskParams = {
  sourceFile: string,
  quality: GSQuality | null,
  callbackSuccess: string,
  callbackError: string,
  destination: string,
  trace: string
}

const newTask = async (input: TaskParams, log: FastifyBaseLogger) => {
  const {
    sourceFile,
    quality,
    callbackSuccess,
    callbackError,
    destination,
    trace
  } = input

  log.info({ trace, callbackSuccess, callbackError, quality, sourceFile, destination }, 'Begin s3 task')

  let resultFile: string | null = null
  try {
    const { result } = await runCompression(sourceFile, quality)
    resultFile = result

    await uploadToS3(destination, resultFile)
    await stringWebhookRequest(JSON.stringify({ trace }), callbackSuccess, { [headers.trace]: trace })
    log.info({ trace, done: true }, 'Task success')
  } catch(err: any) {
    log.error({ trace, err }, 'Task failed')

    if(typeof err === 'object' && 'code' in err)
      await stringWebhookRequest((err as GSError).code.toString(), callbackError, { [headers.trace]: trace })
    else
      await stringWebhookRequest('Internal server error', callbackError, { [headers.trace]: trace })

  }

  if(resultFile)
    cleanup(resultFile)

  cleanup(sourceFile)
  workerPool.release()
}
