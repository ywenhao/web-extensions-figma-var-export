import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { tokensZipToCss } from './tokens'

describe('tokensZipToCss', () => {
  it('generates vars.css from Figma mode token files', () => {
    const zip = zipSync({
      'Light.tokens.json': strToU8(
        JSON.stringify({
          Base: {
            Gray: {
              0: {
                $type: 'color',
                $value: {
                  alpha: 1,
                  colorSpace: 'srgb',
                  components: [0.976, 0.98, 0.984],
                  hex: '#F9FAFB',
                },
              },
            },
          },
        }),
      ),
      'Dark.tokens.json': strToU8(
        JSON.stringify({
          Base: {
            Gray: {
              0: {
                $type: 'color',
                $value: {
                  alpha: 1,
                  colorSpace: 'srgb',
                  components: [0.063, 0.063, 0.071],
                  hex: '#101012',
                },
              },
            },
          },
        }),
      ),
    })

    const result = tokensZipToCss(zip)

    expect(result.files.light).toBe('Light.tokens.json')
    expect(result.files.dark).toBe('Dark.tokens.json')
    expect(result.css).toContain(':root {')
    expect(result.css).toContain('  --Base-Gray-0: #f9fafb;')
    expect(result.css).toContain('.dark {')
    expect(result.css).toContain('  --Base-Gray-0: #101012;')
  })

  it('finds token files inside folders', () => {
    const zip = zipSync({
      'theme/Light.tokens.json': strToU8(
        JSON.stringify({ Color: { Primary: { $type: 'color', $value: '#fff' } } }),
      ),
      'theme/Dark.tokens.json': strToU8(
        JSON.stringify({ Color: { Primary: { $type: 'color', $value: '#000' } } }),
      ),
    })

    const result = tokensZipToCss(zip)

    expect(result.files.light).toBe('theme/Light.tokens.json')
    expect(result.files.dark).toBe('theme/Dark.tokens.json')
    expect(result.css).toContain('  --Color-Primary: #fff;')
  })
})
