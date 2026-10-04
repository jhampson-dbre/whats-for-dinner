import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const [address, appUrl] = process.argv.slice(2)
const email = address?.trim().toLowerCase()
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !appUrl || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/invite-creator.mjs email@example.com https://app.example.com/')
  process.exit(1)
}
const link = new URL(appUrl)
if (link.protocol !== 'https:' || link.username || link.password) throw new Error('Use an HTTPS app URL')
const token = randomBytes(32).toString('base64url')
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { error } = await db.from('household_invitations').insert({
  token_hash: createHash('sha256').update(token).digest('hex'), email, role: 'creator', expires_at: expiresAt,
})
if (error) throw error
link.hash = new URLSearchParams({ invite: token }).toString()
console.log(`Expires ${expiresAt}\n${link}`)
