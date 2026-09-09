// QuoteIQ's public docs don't publish an exact webhook payload schema, so instead of
// hard-coding field names that might be wrong, we try a list of likely candidates
// (case-insensitive) and fall back gracefully. Once you see a real payload in
// webhook_log, tell Claude the actual field names and this list can be tightened.

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

// Some QuoteIQ payloads may nest the actual record under "data", "estimate", "schedule", etc.
function unwrap(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  for (const key of ['data', 'estimate', 'schedule', 'record', 'payload']) {
    if (payload[key] && typeof payload[key] === 'object') return payload[key];
  }
  return payload;
}

function extractEstimate(rawPayload) {
  const p = unwrap(rawPayload);
  return {
    external_id: pick(p, ['id', 'estimateId', 'estimate_id', 'uuid', '_id']),
    customer_name: pick(p, ['customerName', 'customer_name', 'clientName', 'name', 'contactName']),
    customer_email: pick(p, ['customerEmail', 'customer_email', 'email']),
    customer_phone: pick(p, ['customerPhone', 'customer_phone', 'phone']),
    address: pick(p, ['address', 'jobAddress', 'job_address', 'propertyAddress']),
    amount: pick(p, ['amount', 'total', 'totalAmount', 'total_amount', 'price', 'quoteTotal']),
    status: pick(p, ['status', 'estimateStatus', 'state']),
    job_type: pick(p, ['jobType', 'job_type', 'service', 'serviceType']),
    quote_date: pick(p, ['date', 'quoteDate', 'createdAt', 'created_at', 'dateCreated']),
  };
}

function extractSchedule(rawPayload) {
  const p = unwrap(rawPayload);
  return {
    external_id: pick(p, ['id', 'scheduleId', 'schedule_id', 'eventId', 'uuid', '_id']),
    customer_name: pick(p, ['customerName', 'customer_name', 'clientName', 'name', 'contactName']),
    job_type: pick(p, ['jobType', 'job_type', 'service', 'serviceType', 'title']),
    status: pick(p, ['status', 'scheduleStatus', 'state']),
    start_time: pick(p, ['startTime', 'start_time', 'start', 'startDate', 'scheduledAt']),
    end_time: pick(p, ['endTime', 'end_time', 'end', 'endDate']),
  };
}

module.exports = { pick, unwrap, extractEstimate, extractSchedule };
