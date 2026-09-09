// Confirmed from a real QuoteIQ webhook payload (estimate.updated, captured 2026-09-09):
// {
//   "type": "estimate.updated",
//   "payload": {
//     "doc_id": "...", "customer_name", "customer_email", "customer_phone", "address",
//     "total", "sub_total", "estimate_status" (numeric code, meaning unconfirmed),
//     "accepted_at" / "declined_at" / "viewed_at" / "paid_at" (epoch ms, 0 = hasn't happened, -1 = n/a),
//     "created_at" (epoch ms), "date" / "time" (display strings),
//     "service_list": [{ "service_name", "industry", ... }],
//     ...
//   }
// }
// No schedule.* payload has been captured yet -- field names there are still best-guess
// candidates. If you see one in webhook_log, tell Claude and this file can be tightened
// the same way the estimate side was.

function pick(obj, candidates) {
  if (!obj || typeof obj !== 'object') return undefined;
  const lowerMap = {};
  for (const key of Object.keys(obj)) {
    lowerMap[key.toLowerCase()] = obj[key];
  }
  for (const candidate of candidates) {
    const v = lowerMap[candidate.toLowerCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// QuoteIQ wraps the actual record as { type: "...", payload: {...} }. Some payloads
// elsewhere might nest it under other common names, so keep those as a fallback too.
function unwrap(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  for (const key of ['payload', 'data', 'estimate', 'schedule', 'record']) {
    if (payload[key] && typeof payload[key] === 'object') return payload[key];
  }
  return payload;
}

// QuoteIQ timestamps observed as epoch milliseconds (e.g. created_at: 1788973022035).
// Also accept epoch seconds and ordinary date strings, in case other events differ.
function toDate(value) {
  if (value === undefined || value === null || value === '' || value === 0 || value === -1) {
    return undefined;
  }
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000; // seconds -> ms if it looks too small
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// QuoteIQ's numeric `estimate_status` code isn't documented, so instead of guessing what
// each number means, derive a human-readable stage from the timestamp fields, which are
// self-explanatory: 0 means "hasn't happened", anything else is a real epoch-ms timestamp.
function deriveEstimateStatus(p) {
  if (toDate(p.accepted_at)) return 'Accepted';
  if (toDate(p.declined_at)) return 'Declined';
  if (p.is_deposit_paid === true || toDate(p.paid_at)) return 'Paid';
  if (toDate(p.viewed_at)) return 'Viewed';
  if (p.estimate_status !== undefined && p.estimate_status !== null) {
    return `Status ${p.estimate_status}`; // fallback: at least show the raw code
  }
  return 'Sent';
}

function extractEstimate(rawPayload) {
  const p = unwrap(rawPayload);
  const firstService = Array.isArray(p.service_list) && p.service_list.length ? p.service_list[0] : null;

  return {
    external_id: pick(p, ['doc_id', 'id', 'estimateId', 'estimate_id', 'uuid', '_id']),
    customer_name: pick(p, ['customer_name', 'customerName', 'clientName', 'name', 'contactName']),
    customer_email: pick(p, ['customer_email', 'customerEmail', 'email']),
    customer_phone: pick(p, ['customer_phone', 'customerPhone', 'phone']),
    address: pick(p, ['address', 'jobAddress', 'job_address', 'propertyAddress']),
    amount: pick(p, ['total', 'amount', 'totalAmount', 'total_amount', 'price', 'quoteTotal']),
    status: deriveEstimateStatus(p),
    job_type: firstService
      ? (firstService.service_name || firstService.industry || null)
      : pick(p, ['jobType', 'job_type', 'service', 'serviceType']),
    quote_date: toDate(pick(p, ['created_at', 'createdAt', 'date', 'quoteDate', 'dateCreated'])),
  };
}

function extractSchedule(rawPayload) {
  const p = unwrap(rawPayload);
  return {
    external_id: pick(p, ['doc_id', 'id', 'scheduleId', 'schedule_id', 'eventId', 'uuid', '_id']),
    customer_name: pick(p, ['customer_name', 'customerName', 'clientName', 'name', 'contactName']),
    job_type: pick(p, ['jobType', 'job_type', 'service', 'serviceType', 'title']),
    status: pick(p, ['status', 'scheduleStatus', 'state']),
    start_time: toDate(pick(p, ['startTime', 'start_time', 'start', 'startDate', 'scheduledAt', 'created_at'])),
    end_time: toDate(pick(p, ['endTime', 'end_time', 'end', 'endDate'])),
  };
}

module.exports = { pick, unwrap, toDate, deriveEstimateStatus, extractEstimate, extractSchedule };
