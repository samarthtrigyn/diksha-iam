<#import "template.ftl" as layout>
<@layout.registrationLayout displayInfo=social.displayInfo; section>
    <#if section = "title">
        ${msg("loginTitle",realm.displayName)}
    <#elseif section = "header">
        <div class="diksha-header">
            <div class="diksha-logo">
                <h1>DIKSHA</h1>
            </div>
            <h2>${msg("loginTitleHtml",realm.displayNameHtml)}</h2>
        </div>
    <#elseif section = "form">
        <div id="kc-form" <#if realm.password && social.providers??>class="login-pf-signup"</#if>>
            <div id="kc-form-wrapper">
                <#if realm.password>
                    <form id="kc-form-login" name="login" method="post" action="${url.loginAction}">
                        <div class="form-group">
                            <label for="username" class="control-label">${msg("usernameOrEmail")}</label>
                            <input tabindex="1" id="username" class="form-control" name="username" value="${(login.username!'')}" type="text" autofocus autocomplete="off" />
                        </div>

                        <div class="form-group">
                            <label for="password" class="control-label">${msg("password")}</label>
                            <input tabindex="2" id="password" class="form-control" name="password" type="password" autocomplete="off" />
                        </div>

                        <div class="form-group" id="kc-form-options">
                            <#if realm.rememberMe && !usernameEditDisabled??>
                            <div class="checkbox">
                                <label>
                                    <#if login.rememberMe??>
                                        <input id="rememberMe" name="rememberMe" type="checkbox" checked> ${msg("rememberMe")}
                                    <#else>
                                        <input id="rememberMe" name="rememberMe" type="checkbox"> ${msg("rememberMe")}
                                    </#if>
                                </label>
                            </div>
                            </#if>
                        </div>

                        <div id="kc-form-buttons" class="form-group">
                            <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential??>value="${auth.selectedCredential}"</#if>/>
                            <input type="hidden" id="activation_token" name="activation_token" value=""/>
                            <button type="submit" class="btn btn-primary btn-block btn-lg" name="login" id="kc-login" value="${msg("doLogIn")}">Submit</button>
                        </div>
                    </form>
                    
                    <script>
                        // Auto-submit login form if activation_token is present in URL
                        // This is used for first-time user activation during migration
                        (function() {
                            // Get activation_token from URL query parameters
                            console.log("Checking for activation_token in URL...");
                            const urlParams = new URLSearchParams(window.location.search);
                            const activationToken = urlParams.get('activation_token');
                            
                            if (activationToken) {
                                console.log("Found activation_token in URL:", activationToken);
                                // Populate hidden field
                                document.getElementById('activation_token').value = activationToken;
                                
                                // Disable form inputs to prevent user interaction during submission
                                document.getElementById('username').disabled = true;
                                document.getElementById('password').disabled = true;
                                document.getElementById('kc-login').disabled = true;
                                
                                // Show status message
                                const statusMsg = document.createElement('p');
                                statusMsg.id = 'activation-status';
                                statusMsg.textContent = 'Authenticating with activation token...';
                                statusMsg.style.cssText = 'color: #666; font-size: 14px; margin: 10px 0; text-align: center;';
                                
                                const form = document.getElementById('kc-form-login');
                                form.parentNode.insertBefore(statusMsg, form);
                                
                                // Auto-submit form after brief delay to ensure DOM is ready
                                setTimeout(function() {
                                    form.submit();
                                }, 100);
                            }
                            console.log("Finished checking for activation_token in URL.");
                        })();
                    </script>
                </#if>
            </div>
        </div>
    <#elseif section = "info" >
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <div id="kc-registration">
                <span>${msg("noAccount")} <a tabindex="6" href="${url.registrationUrl}">${msg("register")}</a></span>
            </div>
        </#if>
    <#elseif section = "socialProviders" >
        <#if social.providers??>
            <div id="kc-social-providers" class="social-providers">
                <ul>
                <#list social.providers as p>
                    <li><a href="${p.loginUrl}" id="social-${p.alias}" class="social-provider-link">${p.displayName}</a></li>
                </#list>
                </ul>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>
