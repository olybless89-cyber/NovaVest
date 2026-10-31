import crypto from 'node:crypto';
import { sql } from '../db/client.js';
import { hash } from './auth.js';

/* Boot-time defaults for a fresh database.
   - Plans and bots are only inserted when their table is completely empty,
     so plans an admin deletes or edits later are never brought back.
   - The admin account is only created when ADMIN_EMAIL doesn't exist yet;
     an existing admin's password is never overwritten here
     (use `npm run reset-admin` for that). */

const PLANS = [
  { name: 'Starter',  slug: 'starter',  roi: 0.85, hours: 24, periods: 30, min: 100,    max: 2999,    badge: null,
    features: ['Principal returned at maturity', 'Withdraw returns as they post', 'Full charting access', '24/7 support'] },
  { name: 'Standard', slug: 'standard', roi: 1.10, hours: 24, periods: 45, min: 3000,   max: 24999,   badge: 'Popular',
    features: ['Principal returned at maturity', 'Withdraw returns as they post', 'Priority withdrawals', 'Dedicated account manager'] },
  { name: 'Growth',   slug: 'growth',   roi: 1.35, hours: 24, periods: 60, min: 25000,  max: 99999,   badge: null,
    features: ['Principal returned at maturity', 'Withdraw returns as they post', 'Reduced spreads', 'Quarterly strategy review'] },
  { name: 'Private',  slug: 'private',  roi: 1.60, hours: 24, periods: 90, min: 100000, max: 1000000, badge: 'Invite',
    features: ['Principal returned at maturity', 'Custom mandate available', 'Institutional execution', 'Direct desk line'] },
];

const BOTS = [
  { slug: 'grid-btc',    name: 'Grid — BTC',               market: 'crypto',  cadence: 'grid',     risk: 5, min: 500,
    tagline: 'Places a ladder of buy and sell orders across a range and profits from oscillation.' },
  { slug: 'trend-major', name: 'Trend — FX majors',        market: 'forex',   cadence: 'swing',    risk: 4, min: 1000,
    tagline: 'Follows established daily trends on the majors, sits out chop.' },
  { slug: 'meanrev-idx', name: 'Mean reversion — indices', market: 'indices', cadence: 'intraday', risk: 6, min: 750,
    tagline: 'Fades intraday extremes on index CFDs and exits at the session average.' },
];

export async function seedDefaultPlans() {
  const [{ n }] = await sql`select count(*)::int n from plans`;
  if (n > 0) return 0;
  for (const [i, p] of PLANS.entries()) {
    await sql`
      insert into plans (name, slug, badge, roi_percent, period_hours, duration_periods,
                         min_amount, max_amount, features, sort_order, active)
      values (${p.name}, ${p.slug}, ${p.badge}, ${p.roi}, ${p.hours}, ${p.periods},
              ${p.min}, ${p.max}, ${JSON.stringify(p.features)}, ${i}, true)
      on conflict (slug) do nothing`;
  }
  console.log(`[bootstrap] default plans created: ${PLANS.length}`);
  return PLANS.length;
}

export async function seedDefaultBots() {
  const [{ n }] = await sql`select count(*)::int n from bots`;
  if (n > 0) return 0;
  for (const b of BOTS) {
    await sql`
      insert into bots (slug, name, tagline, market, cadence, risk_score, min_allocation, active)
      values (${b.slug}, ${b.name}, ${b.tagline}, ${b.market}, ${b.cadence}, ${b.risk}, ${b.min}, true)
      on conflict (slug) do nothing`;
  }
  console.log(`[bootstrap] default bots created: ${BOTS.length}`);
  return BOTS.length;
}

export async function ensureAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) return false;
  const [existing] = await sql`select id from users where email = ${email}`;
  if (existing) return false;
  await sql`
    insert into users (email, password_hash, first_name, last_name, role, referral_code)
    values (${email}, ${await hash(pw)}, 'Platform', 'Admin', 'admin',
            ${crypto.randomBytes(4).toString('hex').toUpperCase()})`;
  console.log(`[bootstrap] admin created: ${email}`);
  return true;
}
