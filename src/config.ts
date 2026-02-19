import path from "node:path";
import { ensureDir } from "./utils.js";
import crypto from 'node:crypto'

export const headers = {
  replyTo: 'ghostscript-reply-to',
  reportTo: 'ghostscript-report-to',
  trace: 'trace',
} as const

export const config = {
  uploads: path.resolve('/', 'tmp', 'gs', 'uploads'),
  maxWorkers: parseInt(process.env.WORKERS || '10') || 10
} as const

export const getSourceFileName = (trace: string) => path.resolve(config.uploads, `body-${trace}-${crypto.randomBytes(16).toString('hex')}.bin`)
