package com.diksha.keycloak;

import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

import jakarta.ws.rs.core.MultivaluedMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Keycloak custom authenticator for DIKSHA migration activation flow.
 *
 * When a migrated user completes OTP verification, the IAM orchestrator generates a
 * short-lived signed activation_token and includes it in the Keycloak authorization
 * URL. This authenticator:
 *   1. Reads activation_token from the incoming auth request query params
 *   2. Validates its HMAC-SHA256 signature and expiry
 *   3. Resolves the Keycloak user by identifier (email/username)
 *   4. Sets UPDATE_PASSWORD as a required action
 *   5. Calls context.success() so Keycloak immediately shows the Update Password page
 *
 * For requests without a valid activation_token, context.attempted() is called so
 * the flow falls through to the normal username + password form.
 */
public class ActivationTokenAuthenticator implements Authenticator {

    private static final Logger LOG = Logger.getLogger(ActivationTokenAuthenticator.class);
    private static final String ACTIVATION_TOKEN_PARAM = "activation_token";
    private static final String AUTH_NOTE_KEY = "diksha_activation_token";

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        // Read activation_token: first from cached auth-session note, then from request params
        String activationToken = context.getAuthenticationSession().getClientNote(AUTH_NOTE_KEY);

        if (activationToken == null || activationToken.isEmpty()) {
            try {
                MultivaluedMap<String, String> params =
                        context.getHttpRequest().getUri().getQueryParameters();
                activationToken = params.getFirst(ACTIVATION_TOKEN_PARAM);
            } catch (Exception e) {
                LOG.debug("Could not read activation_token from request: " + e.getMessage());
            }

            if (activationToken == null || activationToken.isEmpty()) {
                LOG.debug("No activation_token – passing to next authenticator");
                context.attempted();
                return;
            }

            // Cache in auth session so it survives across form submissions
            context.getAuthenticationSession().setClientNote(AUTH_NOTE_KEY, activationToken);
        }

        LOG.info("Processing DIKSHA activation_token");

        try {
            TokenPayload payload = validateToken(activationToken);
            if (payload == null) {
                LOG.warn("activation_token validation failed – passing to next authenticator");
                context.getAuthenticationSession().removeClientNote(AUTH_NOTE_KEY);
                context.attempted();
                return;
            }

            // Resolve Keycloak user
            RealmModel realm = context.getRealm();
            UserModel user = resolveUser(context.getSession(), realm, payload.identifier);

            if (user == null) {
                LOG.warnf("User not found for identifier: %s", payload.identifier);
                context.getAuthenticationSession().removeClientNote(AUTH_NOTE_KEY);
                context.attempted();
                return;
            }

            if (!user.isEnabled()) {
                LOG.warnf("User is disabled: %s", payload.identifier);
                context.getAuthenticationSession().removeClientNote(AUTH_NOTE_KEY);
                context.attempted();
                return;
            }

            // Ensure UPDATE_PASSWORD required action is present
            boolean hasUpdatePassword = user.getRequiredActionsStream()
                    .anyMatch(a -> UserModel.RequiredAction.UPDATE_PASSWORD.name().equals(a));

            if (!hasUpdatePassword) {
                user.addRequiredAction(UserModel.RequiredAction.UPDATE_PASSWORD);
                LOG.infof("Added UPDATE_PASSWORD required action for user: %s", payload.identifier);
            }

            // Authenticate the user for this browser session
            // Keycloak will then execute required actions (showing the Update Password page)
            context.setUser(user);
            context.success();
            LOG.infof("Activation token auth succeeded for: %s", payload.identifier);

        } catch (Exception e) {
            LOG.errorf(e, "Unexpected error processing activation_token");
            context.attempted();
        }
    }

    private UserModel resolveUser(KeycloakSession session, RealmModel realm, String identifier) {
        // Try email first
        UserModel user = session.users().getUserByEmail(realm, identifier);
        if (user != null) return user;
        // Fall back to username
        return session.users().getUserByUsername(realm, identifier);
    }

    /**
     * Validate the activation token:
     *   format: base64url(header).base64url(payload).base64url(HMAC-SHA256 signature)
     */
    private TokenPayload validateToken(String token) {
        String secret = System.getenv("ACTIVATION_TOKEN_SECRET");
        if (secret == null || secret.isEmpty()) {
            LOG.error("ACTIVATION_TOKEN_SECRET environment variable is not set");
            return null;
        }

        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            LOG.debug("activation_token does not have 3 parts");
            return null;
        }

        String headerB64  = parts[0];
        String payloadB64 = parts[1];
        String sigB64     = parts[2];

        // Verify HMAC-SHA256 signature
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] expectedBytes = mac.doFinal(
                    (headerB64 + "." + payloadB64).getBytes(StandardCharsets.UTF_8));
            String expectedSig = Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(expectedBytes);

            if (!expectedSig.equals(sigB64)) {
                LOG.debug("activation_token signature mismatch");
                return null;
            }
        } catch (Exception e) {
            LOG.errorf(e, "HMAC validation error");
            return null;
        }

        // Decode and parse payload (no external JSON library – simple flat parsing)
        try {
            byte[] payloadBytes = Base64.getUrlDecoder().decode(payloadB64);
            String payloadJson  = new String(payloadBytes, StandardCharsets.UTF_8);
            return parsePayload(payloadJson);
        } catch (Exception e) {
            LOG.errorf(e, "Error decoding activation_token payload");
            return null;
        }
    }

    /** Minimal flat-JSON parser (avoids needing Jackson in the classpath). */
    private TokenPayload parsePayload(String json) {
        try {
            json = json.trim();
            if (!json.startsWith("{") || !json.endsWith("}")) return null;
            json = json.substring(1, json.length() - 1);

            String identifier = extractString(json, "identifier");
            String purpose    = extractString(json, "purpose");
            Long   exp        = extractLong(json,   "exp");

            if (identifier == null || purpose == null || exp == null) {
                LOG.debugf("Missing required fields in activation_token payload");
                return null;
            }

            long nowSeconds = System.currentTimeMillis() / 1000;
            if (exp < nowSeconds) {
                LOG.debug("activation_token has expired");
                return null;
            }

            if (!"PASSWORD_ACTIVATION".equals(purpose)) {
                LOG.debugf("Wrong token purpose: %s", purpose);
                return null;
            }

            TokenPayload p = new TokenPayload();
            p.identifier = identifier;
            p.purpose    = purpose;
            p.exp        = exp;
            return p;

        } catch (Exception e) {
            LOG.errorf(e, "Error parsing activation_token payload JSON");
            return null;
        }
    }

    private String extractString(String json, String key) {
        String searchKey = "\"" + key + "\"";
        int keyIdx = json.indexOf(searchKey);
        if (keyIdx < 0) return null;
        int colonIdx = json.indexOf(':', keyIdx + searchKey.length());
        if (colonIdx < 0) return null;
        int startQuote = json.indexOf('"', colonIdx + 1);
        if (startQuote < 0) return null;
        int endQuote = json.indexOf('"', startQuote + 1);
        if (endQuote < 0) return null;
        return json.substring(startQuote + 1, endQuote);
    }

    private Long extractLong(String json, String key) {
        String searchKey = "\"" + key + "\"";
        int keyIdx = json.indexOf(searchKey);
        if (keyIdx < 0) return null;
        int colonIdx = json.indexOf(':', keyIdx + searchKey.length());
        if (colonIdx < 0) return null;
        int start = colonIdx + 1;
        while (start < json.length() && json.charAt(start) == ' ') start++;
        int end = start;
        while (end < json.length() && Character.isDigit(json.charAt(end))) end++;
        if (end == start) return null;
        return Long.parseLong(json.substring(start, end));
    }

    @Override public void action(AuthenticationFlowContext context) {}
    @Override public boolean requiresUser() { return false; }
    @Override public boolean configuredFor(KeycloakSession s, RealmModel r, UserModel u) { return true; }
    @Override public void setRequiredActions(KeycloakSession s, RealmModel r, UserModel u) {}
    @Override public void close() {}

    static class TokenPayload {
        String identifier;
        String purpose;
        long   exp;
    }
}
