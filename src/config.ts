import path from "node:path";
import { ensureDir } from "./utils.js";

export const headers = {
  replyTo: 'ghostscript-reply-to',
  reportTo: 'ghostscript-report-to',
  trace: 'trace',
} as const

export const config = {
  uploads: path.resolve('/', 'tmp', 'gs', 'uploads'),
  maxWorkers: parseInt(process.env.WORKERS || '10') || 10
} as const

export const getSourceFile = (trace: string) => path.resolve(config.uploads, `body-${trace}.bin`)

// Yeah it just runs on process start, fight me
ensureDir(config.uploads)