import { spawn } from "child_process"
import { createWriteStream } from "fs"

export const GS_QUALITIES = [ 'screen', 'ebook', 'printer', 'prepress', 'default' ] as const

export type GSQuality = typeof GS_QUALITIES[number]

export type GSResult = {
  result: string,
  code: number
}
export type GSError = GSResult

export const runCompression = (source: string, quality: GSQuality | null): Promise<GSResult> => new Promise((resolve, reject) => {
  const result = source + '.result'

  const resultBuffer = createWriteStream(result)

  const gs = spawn('gs', [
    '-sOutputFile=%stdout',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.7',
    `-dPDFSETTINGS=/${quality || 'printer'}`,
    '-dNOPAUSE',
    '-dBATCH',
    '-dQUIET',
    source
  ], {
    stdio: [ 'ignore', 'pipe', 'pipe' ]
  })

  gs.on('close', code => {
    if(!resultBuffer.closed) {
      resultBuffer.close()
    }
    if(code === 0)
      return resolve({ code, result })

    return reject({ code, result })
  })

  gs.stderr.pipe(process.stderr)

  gs.stdout.pipe(resultBuffer)
})
