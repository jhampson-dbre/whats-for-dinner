import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import fixture from './recipeKeeper.fixture.html?raw'
import { readRecipeKeeperZip } from './recipeKeeper'

const zip = (files: Record<string, Uint8Array | string>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])))
const centralOffset = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 6, true)
const duplicateRecipesDocument = () => {
  const original = zip({ 'recipes.html': fixture }); const offset = centralOffset(original); const record = original.slice(offset, original.length - 22); const output = new Uint8Array(original.length + record.length)
  output.set(original.slice(0, original.length - 22)); output.set(record, original.length - 22); output.set(original.slice(original.length - 22), original.length - 22 + record.length)
  const data = new DataView(output.buffer); const end = output.length - 22
  data.setUint16(end + 8, 2, true); data.setUint16(end + 10, 2, true); data.setUint32(end + 12, record.length * 2, true)
  return output
}

describe('Recipe Keeper ZIP boundary', () => {
  it('reads only normalized recipe candidates from the root recipes document', async () => {
    await expect(readRecipeKeeperZip(zip({ 'recipes.html': fixture, 'images/photo.jpg': 'not opened' }))).resolves.toMatchObject({
      skipped: 0,
      candidates: [{ externalId: 'rk-1', title: 'Weeknight Soup', source: 'Family notes', category: 'Dinner / Soup', prepMinutes: 10, cookMinutes: 20, yield: '4 bowls', ingredients: ['1 onion', 'Broth'], instructions: ['Cook onion.', 'Add broth.'] }],
    })
  })

  it.each([
    ['invalid signature', new Uint8Array([1, 2, 3]), /ZIP/],
    ['missing recipes document', zip({ 'other.html': fixture }), /recipes.html/],
    ['missing root recipes document', zip({ 'other.html': fixture }), /recipes.html/],
    ['dot-segment entry beside the root document', zip({ 'recipes.html': fixture, '../other.txt': 'x' }), /unsafe path/],
    ['duplicate recipes document', duplicateRecipesDocument(), /exactly one/],
  ])('rejects %s before candidates are returned', async (_name, bytes, message) => {
    await expect(readRecipeKeeperZip(bytes)).rejects.toThrow(message)
  })

  it('skips malformed, unnamed, and duplicate external records', async () => {
    const html = fixture.replace('</body>', '<article class="recipe-details" data-recipe-id="rk-1"><h1 class="recipeName">Duplicate</h1></article><article class="recipe-details"><h1 class="recipeName">No ID</h1></article><article class="recipe-details" data-recipe-id="rk-2"></article></body>')
    await expect(readRecipeKeeperZip(zip({ 'recipes.html': html }))).resolves.toMatchObject({ skipped: 3, candidates: [{ externalId: 'rk-1' }] })
  })

  it('rejects decoded oversized and invalid bounded records', async () => {
    await expect(readRecipeKeeperZip(zip({ 'recipes.html': 'x'.repeat(5 * 1024 * 1024 + 1) }))).rejects.toThrow(/5 MiB/)
    const html = fixture.replace('Weeknight Soup', 'x'.repeat(1025))
    await expect(readRecipeKeeperZip(zip({ 'recipes.html': html }))).rejects.toThrow(/valid recipes/)
  })

  it('rejects file, entry, encryption, and unsupported compression limits', async () => {
    await expect(readRecipeKeeperZip(new Uint8Array(32 * 1024 * 1024 + 1))).rejects.toThrow(/32 MiB/)
    await expect(readRecipeKeeperZip(zip(Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`${index}.txt`, 'x']))))).rejects.toThrow(/too many/)
    for (const mutation of ['encrypted', 'compressed'] as const) {
      const bytes = zip({ 'recipes.html': fixture }); const offset = centralOffset(bytes); const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      if (mutation === 'encrypted') data.setUint16(offset + 8, 1, true)
      else data.setUint16(offset + 10, 12, true)
      await expect(readRecipeKeeperZip(bytes)).rejects.toThrow(/unsupported/)
    }
  })

  it('rejects a local header that disagrees with its inspected central entry', async () => {
    const bytes = zip({ 'recipes.html': fixture }); const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    data.setUint16(6, 1, true)
    await expect(readRecipeKeeperZip(bytes)).rejects.toThrow(/malformed/)
  })
})
