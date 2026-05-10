# DIKSHA IAM - Postman Collection

Complete API testing collection for the DIKSHA IAM System using Postman.

## Files

- **DIKSHA_IAM_API.postman_collection.json** - Main API collection with all requests
- **DIKSHA_IAM_Dev.postman_environment.json** - Development environment (localhost)
- **DIKSHA_IAM_Staging.postman_environment.json** - Staging environment
- **DIKSHA_IAM_Production.postman_environment.json** - Production environment

## Setup

### 1. Import Collection into Postman

1. Open Postman
2. Click **"Import"** button (top-left)
3. Select **"File"** tab
4. Choose `DIKSHA_IAM_API.postman_collection.json`
5. Click **"Import"**

### 2. Import Environment

1. Click **"Manage Environments"** (gear icon, top-right)
2. Click **"Import"**
3. Choose one of the environment files:
   - `DIKSHA_IAM_Dev.postman_environment.json` (for local testing)
   - `DIKSHA_IAM_Staging.postman_environment.json` (for staging)
   - `DIKSHA_IAM_Production.postman_environment.json` (for production)
4. Click **"Import"**

### 3. Select Environment

1. Click the environment dropdown (top-right)
2. Select the environment you imported (e.g., "DIKSHA IAM - Dev")

## Collection Structure

### Orchestrator
Central authentication orchestrator (Port 4000)
- **Health Check** - GET /health
- **Login Start** - POST /iam/login/start (Direct Grant with password)
- **Login Start - New User** - POST /iam/login/start (OTP flow without password)
- **Verify OTP** - POST /iam/activation/verify-otp
- **Auth Callback** - POST /iam/auth/callback
- **Get Current User** - GET /iam/me
- **Logout** - POST /iam/logout

### IAM Service
User management and OTP service (Port 3000)
- **Health Check** - GET /health
- **Generate OTP** - POST /otp/generate
- **Verify OTP** - POST /otp/verify
- **Create User** - POST /users
- **Get User by ID** - GET /users/:id
- **Get User by Email** - GET /users?email=...

### Keycloak
OpenID Connect provider (Port 8080)
- **Health Check** - GET /health
- **Get Admin Token** - POST /realms/{realm}/protocol/openid-connect/token
- **List Realms** - GET /admin/realms
- **List Users in Realm** - GET /admin/realms/{realm}/users
- **Get User by Username** - GET /admin/realms/{realm}/users?username=...
- **List Clients** - GET /admin/realms/{realm}/clients
- **Get User Info** - GET /realms/{realm}/protocol/openid-connect/userinfo

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `orchestrator_url` | IAM Orchestrator base URL |
| `iam_service_url` | IAM Service base URL |
| `keycloak_url` | Keycloak base URL |
| `keycloak_realm` | Keycloak realm name |
| `keycloak_client_id` | Keycloak client ID |
| `test_email` | Test user email |
| `test_password` | Test user password |
| `test_otp` | Mock OTP code |
| `access_token` | Bearer token (auto-populated from login) |
| `refresh_token` | Refresh token (auto-populated from login) |
| `admin_token` | Admin token (auto-populated from Get Admin Token) |

## Common Workflows

### Direct Grant Flow (Active User)
1. **Login Start** - Send email + password
   - Check response for `AUTHENTICATED` flow
   - Tokens are returned immediately

2. **Get Current User** - Verify user profile
   - Uses the returned `access_token`

3. **Logout** - Revoke tokens
   - Sends `refresh_token` to orchestrator

### OTP Flow (New User)
1. **Login Start** - Send email only (no password)
   - Response will have `OTP_REQUIRED` flow with `txnId`

2. **Verify OTP** - Send txnId + OTP
   - Response will have `keycloakAuthUrl`
   - User must visit this URL to set password in Keycloak

3. **Auth Callback** - After Keycloak password setup
   - Exchange `code` and `state` for tokens
   - This is called automatically by frontend

### Admin Operations
1. **Get Admin Token** - Obtain service account token
   - Uses client_credentials grant
   - Stores token in `admin_token` variable

2. **List Users** - List all users in realm
   - Requires `admin_token`

3. **Get User by Username** - Find specific user
   - Requires `admin_token`

## Tips

- **Auto-populate variables**: Postman can extract tokens from responses. Use the **Tests** tab to set variables:
  ```javascript
  var jsonData = pm.response.json();
  pm.environment.set("access_token", jsonData.tokens.accessToken);
  pm.environment.set("refresh_token", jsonData.tokens.refreshToken);
  ```

- **Pre-request scripts**: Set up data before requests (e.g., generate timestamps)
  ```javascript
  pm.environment.set("timestamp", new Date().getTime());
  ```

- **Debugging**: Check the **Console** (Ctrl+Alt+C) to see request/response details

- **Share collections**: Export collection and send to team members for collaboration

## Troubleshooting

**"No environment selected" error:**
- Click environment dropdown (top-right)
- Select one of the imported environments

**"Variable is not defined" error:**
- Verify the environment is selected
- Check that all required variables exist in the environment
- Click the environment name to edit and verify values

**"Connection refused" error:**
- Verify services are running (orchestrator on 4000, iam-service on 3000, keycloak on 8080)
- Check URLs in the selected environment

**"401 Unauthorized" error on protected endpoints:**
- Run "Login Start" first to get access token
- Or run "Get Admin Token" for admin endpoints
- Verify the token is stored in `access_token` or `admin_token` variable

## Documentation

For detailed API documentation, service architecture, and configuration, see the main [README.md](./README.md) in the project root.
