import { mkdir, stat, unlink } from "fs/promises"
import { config } from "../config.js"

type SnowflakeOptions = {
  epoch?: number
  worker?: number // 0..31
  process?: number // 0..31
  rate?: number // IDs/ms <= 4096 (12 bits)
}

const bin2hex = (bin: string) => {
  let hex = ''
  for(let i = 0; i < bin.length; i += 4) {
    hex += parseInt(bin.substring(i, i + 4), 2).toString(16)
  }
  return hex
}

const snowflake = (idx: number, options: Required<SnowflakeOptions>) => {
  const time = Date.now() - options.epoch
  const right = (options.worker << 17) + (options.process << 12) + idx
  return bin2hex('0' + time.toString(2).padStart(41, '0') + right.toString(2).padStart(22, '0'))
}

const snowflakeFactory = (options: SnowflakeOptions = {}) => {
  const {
    epoch = (new Date('2026-01-01T00:00:00.000Z')).getTime(),
    worker = 1,
    process = 1,
    rate = 4096
  } = options

  const defaultedOptions: Required<SnowflakeOptions> = {
    epoch,
    worker: worker % 0x1f,
    process: process % 0x1f,
    rate: rate % 0x1000
  }

  let seq = 0

  return () => {
    seq = (seq + 1) % rate
    return snowflake(seq, defaultedOptions)
  }
}

export const useSnowflake = snowflakeFactory()


export const cleanup = (filename: string) => {
  return unlink(filename).catch(console.log)
}

export const ensureDir = async (dir: string) => {
  try {
    await stat(dir)
  } catch {
    await mkdir(dir, {
      recursive: true
    })
  }
}

class WorkerPool {
  #current = 0
  readonly #max: number

  constructor(max: number) {
    this.#max = max
  }

  get current() {
    return this.#current
  }

  available() {
    return this.#current < this.#max
  }

  acquire() {
    if(!this.available()) return false
    this.#current++
    return true
  }

  release() {
    if(this.#current > 0) this.#current--
  }
}

export const workerPool = new WorkerPool(config.maxWorkers)
