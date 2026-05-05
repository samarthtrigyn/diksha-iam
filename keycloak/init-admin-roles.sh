#!/bin/bash
# Initialize admin client roles for Keycloak
# This grants the service account manage-users permission

echo "Initializing Keycloak admin client roles..."

# Wait for Keycloak to be ready
sleep 10

# Get admin token
TOKEN=$(curl -s -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=admin_password" \
  -d "grant_type=password" | jq -r '.access_token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "Failed to get admin token"
  exit 1
fi

echo "Got admin token, assigning roles..."

# Get realm-management client ID
REALM_MGMT_CLIENT=$(curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/admin/realms/diksha-demo/clients \
  | jq -r '.[] | select(.clientId=="realm-management") | .id')

if [ -z "$REALM_MGMT_CLIENT" ]; then
  echo "Failed to find realm-management client"
  exit 1
fi

echo "Found realm-management client: $REALM_MGMT_CLIENT"

# Get iam-admin-client service account user ID
IAM_ADMIN_SA=$(curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/admin/realms/diksha-demo/clients \
  | jq -r '.[] | select(.clientId=="iam-admin-client") | .id')

if [ -z "$IAM_ADMIN_SA" ]; then
  echo "Failed to find iam-admin-client"
  exit 1
fi

echo "Found iam-admin-client: $IAM_ADMIN_SA"

# Get manage-users role ID
MANAGE_USERS_ROLE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/admin/realms/diksha-demo/clients/$REALM_MGMT_CLIENT/roles \
  | jq -r '.[] | select(.name=="manage-users") | .id')

if [ -z "$MANAGE_USERS_ROLE" ]; then
  echo "Failed to find manage-users role"
  exit 1
fi

echo "Found manage-users role: $MANAGE_USERS_ROLE"

# Get service account user
SA_USER=$(curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/admin/realms/diksha-demo/clients/$IAM_ADMIN_SA/service-account-user \
  | jq -r '.id')

if [ -z "$SA_USER" ]; then
  echo "Failed to find service account user"
  exit 1
fi

echo "Found service account user: $SA_USER"

# Assign manage-users role to service account
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/admin/realms/diksha-demo/users/$SA_USER/role-mappings/clients/$REALM_MGMT_CLIENT \
  -d "[{\"id\":\"$MANAGE_USERS_ROLE\",\"name\":\"manage-users\"}]"

echo "Role assignment completed!"
