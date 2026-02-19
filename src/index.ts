import Fastify from "fastify"
import { cleanup, ensureDir, useSnowflake } from "./utils.js"
import { GS_QUALITIES, runCompression, type GSError, type GSQuality } from "./gs.js"
import { createReadStream, createWriteStream } from "fs"
import path from "path"
import { pipeline } from "stream/promises"
import { stat } from "fs/promises"
import { request } from "http"

const replyToHeader = 'ghostscript-reply-to' as const
const reportToHeader = 'ghostscript-report-to' as const
const traceHeader = 'trace' as const

const getSnowflake = useSnowflake()
const tmpUploads = path.resolve('/', 'tmp', 'gs', 'uploads')
ensureDir(tmpUploads)

let currentWorkers = 0
const maxWorkers = parseInt(process.env.WORKERS || '10') || 10

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
  currentWorkers--
}

type QueryParams = {
  quality: GSQuality | null
}

type WebhookHeaders = {
  [replyToHeader]: string
  [reportToHeader]: string
  [traceHeader]?: string
}

app.post<{ Querystring: QueryParams, Headers: WebhookHeaders }>('/process/webhook', {
  schema: {
    headers: {
      type: 'object',
      properties: {
        [replyToHeader]: { type: 'string' },
        [reportToHeader]: { type: 'string' },
        [traceHeader]: { type: 'string' }
      },
      required: [replyToHeader, reportToHeader]
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
}, async (request, reply) => {
  if(currentWorkers >= maxWorkers) {
    return reply.code(503).send({ error: 'Server is busy, please try again later' })
  }

  const quality = request.query.quality || null

  // Reply-To - Success
  // Report-to - Error
  const callbackSuccess = request.headers[replyToHeader]
  const callbackError = request.headers[reportToHeader]

  const trace = request.headers[traceHeader] || getSnowflake()
  const sourceFile = path.resolve(tmpUploads, `body-${trace}.bin`)

  const tmpStream = createWriteStream(sourceFile)

  request.raw.on('aborted', () => {
    if(!tmpStream.closed)
      tmpStream.close()
    cleanup(sourceFile)
  })

  await pipeline(request.raw, tmpStream)

  currentWorkers++
  newTask({
    sourceFile,
    quality,
    callbackSuccess,
    callbackError,
    trace
  })

  return reply.code(202).header('Trace', trace).send({ trace })
})

app.post<{ Querystring: QueryParams }>('/process/inline', {
  schema: {
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
}, async (request, reply) => {
  if(currentWorkers >= maxWorkers) {
    return reply.code(503).send({ error: 'Server is busy, please try again later' })
  }

  const quality = request.query.quality || null

  const trace = getSnowflake()
  const sourceFile = path.resolve(tmpUploads, `body-${trace}.bin`)

  const tmpStream = createWriteStream(sourceFile)

  let resultFile: string | null = null
  try {
    await pipeline(request.raw, tmpStream)

    currentWorkers++
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
  currentWorkers--
})

app.get('/health', async (request, reply) => {
  return { status: 'ok' }
})

app.listen({
  host: '0.0.0.0',
  port: parseInt(process.env.PORT!) || 3416
})

// why is it so complex wth
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
      reject("SuccWebhook: Socket timeout")
    }, 3334)
  }
  updateTimeout()

  readStream.pipe(req)

  readStream.on('error', () => {
    req.destroy()
    reject('SuccWebhook: File read error')
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
    reject("SuccWebhook: Request error: " + reqError.name)
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
