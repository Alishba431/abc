const { waitForDb } = require('./db');
const { bootstrap } = require('./seed');
const { app } = require('./app');
const metrics = require('./metrics');

if (!process.env.DAY1_SALT) console.warn('WARNING: DAY1_SALT is not set; signatures will use an empty key.');

(async () => {
  await waitForDb();
  await bootstrap();
  const port = Number(process.env.PORT || 8080);
  const server = app.listen(port, () => console.log(`api listening on ${port}`));
  require('./realtime').attach(server);
  metrics.startSampler();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
