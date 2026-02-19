import Fastify from "fastify"
import { cleanup, useSnowflake, workerPool } from "./utils.js"
import { GS_QUALITIES, runCompression, type GSError, type GSQuality } from "./gs.js"
import { createReadStream, createWriteStream } from "fs"
import { pipeline } from "stream/promises"
import { stat } from "fs/promises"
import { request } from "http"
import { getSourceFile, headers } from "./config.js"

const getSnowflake = useSnowflake()

const app = Fastify({
  logger: true,
  trustProxy: true
})

app.addContentTypeParser(
  'application/pdf',
  (req, payload, done) => done(null, payload)
)

type TaskParams = {
  sourceFile: string,
  quality: GSQuality | null,
  callbackSuccess: string,
  callbackError: string,
  trace: string
}

const newTask = async (input: TaskParams) => {
  const {
    sourceFile,
    quality,
    callbackSuccess,
    callbackError,
    trace
  } = input

  app.log.info({ trace, callbackSuccess, callbackError, quality, sourceFile }, 'Begin task')

  let resultFile: string | null = null
  try {
    const { result } = await runCompression(sourceFile, quality)
    resultFile = result

    await callSuccessWebhook(resultFile, callbackSuccess, trace)
    app.log.info({ trace, done: true }, 'Task success')
  } catch(err: any) {
    app.log.error({ trace, err }, 'Task failed')

    if(typeof err === 'object' && 'code' in err) {
      await callErrorWebhook((err as GSError).code.toString(16), callbackError, trace)
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
}

const webhookSchema = {
  headers: {
    type: 'object',
    properties: {
      [headers.replyTo]: { type: 'string' },
      [headers.reportTo]: { type: 'string' },
      [headers.trace]: { type: 'string' }
    },
    required: [headers.replyTo, headers.reportTo]
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

app.post<{ Querystring: QueryParams, Headers: WebhookHeaders }>('/process/webhook', { schema: webhookSchema }, async (request, reply) => {
  if(!workerPool.available()) {
    return reply.code(503).send({ error: 'Server is busy, please try again later' })
  }

  const quality = request.query.quality || null

  // Reply-To - Success
  // Report-to - Error
  const callbackSuccess = request.headers[headers.replyTo]
  const callbackError = request.headers[headers.reportTo]

  const trace = request.headers[headers.trace] || getSnowflake()
  const sourceFile = getSourceFile(trace)

  const tmpStream = createWriteStream(sourceFile)

  request.raw.on('aborted', () => {
    if(!tmpStream.closed)
      tmpStream.close()
    cleanup(sourceFile)
  })

  await pipeline(request.raw, tmpStream)

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
  })

  return reply.code(202).header('Trace', trace).send({ trace })
})

 const inlineSchema = {
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

app.post<{ Querystring: QueryParams }>('/process/inline', { schema: inlineSchema }, async (request, reply) => {
  if(!workerPool.available()) {
    return reply.code(503).send({ error: 'Server is busy, please try again later' })
  }

  const quality = request.query.quality || null

  const trace = getSnowflake()
  const sourceFile = getSourceFile(trace)

  const tmpStream = createWriteStream(sourceFile)

  let resultFile: string | null = null
  try {
    await pipeline(request.raw, tmpStream)

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

app.get('/health', async (request, reply) => {
  return { status: 'ok' }
})

app.listen({
  host: '0.0.0.0',
  port: parseInt(process.env.PORT!) || 3416
})

// why is it so complex wth
// Need to watch if server just hangs the connection forever
// and in that case destry it and release the worker
const callSuccessWebhook = async (filename: string, url: string, trace: string) => new Promise<void>(async (resolve, reject) => {
  const stats = await stat(filename)
  const readStream = createReadStream(filename)

  const req = request(url, {
    method: 'POST',
    headers: {
      "Content-length": stats.size.toString(),
      "content-type": 'application/pdf',
      "Trace": trace
    },
  })

  let lastRead = Date.now()
  let timeout: NodeJS.Timeout;
  const updateTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      const diff = Date.now() - lastRead
      if(diff < 10_000)
        return updateTimeout()
      req.destroy()
      reject("SuccessWebhook: Socket timeout")
    }, 3334)
  }
  updateTimeout()

  readStream.pipe(req)

  readStream.on('error', () => {
    req.destroy()
    reject('SuccessWebhook: File read error')
  })
  readStream.on('data', () => {
    lastRead = Date.now()
  })

  req.on('response', res => {
    req.destroy()
    resolve()
  })
  req.on('close', () => {
    clearTimeout(timeout)
    resolve()
  })
  req.on('error', reqError => {
    reject("SuccessWebhook: Request error: " + reqError.name)
  })
})

const callErrorWebhook = async (reason: string, url: string, trace: string) => {
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        "Trace": trace
      },
      body: JSON.stringify({
        error: reason
      })
    })
  } catch(err) {
    throw "ErrorWebhook: Fetch error: " + ((err as Error)?.message || 'Unknown error')
  }
}
