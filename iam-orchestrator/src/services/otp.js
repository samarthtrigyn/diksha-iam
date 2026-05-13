import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { IAM_SERVICE_URL, USE_MOCK_OTP, MOCK_OTP_CODE } from '../config/index.js';
import { isEmail, maskIdentifier } from '../utils/helpers.js';

// ──────────────────────────────────────────────────────────────────────────────
// Mock OTP Service
// ──────────────────────────────────────────────────────────────────────────────
const mockOtpService = {
  send: async (id) => {
    const txnId = uuidv4();
    console.log(`[MOCK-OTP] Sent OTP ${MOCK_OTP_CODE} to ${maskIdentifier(id)}, txnId: ${txnId}`);
    return {
      data: {
        result: {
          txnId,
          response: 'SUCCESS'
        }
      }
    };
  },
  generate: async (id) => {
    console.log(`[MOCK-OTP] Generated OTP ${MOCK_OTP_CODE} for ${maskIdentifier(id)}`);
    return { data: { params: { status: 'SUCCESS' }, result: { response: 'SUCCESS' } } };
  },
  verify: async (id, otp) => {
    if (otp === MOCK_OTP_CODE) {
      console.log(`[MOCK-OTP] Verified OTP for ${maskIdentifier(id)}`);
      return { data: { params: { status: 'SUCCESS' }, result: { response: 'SUCCESS' } } };
    }
    const err = new Error('OTP verification failed');
    err.response = {
      status: 400,
      data: {
        params: {
          err: 'OTP_VERIFICATION_FAILED', status: 'OTP_VERIFICATION_FAILED',
          errmsg: 'OTP verification failed. Remaining attempt count is 1.'
        },
        result: { remainingAttempt: 1, maxAllowedAttempt: 2 }
      }
    };
    throw err;
  }
};

/**
 * Send an OTP to the given identifier (uses mock or real service based on config).
 */
export async function sendOtp(identifier) {
  if (USE_MOCK_OTP) {
    return mockOtpService.send(identifier);
  }
  return axios.post(
    `${IAM_SERVICE_URL}/otp/send`,
    { request: { key: identifier, type: isEmail(identifier) ? 'email' : 'phone' } },
    { timeout: 5000 }
  );
}

/**
 * Verify an OTP for the given identifier (uses mock or real service based on config).
 */
export async function verifyOtp(identifier, otp) {
  if (USE_MOCK_OTP) {
    return mockOtpService.verify(identifier, otp);
  }
  return axios.post(
    `${IAM_SERVICE_URL}/otp/verify`,
    { request: { key: identifier, type: isEmail(identifier) ? 'email' : 'phone', otp } },
    { timeout: 10000 }
  );
}
