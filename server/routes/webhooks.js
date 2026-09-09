const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { extractEstimate, extractSchedule } = require('../lib/extract');

const router = express.Router();

function secretMatches(req) {
  const expected = process.env.QUOTEIQ_WEBHOOK_SECRET;
  if (!expected || expected === 'change-me') return false;

  const provided =
    req.get('x-quoteiq-secret') ||
    req.get('x-webhook-secret') ||
    req.get('x-quoteiq-signature') ||
    req.query.secret ||
    '';

  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.post('/quoteiq', express.json({ limit: '2mb' }), async (req, res) => {
  if (!secretMatches(req)) {
    console.warn('[webhook] rejected: missing/invalid shared secret');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const payload = req.body || {};
  const eventType =
    payload.event || payload.eventType || payload.type || req.query.event || 'unknown';

  try {
    await pool.query(
      'INSERT INTO webhook_log (event_type, payload) VALUES ($1, $2)',
      [String(eventType), payload]
    );

    const et = String(eventType).toLowerCase();

    if (et.includes('estimate')) {
      const e = extractEstimate(payload);
      const deleted = et.includes('delete');
      if (e.external_id) {
        await pool.query(
          `INSERT INTO estimates
             (external_id, customer_name, customer_email, customer_phone, address, amount, status, job_type, quote_date, source, deleted, raw, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'webhook',$10,$11, now())
           ON CONFLICT (external_id) DO UPDATE SET
             customer_name = COALESCE(EXCLUDED.customer_name, estimates.customer_name),
             customer_email = COALESCE(EXCLUDED.customer_email, estimates.customer_email),
             customer_phone = COALESCE(EXCLUDED.customer_phone, estimates.customer_phone),
             address = COALESCE(EXCLUDED.address, estimates.address),
             amount = COALESCE(EXCLUDED.amount, estimates.amount),
             status = COALESCE(EXCLUDED.status, estimates.status),
             job_type = COALESCE(EXCLUDED.job_type, estimates.job_type),
             quote_date = COALESCE(EXCLUDED.quote_date, estimates.quote_date),
             deleted = EXCLUDED.deleted,
             raw = EXCLUDED.raw,
             updated_at = now()`,
          [
            e.external_id,
            e.customer_name || null,
            e.customer_email || null,
            e.customer_phone || null,
            e.address || null,
            e.amount || null,
            e.status || null,
            e.job_type || null,
            e.quote_date || null,
            deleted,
            payload,
          ]
        );
      } else {
        console.warn('[webhook] estimate event had no recognizable id; logged raw only');
      }
    } else if (et.includes('schedule')) {
      const s = extractSchedule(payload);
      const deleted = et.includes('delete');
      if (s.external_id) {
        await pool.query(
          `INSERT INTO schedule_events
             (external_id, customer_name, job_type, status, start_time, end_time, source, deleted, raw, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'webhook',$7,$8, now())
           ON CONFLICT (external_id) DO UPDATE SET
             customer_name = COALESCE(EXCLUDED.customer_name, schedule_events.customer_name),
             job_type = COALESCE(EXCLUDED.job_type, schedule_events.job_type),
             status = COALESCE(EXCLUDED.status, schedule_events.status),
             start_time = COALESCE(EXCLUDED.start_time, schedule_events.start_time),
             end_time = COALESCE(EXCLUDED.end_time, schedule_events.end_time),
             deleted = EXCLUDED.deleted,
             raw = EXCLUDED.raw,
             updated_at = now()`,
          [
            s.external_id,
            s.customer_name || null,
            s.job_type || null,
            s.status || null,
            s.start_time || null,
            s.end_time || null,
            deleted,
            payload,
          ]
        );
      } else {
        console.warn('[webhook] schedule event had no recognizable id; logged raw only');
      }
    } else {
      console.warn(`[webhook] unrecognized event type "${eventType}"; logged raw only`);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook] error handling event', err);
    res.status(500).json({ error: 'internal error' });
  }
});

module.exports = router;
