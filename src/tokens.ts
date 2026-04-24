import { strFromU8, unzipSync } from 'fflate'
import { generateThemeModesCss, resolvePrimaryThemeModeName } from 'figma-var-export/browser'

interface ThemeModeArchiveEntry {
  fileName: string
  modeName: string
  tokens: Record<string, unknown>
}

export interface TokensZipToCssResult {
  css: string
  files: Array<{
    fileName: string
    modeName: string
  }>
  modeNames: string[]
  primaryModeName: string
}

export function tokensZipToCss(input: ArrayBuffer | Uint8Array): TokensZipToCssResult {
  const archive = unzipSync(input instanceof Uint8Array ? input : new Uint8Array(input))
  const modes = findThemeModeEntries(archive)
  const modeNames = modes.map((mode) => mode.modeName)
  const primaryModeName = resolvePrimaryThemeModeName(modeNames)
  const css = `${generateThemeModesCss(
    modes.map((mode) => ({
      name: mode.modeName,
      tokens: mode.tokens,
    })),
    { primaryModeName },
  )}\n`

  return {
    css,
    files: modes.map((mode) => ({
      fileName: mode.fileName,
      modeName: mode.modeName,
    })),
    modeNames,
    primaryModeName,
  }
}

function findThemeModeEntries(files: Record<string, Uint8Array>): ThemeModeArchiveEntry[] {
  const tokenFileNames = Object.keys(files)
    .filter((name) => !name.endsWith('/'))
    .filter((name) => {
      const basename = getBasename(name).toLowerCase()
      return basename.endsWith('.tokens.json')
    })
    .toSorted((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))

  if (tokenFileNames.length === 0) {
    throw new Error('Cannot find any *.tokens.json file in theme.zip.')
  }

  return tokenFileNames.map((fileName) => ({
    fileName,
    modeName: getModeName(fileName),
    tokens: parseTokenJson(files[fileName], fileName),
  }))
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

function getModeName(fileName: string): string {
  const basename = getBasename(fileName)
  const modeName = basename.replace(/\.tokens\.json$/i, '').trim()

  if (!modeName) {
    throw new Error(`Cannot derive a mode name from ${fileName}.`)
  }

  return modeName
}
