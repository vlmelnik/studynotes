'use strict';
// The Google OAuth client StudyNotes signs in with (Drive sync).
// The real values are not in the public source code: they live in
// google-client.local.js (not committed) or come from the environment when
// the installer is built. A build without them can still sync with your own
// client: Settings → Google Drive → Advanced.
let local = {};
try { local = require('./google-client.local.js'); } catch { /* not present in the public source */ }

module.exports = {
  clientId: local.clientId || process.env.STUDYNOTES_GOOGLE_CLIENT_ID || '',
  clientSecret: local.clientSecret || process.env.STUDYNOTES_GOOGLE_CLIENT_SECRET || '',
};
