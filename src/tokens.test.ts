import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { tokensZipToCss } from './tokens'

describe('tokensZipToCss', () => {
  it('uses Light as the primary mode and emits additional mode selectors', () => {
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
      'Compact.tokens.json': strToU8(
        JSON.stringify({
          Base: {
            Gray: {
              0: {
                $type: 'color',
                $value: {
                  alpha: 1,
                  colorSpace: 'srgb',
                  components: [0.831, 0.831, 0.847],
                  hex: '#D4D4D8',
                },
              },
            },
          },
        }),
      ),
    })

    const result = tokensZipToCss(zip)

    expect(result.primaryModeName).toBe('Light')
    expect(result.modeNames).toEqual(['Compact', 'Dark', 'Light'])
    expect(result.files).toEqual([
      { fileName: 'Compact.tokens.json', modeName: 'Compact' },
      { fileName: 'Dark.tokens.json', modeName: 'Dark' },
      { fileName: 'Light.tokens.json', modeName: 'Light' },
    ])
    expect(result.css).toContain(':root {')
    expect(result.css).toContain('  --Base-Gray-0: #f9fafb;')
    expect(result.css).toContain('.dark {')
    expect(result.css).toContain('  --Base-Gray-0: #101012;')
    expect(result.css).toContain('.compact {')
    expect(result.css).toContain('  --Base-Gray-0: #d4d4d8;')
  })

  it('falls back to Main as the primary mode when Light is missing', () => {
    const zip = zipSync({
      'theme/Main.tokens.json': strToU8(
        JSON.stringify({ Color: { Primary: { $type: 'color', $value: '#fff' } } }),
      ),
      'theme/Dark.tokens.json': strToU8(
        JSON.stringify({ Color: { Primary: { $type: 'color', $value: '#000' } } }),
      ),
      'theme/Brand Night.tokens.json': strToU8(
        JSON.stringify({ Color: { Primary: { $type: 'color', $value: '#222' } } }),
      ),
    })

    const result = tokensZipToCss(zip)

    expect(result.primaryModeName).toBe('Main')
    expect(result.files).toEqual([
      { fileName: 'theme/Brand Night.tokens.json', modeName: 'Brand Night' },
      { fileName: 'theme/Dark.tokens.json', modeName: 'Dark' },
      { fileName: 'theme/Main.tokens.json', modeName: 'Main' },
    ])
    expect(result.css).toContain('  --Color-Primary: #fff;')
    expect(result.css).toContain('.dark {')
    expect(result.css).toContain('.brand-night {')
  })
})
