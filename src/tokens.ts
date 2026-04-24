import { generateThemeCss } from '@figma-var-export/core'
import { strFromU8, unzipSync } from 'fflate'

export interface TokensZipToCssResult {
  css: string
  files: {
    dark: string
    light: string
  }
}

export function tokensZipToCss(input: ArrayBuffer | Uint8Array): TokensZipToCssResult {
  const archive = unzipSync(input instanceof Uint8Array ? input : new Uint8Array(input))
  const lightFileName = findTokenFile(archive, 'Light')
  const darkFileName = findTokenFile(archive, 'Dark')

  const lightTokens = parseTokenJson(archive[lightFileName], lightFileName)
  const darkTokens = parseTokenJson(archive[darkFileName], darkFileName)
  const css = `${generateThemeCss(lightTokens, darkTokens)}\n`

  return {
    css,
    files: {
      dark: darkFileName,
      light: lightFileName,
    },
  }
}

function findTokenFile(files: Record<string, Uint8Array>, modeName: 'Dark' | 'Light'): string {
  const mode = modeName.toLowerCase()
  const names = Object.keys(files).filter((name) => !name.endsWith('/'))

  const exact = names.find((name) => {
    const basename = getBasename(name).toLowerCase()
    return basename === `${mode}.tokens.json`
  })

  if (exact) {
    return exact
  }

  const fallback = names.find((name) => {
    const basename = getBasename(name).toLowerCase()
    return basename.endsWith('.json') && basename.includes(mode)
  })

  if (fallback) {
    return fallback
  }

  throw new Error(`Cannot find ${modeName}.tokens.json in theme.zip.`)
}

function parseTokenJson(
  content: Uint8Array | undefined,
  fileName: string,
): Record<string, unknown> {
  if (!content) {
    throw new Error(`Cannot read ${fileName} from theme.zip.`)
  }

  try {
    return JSON.parse(strFromU8(content)) as Record<string, unknown>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot parse ${fileName}: ${message}`, { cause: error })
  }
}

function getBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
