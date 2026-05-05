# Stage 1: Build the custom authenticator JAR
FROM maven:3.9-eclipse-temurin-17-alpine AS builder

WORKDIR /build
COPY authenticator/pom.xml ./pom.xml
COPY authenticator/src ./src

# Download dependencies first (better layer caching)
RUN mvn dependency:go-offline -q

# Build the JAR (skip tests since this is an SPI extension)
RUN mvn package -DskipTests -q

# Stage 2: Keycloak with the custom provider
FROM quay.io/keycloak/keycloak:24.0.5

# Install the activation-token authenticator SPI
COPY --from=builder /build/target/activation-token-authenticator-1.0.0.jar \
     /opt/keycloak/providers/activation-token-authenticator.jar

# Copy custom theme
COPY themes/diksha-demo /opt/keycloak/themes/diksha-demo

# Keycloak will automatically load providers from /opt/keycloak/providers/ on startup
