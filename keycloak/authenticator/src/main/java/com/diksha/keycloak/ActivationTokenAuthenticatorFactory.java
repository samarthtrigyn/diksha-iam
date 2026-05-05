package com.diksha.keycloak;

import org.keycloak.Config;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;

import java.util.Collections;
import java.util.List;

/**
 * SPI factory for the DIKSHA Activation Token Authenticator.
 * Provider ID: diksha-activation-token
 */
public class ActivationTokenAuthenticatorFactory implements AuthenticatorFactory {

    public static final String PROVIDER_ID = "diksha-activation-token";

    private static final ActivationTokenAuthenticator SINGLETON =
            new ActivationTokenAuthenticator();

    private static final AuthenticationExecutionModel.Requirement[] REQUIREMENT_CHOICES = {
        AuthenticationExecutionModel.Requirement.REQUIRED,
        AuthenticationExecutionModel.Requirement.ALTERNATIVE,
        AuthenticationExecutionModel.Requirement.DISABLED
    };

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getDisplayType() {
        return "DIKSHA Activation Token";
    }

    @Override
    public String getHelpText() {
        return "Authenticates migrated users via a short-lived signed activation_token " +
               "that is passed as a query parameter in the Keycloak authorization URL. " +
               "If no valid token is present, falls through to the next authenticator.";
    }

    @Override
    public String getReferenceCategory() {
        return "token";
    }

    @Override
    public boolean isConfigurable() {
        return false;
    }

    @Override
    public AuthenticationExecutionModel.Requirement[] getRequirementChoices() {
        return REQUIREMENT_CHOICES;
    }

    @Override
    public boolean isUserSetupAllowed() {
        return false;
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return Collections.emptyList();
    }

    @Override
    public Authenticator create(KeycloakSession session) {
        return SINGLETON;
    }

    @Override
    public void init(Config.Scope config) {}

    @Override
    public void postInit(KeycloakSessionFactory factory) {}

    @Override
    public void close() {}
}
