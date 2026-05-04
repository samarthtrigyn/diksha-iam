<#import "template.ftl" as layout>
<@layout.registrationLayout showAnotherWayIfPresent=social.showButtonsIfPresent; section>
    <#if section = "title">
        ${msg("updatePasswordTitle")}
    <#elseif section = "header">
        <div class="diksha-header">
            <div class="diksha-logo">
                <h1>DIKSHA</h1>
            </div>
            <h2>${msg("updatePasswordTitle")}</h2>
        </div>
    <#elseif section = "form">
        <form id="kc-passwd-update-form" class="${properties.kcFormClass!}" method="post">
            <input type="text" id="username" name="username" value="${username}" style="display:none;"/>
            <input type="password" id="password" name="password" style="display:none;"/>

            <div class="diksha-update-password-box">
                <p class="diksha-message">
                    For your security, please create a strong password to continue.
                </p>

                <div class="${properties.kcFormGroupClass!}">
                    <label for="password-new" class="${properties.kcLabelClass!}">${msg("passwordNew")}</label>
                    <input type="password" id="password-new" name="password-new" class="${properties.kcInputClass!}" autofocus autocomplete="off" />
                </div>

                <div class="${properties.kcFormGroupClass!}">
                    <label for="password-confirm" class="${properties.kcLabelClass!}">${msg("passwordConfirm")}</label>
                    <input type="password" id="password-confirm" name="password-confirm" class="${properties.kcInputClass!}" autocomplete="off" />
                </div>

                <div class="${properties.kcFormButtonsClass!}">
                    <button type="submit" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonLargeClass!}" name="submitAction" value="Update">${msg("doSubmit")}</button>
                </div>
            </div>
        </form>
    <#elseif section = "info" >
    </#if>
</@layout.registrationLayout>
