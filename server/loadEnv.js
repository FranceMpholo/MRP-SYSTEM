// Resolve settings from the project, regardless of the launcher's working directory.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
