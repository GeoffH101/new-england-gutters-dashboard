const express = require('express');
const { pool } = require('../db');

const router = express.Router();
router.use(express.json({ limit: '5mb' }));

// ---- Summary KPIs -------------------------------------------------------

router.get('/summary', async (req, res) => {
  try {
    const [pipeline, revenue, upcoming, recentLog] = await Promise.all([
      pool.query(`
        SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float AS total
        FROM estimates
        WHERE deleted = false
        GROUP BY status
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE status ILIKE 'accept%' OR status ILIKE 'won%'), 0)::float AS won_revenue,
          COALESCE(SUM(amount), 0)::float AS pipeline_value,
          COALESCE(AVG(amount), 0)::float AS avg_job_value,
          COUNT(*)::int AS total_estimates
        FROM estimates
        WHERE deleted = false
      `),
      pool.query(`
        SELECT id, external_id, customer_name, job_type, status, start_time, end_time
        FROM schedule_events
        WHERE deleted = false AND start_time IS NOT NULL AND start_time >= now() - interval '1 day'
        ORDER BY start_time ASC
        LIMIT 25
      `),
      pool.query(`SELECT event_type, received_at FROM webhook_log ORDER BY received_at DESC LIMIT 1`),
    ]);

    res.json({
      pipeline: pipeline.rows,
      revenue: revenue.rows[0],
      upcoming_schedule: upcoming.rows,
      last_webhook_received_at: recentLog.rows[0] ? recentLog.rows[0].received_at : null,
    });
  } catch (err) {
    console.error('[api] /summary error', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// ---- Monthly revenue trend ----------------------------------------------

router.get('/revenue-trend', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT to_char(date_trunc('month', COALESCE(quote_date, created_at)), 'YYYY-MM') AS month,
             COALESCE(SUM(amount) FILTER (WHERE status ILIKE 'accept%' OR status ILIKE 'won%'), 0)::float AS won_revenue,
             COALESCE(SUM(amount), 0)::float AS pipeline_value
      FROM estimates
      WHERE deleted = false
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 24
    `);
    res.json(rows);
  } catch (err) {
    console.error('[api] /revenue-trend error', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// ---- Lists ---------------------------------------------------------------

router.get('/estimates', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, external_id, customer_name, customer_email, customer_phone, address,
             amount, status, job_type, quote_date, source, updated_at
      FROM estimates
      WHERE deleted = false
      ORDER BY COALESCE(quote_date, updated_at) DESC
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    console.error('[api] /estimates error', err);
    res.status(500).json({ error: 'internal error' });
  }
});

router.get('/schedule', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, external_id, customer_name, job_type, status, start_time, end_time, source, updated_at
      FROM schedule_events
      WHERE deleted = false
      ORDER BY start_time DESC NULLS LAST
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    console.error('[api] /schedule error', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// ---- CSV backfill import --------------------------------------------------
// The browser parses the CSV and maps columns to our field names (see public/admin.html),
// then posts normalized rows here so the backend never has to guess QuoteIQ's export format.

router.post('/import/estimates', async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'no rows provided' });

  let inserted = 0;
  let skipped = 0;
  try {
    for (const r of rows) {
      const externalId = r.external_id || `csv-${Buffer.from(
        `${r.customer_name || ''}|${r.amount || ''}|${r.quote_date || ''}`
      ).toString('base64').slice(0, 24)}`;

      await pool.query(
        `INSERT INTO estimates
           (external_id, customer_name, customer_email, customer_phone, address, amount, status, job_type, quote_date, source, raw, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'csv_import',$10, now())
         ON CONFLICT (external_id) DO UPDATE SET
           customer_name = COALESCE(EXCLUDED.customer_name, estimates.customer_name),
           amount = COALESCE(EXCLUDED.amount, estimates.amount),
           status = COALESCE(EXCLUDED.status, estimates.status),
           updated_at = now()`,
        [
          externalId,
          r.customer_name || null,
          r.customer_email || null,
          r.customer_phone || null,
          r.address || null,
          r.amount ? Number(String(r.amount).replace(/[^0-9.-]/g, '')) : null,
          r.status || null,
          r.job_type || null,
          r.quote_date || null,
          r,
        ]
      );
      inserted += 1;
    }
    res.json({ inserted, skipped });
  } catch (err) {
    console.error('[api] /import/estimates error', err);
    res.status(500).json({ error: 'internal error', inserted, skipped });
  }
});

router.post('/import/schedule', async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'no rows provided' });

  let inserted = 0;
  try {
    for (const r of rows) {
      const externalId = r.external_id || `csv-${Buffer.from(
        `${r.customer_name || ''}|${r.start_time || ''}`
      ).toString('base64').slice(0, 24)}`;

      await pool.query(
        `INSERT INTO schedule_events
           (external_id, customer_name, job_type, status, start_time, end_time, source, raw, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'csv_import',$7, now())
         ON CONFLICT (external_id) DO UPDATE SET
           customer_name = COALESCE(EXCLUDED.customer_name, schedule_events.customer_name),
           status = COALESCE(EXCLUDED.status, schedule_events.status),
           start_time = COALESCE(EXCLUDED.start_time, schedule_events.start_time),
           end_time = COALESCE(EXCLUDED.end_time, schedule_events.end_time),
           updated_at = now()`,
        [
          externalId,
          r.customer_name || null,
          r.job_type || null,
          r.status || null,
          r.start_time || null,
          r.end_time || null,
          r,
        ]
      );
      inserted += 1;
    }
    res.json({ inserted });
  } catch (err) {
    console.error('[api] /import/schedule error', err);
    res.status(500).json({ error: 'internal error', inserted });
  }
});

module.exports = router;
