import { inflateSync, strFromU8 } from 'fflate'
import { z } from 'zod'

const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_ENTRIES = 1000
const MAX_HTML_BYTES = 5 * 1024 * 1024
const MAX_RECORDS = 1000
const bounded = (max: number) => z.string().min(1).max(max)
const list = z.array(bounded(2048)).max(500).superRefine((items, context) => {
  if (items.reduce((total, item) => total + item.length, 0) > 128 * 1024) context.addIssue({ code: 'custom', message: 'too large' })
})

export const recipeKeeperCandidateSchema = z.object({
  externalId: bounded(1024), title: bounded(1024), source: bounded(1024).optional(), category: bounded(1024).optional(),
  prepMinutes: z.number().int().min(0).max(10_080).optional(), cookMinutes: z.number().int().min(0).max(10_080).optional(), yield: bounded(1024).optional(),
  ingredients: list.optional(), instructions: list.optional(),
}).strict()
export type RecipeKeeperCandidate = z.infer<typeof recipeKeeperCandidateSchema>

type Entry = { name: string; flags: number; method: number; compressedSize: number; size: number; localOffset: number }
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const u16 = (data: DataView, offset: number) => data.getUint16(offset, true)
const u32 = (data: DataView, offset: number) => data.getUint32(offset, true)
const ZIP64 = 0xffffffff
const zip64Sizes = (data: DataView, offset: number, length: number, size: number, compressedSize: number) => {
  if (size !== ZIP64 && compressedSize !== ZIP64) return { size, compressedSize }
  const end = offset + length; let cursor = offset
  while (cursor + 4 <= end) {
    const id = u16(data, cursor); const fieldLength = u16(data, cursor + 2); cursor += 4
    if (cursor + fieldLength > end) break
    if (id === 1) {
      let valueOffset = cursor
      const read = () => {
        if (valueOffset + 8 > cursor + fieldLength) throw new Error('The ZIP archive has malformed ZIP64 sizes.')
        const value = Number(data.getBigUint64(valueOffset, true)); valueOffset += 8
        if (!Number.isSafeInteger(value)) throw new Error('The ZIP archive has unsupported ZIP64 sizes.')
        return value
      }
      return { size: size === ZIP64 ? read() : size, compressedSize: compressedSize === ZIP64 ? read() : compressedSize }
    }
    cursor += fieldLength
  }
  throw new Error('The ZIP archive has malformed ZIP64 sizes.')
}
const value = (record: Element, selector: string) => {
  const item = record.querySelector(selector)
  return (item?.getAttribute('content') ?? item?.textContent ?? '').trim()
}
const values = (record: Element, selector: string) => Array.from(record.querySelectorAll(selector)).map((item) => (item.textContent ?? '').trim()).filter(Boolean)
const duration = (raw: string) => {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(raw.trim())
  return match ? Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) + Math.floor(Number(match[3] ?? 0) / 60) : /^\d+$/.test(raw.trim()) ? Number(raw) : undefined
}
const validName = (name: string) => name.length <= 255 && !/^(?:[A-Za-z]:|\/)|\\/.test(name) && !name.split('/').some((segment) => segment === '.' || segment === '..')

function entries(bytes: Uint8Array): Entry[] {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || (bytes[2] !== 3 && bytes[2] !== 5 && bytes[2] !== 7) || bytes[3] !== 4) throw new Error('Select a valid ZIP file.')
  const data = view(bytes)
  let end = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index--) if (u32(data, index) === 0x06054b50) { end = index; break }
  if (end < 0) throw new Error('The ZIP archive is malformed.')
  const count = u16(data, end + 10); const directorySize = u32(data, end + 12); let offset = u32(data, end + 16)
  if (count === 0xffff || directorySize === ZIP64 || offset === ZIP64 || count > MAX_ENTRIES || offset + directorySize > end) throw new Error('The ZIP archive is unsupported or has too many entries.')
  const output: Entry[] = []
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || u32(data, offset) !== 0x02014b50) throw new Error('The ZIP archive is malformed.')
    const flags = u16(data, offset + 8); const method = u16(data, offset + 10); const rawCompressedSize = u32(data, offset + 20); const rawSize = u32(data, offset + 24); const nameLength = u16(data, offset + 28); const extraLength = u16(data, offset + 30); const commentLength = u16(data, offset + 32); const localOffset = u32(data, offset + 42)
    if (flags & 0x41 || method !== 0 && method !== 8 || localOffset === ZIP64 || nameLength > 255 || offset + 46 + nameLength + extraLength + commentLength > bytes.length) throw new Error('The ZIP archive contains unsupported entries.')
    const { size, compressedSize } = zip64Sizes(data, offset + 46 + nameLength, extraLength, rawSize, rawCompressedSize)
    if (compressedSize > MAX_FILE_BYTES) throw new Error('The ZIP archive contains unsupported entries.')
    const name = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (!validName(name)) throw new Error('The ZIP archive contains an unsafe path.')
    output.push({ name, flags, method, compressedSize, size, localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return output
}

function extractHtml(bytes: Uint8Array, entry: Entry): string {
  const data = view(bytes); const offset = entry.localOffset
  if (offset + 30 > bytes.length || u32(data, offset) !== 0x04034b50) throw new Error('The ZIP archive is malformed.')
  const flags = u16(data, offset + 6); const method = u16(data, offset + 8); const rawCompressedSize = u32(data, offset + 18); const rawSize = u32(data, offset + 22); const nameLength = u16(data, offset + 26); const extraLength = u16(data, offset + 28)
  if (flags !== entry.flags || flags & 0x41 || method !== entry.method || nameLength > 255 || offset + 30 + nameLength + extraLength > bytes.length || strFromU8(bytes.subarray(offset + 30, offset + 30 + nameLength)) !== entry.name) throw new Error('The ZIP archive is malformed.')
  const { size, compressedSize } = zip64Sizes(data, offset + 30 + nameLength, extraLength, rawSize, rawCompressedSize)
  if (compressedSize > MAX_FILE_BYTES || (!(flags & 8) && (compressedSize !== entry.compressedSize || size !== entry.size))) throw new Error('The ZIP archive is malformed.')
  const start = offset + 30 + nameLength + extraLength
  if (start + entry.compressedSize > bytes.length) throw new Error('The ZIP archive is malformed.')
  if (entry.size > MAX_HTML_BYTES || entry.method === 0 && entry.compressedSize > MAX_HTML_BYTES) throw new Error('recipes.html exceeds 5 MiB.')
  const compressed = bytes.subarray(start, start + entry.compressedSize)
  const decoded = entry.method === 0 ? compressed : inflateSync(compressed, { out: new Uint8Array(entry.size + 1) })
  if (decoded.length !== entry.size || decoded.length > MAX_HTML_BYTES) throw new Error('recipes.html exceeds 5 MiB.')
  return strFromU8(decoded)
}

export async function readRecipeKeeperZip(bytes: Uint8Array): Promise<{ candidates: RecipeKeeperCandidate[]; skipped: number }> {
  if (bytes.length > MAX_FILE_BYTES) throw new Error('The ZIP file exceeds 32 MiB.')
  const archive = entries(bytes)
  const documents = archive.filter((entry) => entry.name === 'recipes.html')
  if (documents.length !== 1) throw new Error('The ZIP must contain exactly one root recipes.html.')
  const document = new DOMParser().parseFromString(extractHtml(bytes, documents[0]), 'text/html')
  const seen = new Set<string>(); const candidates: RecipeKeeperCandidate[] = []; let skipped = 0
  const records = document.querySelectorAll('.recipe-details')
  if (records.length > MAX_RECORDS) throw new Error('recipes.html has too many recipes.')
  records.forEach((record) => {
    const externalId = value(record, '[itemprop="recipeId"], [data-recipe-id]')
    const title = value(record, '[itemprop="name"], .recipeName')
    const category = [value(record, '[itemprop="recipeCourse"], .recipeCourse'), ...Array.from(record.querySelectorAll('[itemprop="recipeCategory"], .recipeCategory')).map((item) => (item.getAttribute('content') ?? item.textContent ?? '').trim()).filter(Boolean)].filter(Boolean).join(' / ')
    const candidate = { externalId, title, source: value(record, '[itemprop="recipeSource"], .recipeSource') || undefined, category: category || undefined, prepMinutes: duration(value(record, '[itemprop="prepTime"], .prepTime')), cookMinutes: duration(value(record, '[itemprop="cookTime"], .cookTime')), yield: value(record, '[itemprop="recipeYield"], .recipeYield') || undefined, ingredients: values(record, '[itemprop="recipeIngredients"] p, .recipeIngredients p') || undefined, instructions: values(record, '[itemprop="recipeDirections"] p, .recipeDirections p') || undefined }
    if (!externalId || seen.has(externalId) || !recipeKeeperCandidateSchema.safeParse(candidate).success) { skipped++; return }
    seen.add(externalId); candidates.push(candidate)
  })
  if (!candidates.length) throw new Error('No valid recipes were found.')
  return { candidates, skipped }
}
