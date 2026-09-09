require('dotenv').config();
const path = require('path');
const express = require('express');
const basicAuth = require('express-basic-auth');

const { initSchema } = require('./db');
const webhookRoutes = require('./routes/webhooks');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Webhooks are authenticated by QuoteIQ's shared secret (checked inside the route),
// not basic auth -- QuoteIQ's servers can't fill in a username/password prompt.
app.use('/webhooks', webhookRoutes);

// Everything else (the dashboard UI + its data API) is behind basic auth so the
// site isn't a fully public page once it's live on a Railway URL.
const authUser = process.env.DASHBOARD_USER;
const authPass = process.env.DASHBOARD_PASSWORD;
if (authUser && authPass && authPass !== 'change-me') {
  app.use(
    basicAuth({
      users: { [authUser]: authPass },
      challenge: true,
      realm: 'New England Gutters Dashboard',
    })
  );
} else {
  console.warn(
    '[server] DASHBOARD_USER/DASHBOARD_PASSWORD not set (or left as "change-me") -- ' +
      'the dashboard is running WITHOUT a login. Set them before sharing the URL.'
  );
}

app.use('/api', apiRoutes);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true }));

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`New England Gutters dashboard listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema', err);
    process.exit(1);
  });
