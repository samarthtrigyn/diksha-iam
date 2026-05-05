#!/bin/bash

# Full E2E test of DIKSHA IAM OTP → Password → OAuth flow

set -e

API_BASE="http://localhost:4000"
IDENTIFIER="samarth.nigam@trigyn.com"
OTP="123456"
PASSWORD="SecurePass123!"
CODE_CHALLENGE="YB85UUUObLl5k1eH5JnXo_3V2aQrqpX7wUNL8Tq1sEE"

echo "=== DIKSHA IAM E2E Test ==="
echo ""

# 1. Delete user if exists
echo "1️⃣  Cleaning up existing user..."
TOKEN=$(curl -s -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=admin_password" \
  -d "grant_type=password" | jq -r '.access_token')

USER_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/admin/realms/diksha-demo/users?username=$IDENTIFIER" | jq -r '.[0].id // empty')

if [ ! -z "$USER_ID" ]; then
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
    "http://localhost:8080/admin/realms/diksha-demo/users/$USER_ID"
  echo "   ✓ User deleted"
else
  echo "   ✓ No existing user"
fi
echo ""

# 2. Login Start
echo "2️⃣  Initiating login..."
LOGIN_RESPONSE=$(curl -s -X POST $API_BASE/iam/login/start \
  -H "Content-Type: application/json" \
  -d "{\"identifier\": \"$IDENTIFIER\"}")

TXN_ID=$(echo $LOGIN_RESPONSE | jq -r '.txnId')
NEXT_ACTION=$(echo $LOGIN_RESPONSE | jq -r '.nextAction')

if [ "$NEXT_ACTION" != "VERIFY_OTP" ]; then
  echo "   ❌ Expected VERIFY_OTP, got $NEXT_ACTION"
  exit 1
fi
echo "   ✓ OTP requested (txnId: $TXN_ID)"
echo ""

# 3. OTP Verification
echo "3️⃣  Verifying OTP..."
OTP_RESPONSE=$(curl -s -X POST $API_BASE/iam/activation/verify-otp \
  -H "Content-Type: application/json" \
  -d "{
    \"txnId\": \"$TXN_ID\",
    \"identifier\": \"$IDENTIFIER\",
    \"otp\": \"$OTP\",
    \"codeChallenge\": \"$CODE_CHALLENGE\"
  }")

NEXT_ACTION=$(echo $OTP_RESPONSE | jq -r '.nextAction')
SETUP_TOKEN=$(echo $OTP_RESPONSE | jq -r '.setupToken // empty')

if [ "$NEXT_ACTION" != "SET_PASSWORD" ]; then
  echo "   ❌ Expected SET_PASSWORD, got $NEXT_ACTION"
  exit 1
fi
echo "   ✓ OTP verified (setupToken: $SETUP_TOKEN)"
echo ""

# 4. Set Password
echo "4️⃣  Setting password..."
PASSWORD_RESPONSE=$(curl -s -X POST $API_BASE/auth/set-password \
  -H "Content-Type: application/json" \
  -d "{
    \"setupToken\": \"$SETUP_TOKEN\",
    \"password\": \"$PASSWORD\",
    \"codeChallenge\": \"$CODE_CHALLENGE\"
  }")

NEXT_ACTION=$(echo $PASSWORD_RESPONSE | jq -r '.nextAction')
AUTH_URL=$(echo $PASSWORD_RESPONSE | jq -r '.authUrl // empty')

if [ "$NEXT_ACTION" != "KEYCLOAK_LOGIN" ]; then
  echo "   ❌ Expected KEYCLOAK_LOGIN, got $NEXT_ACTION"
  exit 1
fi
echo "   ✓ Password set successfully"
echo ""

# 5. Verify User in Keycloak
echo "5️⃣  Verifying user in Keycloak..."
KEYCLOAK_USER=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/admin/realms/diksha-demo/users?username=$IDENTIFIER" | \
  jq '.[0] | {username, enabled, requiredActions}')

echo "   $KEYCLOAK_USER" | jq .

USER_ENABLED=$(echo $KEYCLOAK_USER | jq -r '.enabled')
REQUIRED_ACTIONS=$(echo $KEYCLOAK_USER | jq -r '.requiredActions | length')

if [ "$USER_ENABLED" != "true" ]; then
  echo "   ❌ User not enabled"
  exit 1
fi

if [ "$REQUIRED_ACTIONS" != "0" ]; then
  echo "   ❌ User still has required actions"
  exit 1
fi

echo "   ✓ User created with password set"
echo ""

# 6. Verify OAuth URL
echo "6️⃣  Verifying OAuth auth URL..."
if [[ $AUTH_URL == *"client_id=diksha-portal"* ]]; then
  echo "   ✓ Auth URL contains correct client_id"
else
  echo "   ❌ Auth URL missing client_id"
  exit 1
fi

if [[ $AUTH_URL == *"login_hint="* ]]; then
  echo "   ✓ Auth URL contains login_hint"
else
  echo "   ❌ Auth URL missing login_hint"
  exit 1
fi

echo ""
echo "=== ✅ ALL TESTS PASSED ==="
echo ""
echo "User can now:"
echo "  1. Click the auth URL to go to Keycloak"
echo "  2. Log in with email: $IDENTIFIER"
echo "  3. Password: $PASSWORD"
echo "  4. Receive authorization code"
echo "  5. Exchange for JWT token"
