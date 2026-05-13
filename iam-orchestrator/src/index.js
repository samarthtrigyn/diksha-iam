import app from './app.js';
import { initRedis } from './stores/redis.js';
import {
  PORT, KEYCLOAK_URL, KEYCLOAK_PUBLIC_URL,
  IAM_SERVICE_URL, USE_MOCK_OTP, MOCK_OTP_CODE,
  KC_ADMIN_CLIENT_ID, REDIS_URL
} from './config/index.js';

initRedis().then(() => {
  app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`IAM Orchestrator  http://0.0.0.0:${PORT}`);
    console.log(`Keycloak (int):   ${KEYCLOAK_URL}  (pub): ${KEYCLOAK_PUBLIC_URL}`);
    console.log(`IAM Service:      ${IAM_SERVICE_URL}`);
    console.log(`OTP mode:         ${USE_MOCK_OTP ? `MOCK (code: ${MOCK_OTP_CODE})` : 'REAL'}`);
    console.log(`Admin client:     ${KC_ADMIN_CLIENT_ID} (client_credentials)`);
    console.log(`Redis:            ${REDIS_URL}`);
    console.log(`${'='.repeat(60)}\n`);
  });
}).catch((err) => {
  console.error('[STARTUP] Failed to initialize Redis:', err.message);
  process.exit(1);
});
