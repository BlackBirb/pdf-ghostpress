import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { GS_QUALITIES, runCompression, type GSError, type GSQuality } from "../gs.js"
import { mediaWebhookRequest, stringWebhookRequest } from "../webhook.js"
import { headers } from "../config.js"
import { cleanup, useSnowflake, workerPool } from "../utils/index.js"
import readSourceFile from "../utils/readSourceFile.js"

type TaskParams = {
  sourceFile: string,
  quality: GSQuality | null,
  callbackSuccess: string,
  callbackError: string,
  trace: string
}

const newTask = async (input: TaskParams, log: FastifyBaseLogger) => {
  const {
    sourceFile,
    quality,
    callbackSuccess,
    callbackError,
    trace
  } = input

  log.info({ trace, callbackSuccess, callbackError, quality, sourceFile }, 'Begin webhook task')

  let resultFile: string | null = null
  try {
    const { result } = await runCompression(sourceFile, quality)
    resultFile = result

    await mediaWebhookRequest(resultFile, callbackSuccess, { [headers.trace]: trace })
    log.info({ trace, done: true }, 'Task success')
  } catch(err: any) {
    log.error({ trace, err }, 'Task failed')

    if(typeof err === 'object' && 'code' in err) {
      await stringWebhookRequest((err as GSError).code.toString(), callbackError, { [headers.trace]: trace })
    }
  }

  if(resultFile)
    cleanup(resultFile)

  cleanup(sourceFile)
  workerPool.release()
}

type QueryParams = {
  quality: GSQuality | null
}

type WebhookHeaders = {
  [headers.replyTo]: string
  [headers.reportTo]: string
  [headers.trace]?: string
  ['content-type']: string
}

const webhookSchema = {
  headers: {
    type: 'object',
    properties: {
      [headers.replyTo]: { type: 'string' },
      [headers.reportTo]: { type: 'string' },
      [headers.trace]: { type: 'string' },
      ['content-type']: {
        type: 'string',
        anyOf: [
          { const: 'application/pdf' },
          { pattern: '^multipart/form-data' }
        ]
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

  app.post<{ Querystring: QueryParams, Headers: WebhookHeaders }>('/process/webhook', { schema: webhookSchema }, async (request, reply) => {
    if(!workerPool.available()) {
      return reply.code(503).send({ error: 'Server is busy, please try again later' })
    }

    const quality = request.query.quality || null

    // Reply-To - Success
    // Report-to - Error
    const callbackSuccess = request.headers[headers.replyTo]
    const callbackError = request.headers[headers.reportTo]

    const trace = request.headers[headers.trace] || useSnowflake()

    const { sourceFile } = (await readSourceFile(trace, request)) || {}

    if(!sourceFile) {
      return reply.code(400).send({ error: 'No file provided' })
    }

    if(!workerPool.acquire()) {
      cleanup(sourceFile)
      return reply.code(503).send({ error: 'Server is busy, please try again later' })
    }

    newTask({
      sourceFile,
      quality,
      callbackSuccess,
      callbackError,
      trace
    }, app.log)

    return reply.code(202).header('Trace', trace).send({ trace })
  })
}
